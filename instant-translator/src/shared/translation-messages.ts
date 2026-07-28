export const TRANSLATION_MESSAGE_TYPE = {
  TRANSLATE_TEXT: 'TRANSLATE_TEXT',
  CANCEL_TRANSLATION: 'CANCEL_TRANSLATION',
} as const;

export type TranslationErrorCode =
  | 'INVALID_REQUEST'
  | 'TEXT_EMPTY'
  | 'TEXT_TOO_LONG'
  | 'TRANSLATION_FAILED'
  | 'CANCELLED';

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  detectedLanguage: string;
  targetLanguage: string;
  provider: 'fake';
}

export interface TranslateTextMessage {
  type: typeof TRANSLATION_MESSAGE_TYPE.TRANSLATE_TEXT;

  payload: {
    requestId: string;
    text: string;
    targetLanguage: string;
  };
}

export interface CancelTranslationMessage {
  type: typeof TRANSLATION_MESSAGE_TYPE.CANCEL_TRANSLATION;

  payload: {
    requestId: string;
  };
}

export type TranslationMessage =
  | TranslateTextMessage
  | CancelTranslationMessage;

export interface TranslationError {
  code: TranslationErrorCode;
  message: string;
}

export type TranslateTextResponse =
  | {
      ok: true;
      requestId: string;
      result: TranslationResult;
    }
  | {
      ok: false;
      requestId: string;
      error: TranslationError;
    };

export interface CancelTranslationResponse {
  ok: true;
  requestId: string;
  cancelled: boolean;
}

export function isTranslateTextMessage(
  value: unknown,
): value is TranslateTextMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.type !==
    TRANSLATION_MESSAGE_TYPE.TRANSLATE_TEXT
  ) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  return (
    typeof value.payload.requestId === 'string' &&
    typeof value.payload.text === 'string' &&
    typeof value.payload.targetLanguage === 'string'
  );
}

export function isCancelTranslationMessage(
  value: unknown,
): value is CancelTranslationMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.type !==
    TRANSLATION_MESSAGE_TYPE.CANCEL_TRANSLATION
  ) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  return typeof value.payload.requestId === 'string';
}

export function isTranslateTextResponse(
  value: unknown,
): value is TranslateTextResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.ok !== 'boolean' ||
    typeof value.requestId !== 'string'
  ) {
    return false;
  }

  if (value.ok === true) {
    return isTranslationResult(value.result);
  }

  return (
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  );
}

function isTranslationResult(
  value: unknown,
): value is TranslationResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.originalText === 'string' &&
    typeof value.translatedText === 'string' &&
    typeof value.detectedLanguage === 'string' &&
    typeof value.targetLanguage === 'string' &&
    value.provider === 'fake'
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}