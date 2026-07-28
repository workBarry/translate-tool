import type { TranslationResult } from './types';

const FAKE_DICTIONARY: Record<string, string> = {
  hello: '你好',
  world: '世界',
  browser: '瀏覽器',
  translation: '翻譯',
  extension: '擴充功能',
  'browser extension': '瀏覽器擴充功能',
  'hello world': '你好，世界',
  'instant translator': '即時翻譯工具',
};

export async function translateText(
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  // 根據文字長度產生不同等待時間，
  // 用來模擬真實網路請求。
  const delayMilliseconds =
    700 + Math.min(text.length * 20, 1_300);

  await wait(delayMilliseconds, signal);

  const normalizedText = text
    .trim()
    .toLocaleLowerCase('en-US');

  // 選取單獨的 error，可以測試錯誤畫面。
  if (normalizedText === 'error') {
    throw new Error('模擬翻譯服務發生錯誤');
  }

  const dictionaryResult =
    FAKE_DICTIONARY[normalizedText];

  return {
    originalText: text,

    translatedText:
      dictionaryResult ??
      `【模擬翻譯】${text}`,
  };
}

export function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

function wait(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    let timerId: number | undefined;

    const handleAbort = (): void => {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }

      signal?.removeEventListener(
        'abort',
        handleAbort,
      );

      reject(createAbortError());
    };

    timerId = window.setTimeout(() => {
      signal?.removeEventListener(
        'abort',
        handleAbort,
      );

      resolve();
    }, milliseconds);

    signal?.addEventListener(
      'abort',
      handleAbort,
      {
        once: true,
      },
    );
  });
}

function createAbortError(): DOMException {
  return new DOMException(
    'Translation request was aborted',
    'AbortError',
  );
}