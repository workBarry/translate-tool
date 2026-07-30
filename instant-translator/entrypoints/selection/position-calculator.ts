import type { PopoverPosition } from './types';

const CARD_WIDTH = 320;
const CARD_ESTIMATED_HEIGHT = 300;
const CARD_GAP = 12;
const VIEWPORT_PADDING = 8;

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function getViewportBounds(): ViewportBounds {
  const visualViewport = window.visualViewport;

  if (visualViewport) {
    const left = visualViewport.offsetLeft;
    const top = visualViewport.offsetTop;

    return {
      left,
      top,
      right: left + visualViewport.width,
      bottom: top + visualViewport.height,
      width: visualViewport.width,
      height: visualViewport.height,
    };
  }

  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function calculatePopoverPosition(
  pointerX: number,
  pointerY: number,
): PopoverPosition {
  const viewport = getViewportBounds();
  const spaceBelow =
    viewport.bottom - pointerY - VIEWPORT_PADDING;
  const shouldPlaceAbove =
    spaceBelow < CARD_ESTIMATED_HEIGHT + CARD_GAP;

  const preferredLeft = pointerX + CARD_GAP;
  const preferredTop = shouldPlaceAbove
    ? pointerY - CARD_ESTIMATED_HEIGHT - CARD_GAP
    : pointerY + CARD_GAP;

  const minimumLeft = viewport.left + VIEWPORT_PADDING;
  const maximumLeft = Math.max(
    minimumLeft,
    viewport.right - CARD_WIDTH - VIEWPORT_PADDING,
  );
  const minimumTop = viewport.top + VIEWPORT_PADDING;
  const maximumTop = Math.max(
    minimumTop,
    viewport.bottom - CARD_ESTIMATED_HEIGHT - VIEWPORT_PADDING,
  );

  return {
    left: clamp(preferredLeft, minimumLeft, maximumLeft),
    top: clamp(preferredTop, minimumTop, maximumTop),
  };
}

export function correctPopoverPosition(
  cardRect: DOMRect,
  currentPosition: PopoverPosition,
): PopoverPosition {
  const viewport = getViewportBounds();
  let left = currentPosition.left;
  let top = currentPosition.top;

  const maximumRight = viewport.right - VIEWPORT_PADDING;
  const minimumLeft = viewport.left + VIEWPORT_PADDING;
  const maximumBottom = viewport.bottom - VIEWPORT_PADDING;
  const minimumTop = viewport.top + VIEWPORT_PADDING;

  if (cardRect.right > maximumRight) {
    left -= cardRect.right - maximumRight;
  }

  if (cardRect.left < minimumLeft) {
    left += minimumLeft - cardRect.left;
  }

  if (cardRect.bottom > maximumBottom) {
    top -= cardRect.bottom - maximumBottom;
  }

  if (cardRect.top < minimumTop) {
    top += minimumTop - cardRect.top;
  }

  return {
    left: Math.round(Math.max(minimumLeft, left)),
    top: Math.round(Math.max(minimumTop, top)),
  };
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(Math.max(value, minimum), maximum);
}
