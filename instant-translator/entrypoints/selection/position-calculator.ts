import type { PopoverPosition } from './types';

const CARD_WIDTH = 320;
const CARD_ESTIMATED_HEIGHT = 300;
const CARD_GAP = 12;
const VIEWPORT_PADDING = 8;

export function calculatePopoverPosition(
  pointerX: number,
  pointerY: number,
): PopoverPosition {
  let left = pointerX + CARD_GAP;
  let top = pointerY;

  const rightBoundary =
    window.innerWidth - VIEWPORT_PADDING;

  const bottomBoundary =
    window.innerHeight - VIEWPORT_PADDING;

  // 右側空間不足時，改顯示在滑鼠左側。
  if (left + CARD_WIDTH > rightBoundary) {
    left = pointerX - CARD_WIDTH - CARD_GAP;
  }

  // 底部空間不足時，把卡片往上推。
  if (
    top + CARD_ESTIMATED_HEIGHT >
    bottomBoundary
  ) {
    top =
      bottomBoundary -
      CARD_ESTIMATED_HEIGHT;
  }

  return {
    left: Math.max(VIEWPORT_PADDING, left),
    top: Math.max(VIEWPORT_PADDING, top),
  };
}

/**
 * 依卡片實際尺寸修正位置，使其完整保留在 viewport 內。
 *
 * 初始位置仍使用滑鼠座標快速決定；等 Vue 完成渲染後，
 * 再透過 getBoundingClientRect() 處理實際高度、換行與錯誤訊息。
 */
export function correctPopoverPosition(
  cardRect: DOMRect,
  currentPosition: PopoverPosition,
): PopoverPosition {
  const rightBoundary =
    window.innerWidth - VIEWPORT_PADDING;

  const bottomBoundary =
    window.innerHeight - VIEWPORT_PADDING;

  let left = currentPosition.left;
  let top = currentPosition.top;

  if (cardRect.right > rightBoundary) {
    left -= cardRect.right - rightBoundary;
  }

  if (cardRect.left < VIEWPORT_PADDING) {
    left += VIEWPORT_PADDING - cardRect.left;
  }

  if (cardRect.bottom > bottomBoundary) {
    top -= cardRect.bottom - bottomBoundary;
  }

  if (cardRect.top < VIEWPORT_PADDING) {
    top += VIEWPORT_PADDING - cardRect.top;
  }

  return {
    left: Math.round(
      Math.max(VIEWPORT_PADDING, left),
    ),
    top: Math.round(
      Math.max(VIEWPORT_PADDING, top),
    ),
  };
}
