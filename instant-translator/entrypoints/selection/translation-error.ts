import {
  errorLog,
} from '../../src/shared/logger';

export const TRANSLATION_ERROR_CODES = [
  'API_UNAVAILABLE',
  'LANGUAGE_AMBIGUOUS',
  'LANGUAGE_DETECTION_FAILED',
  'LANGUAGE_PAIR_UNAVAILABLE',
  'USER_GESTURE_REQUIRED',
  'MODEL_DOWNLOAD_FAILED',
  'TRANSLATION_FAILED',
  'REQUEST_ABORTED',
  'UNKNOWN',
] as const;

export type TranslationErrorCode =
  (typeof TRANSLATION_ERROR_CODES)[number];

export type TranslationFailurePhase =
  | 'detect'
  | 'create'
  | 'translate'
  | 'unknown';

interface TranslationErrorDefinition {
  message: string;
  retryable: boolean;
}

const ERROR_DEFINITIONS: Record<
  TranslationErrorCode,
  TranslationErrorDefinition
> = {
  API_UNAVAILABLE: {
    message:
      '目前瀏覽器不支援裝置端翻譯，請確認使用支援版本的桌面版 Chrome。',
    retryable: false,
  },

  LANGUAGE_AMBIGUOUS: {
    message:
      '無法可靠判斷來源語言，請手動選擇中文、日文、韓文或英文。',
    retryable: false,
  },

  LANGUAGE_DETECTION_FAILED: {
    message:
      '來源語言偵測失敗，請重新嘗試或手動指定來源語言。',
    retryable: true,
  },

  LANGUAGE_PAIR_UNAVAILABLE: {
    message:
      '目前不支援這組來源與目標語言，請更換語言設定。',
    retryable: false,
  },

  USER_GESTURE_REQUIRED: {
    message:
      '瀏覽器需要由使用者操作啟動翻譯模型，請按下重新翻譯。',
    retryable: true,
  },

  MODEL_DOWNLOAD_FAILED: {
    message:
      '翻譯模型下載或載入失敗，請確認網路連線後重新翻譯。',
    retryable: true,
  },

  TRANSLATION_FAILED: {
    message:
      '這段文字目前無法翻譯，請重新嘗試、改用完整句子或手動指定來源語言。',
    retryable: true,
  },

  REQUEST_ABORTED: {
    message: '翻譯已取消。',
    retryable: false,
  },

  UNKNOWN: {
    message:
      '翻譯發生未知錯誤，請重新嘗試。',
    retryable: true,
  },
};

interface InstantTranslationErrorOptions {
  message?: string;
  cause?: unknown;
}

export class InstantTranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly retryable: boolean;
  readonly originalError?: unknown;

  constructor(
    code: TranslationErrorCode,
    options: InstantTranslationErrorOptions = {},
  ) {
    const definition =
      ERROR_DEFINITIONS[code];

    super(
      options.message ??
        definition.message,
    );

    this.name =
      'InstantTranslationError';

    this.code = code;
    this.retryable =
      definition.retryable;

    this.originalError =
      options.cause;

    /*
     * 修正部分編譯目標下，
     * Error 子類別的 prototype 問題。
     */
    Object.setPrototypeOf(
      this,
      InstantTranslationError.prototype,
    );
  }
}

export function createTranslationError(
  code: TranslationErrorCode,
  options: InstantTranslationErrorOptions = {},
): InstantTranslationError {
  return new InstantTranslationError(
    code,
    options,
  );
}

