import {
  browser,
} from 'wxt/browser';

import {
  isSpeechResponse,
  SPEECH_MESSAGE_TYPE,
} from '../../src/shared/speech-messages';

import type {
  SpeakTextMessage,
  SpeechTarget,
  StopSpeechMessage,
} from '../../src/shared/speech-messages';

export interface SpeakTextInput {
  text: string;
  target: SpeechTarget;
  lang?: string;
  rate?: number;
  pitch?: number;
}

export class SpeechClientError
  extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);

    this.name =
      'SpeechClientError';
  }
}

export async function speakTextInBackground(
  input: SpeakTextInput,
): Promise<void> {
  const requestId =
    crypto.randomUUID();

  const message:
    SpeakTextMessage = {
      type:
        SPEECH_MESSAGE_TYPE
          .SPEAK_TEXT,

      payload: {
        requestId,
        text: input.text,
        target: input.target,
        rate: input.rate ?? 1,
        pitch:
          input.pitch ?? 1,

        ...(input.lang
          ? {
              lang: input.lang,
            }
          : {}),
      },
    };

  const rawResponse =
    await browser.runtime.sendMessage(
      message,
    );

  validateResponse(
    rawResponse,
    requestId,
  );
}

export async function stopSpeechInBackground():
  Promise<void> {
  const requestId =
    crypto.randomUUID();

  const message:
    StopSpeechMessage = {
      type:
        SPEECH_MESSAGE_TYPE
          .STOP_SPEECH,

      payload: {
        requestId,
      },
    };

  const rawResponse =
    await browser.runtime.sendMessage(
      message,
    );

  validateResponse(
    rawResponse,
    requestId,
  );
}

/**
 * 這只是簡單字元判斷，
 * 不是完整語言偵測器。
 */
export function detectSpeechLanguage(
  text: string,
): string | undefined {
  if (
    /[\u3040-\u30ff]/u.test(text)
  ) {
    return 'ja-JP';
  }

  if (
    /[\uac00-\ud7af]/u.test(text)
  ) {
    return 'ko-KR';
  }

  if (
    /[\u3400-\u9fff]/u.test(text)
  ) {
    return 'zh-TW';
  }

  if (
    /[a-z]/iu.test(text)
  ) {
    return 'en-US';
  }

  return undefined;
}

function validateResponse(
  rawResponse: unknown,
  requestId: string,
): void {
  if (
    !isSpeechResponse(rawResponse)
  ) {
    throw new SpeechClientError(
      '背景服務回傳了無效的發音資料',
      'INVALID_RESPONSE',
    );
  }

  if (
    rawResponse.requestId !==
    requestId
  ) {
    throw new SpeechClientError(
      '發音請求與回應識別碼不一致',
      'INVALID_RESPONSE',
    );
  }

  if (!rawResponse.ok) {
    throw new SpeechClientError(
      rawResponse.error.message,
      rawResponse.error.code,
    );
  }
}