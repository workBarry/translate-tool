import {
  createShadowRootUi,
  defineContentScript,
} from '#imports';
import { createApp, reactive } from 'vue';

import TranslationCard from './selection/TranslationCard.vue';
import './selection/style.css';

import type { TranslationPopoverState } from './selection/types';

const CARD_WIDTH = 320;
const CARD_ESTIMATED_HEIGHT = 280;
const CARD_GAP = 12;
const VIEWPORT_PADDING = 8;

interface PopoverPosition {
  left: number;
  top: number;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],

  // 告訴 WXT：匯入的 CSS 要放進 Shadow Root。
  cssInjectionMode: 'ui',

  async main(ctx) {
    console.log('[Instant Translator] Content Script 已載入');

    const state = reactive<TranslationPopoverState>({
      visible: false,
      sourceText: '',
      translatedText: '',
      left: 0,
      top: 0,
    });

    const hidePopover = (): void => {
      state.visible = false;
    };

    const ui = await createShadowRootUi(ctx, {
      name: 'instant-translator',

      // 使用不占據網頁排版空間的浮動 UI。
      position: 'overlay',

      // 盡量顯示在網站內容上方。
      zIndex: 2_147_483_647,

      // 降低卡片內事件與外部網站互相影響。
      isolateEvents: true,

      onMount(container) {
        const app = createApp(TranslationCard, {
          state,
          onClose: hidePopover,
        });

        app.mount(container);

        return app;
      },

      onRemove(app) {
        app?.unmount();
      },
    });

    ui.mount();

    ctx.addEventListener(
      document,
      'pointerup',
      (event) => {
        // 目前只處理滑鼠左鍵。
        if (event.button !== 0) {
          return;
        }

        const selection = window.getSelection();

        if (!selection) {
          return;
        }

        if (selection.rangeCount === 0) {
          return;
        }

        if (selection.isCollapsed) {
          return;
        }

        const selectedText = selection.toString().trim();

        if (!selectedText) {
          return;
        }

        const position = calculatePopoverPosition(
          event.clientX,
          event.clientY,
        );

        state.sourceText = selectedText;
        state.translatedText = '這是測試翻譯結果，下一階段才會串接翻譯流程。';
        state.left = position.left;
        state.top = position.top;
        state.visible = true;

        console.log('[Instant Translator] 顯示翻譯卡片', {
          selectedText,
          position,
        });
      },
      {
        capture: true,
      },
    );

    // 點擊卡片以外的網頁區域時關閉。
    ctx.addEventListener(document, 'pointerdown', () => {
      if (!state.visible) {
        return;
      }

      hidePopover();
    });

    // 按 Escape 關閉。
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

    // 捲動頁面時先關閉，避免卡片留在舊座標。
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
    ctx.addEventListener(window, 'resize', () => {
      hidePopover();
    });
  },
});

function calculatePopoverPosition(
  pointerX: number,
  pointerY: number,
): PopoverPosition {
  let left = pointerX + CARD_GAP;
  let top = pointerY;

  const rightBoundary =
    window.innerWidth - VIEWPORT_PADDING;

  const bottomBoundary =
    window.innerHeight - VIEWPORT_PADDING;

  // 滑鼠靠近右側時，改成顯示在滑鼠左側。
  if (left + CARD_WIDTH > rightBoundary) {
    left = pointerX - CARD_WIDTH - CARD_GAP;
  }

  // 滑鼠靠近底部時，把卡片往上推。
  if (top + CARD_ESTIMATED_HEIGHT > bottomBoundary) {
    top =
      bottomBoundary -
      CARD_ESTIMATED_HEIGHT;
  }

  return {
    left: Math.max(VIEWPORT_PADDING, left),
    top: Math.max(VIEWPORT_PADDING, top),
  };
}