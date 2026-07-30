import {
  debugLog,
  errorLog,
} from "../src/shared/logger";

import { browser, type Browser } from "wxt/browser";
import {
  loadTranslatorSettings,
  saveTranslatorSettings,
  watchTranslatorSettings,
} from "../src/shared/translator-settings.storage";

import { DEFAULT_TRANSLATOR_SETTINGS } from "../src/shared/translator-settings.types";

import type { TranslatorSettings } from "../src/shared/translator-settings.types";

import { isSpeechPlaybackEventMessage } from "../src/shared/speech-messages";

import type { PopoverPosition, SourceLanguageSetting, SpeechTarget } from "./selection/types";
import { createShadowRootUi, defineContentScript } from "#imports";
import { createApp, reactive } from "vue";
import { destroyAllTranslatorSessions } from "./selection/translator-session-cache";
import {
  destroyLanguageDetector,
  resolveImmediateSourceLanguage,
  resolveSourceLanguageWithDetector,
} from "./selection/language-detector.service";
import {
  detectSpeechLanguage,
  speakTextInBackground,
  stopSpeechInBackground,
} from "./selection/speech-client";

import TranslationCard from "./selection/TranslationCard.vue";
import { PopoverController } from "./selection/popover-controller";
import { calculatePopoverPosition } from "./selection/position-calculator";
import { getCurrentSelectedText } from "./selection/selection-detector";
import { translateWithChrome } from "./selection/native-translation.provider";
import {
  createTranslationError,
  isAbortError,
  logTranslationError,
  normalizeTranslationError,
} from "./selection/translation-error";
import "./selection/style.css";

import type { TranslationPopoverState } from "./selection/types";
import type { TranslationLanguage } from "./selection/types";

/*
 * WXT 會使用 name 建立同名的自訂元素，
 * 也就是 <instant-translator>。
 */
const TRANSLATOR_HOST_TAG = "instant-translator";
const CONTENT_SCRIPT_MARKER = "data-instant-translator-loaded";

/*
 * 用來辨識目前頁面中最新的 Content Script instance。
 *
 * 使用 isolated world 內的 globalThis，
 * 不修改原始網站的 html、body 屬性。
 */
const GLOBAL_INSTANCE_KEY = "__instantTranslatorInstanceId__";

interface TranslatorGlobalScope {
  __instantTranslatorInstanceId__?: string;
}

/*
 * 只保存我們實際需要的方法，
 * 不必把 WXT UI 的完整泛型型別寫在這裡。
 */
interface TranslationUi {
  mount(): void;
  remove(): void;
}