export function normalizeTranslationError(
  error: unknown,
  phase: TranslationFailurePhase = 'unknown',
): InstantTranslationError {
  if (
    error instanceof
    InstantTranslationError
  ) {
    return error;
  }

  if (isAbortError(error)) {
    return createTranslationError(
      'REQUEST_ABORTED',
      {
        cause: error,
      },
    );
  }

  const errorName =
    getErrorName(error);

  const errorMessage =
    getErrorMessage(error);

  if (
    errorName ===
      'NotSupportedError'
  ) {
    return createTranslationError(
      phase === 'detect'
        ? 'LANGUAGE_DETECTION_FAILED'
        : 'LANGUAGE_PAIR_UNAVAILABLE',
      {
        cause: error,
      },
    );
  }

  if (
    /not supported/iu.test(
      errorMessage,
    ) ||
    /unsupported language/iu.test(
      errorMessage,
    )
  ) {
    return createTranslationError(
      phase === 'detect'
        ? 'LANGUAGE_DETECTION_FAILED'
        : 'LANGUAGE_PAIR_UNAVAILABLE',
      {
        cause: error,
      },
    );
  }

  if (
    errorName ===
      'NotAllowedError' ||
    /user activation/iu.test(
      errorMessage,
    ) ||
    /user gesture/iu.test(
      errorMessage,
    )
  ) {
    return createTranslationError(
      'USER_GESTURE_REQUIRED',
      {
        cause: error,
      },
    );
  }

  if (
    errorName ===
      'NetworkError' ||
    /network/iu.test(
      errorMessage,
    ) ||
    /download/iu.test(
      errorMessage,
    )
  ) {
    return createTranslationError(
      phase === 'detect'
        ? 'LANGUAGE_DETECTION_FAILED'
        : 'MODEL_DOWNLOAD_FAILED',
      {
        cause: error,
      },
    );
  }

  if (
    /other generic failures occurred/iu
      .test(errorMessage)
  ) {
    return createTranslationError(
      'TRANSLATION_FAILED',
      {
        cause: error,
      },
    );
  }

  switch (phase) {
    case 'detect':
      return createTranslationError(
        'LANGUAGE_DETECTION_FAILED',
        {
          cause: error,
        },
      );

    case 'create':
      return createTranslationError(
        'MODEL_DOWNLOAD_FAILED',
        {
          cause: error,
        },
      );

    case 'translate':
      return createTranslationError(
        'TRANSLATION_FAILED',
        {
          cause: error,
        },
      );

    default:
      return createTranslationError(
        'UNKNOWN',
        {
          cause: error,
        },
      );
  }
}

/**
 * 保留瀏覽器原始例外的診斷資訊，但不記錄選取文字或譯文。
 */
export function logTranslationError(
  message: string,
  error: unknown,
  context?: {
    requestId?: string;
    phase?: TranslationFailurePhase;
    sourceLanguage?: string;
    targetLanguage?: string;
  },
): void {
  const normalized = normalizeTranslationError(
    error,
    context?.phase ?? 'unknown',
  );
  const originalError = normalized.originalError;

  errorLog(
    message,
    originalError ?? normalized,
    {
      requestId: context?.requestId,
      phase: context?.phase ?? 'unknown',
      code: normalized.code,
      sourceLanguage: context?.sourceLanguage,
      targetLanguage: context?.targetLanguage,
      retryable: normalized.retryable,
      causeName:
        import.meta.env.DEV && originalError instanceof Error
          ? originalError.name
          : undefined,
    },
  );
}

export function isAbortError(
  error: unknown,
): boolean {
  if (
    error instanceof
      InstantTranslationError &&
    error.code ===
      'REQUEST_ABORTED'
  ) {
    return true;
  }

  if (
    error instanceof DOMException
  ) {
    return (
      error.name ===
      'AbortError'
    );
  }

  if (
    error instanceof Error
  ) {
    return (
      error.name ===
        'AbortError' ||
      /aborted/iu.test(
        error.message,
      )
    );
  }

  return false;
}

function getErrorName(
  error: unknown,
): string {
  if (
    error instanceof Error ||
    error instanceof DOMException
  ) {
    return error.name;
  }

  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof error.name === 'string'
  ) {
    return error.name;
  }

  return '';
}

function getErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error ||
    error instanceof DOMException
  ) {
    return error.message;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message ===
      'string'
  ) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '';
}
