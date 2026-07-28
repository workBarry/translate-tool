import {
  getTranslatorSession,
} from './translator-session-cache';

export type NativeTranslationErrorCode =
  | 'EMPTY_TEXT'
  | 'UNSUPPORTED_BROWSER'
  | 'UNSUPPORTED_LANGUAGE'
  | 'CREATE_FAILED'
  | 'TRANSLATE_FAILED';

export interface NativeTranslationInput {
  text: string;

  /**
   * 網頁宣告的語言，例如 en-US、zh-TW。
   */
  pageLanguage?: string;

  /**
   * 目前固定翻譯成繁體中文。
   */
  targetLanguage?: string;

  signal: AbortSignal;

  onDownloadProgress?: (
    percentage: number,
  ) => void;

  onPreparing?: () => void;
  onReady?: () => void;
}

export interface NativeTranslationResult {
  originalText: string;
  translatedText: string;

  sourceLanguage: string;
  targetLanguage: string;
}

export class NativeTranslationError
  extends Error {
  constructor(
    message: string,
    public readonly code:
      NativeTranslationErrorCode,
    options?: {
      cause?: unknown;
    },
  ) {
    super(message, options);

    this.name =
      'NativeTranslationError';
  }
}

/**
 * Chrome Translator API 支援的語言代碼。
 *
 * 使用短 BCP 47 language tag，
 * 繁體中文例外使用 zh-Hant。
 */
const SUPPORTED_LANGUAGES =
  new Set([
    'ar',
    'bg',
    'bn',
    'cs',
    'da',
    'de',
    'el',
    'en',
    'es',
    'fi',
    'fr',
    'he',
    'hi',
    'hr',
    'hu',
    'id',
    'it',
    'ja',
    'kn',
    'ko',
    'lt',
    'mr',
    'nl',
    'no',
    'pl',
    'pt',
    'ro',
    'ru',
    'sk',
    'sl',
    'sv',
    'ta',
    'te',
    'th',
    'tr',
    'uk',
    'vi',
    'zh',
    'zh-Hant',
  ]);

/**
 * 注意：此函式刻意不是 async。
 *
 * Translator.create() 必須直接在使用者操作流程中呼叫，
 * 避免先 await 其他工作後失去 user activation。
 */
export function translateWithChrome(
  input: NativeTranslationInput,
): Promise<NativeTranslationResult> {
  const normalizedText =
    input.text.trim();

  if (!normalizedText) {
    return Promise.reject(
      new NativeTranslationError(
        '沒有可以翻譯的文字',
        'EMPTY_TEXT',
      ),
    );
  }

if (!('Translator' in self)) {
  return Promise.reject(
    new NativeTranslationError(
      '目前瀏覽器不支援 Chrome Translator API',
      'UNSUPPORTED_BROWSER',
    ),
  );
}

  input.signal.throwIfAborted();

  const sourceLanguage =
    inferSourceLanguage(
      normalizedText,
      input.pageLanguage,
    );

  const targetLanguage =
    normalizeLanguageTag(
      input.targetLanguage ??
        'zh-Hant',
    );

    console.log(
      '[Instant Translator] 語言判斷結果',
      {
        text:
          normalizedText.slice(
            0,
            100,
          ),

        pageLanguage:
          input.pageLanguage ||
          '(empty)',

        sourceLanguage,
        targetLanguage,
      },
    );
  if (!targetLanguage) {
    return Promise.reject(
      new NativeTranslationError(
        '不支援指定的目標語言',
        'UNSUPPORTED_LANGUAGE',
      ),
    );
  }
  if (!sourceLanguage) {
  return Promise.reject(
    new NativeTranslationError(
      '無法判斷這段文字是中文或日文，請手動選擇來源語言',
      'UNSUPPORTED_LANGUAGE',
    ),
  );
}

  /*
   * 已經是繁體中文時，
   * 不需要建立翻譯模型。
   */
  if (
    sourceLanguage ===
    targetLanguage
  ) {
    return Promise.resolve({
      originalText:
        normalizedText,

      translatedText:
        normalizedText,

      sourceLanguage,
      targetLanguage,
    });
  }

let createPromise:
  Promise<Translator>;

try {
  createPromise =
    getTranslatorSession({
      sourceLanguage,
      targetLanguage,

      onDownloadProgress:
        input.onDownloadProgress,

      onPreparing:
        input.onPreparing,
    });
} catch (error: unknown) {
  return Promise.reject(
    normalizeTranslationError(
      error,
      'CREATE_FAILED',
    ),
  );
}

  return createPromise
  .then(
    async (
      translator,
    ) => {
      input.signal
        .throwIfAborted();

      input.onReady?.();

      /*
       * 單次翻譯仍然使用自己的 signal。
       *
       * 取消這次 translate，
       * 不會破壞共用 Translator session。
       */
      const translatedText =
        await translator.translate(
          normalizedText,
          {
            signal:
              input.signal,
          },
        );

      return {
        originalText:
          normalizedText,

        translatedText:
          translatedText.trim(),

        sourceLanguage,
        targetLanguage,
      };
    },
  )
  .catch((error: unknown) => {
    if (isAbortError(error)) {
      throw error;
    }

    throw normalizeTranslationError(
      error,
      'TRANSLATE_FAILED',
    );
  });
}