export default defineContentScript({
  matches: ["<all_urls>"],

  allFrames: false,

  runAt: "document_idle",

  /*
   * 匯入的 selection/style.css
   * 只注入 Shadow Root UI。
   */
  cssInjectionMode: "ui",

  async main(ctx) {
    if (document.documentElement.hasAttribute(CONTENT_SCRIPT_MARKER)) {
      debugLog("Content Script 已存在，略過重複注入");
      return;
    }

    document.documentElement.setAttribute(
      CONTENT_SCRIPT_MARKER,
      "true",
    );

    if (window.top !== window) {
      document.documentElement.removeAttribute(CONTENT_SCRIPT_MARKER);
      return;
    }

    const instanceId = crypto.randomUUID();

    const globalScope = globalThis as typeof globalThis & TranslatorGlobalScope;

    /*
     * 新 Content Script instance 啟動後，
     * 讓舊 instance 停止處理事件。
     */
    globalScope[GLOBAL_INSTANCE_KEY] = instanceId;

    const isCurrentInstance = (): boolean => {
      return globalScope[GLOBAL_INSTANCE_KEY] === instanceId;
    };

    debugLog("[Instant Translator] Content Script 已載入", {
      instanceId,
    });
    const initialSettings = await loadTranslatorSettings().catch((error: unknown) => {
      errorLog("[Instant Translator] 載入設定失敗", error);

      return {
        ...DEFAULT_TRANSLATOR_SETTINGS,
      };
    });

    if (ctx.isInvalid || !isCurrentInstance()) {
      return;
    }
    /*
     * Vue 卡片共用狀態。
     */
    const state = reactive<TranslationPopoverState>({
      enabled: initialSettings.enabled,

      sourceLanguageSetting: initialSettings.sourceLanguageSetting,

      targetLanguage: initialSettings.targetLanguage,
      status: "hidden",

      sourceText: "",
      translatedText: "",
      errorMessage: "",
      errorCode: null,
      canRetry: false,

      left: 0,
      top: 0,

      detectedSourceLanguage: "",

      detectedSourceConfidence: null,

      modelStatus: "idle",

      modelDownloadProgress: 0,

      speechPlaybackStatus: "idle",

      activeSpeechTarget: null,

      speechErrorMessage: "",
    });
    const popoverController = new PopoverController(state);

    function adjustPopoverPosition(position: PopoverPosition): void {
      if (ctx.isInvalid || !isCurrentInstance()) {
        return;
      }

      state.left = position.left;
      state.top = position.top;
    }

    /*
     * 目前最新的翻譯請求。
     *
     * 回應回來時會比對 requestId，
     * 防止舊回應覆蓋新選取文字。
     */
    let latestRequestId: string | null = null;

    let latestSpeechRequestId: string | null = null;

    /*
     * Content Script 端的取消控制器。
     */
    let activeAbortController: AbortController | null = null;

    /*
     * Shadow UI 在第一次選字前不建立。
     */
    let translationUi: TranslationUi | null = null;

    /*
     * 避免快速連續選字時，
     * 同時執行兩次 createShadowRootUi。
     */
    let uiMountPromise: Promise<void> | null = null;

    let selectionProcessFrame: number | null = null;

    const abortActiveTranslation = (): void => {
      const controller = activeAbortController;

      activeAbortController = null;

      controller?.abort();
    };

    const speakSourceText = async (): Promise<void> => {
      const text = state.sourceText.trim();

      if (!text) {
        return;
      }

      if (
        state.activeSpeechTarget === "source" &&
        (state.speechPlaybackStatus === "starting" || state.speechPlaybackStatus === "speaking")
      ) {
        await stopCurrentSpeech();
        return;
      }

      if (state.speechPlaybackStatus === "stopping") {
        return;
      }

      const requestId = crypto.randomUUID();

      latestSpeechRequestId = requestId;

      popoverController.beginSpeech("source");

      try {
        await speakTextInBackground({
          requestId,
          text,
          target: "source",

          lang: detectSpeechLanguage(text),

          rate: 1,
          pitch: 1,
        });
      } catch (error: unknown) {
        if (latestSpeechRequestId === requestId) {
          latestSpeechRequestId = null;
        }

        errorLog("[Instant Translator] 原文發音失敗", error);

        popoverController.showSpeechError(error instanceof Error ? error.message : "原文發音失敗");
      }
    };

    const speakTranslatedText = async (): Promise<void> => {
      const text = state.translatedText.trim();

      if (!text) {
        return;
      }

      if (
        state.activeSpeechTarget === "translation" &&
        (state.speechPlaybackStatus === "starting" || state.speechPlaybackStatus === "speaking")
      ) {
        await stopCurrentSpeech();
        return;
      }

      if (state.speechPlaybackStatus === "stopping") {
        return;
      }

      const requestId = crypto.randomUUID();

      latestSpeechRequestId = requestId;

      popoverController.beginSpeech("translation");

      try {
        await speakTextInBackground({
          requestId,
          text,
          target: "translation",

          /*
           * 目前目標語言固定為繁體中文。
           */
          lang: "zh-TW",

          rate: 1,
          pitch: 1,
        });
      } catch (error: unknown) {
        if (latestSpeechRequestId === requestId) {
          latestSpeechRequestId = null;
        }

        errorLog("[Instant Translator] 譯文發音失敗", error);

        popoverController.showSpeechError(error instanceof Error ? error.message : "譯文發音失敗");
      }
    };

    const stopCurrentSpeech = async (): Promise<void> => {
      if (!latestSpeechRequestId) {
        popoverController.finishSpeech();
        return;
      }

      popoverController.beginStopSpeech();

      try {
        await stopSpeechInBackground();

        latestSpeechRequestId = null;

        popoverController.finishSpeech();
      } catch (error: unknown) {
        errorLog("[Instant Translator] 停止發音失敗", error);

        popoverController.showSpeechError(error instanceof Error ? error.message : "無法停止發音");
      }
    };
    const hidePopover = (): void => {
      latestRequestId = null;

      abortActiveTranslation();

      /*
       * 關閉卡片時一併停止發音。
       */
      void stopSpeechInBackground().catch(() => {
        // 關閉卡片時不再顯示發音錯誤。
      });

      popoverController.hide();
    };

    /**
     * 移除舊版程式或 HMR 遺留的宿主。
     *
     * 只會在真正準備掛載新 UI 時執行，
     * 不會在一般頁面載入時修改 DOM。
     */
    const removeStaleHosts = (): void => {
      document.querySelectorAll(TRANSLATOR_HOST_TAG).forEach((element) => {
        element.remove();
      });
    };

    /**
     * 第一次選字時才建立 Shadow UI。
     */
    const ensureTranslationUiMounted = async (): Promise<void> => {
      /*
       * 已完成掛載，不再重複處理。
       */
      if (translationUi) {
        return;
      }

      /*
       * 已有建立程序正在進行，
       * 後續呼叫共用同一個 Promise。
       */
      if (uiMountPromise) {
        return uiMountPromise;
      }

      uiMountPromise = (async () => {
        removeStaleHosts();

        const createdUi = await createShadowRootUi(ctx, {
          name: TRANSLATOR_HOST_TAG,

          /*
           * 不使用 modal。
           *
           * overlay 不應建立覆蓋整個畫面的
           * 透明互動區域。
           */
          position: "overlay",

          zIndex: 2_147_483_647,

          /*
           * 不在 Shadow Root 層級
           * 阻止網站事件。
           *
           * 卡片本身透過 Vue 的
           * @pointerdown.stop 處理即可。
           */
          isolateEvents: false,

          onMount(container, _shadow, shadowHost) {
            configureOverlayHost(shadowHost, container, instanceId);

            /*
             * 不直接把 Vue 掛在
             * WXT 提供的 body container。
             *
             * 使用獨立 mount point，
             * 方便明確清除。
             */
            const mountPoint = document.createElement("div");

            mountPoint.id = "instant-translator-app";

            configureMountPoint(mountPoint);

            container.append(mountPoint);

            const app = createApp(TranslationCard, {
              state,

              onClose: hidePopover,

              onRetry: retryTranslation,

              onSpeakSource: speakSourceText,

              onSpeakTranslation: speakTranslatedText,

              onStopSpeech: stopCurrentSpeech,

              onChangeSourceLanguage: changeSourceLanguage,

              onChangeTargetLanguage: changeTargetLanguage,

              onAdjustPosition: adjustPopoverPosition,
            });

            app.mount(mountPoint);

            debugLog("[Instant Translator] Shadow UI 已掛載", {
              instanceId,
              shadowHost,
              container,
              mountPoint,
              hostRect: shadowHost.getBoundingClientRect(),
            });

            return {
              app,
              mountPoint,
            };
          },

          onRemove(mounted) {
            mounted?.app.unmount();
            mounted?.mountPoint.remove();

            debugLog("[Instant Translator] Shadow UI 已移除", {
              instanceId,
            });
          },
        });

        /*
         * createShadowRootUi 是非同步的。
         * 等待期間，Content Script 可能已失效，
         * 或已被更新的 instance 取代。
         */
        if (ctx.isInvalid || !isCurrentInstance()) {
          createdUi.remove();
          return;
        }

        /*
         * 整份程式只有這一個 mount 呼叫。
         */
        createdUi.mount();

        translationUi = createdUi;
      })()
        .catch((error: unknown) => {
          errorLog("[Instant Translator] Shadow UI 建立失敗", error);

          throw error;
        })
        .finally(() => {
          uiMountPromise = null;
        });

      return uiMountPromise;
    };

    const handleSpeechPlaybackMessage = (message: unknown, sender: Browser.runtime.MessageSender): void => {
      if (sender.id !== browser.runtime.id) {
        return;
      }

      if (!isSpeechPlaybackEventMessage(message)) {
        return;
      }

      const { requestId, eventType, errorMessage } = message.payload;

      /*
       * 忽略上一段語音遲到的
       * interrupted 或 end。
       */
      if (requestId !== latestSpeechRequestId) {
        return;
      }

      if (eventType === "start") {
        popoverController.markSpeechStarted();

        return;
      }

      if (eventType === "end" || eventType === "interrupted" || eventType === "cancelled") {
        latestSpeechRequestId = null;

        popoverController.finishSpeech();

        return;
      }

      if (eventType === "error") {
        latestSpeechRequestId = null;

        popoverController.showSpeechError(errorMessage ?? "語音播放失敗");
      }
    };

    browser.runtime.onMessage.addListener(handleSpeechPlaybackMessage);

    /**
     * 向 Background Service Worker
     * 發送翻譯請求。
     */
    const startTranslationLegacy = (text: string, pointerX?: number, pointerY?: number): void => {
      if (!state.enabled || !isCurrentInstance()) {
        return;
      }

      abortActiveTranslation();

      const requestId = crypto.randomUUID();

      latestRequestId = requestId;

      const abortController = new AbortController();

      activeAbortController = abortController;

      const hasPointerPosition = typeof pointerX === "number" && typeof pointerY === "number";

      const position = hasPointerPosition
        ? calculatePopoverPosition(pointerX, pointerY)
        : {
            left: state.left,
            top: state.top,
          };
      /*
       * UI 尚未掛載也沒關係。
       * reactive state 會在 Vue 掛載後
       * 顯示目前最新狀態。
       */
      popoverController.showLoading(text, position);

      popoverController.showModelDownloading(0);

      const pageLanguage = getSelectionLanguageHint();

      debugLog("[Instant Translator] 準備呼叫 translateWithChrome", {
        requestId,
        pageLanguage,
        targetLanguage: state.targetLanguage,
      });

      /*
       * 重要：
       *
       * translateWithChrome() 必須在這裡
       * 立即呼叫。
       *
       * 不能先 await ensureTranslationUiMounted()，
       * 否則可能失去 user activation。
       */
      const translationPromise = translateWithChrome({
        text,

        sourceLanguage: "en",

        targetLanguage: state.targetLanguage,

        signal: abortController.signal,

        onDownloadProgress(percentage) {
          if (requestId !== latestRequestId || abortController.signal.aborted || !isCurrentInstance()) {
            return;
          }

          popoverController.showModelDownloading(percentage);

          debugLog("[Instant Translator] 模型下載中", {
            requestId,
            percentage,
          });
        },

        onPreparing() {
          if (requestId !== latestRequestId || abortController.signal.aborted || !isCurrentInstance()) {
            return;
          }

          popoverController.showModelPreparing();

          debugLog("[Instant Translator] 模型下載完成，正在準備 session", {
            requestId,
          });
        },

        onReady() {
          if (requestId !== latestRequestId || abortController.signal.aborted || !isCurrentInstance()) {
            return;
          }

          popoverController.showModelReady();

          debugLog("[Instant Translator] Translator session 已可使用", {
            requestId,
          });
        },
      });

      debugLog("[Instant Translator] translateWithChrome 已回傳 Promise", {
        requestId,
      });

      /*
       * 翻譯已開始建立後，
       * 再進行 UI 掛載及結果處理。
       */
      void (async () => {
        try {
          await ensureTranslationUiMounted();

          if (ctx.isInvalid || !isCurrentInstance()) {
            abortController.abort();
            return;
          }

          const result = await translationPromise;

          debugLog("[Instant Translator] translateWithChrome Promise 已完成", {
            requestId,
            sourceLanguage: result.sourceLanguage,
            targetLanguage: result.targetLanguage,
          });

          if (requestId !== latestRequestId) {
            debugLog("[Instant Translator] 忽略舊翻譯結果", {
              requestId,
              latestRequestId,
            });

            return;
          }

          if (abortController.signal.aborted) {
            return;
          }

          if (!isCurrentInstance()) {
            return;
          }

          state.detectedSourceLanguage = result.sourceLanguage;

          popoverController.showSuccess(result.translatedText);

          debugLog("[Instant Translator] 收到 Chrome 翻譯結果", {
            requestId,

            sourceLanguage: result.sourceLanguage,

            targetLanguage: result.targetLanguage,

          });
        } catch (error: unknown) {
          errorLog("[Instant Translator] translateWithChrome Promise 失敗", {
            requestId,
            error,
            aborted: abortController.signal.aborted,
          });

          if (isAbortError(error)) {
            debugLog("[Instant Translator] 翻譯已取消", {
              requestId,
            });

            return;
          }

          if (requestId !== latestRequestId) {
            return;
          }

          if (!isCurrentInstance()) {
            return;
          }

          errorLog("[Instant Translator] Chrome 翻譯失敗", {
            requestId,
            error,
          });

          popoverController.showError(
            normalizeTranslationError(error, "translate"),
          );
        } finally {
          if (activeAbortController === abortController) {
            activeAbortController = null;
          }
        }
      })();
    };

    function retryTranslation(): void {
      if (!state.enabled || state.status !== "error" || !state.canRetry) {
        return;
      }

      const sourceText = state.sourceText.trim();

      if (!sourceText) {
        return;
      }

      startTranslation(sourceText);
    }

    function startTranslation(text: string, pointerX?: number, pointerY?: number): void {
      if (!state.enabled || ctx.isInvalid || !isCurrentInstance()) {
        return;
      }

      const normalizedText = text.trim();

      if (!normalizedText) {
        return;
      }

      abortActiveTranslation();

      const requestId = crypto.randomUUID();
      latestRequestId = requestId;

      const abortController = new AbortController();
      activeAbortController = abortController;

      const position =
        typeof pointerX === "number" && typeof pointerY === "number"
          ? calculatePopoverPosition(pointerX, pointerY)
          : {
              left: state.left,
              top: state.top,
            };

      const pageLanguage = getSelectionLanguageHint();

      state.detectedSourceLanguage = "";
      state.detectedSourceConfidence = null;

      popoverController.showLoading(normalizedText, position);

      void ensureTranslationUiMounted().catch((error: unknown) => {
        if (requestId !== latestRequestId || !isCurrentInstance()) {
          return;
        }

        popoverController.showError(
          normalizeTranslationError(error),
        );
      });

      const immediateResolution = resolveImmediateSourceLanguage({
        text: normalizedText,
        sourceLanguageSetting: state.sourceLanguageSetting,
        pageLanguage,
      });

      if (immediateResolution?.language) {
        state.detectedSourceLanguage = immediateResolution.language;
        state.detectedSourceConfidence = immediateResolution.confidence;

        beginResolvedTranslation({
          requestId,
          text: normalizedText,
          sourceLanguage: immediateResolution.language,
          abortController,
        });

        return;
      }

      void resolveSourceLanguageWithDetector({
        text: normalizedText,
        sourceLanguageSetting: state.sourceLanguageSetting,
        pageLanguage,
        onDownloadProgress(percentage) {
          if (requestId !== latestRequestId || abortController.signal.aborted || !isCurrentInstance()) {
            return;
          }

          debugLog("[Instant Translator] Language Detector 模型下載中", { requestId, percentage });
        },
      })
        .then((resolution) => {
          if (requestId !== latestRequestId || abortController.signal.aborted || !isCurrentInstance()) {
            return;
          }

          if (!resolution.language) {
            popoverController.showError(
              createTranslationError("LANGUAGE_AMBIGUOUS"),
            );
            clearActiveTranslation(abortController);
            return;
          }

          state.detectedSourceLanguage = resolution.language;
          state.detectedSourceConfidence = resolution.confidence;

          beginResolvedTranslation({
            requestId,
            text: normalizedText,
            sourceLanguage: resolution.language,
            abortController,
          });
        })
        .catch((error: unknown) => {
          if (requestId !== latestRequestId || abortController.signal.aborted || !isCurrentInstance()) {
            return;
          }

          const normalizedError = normalizeTranslationError(error, "detect");

          if (isAbortError(normalizedError)) {
            return;
          }

          logTranslationError("來源語言偵測失敗", error, {
            requestId,
            phase: "detect",
            targetLanguage: state.targetLanguage,
          });

          popoverController.showError(normalizedError);
          clearActiveTranslation(abortController);
        });
    }

    function beginResolvedTranslation(input: {
      requestId: string;
      text: string;
      sourceLanguage: string;
      abortController: AbortController;
    }): void {
      debugLog("[Instant Translator] 開始翻譯", {
        requestId: input.requestId,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: state.targetLanguage,
      });

      const translationPromise = translateWithChrome({
        text: input.text,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: state.targetLanguage,
        signal: input.abortController.signal,
        onDownloadProgress(percentage) {
          if (
            input.requestId !== latestRequestId ||
            input.abortController.signal.aborted ||
            !isCurrentInstance()
          ) {
            return;
          }

          popoverController.showModelDownloading(percentage);
        },
        onPreparing() {
          if (
            input.requestId === latestRequestId &&
            !input.abortController.signal.aborted &&
            isCurrentInstance()
          ) {
            popoverController.showModelPreparing();
          }
        },
        onReady() {
          if (
            input.requestId === latestRequestId &&
            !input.abortController.signal.aborted &&
            isCurrentInstance()
          ) {
            popoverController.showModelReady();
          }
        },
      });

      void translationPromise
        .then((result) => {
          if (
            input.requestId !== latestRequestId ||
            input.abortController.signal.aborted ||
            !isCurrentInstance()
          ) {
            return;
          }

          state.detectedSourceLanguage = result.sourceLanguage;
          popoverController.showSuccess(result.translatedText);

          debugLog("[Instant Translator] 翻譯完成", {
            requestId: input.requestId,
            sourceLanguage: result.sourceLanguage,
            targetLanguage: result.targetLanguage,
          });
        })
        .catch((error: unknown) => {
          const normalizedError = normalizeTranslationError(error, "translate");

          if (isAbortError(normalizedError)) {
            debugLog("[Instant Translator] 翻譯已取消", {
              requestId: input.requestId,
            });
            return;
          }

          if (input.requestId !== latestRequestId || !isCurrentInstance()) {
            return;
          }

          logTranslationError("翻譯失敗", error, {
            requestId: input.requestId,
            phase: "translate",
            sourceLanguage: input.sourceLanguage,
            targetLanguage: state.targetLanguage,
          });

          popoverController.showError(normalizedError);
        })
        .finally(() => {
          clearActiveTranslation(input.abortController);
        });
    }
    function persistTranslatorSettings(): void {
      const settings: TranslatorSettings = {
        enabled: state.enabled,

        sourceLanguageSetting: state.sourceLanguageSetting,

        targetLanguage: state.targetLanguage,
      };

      void saveTranslatorSettings(settings)
        .then(() => {
          debugLog("[Instant Translator] 設定已保存", settings);
        })
        .catch((error: unknown) => {
          /*
           * 保存設定失敗不應破壞
           * 目前正在進行的翻譯。
           */
          errorLog("[Instant Translator] 保存設定失敗", {
            settings,
            error,
          });
        });
    }
    function clearActiveTranslation(abortController: AbortController): void {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }

    function changeSourceLanguage(sourceLanguageSetting: SourceLanguageSetting): void {
      if (state.sourceLanguageSetting === sourceLanguageSetting) {
        return;
      }

      state.sourceLanguageSetting = sourceLanguageSetting;

      state.detectedSourceLanguage = "";

      state.detectedSourceConfidence = null;

      /*
       * 即使目前沒有開啟卡片，
       * 也要保存使用者設定。
       */
      persistTranslatorSettings();

      const text = state.sourceText.trim();

      if (!text || state.status === "hidden") {
        return;
      }

      startTranslation(text);
    }

    function changeTargetLanguage(targetLanguage: TranslationLanguage): void {
      if (state.targetLanguage === targetLanguage) {
        return;
      }

      state.targetLanguage = targetLanguage;

      /*
       * 先更新並保存設定。
       */
      persistTranslatorSettings();

      const sourceText = state.sourceText.trim();

      if (!sourceText || state.status === "hidden") {
        return;
      }

      /*
       * 不傳入座標，
       * 保持卡片目前位置。
       */
      startTranslation(sourceText);
    }
    const unwatchTranslatorSettings = watchTranslatorSettings((settings) => {
      if (ctx.isInvalid || !isCurrentInstance()) {
        return;
      }

      const enabledChanged = state.enabled !== settings.enabled;

      const sourceChanged = state.sourceLanguageSetting !== settings.sourceLanguageSetting;

      const targetChanged = state.targetLanguage !== settings.targetLanguage;

      if (!enabledChanged && !sourceChanged && !targetChanged) {
        return;
      }

      const becameDisabled = state.enabled && !settings.enabled;

      state.enabled = settings.enabled;

      state.sourceLanguageSetting = settings.sourceLanguageSetting;

      state.targetLanguage = settings.targetLanguage;

      if (sourceChanged) {
        state.detectedSourceLanguage = "";

        state.detectedSourceConfidence = null;
      }

      if (becameDisabled) {
        hidePopover();
      }

      debugLog("[Instant Translator] 已同步其他分頁的設定", {
        enabled: settings.enabled,

        sourceLanguageSetting: settings.sourceLanguageSetting,

        targetLanguage: settings.targetLanguage,
      });
    });
    /**
     * 處理有效的選取文字。
     */
    const handleSelectedText = (selectedText: string, pointerX: number, pointerY: number): void => {
      if (!state.enabled) {
        return;
      }

      startTranslation(selectedText, pointerX, pointerY);
    };
    /*
     * 使用者放開滑鼠後，
     * 判斷是否有有效選取文字。
     *
     * capture 只代表較早收到事件，
     * 這裡沒有 preventDefault 或
     * stopPropagation，不會阻止網站操作。
     */
    ctx.addEventListener(
      document,
      "pointerup",
      (event) => {
        if (
          !state.enabled ||
          ctx.isInvalid ||
          !isCurrentInstance()
        ) {
          return;
        }

        /*
         * document 使用 capture，
         * 所以會比 Vue 的 @pointerup.stop
         * 更早收到事件。
         *
         * 必須在這裡主動忽略翻譯卡片內事件。
         */
        if (isTranslatorUiEvent(event)) {
          return;
        }

        if (event.button !== 0) {
          return;
        }

        const pointerX = event.clientX;
        const pointerY = event.clientY;
        const eventTarget = event.target;

        if (selectionProcessFrame !== null) {
          cancelAnimationFrame(selectionProcessFrame);
        }

        selectionProcessFrame = requestAnimationFrame(() => {
          selectionProcessFrame = null;

          if (ctx.isInvalid || !isCurrentInstance()) {
            return;
          }

          const selectedText = getCurrentSelectedText(eventTarget);

          if (!selectedText) {
            if (state.status !== "hidden") {
              hidePopover();
            }

            return;
          }

          handleSelectedText(selectedText, pointerX, pointerY);
        });
      },
      {
        capture: true,
      },
    );

    /*
     * 點擊卡片外部時關閉。
     *
     * TranslationCard.vue 的
     * @pointerdown.stop
     * 會阻止卡片內事件抵達這裡。
     */
    ctx.addEventListener(document, "pointerdown", (event) => {
      if (!isCurrentInstance()) {
        return;
      }

      if (isTranslatorUiEvent(event)) {
        return;
      }

      if (state.status === "hidden") {
        return;
      }

      hidePopover();
    });

    /*
     * 網頁捲動時關閉卡片。
     */
    /*
     * 視窗尺寸改變時關閉卡片，
     * 避免卡片停留在錯誤位置。
     */
    /*
     * SPA 網址切換時清除目前卡片。
     */
    const dismissForPageLifecycle = (): void => {
      if (!isCurrentInstance()) {
        return;
      }

      hidePopover();
    };

    ctx.addEventListener(window, "pagehide", dismissForPageLifecycle);

    ctx.addEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        return;
      }

      dismissForPageLifecycle();
    });

    ctx.addEventListener(window, "popstate", dismissForPageLifecycle);
    ctx.addEventListener(window, "hashchange", dismissForPageLifecycle);
    ctx.addEventListener(window, "wxt:locationchange", dismissForPageLifecycle);

    /*
     * WXT HMR、擴充功能重載或
     * Content Script 被新版取代時清理。
     */
    ctx.onInvalidated(() => {
      latestRequestId = null;

      document.documentElement.removeAttribute(CONTENT_SCRIPT_MARKER);

      if (selectionProcessFrame !== null) {
        cancelAnimationFrame(selectionProcessFrame);
        selectionProcessFrame = null;
      }

      abortActiveTranslation();

      void destroyLanguageDetector().catch((error: unknown) => {
        debugLog("[Instant Translator] 清除 Language Detector 失敗", error);
      });

      translationUi?.remove();
      translationUi = null;

      uiMountPromise = null;
      unwatchTranslatorSettings();
      /*
       * 只有目前仍是最新 instance，
       * 才清除 global instance ID。
       *
       * 避免舊 instance 清除新版 ID。
       */
      if (isCurrentInstance()) {
        delete globalScope[GLOBAL_INSTANCE_KEY];
      }
      void destroyAllTranslatorSessions().catch((error: unknown) => {
        debugLog("[Instant Translator] 清除 Translator session 失敗", error);
      });
      void stopSpeechInBackground().catch(() => {
        // 擴充功能失效時不再處理錯誤。
      });
      debugLog("[Instant Translator] Content Script 已清理", {
        instanceId,
      });
    });
  },
});

