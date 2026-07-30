type LogMetadata = object;

const LOG_PREFIX = '[Instant Translator]';

const SAFE_METADATA_KEYS = new Set([
  'aborted',
  'code',
  'causeName',
  'errorName',
  'errorType',
  'phase',
  'requestId',
  'retryable',
  'sourceLanguage',
  'targetLanguage',
]);

export function debugLog(
  message: string,
  metadata?: unknown,
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  writeDebugLog('debug', message, metadata);
}

export function infoLog(
  message: string,
  metadata?: unknown,
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  writeDebugLog('info', message, metadata);
}

export function warningLog(
  message: string,
  metadata?: unknown,
): void {
  if (metadata) {
    console.warn(formatMessage(message), metadata);
    return;
  }

  console.warn(formatMessage(message));
}

export function errorLog(
  message: string,
  error?: unknown,
  metadata?: LogMetadata,
): void {
  const payload = getErrorPayload(error);

  console.error(formatMessage(message), {
    ...getSafeMetadata(payload.metadata),
    ...getSafeMetadata(metadata),
    ...getSafeErrorDetails(payload.error),
  });
}

function isDebugLoggingEnabled(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }

  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('instant-translator:debug') === 'true'
    );
  } catch {
    return false;
  }
}

function writeDebugLog(
  level: 'debug' | 'info',
  message: string,
  metadata?: unknown,
): void {
  if (metadata) {
    console[level](formatMessage(message), metadata);
    return;
  }

  console[level](formatMessage(message));
}

function formatMessage(message: string): string {
  return message.startsWith(LOG_PREFIX)
    ? message
    : `${LOG_PREFIX} ${message}`;
}

function getSafeErrorDetails(error: unknown): LogMetadata {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: import.meta.env.DEV
        ? error.message
        : undefined,
    };
  }

  if (error !== undefined) {
    return {
      errorType: typeof error,
    };
  }

  return {};
}

function getErrorPayload(error: unknown): {
  error: unknown;
  metadata?: LogMetadata;
} {
  if (
    error &&
    typeof error === 'object' &&
    'error' in error
  ) {
    const { error: nestedError, ...metadata } = error;

    return {
      error: nestedError,
      metadata,
    };
  }

  return { error };
}

function getSafeMetadata(
  metadata?: LogMetadata,
): LogMetadata {
  if (!metadata) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) =>
      SAFE_METADATA_KEYS.has(key) &&
      (value === undefined ||
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'),
    ),
  );
}
