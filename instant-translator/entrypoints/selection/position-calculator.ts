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