import type { TranslationResult } from '../shared/translation-messages';

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

export interface FakeTranslationInput {
  text: string;
  targetLanguage: string;
}

export async function translateWithFakeProvider(
  input: FakeTranslationInput,
  signal: AbortSignal,
): Promise<TranslationResult> {
  const delayMilliseconds =
    700 +
    Math.min(input.text.length * 20, 1_300);

  await wait(delayMilliseconds, signal);

  const normalizedText = input.text
    .trim()
    .toLocaleLowerCase('en-US');

  // 用來測試錯誤狀態。
  if (normalizedText === 'error') {
    throw new Error(
      '模擬翻譯服務發生錯誤',
    );
  }

  const dictionaryResult =
    FAKE_DICTIONARY[normalizedText];

  return {
    originalText: input.text,

    translatedText:
      dictionaryResult ??
      `【模擬翻譯】${input.text}`,

    detectedLanguage: 'en',
    targetLanguage: input.targetLanguage,
    provider: 'fake',
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
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    let timerId:
      | ReturnType<typeof setTimeout>
      | undefined;

    const handleAbort = (): void => {
      if (timerId !== undefined) {
        globalThis.clearTimeout(timerId);
      }

      signal.removeEventListener(
        'abort',
        handleAbort,
      );

      reject(createAbortError());
    };

    timerId = globalThis.setTimeout(() => {
      signal.removeEventListener(
        'abort',
        handleAbort,
      );

      resolve();
    }, milliseconds);

    signal.addEventListener(
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