/**
 * 設定 WXT Shadow Host。
 *
 * Host 本身存在於原始網站 DOM，
 * 因此關鍵樣式全部使用 !important。
 *
 * Host 尺寸固定為 0 × 0，
 * 不會形成覆蓋網頁的透明點擊層。
 */
function configureOverlayHost(shadowHost: HTMLElement, container: HTMLElement, instanceId: string): void {
  shadowHost.dataset["instantTranslatorInstance"] = instanceId;
  shadowHost.dataset["instantTranslatorHost"] = "true";

  const hostStyles: Record<string, string> = {
    all: "initial",
    display: "block",
    position: "fixed",

    left: "0",
    top: "0",
    right: "auto",
    bottom: "auto",

    width: "0",
    height: "0",
    "min-width": "0",
    "min-height": "0",
    "max-width": "0",
    "max-height": "0",

    margin: "0",
    padding: "0",
    border: "0",

    overflow: "visible",
    visibility: "visible",
    opacity: "1",

    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",

    filter: "none",
    perspective: "none",
    contain: "none",
    "content-visibility": "visible",

    /*
     * 宿主不攔截任何網頁事件。
     */
    "pointer-events": "none",

    /*
     * 建立自己的高層 stacking context。
     */
    isolation: "isolate",
    "z-index": "2147483647",
  };

  applyImportantStyles(shadowHost, hostStyles);

  const containerStyles: Record<string, string> = {
    all: "initial",
    display: "block",
    position: "fixed",

    left: "0",
    top: "0",
    right: "auto",
    bottom: "auto",

    width: "0",
    height: "0",
    "min-width": "0",
    "min-height": "0",
    "max-width": "0",
    "max-height": "0",

    margin: "0",
    padding: "0",
    border: "0",

    overflow: "visible",
    visibility: "visible",
    opacity: "1",

    transform: "none",
    contain: "none",

    /*
     * Shadow Root 外層容器也不攔截事件。
     */
    "pointer-events": "none",

    "z-index": "2147483647",
  };

  applyImportantStyles(container, containerStyles);
}

