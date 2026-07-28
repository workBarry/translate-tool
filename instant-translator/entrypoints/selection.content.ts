import {
  createShadowRootUi,
  defineContentScript,
} from '#imports';
import { createApp, reactive } from 'vue';

import TranslationCard from './selection/TranslationCard.vue';
import {
  isAbortError,
  translateText,
} from './selection/fake-translation.service';
import { PopoverController } from './selection/popover-controller';
import { calculatePopoverPosition } from './selection/position-calculator';
import { getTextSelection } from './selection/selection-detector';
import './selection/style.css';

import type { TranslationPopoverState } from './selection/types';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],

  cssInjectionMode: 'ui',

  async main(ctx) {
    console.log(
      '[Instant Translator] Content Script 已載入',
    );

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

    let latestRequestId = 0;

    let activeAbortController:
      | AbortController
      | null = null;

    const abortActiveTranslation = (): void => {
      activeAbortController?.abort();
      activeAbortController = null;
    };

    const hidePopover = (): void => {
      // 讓目前進行中的請求失效。
      latestRequestId += 1;

      abortActiveTranslation();
      popoverController.hide();
    };

    const startTranslation = async (
      text: string,
      pointerX: number,
      pointerY: number,
    ): Promise<void> => {
      // 若上一個請求尚未完成，先取消。
      abortActiveTranslation();

      const requestId = ++latestRequestId;

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
        '[Instant Translator] 開始模擬翻譯',
        {
          requestId,
          text,
        },
      );

      try {
        const result = await translateText(
          text,
          abortController.signal,
        );

        // 使用者可能已經選取其他文字。
        // 舊請求不得更新目前卡片。
        if (requestId !== latestRequestId) {
          return;
        }

        if (abortController.signal.aborted) {
          return;
        }

        popoverController.showSuccess(
          result.translatedText,
        );

        console.log(
          '[Instant Translator] 模擬翻譯完成',
          {
            requestId,
            result,
          },
        );
      } catch (error: unknown) {
        // 被新請求或關閉操作取消，
        // 不屬於真正錯誤。
        if (isAbortError(error)) {
          console.log(
            '[Instant Translator] 翻譯請求已取消',
            {
              requestId,
            },
          );

          return;
        }

        if (requestId !== latestRequestId) {
          return;
        }

        console.error(
          '[Instant Translator] 模擬翻譯失敗',
          error,
        );

        popoverController.showError(
          error instanceof Error
            ? error.message
            : '發生未知錯誤',
        );
      } finally {
        if (
          activeAbortController ===
          abortController
        ) {
          activeAbortController = null;
        }
      }
    };

    const ui = await createShadowRootUi(ctx, {
      name: 'instant-translator',
      position: 'overlay',
      zIndex: 2_147_483_647,
      isolateEvents: true,

      onMount(container) {
        const app = createApp(
          TranslationCard,
          {
            state,
            onClose: hidePopover,
          },
        );

        app.mount(container);

        return app;
      },

      onRemove(app) {
        abortActiveTranslation();
        app?.unmount();
      },
    });

    ui.mount();

    ctx.addEventListener(
      document,
      'pointerup',
      (event) => {
        const selectedContent =
          getTextSelection(event);

        if (!selectedContent) {
          return;
        }

        void startTranslation(
          selectedContent.text,
          selectedContent.pointerX,
          selectedContent.pointerY,
        );
      },
      {
        capture: true,
      },
    );

    // 點擊翻譯卡片以外的地方時關閉。
    ctx.addEventListener(
      document,
      'pointerdown',
      () => {
        if (state.status === 'hidden') {
          return;
        }

        hidePopover();
      },
    );

    // 按 Escape 關閉卡片。
    ctx.addEventListener(
      document,
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          hidePopover();
        }
      },
      {
        capture: true,
      },
    );

    // 捲動時關閉卡片。
    ctx.addEventListener(
      window,
      'scroll',
      () => {
        hidePopover();
      },
      {
        capture: true,
      },
    );

    // 視窗尺寸改變時關閉。
    ctx.addEventListener(
      window,
      'resize',
      () => {
        hidePopover();
      },
    );
  },
});