import {
  createShadowRootUi,
  defineContentScript,
} from '#imports';
import {
  createApp,
  reactive,
} from 'vue';

import TranslationCard from './selection/TranslationCard.vue';
import { PopoverController } from './selection/popover-controller';
import { calculatePopoverPosition } from './selection/position-calculator';
import { getTextSelection } from './selection/selection-detector';
import {
  isAbortError,
  translateInBackground,
} from './selection/translation-client';
import './selection/style.css';

import type {
  TranslationPopoverState,
} from './selection/types';

/*
 * WXT 會使用 name 建立同名的自訂元素，
 * 也就是 <instant-translator>。
 */
const TRANSLATOR_HOST_TAG =
  'instant-translator';

/*
 * 用來辨識目前頁面中最新的 Content Script instance。
 *
 * 使用 isolated world 內的 globalThis，
 * 不修改原始網站的 html、body 屬性。
 */
const GLOBAL_INSTANCE_KEY =
  '__instantTranslatorInstanceId__';

interface TranslatorGlobalScope {
  __instantTranslatorInstanceId__?:
    string;
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
  matches: [
    'http://*/*',
    'https://*/*',
  ],

  /*
   * 匯入的 selection/style.css
   * 只注入 Shadow Root UI。
   */
  cssInjectionMode: 'ui',

  async main(ctx) {
    const instanceId =
      crypto.randomUUID();

    const globalScope =
      globalThis as typeof globalThis &
        TranslatorGlobalScope;

    /*
     * 新 Content Script instance 啟動後，
     * 讓舊 instance 停止處理事件。
     */
    globalScope[
      GLOBAL_INSTANCE_KEY
    ] = instanceId;

    const isCurrentInstance =
      (): boolean => {
        return (
          globalScope[
            GLOBAL_INSTANCE_KEY
          ] === instanceId
        );
      };

    console.log(
      '[Instant Translator] Content Script 已載入',
      {
        instanceId,
        url: window.location.href,
      },
    );

    /*
     * Vue 卡片共用狀態。
     */
    const state =
      reactive<TranslationPopoverState>({
        status: 'hidden',
        sourceText: '',
        translatedText: '',
        errorMessage: '',
        left: 0,
        top: 0,
      });

    const popoverController =
      new PopoverController(state);

    /*
     * 目前最新的翻譯請求。
     *
     * 回應回來時會比對 requestId，
     * 防止舊回應覆蓋新選取文字。
     */
    let latestRequestId:
      | string
      | null = null;

    /*
     * Content Script 端的取消控制器。
     */
    let activeAbortController:
      | AbortController
      | null = null;

    /*
     * Shadow UI 在第一次選字前不建立。
     */
    let translationUi:
      | TranslationUi
      | null = null;

    /*
     * 避免快速連續選字時，
     * 同時執行兩次 createShadowRootUi。
     */
    let uiMountPromise:
      | Promise<void>
      | null = null;

    const abortActiveTranslation =
      (): void => {
        const controller =
          activeAbortController;

        activeAbortController = null;

        controller?.abort();
      };

    const hidePopover = (): void => {
      latestRequestId = null;

      abortActiveTranslation();
      popoverController.hide();
    };

    /**
     * 移除舊版程式或 HMR 遺留的宿主。
     *
     * 只會在真正準備掛載新 UI 時執行，
     * 不會在一般頁面載入時修改 DOM。
     */
    const removeStaleHosts =
      (): void => {
        document
          .querySelectorAll(
            TRANSLATOR_HOST_TAG,
          )
          .forEach((element) => {
            element.remove();
          });
      };

    /**
     * 第一次選字時才建立 Shadow UI。
     */
    const ensureTranslationUiMounted =
      async (): Promise<void> => {
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

          const createdUi =
            await createShadowRootUi(
              ctx,
              {
                name:
                  TRANSLATOR_HOST_TAG,

                /*
                 * 不使用 modal。
                 *
                 * overlay 不應建立覆蓋整個畫面的
                 * 透明互動區域。
                 */
                position: 'overlay',

                zIndex:
                  2_147_483_647,

                /*
                 * 不在 Shadow Root 層級
                 * 阻止網站事件。
                 *
                 * 卡片本身透過 Vue 的
                 * @pointerdown.stop 處理即可。
                 */
                isolateEvents: false,

                onMount(
                  container,
                  _shadow,
                  shadowHost,
                ) {
                  configureOverlayHost(
                    shadowHost,
                    container,
                    instanceId,
                  );

                  /*
                   * 不直接把 Vue 掛在
                   * WXT 提供的 body container。
                   *
                   * 使用獨立 mount point，
                   * 方便明確清除。
                   */
                  const mountPoint =
                    document.createElement(
                      'div',
                    );

                  mountPoint.id =
                    'instant-translator-app';

                  configureMountPoint(
                    mountPoint,
                  );

                  container.append(
                    mountPoint,
                  );

                  const app = createApp(
                    TranslationCard,
                    {
                      state,
                      onClose:
                        hidePopover,
                    },
                  );

                  app.mount(
                    mountPoint,
                  );

                  console.log(
                    '[Instant Translator] Shadow UI 已掛載',
                    {
                      instanceId,
                      shadowHost,
                      container,
                      mountPoint,
                      hostRect:
                        shadowHost
                          .getBoundingClientRect(),
                    },
                  );

                  return {
                    app,
                    mountPoint,
                  };
                },

                onRemove(mounted) {
                  mounted?.app.unmount();
                  mounted?.mountPoint.remove();

                  console.log(
                    '[Instant Translator] Shadow UI 已移除',
                    {
                      instanceId,
                    },
                  );
                },
              },
            );

          /*
           * createShadowRootUi 是非同步的。
           * 等待期間，Content Script 可能已失效，
           * 或已被更新的 instance 取代。
           */
          if (
            ctx.isInvalid ||
            !isCurrentInstance()
          ) {
            createdUi.remove();
            return;
          }

          /*
           * 整份程式只有這一個 mount 呼叫。
           */
          createdUi.mount();

          translationUi =
            createdUi;
        })()
          .catch((error: unknown) => {
            console.error(
              '[Instant Translator] Shadow UI 建立失敗',
              error,
            );

            throw error;
          })
          .finally(() => {
            uiMountPromise = null;
          });

