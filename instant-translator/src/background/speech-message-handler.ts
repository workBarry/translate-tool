import {
  browser,
  type Browser,
} from 'wxt/browser';

import {
  isSpeakTextMessage,
  isStopSpeechMessage,
} from '../shared/speech-messages';

import type {
  SpeakTextMessage,
  SpeechResponse,
  StopSpeechMessage,
} from '../shared/speech-messages';

const MAX_SPEECH_TEXT_LENGTH = 5_000;

const MIN_RATE = 0.5;
const MAX_RATE = 2;

const MIN_PITCH = 0.5;
const MAX_PITCH = 2;

/**
 * runtime.sendResponse 的明確型別。
 */
type SendSpeechResponse = (
  response: SpeechResponse,
) => void;

export function registerSpeechMessageHandler():
  void {
  /*
   * 這個函式必須在 background.ts 的
   * defineBackground() 裡面呼叫。
   */
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender:
        Browser.runtime.MessageSender,
      sendResponse:
        SendSpeechResponse,
    ): boolean | undefined => {
      /*
       * 只接受同一個擴充功能送出的訊息。
       */
      if (
        sender.id !==
        browser.runtime.id
      ) {
        return undefined;
      }

      if (isSpeakTextMessage(message)) {
        void handleSpeakText(message)
          .then((response) => {
            sendResponse(response);
          })
          .catch((error: unknown) => {
            console.error(
              '[Instant Translator Background] 未預期的發音錯誤',
              error,
            );

            const response:
              SpeechResponse = {
                ok: false,

                requestId:
                  message.payload
                    .requestId,

                error: {
                  code:
                    'SPEECH_FAILED',

                  message:
                    '背景發音服務發生未知錯誤',
                },
              };

            sendResponse(response);
          });

        /*
         * 非同步呼叫 sendResponse，
         * 必須回傳 true 保持訊息通道開啟。
         */
        return true;
      }

      if (isStopSpeechMessage(message)) {
        const response =
          handleStopSpeech(message);

        sendResponse(response);

        /*
         * 同步回應，不需要保持通道。
         */
        return false;
      }

      return undefined;
    },
  );
}

async function handleSpeakText(
  message: SpeakTextMessage,
): Promise<SpeechResponse> {
  const {
    requestId,
    text,
    target,
    lang,
    rate,
    pitch,
  } = message.payload;

  const normalizedText =
    text.trim();

  if (!normalizedText) {
    return {
      ok: false,
      requestId,

      error: {
        code: 'TEXT_EMPTY',
        message:
          '沒有可以朗讀的文字',
      },
    };
  }

  if (
    normalizedText.length >
    MAX_SPEECH_TEXT_LENGTH
  ) {
    return {
      ok: false,
      requestId,

      error: {
        code: 'TEXT_TOO_LONG',

        message:
          `朗讀文字不可超過 ${MAX_SPEECH_TEXT_LENGTH} 個字元`,
      },
    };
  }

  /*
   * WXT 的型別預設假設 API 存在，
   * 但執行時仍應檢查瀏覽器是否真的支援。
   */
  if (
    typeof browser.tts?.speak !==
      'function' ||
    typeof browser.tts?.stop !==
      'function'
  ) {
    return {
      ok: false,
      requestId,

      error: {
        code: 'TTS_UNAVAILABLE',

        message:
          '目前瀏覽器不支援發音功能',
      },
    };
  }

  /*
   * 播放新文字前，
   * 停止上一段語音。
   */
  browser.tts.stop();

  /*
   * 使用 Browser namespace，
   * 不再依賴全域 chrome 型別。
   *
   * options 有明確型別之後，
   * onEvent 的 event 也會自動推導，
   * 不再出現 implicit any。
   */
  const options:
    Browser.tts.TtsOptions = {
      rate: clamp(
        rate,
        MIN_RATE,
        MAX_RATE,
      ),

      pitch: clamp(
        pitch,
        MIN_PITCH,
        MAX_PITCH,
      ),

      volume: 1,
      enqueue: false,

      onEvent(event) {
        console.log(
          '[Instant Translator Background] TTS 事件',
          {
            requestId,
            target,
            type: event.type,

            charIndex:
              event.charIndex,

            errorMessage:
              event.errorMessage,
          },
        );

        if (
          event.type === 'error'
        ) {
          console.error(
            '[Instant Translator Background] TTS 引擎錯誤',
            {
              requestId,

              errorMessage:
                event.errorMessage,
            },
          );
        }
      },
    };

  if (lang) {
    options.lang = lang;
  }

  try {
    /*
     * Manifest V3 的 tts.speak()
     * 支援 Promise。
     *
     * Promise 只代表發音命令已接受，
     * 不代表整段文字已朗讀完。
     */
    await browser.tts.speak(
      normalizedText,
      options,
    );

    console.log(
      '[Instant Translator Background] 已開始發音',
      {
        requestId,
        target,
        lang,

        textLength:
          normalizedText.length,
      },
    );

    return {
      ok: true,
      requestId,
    };
  } catch (error: unknown) {
    console.error(
      '[Instant Translator Background] 發音失敗',
      {
        requestId,
        error,
      },
    );

    return {
      ok: false,
      requestId,

      error: {
        code: 'SPEECH_FAILED',

        message:
          error instanceof Error
            ? error.message
            : '發音服務發生未知錯誤',
      },
    };
  }
}

function handleStopSpeech(
  message: StopSpeechMessage,
): SpeechResponse {
  const { requestId } =
    message.payload;

  if (
    typeof browser.tts?.stop !==
    'function'
  ) {
    return {
      ok: false,
      requestId,

      error: {
        code: 'TTS_UNAVAILABLE',

        message:
          '目前瀏覽器不支援停止發音',
      },
    };
  }

  try {
    browser.tts.stop();

    console.log(
      '[Instant Translator Background] 已停止發音',
      {
        requestId,
      },
    );

    return {
      ok: true,
      requestId,
    };
  } catch (error: unknown) {
    console.error(
      '[Instant Translator Background] 停止發音失敗',
      {
        requestId,
        error,
      },
    );

    return {
      ok: false,
      requestId,

      error: {
        code: 'SPEECH_FAILED',

        message:
          error instanceof Error
            ? error.message
            : '無法停止目前的發音',
      },
    };
  }
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}