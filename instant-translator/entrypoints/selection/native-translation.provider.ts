import {
  getTranslatorSession,
  invalidateTranslatorSession,
} from './translator-session-cache';

import {
  createTranslationError,
  isAbortError,
  logTranslationError,
  normalizeTranslationError,
} from './translation-error';

export interface NativeTranslationInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal: AbortSignal;
  onDownloadProgress?: (percentage: number) => void;
  onPreparing?: () => void;
  onReady?: () => void;
}

export interface NativeTranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  skipped: boolean;
}

interface ExecuteTranslationInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal: AbortSignal;
  onDownloadProgress?: (percentage: number) => void;
  onPreparing?: () => void;
  onReady?: () => void;
}

const SUPPORTED_LANGUAGES = new Set([
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr',
  'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te',
  'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant',
]);

export async function translateWithChrome(
  input: NativeTranslationInput,
): Promise<NativeTranslationResult> {
  const normalizedText = input.text.trim();

  if (!normalizedText) {
    throw createTranslationError('TRANSLATION_FAILED', {
      message: '沒有可翻譯的文字。',
    });
  }

  if (!('Translator' in self)) {
    throw createTranslationError('API_UNAVAILABLE');
  }

  const sourceLanguage = normalizeLanguageCode(input.sourceLanguage);
  const targetLanguage = normalizeLanguageCode(input.targetLanguage);

  if (!sourceLanguage || !targetLanguage) {
    throw createTranslationError('LANGUAGE_PAIR_UNAVAILABLE');
  }

  if (sourceLanguage === targetLanguage) {
    return {
      originalText: normalizedText,
      translatedText: normalizedText,
      sourceLanguage,
      targetLanguage,
      skipped: true,
    };
  }

  const executeInput: ExecuteTranslationInput = {
    text: normalizedText,
    sourceLanguage,
    targetLanguage,
    signal: input.signal,
    onDownloadProgress: input.onDownloadProgress,
    onPreparing: input.onPreparing,
    onReady: input.onReady,
  };

  try {
    return await executeTranslation(executeInput);
  } catch (firstError: unknown) {
    if (isAbortError(firstError)) {
      throw firstError;
    }

    logTranslationError('第一次翻譯失敗，準備重建 Session', firstError);

    await invalidateTranslatorSession(sourceLanguage, targetLanguage);
    input.signal.throwIfAborted();

    try {
      return await executeTranslation(executeInput);
    } catch (secondError: unknown) {
      if (isAbortError(secondError)) {
        throw secondError;
      }

      logTranslationError('重建 Session 後翻譯仍失敗', secondError);

      throw normalizeTranslationError(secondError, 'translate');
    }
  }
}

async function executeTranslation(
  input: ExecuteTranslationInput,
): Promise<NativeTranslationResult> {
  input.signal.throwIfAborted();

  const translator = await getTranslatorSession({
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    onDownloadProgress: input.onDownloadProgress,
    onPreparing: input.onPreparing,
  });

  input.signal.throwIfAborted();
  input.onReady?.();

  const translatedText = await translator.translate(input.text, {
    signal: input.signal,
  });

  return {
    originalText: input.text,
    translatedText: translatedText.trim(),
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    skipped: false,
  };
}

function normalizeLanguageCode(language: string): string | null {
  const normalized = language.trim().replaceAll('_', '-').toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized === 'zh-hant' ||
    normalized.startsWith('zh-hant-')
  ) {
    return 'zh-Hant';
  }

  if (
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh-hans' ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh';
  }

  const primaryLanguage = normalized.split('-')[0];

  return primaryLanguage && SUPPORTED_LANGUAGES.has(primaryLanguage)
    ? primaryLanguage
    : null;
}