        return uiMountPromise;
      };

    /**
     * 向 Background Service Worker
     * 發送翻譯請求。
     */
    const startTranslation = async (
      text: string,
      pointerX: number,
      pointerY: number,
    ): Promise<void> => {
      if (!isCurrentInstance()) {
        return;
      }

      /*
       * 新翻譯開始前，
       * 先取消上一個翻譯。
       */
      abortActiveTranslation();

      const requestId =
        crypto.randomUUID();

      latestRequestId =
        requestId;

      const abortController =
        new AbortController();

      activeAbortController =
        abortController;

      const position =
        calculatePopoverPosition(
          pointerX,
          pointerY,
        );

      popoverController.showLoading(
        text,
        position,
      );

      console.log(
        '[Instant Translator] 傳送翻譯請求',
        {
          instanceId,
          requestId,
          textLength:
            text.length,
          position,
        },
      );

      try {
        const result =
          await translateInBackground(
            {
              requestId,
              text,
              targetLanguage:
                'zh-TW',
            },
            abortController.signal,
          );

        /*
         * 可能已重新選取其他文字。
         */
        if (
          requestId !==
          latestRequestId
        ) {
          return;
        }

        /*
         * 使用者可能已關閉卡片。
         */
        if (
          abortController
            .signal.aborted
        ) {
          return;
        }

        /*
         * Content Script 可能已被新版取代。
         */
        if (
          !isCurrentInstance()
        ) {
          return;
        }

        popoverController.showSuccess(
          result.translatedText,
        );

        console.log(
          '[Instant Translator] 收到翻譯結果',
          {
            instanceId,
            requestId,
            result,
          },
        );
      } catch (error: unknown) {
        /*
         * 主動取消不顯示為翻譯錯誤。
         */
        if (isAbortError(error)) {
          console.log(
            '[Instant Translator] 翻譯請求已取消',
            {
              instanceId,
              requestId,
            },
          );

          return;
        }

        /*
         * 舊請求錯誤不更新目前 UI。
         */
        if (
          requestId !==
          latestRequestId
        ) {
          return;
        }

        if (
          !isCurrentInstance()
        ) {
          return;
        }

        console.error(
          '[Instant Translator] 翻譯失敗',
          {
            instanceId,
            requestId,
            error,
          },
        );

        popoverController.showError(
          error instanceof Error
            ? error.message
            : '翻譯發生未知錯誤',
        );
      } finally {
        /*
         * 只有目前 controller
         * 才能清除 activeAbortController。
         */
        if (
          activeAbortController ===
          abortController
        ) {
          activeAbortController =
            null;
        }
      }
    };

    /**
     * 處理有效的選取文字。
     */
    const handleSelectedText =
      async (
        text: string,
        pointerX: number,
        pointerY: number,
      ): Promise<void> => {
        if (!isCurrentInstance()) {
          return;
        }

        try {
          /*
           * 第一次選字時才掛載 UI。
           */
          await ensureTranslationUiMounted();
        } catch {
          /*
           * ensureTranslationUiMounted
           * 已經輸出詳細錯誤。
           */
          return;
        }

        if (
          ctx.isInvalid ||
          !isCurrentInstance() ||
          !translationUi
        ) {
          return;
        }

        await startTranslation(
          text,
          pointerX,
          pointerY,
        );
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
      'pointerup',
      (event) => {
        if (!isCurrentInstance()) {
          return;
        }

        const selectedContent =
          getTextSelection(event);

        if (!selectedContent) {
          return;
        }

        void handleSelectedText(
          selectedContent.text,
          selectedContent.pointerX,
          selectedContent.pointerY,
        );
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
    ctx.addEventListener(
      document,
      'pointerdown',
      () => {
        if (!isCurrentInstance()) {
          return;
        }

        if (
          state.status ===
          'hidden'
        ) {
          return;
        }

        hidePopover();
      },
    );

    /*
     * Escape 關閉卡片。
     */
    ctx.addEventListener(
      document,
      'keydown',
      (event) => {
        if (!isCurrentInstance()) {
          return;
        }

        if (
          event.key !==
          'Escape'
        ) {
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
      'scroll',
      () => {
        if (!isCurrentInstance()) {
          return;
        }

        if (
          state.status ===
          'hidden'
        ) {
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
      'resize',
      () => {
        if (!isCurrentInstance()) {
          return;
        }

        if (
          state.status ===
          'hidden'
        ) {
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
    ctx.addEventListener(
      window,
      'wxt:locationchange',
      () => {
        if (!isCurrentInstance()) {
          return;
        }

        hidePopover();
      },
    );

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
        delete globalScope[
          GLOBAL_INSTANCE_KEY
        ];
      }

      console.log(
        '[Instant Translator] Content Script 已清理',
        {
          instanceId,
        },
      );
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
function configureOverlayHost(
  shadowHost: HTMLElement,
  container: HTMLElement,
  instanceId: string,
): void {
  shadowHost.dataset[
    'instantTranslatorInstance'
  ] = instanceId;

  const hostStyles: Record<
    string,
    string
  > = {
    all: 'initial',
    display: 'block',
    position: 'fixed',

    left: '0',
    top: '0',
    right: 'auto',
    bottom: 'auto',

    width: '0',
    height: '0',
    'min-width': '0',
    'min-height': '0',
    'max-width': '0',
    'max-height': '0',

    margin: '0',
    padding: '0',
    border: '0',

    overflow: 'visible',
    visibility: 'visible',
    opacity: '1',

    transform: 'none',
    translate: 'none',
    rotate: 'none',
    scale: 'none',

    filter: 'none',
    perspective: 'none',
    contain: 'none',
    'content-visibility':
      'visible',

    /*
     * 宿主不攔截任何網頁事件。
     */
    'pointer-events': 'none',

    /*
     * 建立自己的高層 stacking context。
     */
    isolation: 'isolate',
    'z-index': '2147483647',
  };

  applyImportantStyles(
    shadowHost,
    hostStyles,
  );

  const containerStyles: Record<
    string,
    string
  > = {
    all: 'initial',
    display: 'block',
    position: 'fixed',

    left: '0',
    top: '0',
    right: 'auto',
    bottom: 'auto',

    width: '0',
    height: '0',
    'min-width': '0',
    'min-height': '0',
    'max-width': '0',
    'max-height': '0',

    margin: '0',
    padding: '0',
    border: '0',

    overflow: 'visible',
    visibility: 'visible',
    opacity: '1',

    transform: 'none',
    contain: 'none',

    /*
     * Shadow Root 外層容器也不攔截事件。
     */
    'pointer-events': 'none',

    'z-index': '2147483647',
  };

  applyImportantStyles(
    container,
    containerStyles,
  );
}

/**
 * Vue 專用掛載點。
 */
function configureMountPoint(
  mountPoint: HTMLElement,
): void {
  const styles: Record<
    string,
    string
  > = {
    display: 'block',
    position: 'fixed',

    left: '0',
    top: '0',

    width: '0',
    height: '0',

    margin: '0',
    padding: '0',
    border: '0',

    overflow: 'visible',

    /*
     * 掛載點本身不攔截事件。
     * .translation-card 會改回 pointer-events: auto。
     */
    'pointer-events': 'none',

    'z-index': '2147483647',
  };

  applyImportantStyles(
    mountPoint,
    styles,
  );
}

/**
 * 批次加入 inline !important。
 */
function applyImportantStyles(
  element: HTMLElement,
  styles: Record<string, string>,
): void {
  for (
    const [property, value]
    of Object.entries(styles)
  ) {
    element.style.setProperty(
      property,
      value,
      'important',
    );
  }
}