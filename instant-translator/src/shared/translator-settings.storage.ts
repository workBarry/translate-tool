import {
  storage,
} from '#imports';

import {
  DEFAULT_TRANSLATOR_SETTINGS,
  normalizeTranslatorSettings,
} from './translator-settings.types';

import type {
  TranslatorSettings,
  TranslatorSettingsV1,
} from './translator-settings.types';

const translatorSettingsItem =
  storage.defineItem<TranslatorSettings>(
    'local:translatorSettings',
    {
      fallback: {
        ...DEFAULT_TRANSLATOR_SETTINGS,
      },

      /*
       * V1：
       * sourceLanguageSetting
       * targetLanguage
       *
       * V2：
       * 新增 enabled
       */
      version: 2,

      migrations: {
        2(
          oldSettings:
            TranslatorSettingsV1,
        ): TranslatorSettings {
          return normalizeTranslatorSettings({
            ...oldSettings,
            enabled: true,
          });
        },
      },
    },
  );

export async function loadTranslatorSettings():
  Promise<TranslatorSettings> {
  const storedValue =
    await translatorSettingsItem
      .getValue();

  const normalizedValue =
    normalizeTranslatorSettings(
      storedValue,
    );

  if (
    !areTranslatorSettingsEqual(
      storedValue,
      normalizedValue,
    )
  ) {
    await translatorSettingsItem
      .setValue(
        normalizedValue,
      );
  }

  return normalizedValue;
}

export async function saveTranslatorSettings(
  settings:
    TranslatorSettings,
): Promise<void> {
  await translatorSettingsItem
    .setValue(
      normalizeTranslatorSettings(
        settings,
      ),
    );
}

export function watchTranslatorSettings(
  listener: (
    settings:
      TranslatorSettings,
  ) => void,
): () => void {
  return translatorSettingsItem
    .watch((newValue) => {
      listener(
        normalizeTranslatorSettings(
          newValue,
        ),
      );
    });
}

export async function resetTranslatorSettings():
  Promise<void> {
  await translatorSettingsItem
    .setValue({
      ...DEFAULT_TRANSLATOR_SETTINGS,
    });
}

function areTranslatorSettingsEqual(
  first: unknown,
  second:
    TranslatorSettings,
): boolean {
  if (
    !first ||
    typeof first !== 'object'
  ) {
    return false;
  }

  const candidate =
    first as Partial<
      TranslatorSettings
    >;

  return (
    candidate.enabled ===
      second.enabled &&
    candidate.sourceLanguageSetting ===
      second.sourceLanguageSetting &&
    candidate.targetLanguage ===
      second.targetLanguage
  );
}