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

const MAX_TEXT_LENGTH = 500;

export default defineBackground(() => {
  console.log(
    '[Instant Translator Background] Service Worker 已啟動',
  );

  const activeRequests =
    new Map<string, AbortController>();

  /*
   * 處理「取消訊息比翻譯訊息更早抵達」的極端情況。
   */
  const cancelledRequestIds =
    new Set<string>();

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse,
    ) => {
      /*
       * runtime.onMessage 原則上只處理擴充功能內部訊息，
       * 這裡仍然檢查 sender.id。
       */
      if (sender.id !== browser.runtime.id) {
        return;
      }

      if (isTranslateTextMessage(message)) {
        void handleTranslateMessage(
          message,
          activeRequests,
          cancelledRequestIds,
        )
          .then(sendResponse)
          .catch((error: unknown) => {
            console.error(
              '[Instant Translator Background] 未預期錯誤',
              error,
            );

            const response: TranslateTextResponse = {
              ok: false,
              requestId: message.payload.requestId,
              error: {
                code: 'TRANSLATION_FAILED',
                message: '背景翻譯服務發生未知錯誤',
              },
            };

            sendResponse(response);
          });

        /*
         * 非同步呼叫 sendResponse 時必須回傳 true，
         * 保持訊息通道開啟。
         */
        return true;
      }

      if (isCancelTranslationMessage(message)) {
        const response =
          handleCancelTranslationMessage(
            message,
            activeRequests,
            cancelledRequestIds,
          );

        sendResponse(response);

        return false;
      }

      // 未知或格式錯誤的訊息不執行任何操作。
      return;
    },
  );
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

  console.log(
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

    console.error(
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

  console.log(
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