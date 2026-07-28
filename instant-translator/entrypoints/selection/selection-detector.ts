import type { TextSelection } from './types';

export function getTextSelection(
  event: PointerEvent,
): TextSelection | null {
  // 目前只處理滑鼠左鍵。
  if (event.button !== 0) {
    return null;
  }

  const selection = window.getSelection();

  if (!selection) {
    return null;
  }

  if (selection.rangeCount === 0) {
    return null;
  }

  if (selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().trim();

  if (!text) {
    return null;
  }

  return {
    text,
    pointerX: event.clientX,
    pointerY: event.clientY,
  };
}