import {
  debugLog,
  errorLog,
} from "../src/shared/logger";

import { defineBackground } from '#imports';
import {
  browser,
  type Browser,
} from 'wxt/browser';

import {
  isAbortError,
  translateWithFakeProvider,
} from '../src/background/fake-translation.provider';
import {
  isCancelTranslationMessage,
  isTranslateTextMessage,
} from '../src/shared/translation-messages';

import type {
  CancelTranslationMessage,
  CancelTranslationResponse,
  TranslateTextMessage,
  TranslateTextResponse,
} from '../src/shared/translation-messages';

import {
  registerSpeechMessageHandler,
} from '../src/background/speech-message-handler';

const MAX_TEXT_LENGTH = 500;

export default defineBackground(() => {
  debugLog(
    '[Instant Translator Background] Service Worker 已啟動',
  );

  registerSpeechMessageHandler();

  const activeRequests =
    new Map<string, AbortController>();

  /*
   * 處理「取消訊息比翻譯訊息更早抵達」的極端情況。
   */
  const cancelledRequestIds =
    new Set<string>();

});

async function handleTranslateMessage(
  message: TranslateTextMessage,
  activeRequests: Map<
    string,
    AbortController
  >,
  cancelledRequestIds: Set<string>,
): Promise<TranslateTextResponse> {
  const {
    requestId,
    text,
    targetLanguage,
  } = message.payload;

  const validationError =
    validateTranslationRequest(
      text,
      targetLanguage,
    );

  if (validationError) {
    return {
      ok: false,
      requestId,
      error: validationError,
    };
  }

  /*
   * 有可能取消訊息先抵達 Background，
   * 此時不要再開始翻譯。
   */
  if (cancelledRequestIds.has(requestId)) {
    cancelledRequestIds.delete(requestId);

    return {
      ok: false,
      requestId,
      error: {
        code: 'CANCELLED',
        message: '翻譯請求已取消',
      },
    };
  }

  /*
   * UUID 原則上不會重複。
   * 若真的收到相同 requestId，先取消舊請求。
   */
  activeRequests
    .get(requestId)
    ?.abort();

  const abortController =
    new AbortController();

  activeRequests.set(
    requestId,
    abortController,
  );

  debugLog(
    '[Instant Translator Background] 開始翻譯',
    {
      requestId,
      textLength: text.length,
      targetLanguage,
    },
  );

  try {
    const result =
      await translateWithFakeProvider(
        {
          text,
          targetLanguage,
        },
        abortController.signal,
      );

    return {
      ok: true,
      requestId,
      result,
    };
  } catch (error: unknown) {
    if (isAbortError(error)) {
      return {
        ok: false,
        requestId,
        error: {
          code: 'CANCELLED',
          message: '翻譯請求已取消',
        },
      };
    }

    errorLog(
      '[Instant Translator Background] 翻譯失敗',
      {
        requestId,
        error,
      },
    );

    return {
      ok: false,
      requestId,
      error: {
        code: 'TRANSLATION_FAILED',

        message:
          error instanceof Error
            ? error.message
            : '翻譯服務發生未知錯誤',
      },
    };
  } finally {
    const currentController =
      activeRequests.get(requestId);

    /*
     * 避免舊請求 finally 誤刪掉同 ID 的新 Controller。
     */
    if (
      currentController === abortController
    ) {
      activeRequests.delete(requestId);
    }
  }
}

function handleCancelTranslationMessage(
  message: CancelTranslationMessage,
  activeRequests: Map<
    string,
    AbortController
  >,
  cancelledRequestIds: Set<string>,
): CancelTranslationResponse {
  const { requestId } = message.payload;

  const activeController =
    activeRequests.get(requestId);

  cancelledRequestIds.add(requestId);

  activeController?.abort();
  activeRequests.delete(requestId);

  debugLog(
    '[Instant Translator Background] 取消翻譯',
    {
      requestId,
      hadActiveRequest:
        activeController !== undefined,
    },
  );

  return {
    ok: true,
    requestId,
    cancelled:
      activeController !== undefined,
  };
}

function validateTranslationRequest(
  text: string,
  targetLanguage: string,
):
  | {
      code:
        | 'TEXT_EMPTY'
        | 'TEXT_TOO_LONG'
        | 'INVALID_REQUEST';
      message: string;
    }
  | null {
  if (!text.trim()) {
    return {
      code: 'TEXT_EMPTY',
      message: '沒有可翻譯的文字',
    };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return {
      code: 'TEXT_TOO_LONG',
      message: `選取文字不可超過 ${MAX_TEXT_LENGTH} 個字元`,
    };
  }

  if (!targetLanguage.trim()) {
    return {
      code: 'INVALID_REQUEST',
      message: '未指定目標語言',
    };
  }

  return null;
}