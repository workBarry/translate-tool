import { browser, type Browser } from "wxt/browser";

import { isSpeechPlaybackEventMessage } from "../src/shared/speech-messages";

import type { SpeechTarget } from "./selection/types";
import { createShadowRootUi, defineContentScript } from "#imports";
import { createApp, reactive } from "vue";
import {
  destroyAllTranslatorSessions,
} from './selection/translator-session-cache';
import {
  detectSpeechLanguage,
  speakTextInBackground,
  stopSpeechInBackground,
} from "./selection/speech-client";

import TranslationCard from "./selection/TranslationCard.vue";
import { PopoverController } from "./selection/popover-controller";
import { calculatePopoverPosition } from "./selection/position-calculator";
import { getTextSelection } from "./selection/selection-detector";
import { translateWithChrome } from "./selection/native-translation.provider";
import "./selection/style.css";

import type { TranslationPopoverState } from "./selection/types";
import type { TranslationLanguage } from "./selection/types";

/*
 * WXT 會使用 name 建立同名的自訂元素，
 * 也就是 <instant-translator>。
 */
const TRANSLATOR_HOST_TAG = "instant-translator";

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
  matches: ["http://*/*", "https://*/*"],

  /*
   * 匯入的 selection/style.css
   * 只注入 Shadow Root UI。
   */
  cssInjectionMode: "ui",

  async main(ctx) {
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

    console.log("[Instant Translator] Content Script 已載入", {
      instanceId,
      url: window.location.href,
    });

    /*
     * Vue 卡片共用狀態。
     */
    const state = reactive<TranslationPopoverState>({
      status: "hidden",

      sourceText: "",
      translatedText: "",
      errorMessage: "",

      left: 0,
      top: 0,

      targetLanguage: "zh-Hant",

      detectedSourceLanguage: "",

      speechPlaybackStatus: "idle",

      activeSpeechTarget: null,

      speechErrorMessage: "",
    });
    const popoverController = new PopoverController(state);

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
        state.activeSpeechTarget === 'source' &&
        (
          state.speechPlaybackStatus === 'starting' ||
          state.speechPlaybackStatus === 'speaking'
        )
      ) {
        await stopCurrentSpeech();
        return;
      }

      if (state.speechPlaybackStatus === 'stopping') {
        return;
      }

      const requestId = crypto.randomUUID();

      latestSpeechRequestId = requestId;

      popoverController.beginSpeech('source');

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

        console.error("[Instant Translator] 原文發音失敗", error);

        popoverController.showSpeechError(error instanceof Error ? error.message : "原文發音失敗");
      }
    };

    const speakTranslatedText = async (): Promise<void> => {
      const text = state.translatedText.trim();

      if (!text) {
        return;
      }

      if (
        state.activeSpeechTarget === 'translation' &&
        (
          state.speechPlaybackStatus === 'starting' ||
          state.speechPlaybackStatus === 'speaking'
        )
      ) {
        await stopCurrentSpeech();
        return;
      }

      if (state.speechPlaybackStatus === 'stopping') {
        return;
      }

      const requestId = crypto.randomUUID();

      latestSpeechRequestId = requestId;

      popoverController.beginSpeech('translation');

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

        console.error("[Instant Translator] 譯文發音失敗", error);

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
        console.error("[Instant Translator] 停止發音失敗", error);

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

              onSpeakSource: speakSourceText,

              onSpeakTranslation: speakTranslatedText,

              onStopSpeech: stopCurrentSpeech,

              onChangeTargetLanguage: changeTargetLanguage,
            });

            app.mount(mountPoint);

            console.log("[Instant Translator] Shadow UI 已掛載", {
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

            console.log("[Instant Translator] Shadow UI 已移除", {
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
          console.error("[Instant Translator] Shadow UI 建立失敗", error);

          throw error;
        })
        .finally(() => {
          uiMountPromise = null;
        });

      return uiMountPromise;
    };

    const handleSpeechPlaybackMessage = (
  message: unknown,
  sender:
    Browser.runtime.MessageSender,
): void => {
  if (
    sender.id !==
    browser.runtime.id
  ) {
    return;
  }

  if (
    !isSpeechPlaybackEventMessage(
      message,
    )
  ) {
    return;
  }

  const {
    requestId,
    eventType,
    errorMessage,
  } = message.payload;

  /*
   * 忽略上一段語音遲到的
   * interrupted 或 end。
   */
  if (
    requestId !==
    latestSpeechRequestId
  ) {
    return;
  }

  if (eventType === 'start') {
    popoverController
      .markSpeechStarted();

    return;
  }

  if (
    eventType === 'end' ||
    eventType ===
      'interrupted' ||
    eventType ===
      'cancelled'
  ) {
    latestSpeechRequestId =
      null;

    popoverController
      .finishSpeech();

    return;
  }

  if (eventType === 'error') {
    latestSpeechRequestId =
      null;

    popoverController
      .showSpeechError(
        errorMessage ??
          '語音播放失敗',
      );
  }
};

browser.runtime.onMessage.addListener(
  handleSpeechPlaybackMessage,
);

    /**
     * 向 Background Service Worker
     * 發送翻譯請求。
     */
    const startTranslation = (text: string, pointerX?: number, pointerY?: number): void => {
      if (!isCurrentInstance()) {
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

        pageLanguage: document.documentElement.lang,

        targetLanguage: state.targetLanguage,

        signal: abortController.signal,

        onDownloadProgress(percentage) {
          console.log("[Instant Translator] 模型下載中", {
            requestId,
            percentage,
          });
        },
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

          if (requestId !== latestRequestId) {
            return;
          }

          if (abortController.signal.aborted) {
            return;
          }

          if (!isCurrentInstance()) {
            return;
          }

          state.detectedSourceLanguage =
            result.sourceLanguage;

          popoverController.showSuccess(result.translatedText);

          console.log("[Instant Translator] 收到 Chrome 翻譯結果", {
            requestId,

            sourceLanguage: result.sourceLanguage,

            targetLanguage: result.targetLanguage,

            originalText: result.originalText,

            translatedText: result.translatedText,
          });
        } catch (error: unknown) {
          if (isAbortError(error)) {
            console.log("[Instant Translator] 翻譯已取消", {
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

          console.error("[Instant Translator] Chrome 翻譯失敗", {
            requestId,
            error,
          });

          popoverController.showError(error instanceof Error ? error.message : "翻譯發生未知錯誤");
        } finally {
          if (activeAbortController === abortController) {
            activeAbortController = null;
          }
        }
      })();
    };

    const changeTargetLanguage = (targetLanguage: TranslationLanguage): void => {
      if (state.targetLanguage === targetLanguage) {
        return;
      }

      state.targetLanguage = targetLanguage;

      const text = state.sourceText.trim();

      if (!text || state.status === "hidden") {
        return;
      }

      /*
       * 不傳滑鼠座標，
       * 使用目前卡片位置重新翻譯。
       */
      startTranslation(text);
    };
    /**
     * 處理有效的選取文字。
     */
    const handleSelectedText = async (text: string, pointerX: number, pointerY: number): Promise<void> => {
      await ensureTranslationUiMounted();

      await startTranslation(text, pointerX, pointerY);
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
        if (!isCurrentInstance()) {
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

        const selectedContent = getTextSelection(event);

        if (!selectedContent) {
          return;
        }

        handleSelectedText(selectedContent.text, selectedContent.pointerX, selectedContent.pointerY);
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
     * Escape 關閉卡片。
     */
    ctx.addEventListener(
      document,
      "keydown",
      (event) => {
        if (!isCurrentInstance()) {
          return;
        }

        if (event.key !== "Escape") {
          return;
        }

        hidePopover();
      },
      {
        capture: true,
      },
    );

    /*
     * 網頁捲動時關閉卡片。
     */
    ctx.addEventListener(
      window,
      "scroll",
      () => {
        if (!isCurrentInstance()) {
          return;
        }

        if (state.status === "hidden") {
          return;
        }

        hidePopover();
      },
      {
        capture: true,
        passive: true,
      },
    );

    /*
     * 視窗尺寸改變時關閉卡片，
     * 避免卡片停留在錯誤位置。
     */
    ctx.addEventListener(
      window,
      "resize",
      () => {
        if (!isCurrentInstance()) {
          return;
        }

        if (state.status === "hidden") {
          return;
        }

        hidePopover();
      },
      {
        passive: true,
      },
    );

    /*
     * SPA 網址切換時清除目前卡片。
     */
    ctx.addEventListener(window, "wxt:locationchange", () => {
      if (!isCurrentInstance()) {
        return;
      }

      hidePopover();
    });

    /*
     * WXT HMR、擴充功能重載或
     * Content Script 被新版取代時清理。
     */
    ctx.onInvalidated(() => {
      latestRequestId = null;

      abortActiveTranslation();

      translationUi?.remove();
      translationUi = null;

      uiMountPromise = null;

      /*
       * 只有目前仍是最新 instance，
       * 才清除 global instance ID。
       *
       * 避免舊 instance 清除新版 ID。
       */
      if (isCurrentInstance()) {
        delete globalScope[GLOBAL_INSTANCE_KEY];
      }
      void destroyAllTranslatorSessions()
      .catch((error: unknown) => {
        console.debug(
          '[Instant Translator] 清除 Translator session 失敗',
          error,
        );
      });
      void stopSpeechInBackground().catch(() => {
        // 擴充功能失效時不再處理錯誤。
      });
      console.log("[Instant Translator] Content Script 已清理", {
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isTranslatorUiEvent(event: Event): boolean {
  return event.composedPath().some((node) => {
    if (!(node instanceof Element)) {
      return false;
    }

    return (
      node.matches("instant-translator") ||
      node.id === "instant-translator-app" ||
      node.classList.contains("translation-card")
    );
  });
}
