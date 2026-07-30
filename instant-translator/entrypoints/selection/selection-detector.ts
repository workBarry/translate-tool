export function getCurrentSelectedText(
  target: EventTarget | null,
): string {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;

    if (
      selectionStart === null ||
      selectionEnd === null ||
      selectionStart === selectionEnd
    ) {
      return '';
    }

    return target.value
      .slice(selectionStart, selectionEnd)
      .trim();
  }

  const selection = window.getSelection();

  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return '';
  }

  return selection.toString().trim();
}
