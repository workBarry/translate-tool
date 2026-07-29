export const SOURCE_LANGUAGE_SETTINGS = [
  'auto',
  'zh',
  'zh-Hant',
  'en',
  'ja',
  'ko',
] as const;

export type SourceLanguageSetting =
  (typeof SOURCE_LANGUAGE_SETTINGS)[number];

export const TRANSLATION_LANGUAGES = [
  'zh-Hant',
  'en',
  'ja',
  'ko',
] as const;

export type TranslationLanguage =
  (typeof TRANSLATION_LANGUAGES)[number];

/**
 * 舊版設定格式。
 *
 * 保留給 storage migration 使用。
 */
export interface TranslatorSettingsV1 {
  sourceLanguageSetting: SourceLanguageSetting;
  targetLanguage: TranslationLanguage;
}

/**
 * 目前使用的設定格式。
 */
export interface TranslatorSettingsV2
  extends TranslatorSettingsV1 {
  enabled: boolean;
}

export type TranslatorSettings =
  TranslatorSettingsV2;

export const DEFAULT_TRANSLATOR_SETTINGS:
  Readonly<TranslatorSettings> = {
    enabled: true,
    sourceLanguageSetting: 'auto',
    targetLanguage: 'zh-Hant',
  };

export function isSourceLanguageSetting(
  value: unknown,
): value is SourceLanguageSetting {
  return (
    typeof value === 'string' &&
    (
      SOURCE_LANGUAGE_SETTINGS as readonly string[]
    ).includes(value)
  );
}

export function isTranslationLanguage(
  value: unknown,
): value is TranslationLanguage {
  return (
    typeof value === 'string' &&
    (
      TRANSLATION_LANGUAGES as readonly string[]
    ).includes(value)
  );
}

export function normalizeTranslatorSettings(
  value: unknown,
): TranslatorSettings {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return {
      ...DEFAULT_TRANSLATOR_SETTINGS,
    };
  }

  const candidate =
    value as Partial<TranslatorSettings>;

  return {
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_TRANSLATOR_SETTINGS.enabled,

    sourceLanguageSetting:
      isSourceLanguageSetting(
        candidate.sourceLanguageSetting,
      )
        ? candidate.sourceLanguageSetting
        : DEFAULT_TRANSLATOR_SETTINGS
            .sourceLanguageSetting,

    targetLanguage:
      isTranslationLanguage(
        candidate.targetLanguage,
      )
        ? candidate.targetLanguage
        : DEFAULT_TRANSLATOR_SETTINGS
            .targetLanguage,
  };
}