/**
 * Vue 專用掛載點。
 */
function configureMountPoint(mountPoint: HTMLElement): void {
  const styles: Record<string, string> = {
    display: "block",
    position: "fixed",

    left: "0",
    top: "0",

    width: "0",
    height: "0",

    margin: "0",
    padding: "0",
    border: "0",

    overflow: "visible",

    /*
     * 掛載點本身不攔截事件。
     * .translation-card 會改回 pointer-events: auto。
     */
    "pointer-events": "none",

    "z-index": "2147483647",
  };

  applyImportantStyles(mountPoint, styles);
}

/**
 * 批次加入 inline !important。
 */
function applyImportantStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value, "important");
  }
}

function isTranslatorUiEvent(event: Event): boolean {
  return event.composedPath().some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    return (
      node.matches("instant-translator") ||
      node.id === "instant-translator-app" ||
      node.classList.contains("translation-card") ||
      node.dataset.instantTranslatorHost === "true" ||
      node.dataset.instantTranslatorRoot !== undefined
    );
  });
}

function getSelectionLanguageHint(): string {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return document.documentElement.lang || "";
  }

  const range = selection.getRangeAt(0);

  const commonAncestor = range.commonAncestorContainer;

  const element = commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;

  const languageElement = element?.closest<HTMLElement>("[lang]");

  const nearestLanguage = languageElement?.getAttribute("lang")?.trim();

  if (nearestLanguage) {
    return nearestLanguage;
  }

  return document.documentElement.lang || "";
}