/**
 * 這個階段先使用同步語言推斷。
 *
 * 下一階段再加入語言選擇器與
 * Language Detector API。
 */
function inferSourceLanguage(
  text: string,
  pageLanguage?: string,
): string | null {
  const normalizedPageLanguage =
    normalizeLanguageTag(
      pageLanguage,
    );

  /*
   * 日文假名。
   */
  if (
    /[\u3040-\u30ff]/u.test(
      text,
    )
  ) {
    return 'ja';
  }

  /*
   * 韓文。
   */
  if (
    /[\uac00-\ud7af]/u.test(
      text,
    )
  ) {
    return 'ko';
  }

  /*
   * 泰文。
   */
  if (
    /[\u0e00-\u0e7f]/u.test(
      text,
    )
  ) {
    return 'th';
  }

  /*
   * 阿拉伯文。
   */
  if (
    /[\u0600-\u06ff]/u.test(
      text,
    )
  ) {
    return 'ar';
  }

  /*
   * 西里爾字母。
   *
   * 若頁面明確宣告 uk、bg 或 ru，
   * 優先採用頁面語言。
   */
  if (
    /[\u0400-\u04ff]/u.test(
      text,
    )
  ) {
    if (
      normalizedPageLanguage ===
        'uk' ||
      normalizedPageLanguage ===
        'bg' ||
      normalizedPageLanguage ===
        'ru'
    ) {
      return normalizedPageLanguage;
    }

    return 'ru';
  }

  /*
   * 漢字。
   */
/*
 * 漢字可能是中文，也可能是日文。
 *
 * 單靠 Unicode 漢字範圍無法區分，
 * 因此優先參考選取內容所在元素或網頁的 lang。
 */
/*
 * 純漢字可能是中文或日文。
 */
if (
  /[\u3400-\u9fff]/u.test(text)
) {
  if (
    normalizedPageLanguage === 'ja'
  ) {
    return 'ja';
  }

  if (
    normalizedPageLanguage ===
    'zh-Hant'
  ) {
    return 'zh-Hant';
  }

  if (
    normalizedPageLanguage === 'zh'
  ) {
    return 'zh';
  }

  /*
   * 網頁不是中文或日文，
   * 文字又只有漢字，無法可靠判斷。
   */
  return null;
}

  /*
   * 拉丁字母優先參考網頁 lang。
   */
  if (
    /[a-z\u00c0-\u024f]/iu
      .test(text)
  ) {
    if (
      normalizedPageLanguage &&
      normalizedPageLanguage !==
        'zh' &&
      normalizedPageLanguage !==
        'zh-Hant'
    ) {
      return normalizedPageLanguage;
    }

    return 'en';
  }

  return (
    normalizedPageLanguage ??
    'en'
  );
}

function normalizeLanguageTag(
  language?: string,
): string | null {
  if (!language) {
    return null;
  }

  const normalized =
    language
      .trim()
      .replaceAll('_', '-')
      .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized === 'zh-hant' ||
    normalized.startsWith(
      'zh-hant-',
    )
  ) {
    return 'zh-Hant';
  }

  if (
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh-hans' ||
    normalized.startsWith(
      'zh-hans-',
    )
  ) {
    return 'zh';
  }

  const primaryLanguage =
    normalized.split('-')[0];

  if (
    primaryLanguage &&
    SUPPORTED_LANGUAGES.has(
      primaryLanguage,
    )
  ) {
    return primaryLanguage;
  }

  return null;
}

function normalizeTranslationError(
  error: unknown,
  fallbackCode:
    NativeTranslationErrorCode,
): NativeTranslationError {
  if (
    error instanceof
    NativeTranslationError
  ) {
    return error;
  }

  if (
    error instanceof DOMException
  ) {
    if (
      error.name ===
      'NotSupportedError'
    ) {
      return new NativeTranslationError(
        'Chrome 不支援這組翻譯語言',
        'UNSUPPORTED_LANGUAGE',
        {
          cause: error,
        },
      );
    }

    if (
      error.name ===
      'NotAllowedError'
    ) {
      return new NativeTranslationError(
        '建立翻譯模型需要由使用者操作觸發',
        'CREATE_FAILED',
        {
          cause: error,
        },
      );
    }

    if (
      error.name ===
      'InvalidStateError'
    ) {
      return new NativeTranslationError(
        '目前頁面狀態無法執行翻譯',
        fallbackCode,
        {
          cause: error,
        },
      );
    }
  }

  return new NativeTranslationError(
    error instanceof Error
      ? error.message
      : 'Chrome 翻譯服務發生未知錯誤',
    fallbackCode,
    {
      cause: error,
    },
  );
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}
