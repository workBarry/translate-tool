import { browser } from 'wxt/browser';

import {
  isTranslateTextResponse,
  TRANSLATION_MESSAGE_TYPE,
} from '../../src/shared/translation-messages';

import type {
  CancelTranslationMessage,
  TranslateTextMessage,
  TranslationErrorCode,
  TranslationResult,
} from '../../src/shared/translation-messages';

export interface BackgroundTranslationInput {
  requestId: string;
  text: string;
  targetLanguage: string;
}

export class BackgroundTranslationError
  extends Error {
  constructor(
    message: string,
    public readonly code:
      TranslationErrorCode | 'INVALID_RESPONSE',
  ) {
    super(message);

    this.name =
      'BackgroundTranslationError';
  }
}

export async function translateInBackground(
  input: BackgroundTranslationInput,
  signal: AbortSignal,
): Promise<TranslationResult> {
  if (signal.aborted) {
    throw createAbortError();
  }

  const message: TranslateTextMessage = {
    type:
      TRANSLATION_MESSAGE_TYPE.TRANSLATE_TEXT,

    payload: {
      requestId: input.requestId,
      text: input.text,
      targetLanguage:
        input.targetLanguage,
    },
  };

  let handleAbort: (() => void) | null =
    null;

  const abortPromise =
    new Promise<never>((_, reject) => {
      handleAbort = () => {
        void cancelBackgroundTranslation(
          input.requestId,
        );

        reject(createAbortError());
      };

      signal.addEventListener(
        'abort',
        handleAbort,
        {
          once: true,
        },
      );
    });

  try {
    const responsePromise =
      browser.runtime.sendMessage(message);

    const rawResponse =
      await Promise.race([
        responsePromise,
        abortPromise,
      ]);

    if (
      !isTranslateTextResponse(rawResponse)
    ) {
      throw new BackgroundTranslationError(
        '背景服務回傳了無效資料',
        'INVALID_RESPONSE',
      );
    }

    if (
      rawResponse.requestId !==
      input.requestId
    ) {
      throw new BackgroundTranslationError(
        '翻譯請求與回應識別碼不一致',
        'INVALID_RESPONSE',
      );
    }

    if (!rawResponse.ok) {
      if (
        rawResponse.error.code ===
        'CANCELLED'
      ) {
        throw createAbortError();
      }

      throw new BackgroundTranslationError(
        rawResponse.error.message,
        rawResponse.error.code,
      );
    }

    return rawResponse.result;
  } catch (error: unknown) {
    if (
      isAbortError(error) ||
      error instanceof
        BackgroundTranslationError
    ) {
      throw error;
    }

    console.error(
      '[Instant Translator] Background 通訊失敗',
      error,
    );

    throw new BackgroundTranslationError(
      '無法連接背景翻譯服務，請重新載入擴充功能',
      'INVALID_RESPONSE',
    );
  } finally {
    if (handleAbort) {
      signal.removeEventListener(
        'abort',
        handleAbort,
      );
    }
  }
}

export function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

async function cancelBackgroundTranslation(
  requestId: string,
): Promise<void> {
  const message: CancelTranslationMessage = {
    type:
      TRANSLATION_MESSAGE_TYPE.CANCEL_TRANSLATION,

    payload: {
      requestId,
    },
  };

  try {
    await browser.runtime.sendMessage(
      message,
    );
  } catch {
    /*
     * 擴充功能正在重新載入或 Service Worker
     * 已被替換時，取消訊息可能失敗。
     * 此處不再向 UI 顯示第二個錯誤。
     */
  }
}

function createAbortError(): DOMException {
  return new DOMException(
    'Translation request was aborted',
    'AbortError',
  );
}