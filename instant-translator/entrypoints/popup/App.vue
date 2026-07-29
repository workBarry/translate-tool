<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from 'vue';

import {
  DEFAULT_TRANSLATOR_SETTINGS,
} from '../../src/shared/translator-settings.types';

import {
  loadTranslatorSettings,
  resetTranslatorSettings,
  saveTranslatorSettings,
  watchTranslatorSettings,
} from '../../src/shared/translator-settings.storage';

import type {
  SourceLanguageSetting,
  TranslationLanguage,
  TranslatorSettings,
} from '../../src/shared/translator-settings.types';

type StatusType =
  | 'idle'
  | 'success'
  | 'error';

const settings =
  reactive<TranslatorSettings>({
    ...DEFAULT_TRANSLATOR_SETTINGS,
  });

const loading =
  ref(true);

const saving =
  ref(false);

const resetting =
  ref(false);

const statusType =
  ref<StatusType>(
    'idle',
  );

const statusMessage =
  ref('');

let unwatchSettings:
  (() => void) | null =
    null;

let saveQueue:
  Promise<void> =
    Promise.resolve();

let latestSaveId = 0;
let pendingSaveCount = 0;

let statusTimer:
  ReturnType<
    typeof setTimeout
  > | null = null;

const sourceLanguageLabel =
  computed(() => {
    return getSourceLanguageLabel(
      settings
        .sourceLanguageSetting,
    );
  });

const targetLanguageLabel =
  computed(() => {
    return getTargetLanguageLabel(
      settings.targetLanguage,
    );
  });

onMounted(async () => {
  try {
    const storedSettings =
      await loadTranslatorSettings();

    Object.assign(
      settings,
      storedSettings,
    );

    unwatchSettings =
      watchTranslatorSettings(
        (newSettings) => {
          Object.assign(
            settings,
            newSettings,
          );
        },
      );
  } catch (error: unknown) {
    console.error(
      '[Instant Translator] Popup 載入設定失敗',
      error,
    );

    showStatus(
      'error',
      '無法載入設定',
    );
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  unwatchSettings?.();

  unwatchSettings = null;

  clearStatusTimer();
});

function handleEnabledChange(
  event: Event,
): void {
  const checkbox =
    event.currentTarget;

  if (
    !(
      checkbox instanceof
      HTMLInputElement
    )
  ) {
    return;
  }

  settings.enabled =
    checkbox.checked;

  queueSettingsSave();
}

function handleSourceLanguageChange(
  event: Event,
): void {
  const select =
    event.currentTarget;

  if (
    !(
      select instanceof
      HTMLSelectElement
    )
  ) {
    return;
  }

  settings
    .sourceLanguageSetting =
      select.value as
        SourceLanguageSetting;

  queueSettingsSave();
}

function handleTargetLanguageChange(
  event: Event,
): void {
  const select =
    event.currentTarget;

  if (
    !(
      select instanceof
      HTMLSelectElement
    )
  ) {
    return;
  }

  settings.targetLanguage =
    select.value as
      TranslationLanguage;

  queueSettingsSave();
}

function queueSettingsSave():
  void {
  const saveId =
    ++latestSaveId;

  const snapshot:
    TranslatorSettings = {
      enabled:
        settings.enabled,

      sourceLanguageSetting:
        settings
          .sourceLanguageSetting,

      targetLanguage:
        settings.targetLanguage,
    };

  pendingSaveCount += 1;
  saving.value = true;

  /*
   * 所有 storage 寫入依序執行，
   * 避免使用者快速切換設定時，
   * 較舊的儲存結果覆蓋較新的值。
   */
  saveQueue =
    saveQueue
      .catch(() => {
        /*
         * 前一次失敗不阻止
         * 下一次寫入。
         */
      })
      .then(async () => {
        await saveTranslatorSettings(
          snapshot,
        );

        if (
          saveId ===
          latestSaveId
        ) {
          showStatus(
            'success',
            '設定已保存',
          );
        }
      })
      .catch(
        (error: unknown) => {
          console.error(
            '[Instant Translator] Popup 保存設定失敗',
            {
              snapshot,
              error,
            },
          );

          if (
            saveId ===
            latestSaveId
          ) {
            showStatus(
              'error',
              '設定保存失敗',
            );
          }
        },
      )
      .finally(() => {
        pendingSaveCount =
          Math.max(
            0,
            pendingSaveCount - 1,
          );

        saving.value =
          pendingSaveCount > 0;
      });
}

async function handleReset():
  Promise<void> {
  if (
    resetting.value
  ) {
    return;
  }

  resetting.value = true;

  try {
    await resetTranslatorSettings();

    Object.assign(
      settings,
      DEFAULT_TRANSLATOR_SETTINGS,
    );

    showStatus(
      'success',
      '已恢復預設設定',
    );
  } catch (error: unknown) {
    console.error(
      '[Instant Translator] 重設設定失敗',
      error,
    );

    showStatus(
      'error',
      '重設失敗',
    );
  } finally {
    resetting.value = false;
  }
}

function showStatus(
  type: Exclude<
    StatusType,
    'idle'
  >,
  message: string,
): void {
  clearStatusTimer();

  statusType.value =
    type;

  statusMessage.value =
    message;

  statusTimer =
    setTimeout(() => {
      statusType.value =
        'idle';

      statusMessage.value =
        '';
    }, 1800);
}

function clearStatusTimer():
  void {
  if (
    statusTimer === null
  ) {
    return;
  }

  clearTimeout(
    statusTimer,
  );

  statusTimer = null;
}

function getSourceLanguageLabel(
  language:
    SourceLanguageSetting,
): string {
  switch (language) {
    case 'auto':
      return '自動判斷';

    case 'zh':
      return '中文';

    case 'zh-Hant':
      return '繁體中文';

    case 'en':
      return '英文';

    case 'ja':
      return '日文';

    case 'ko':
      return '韓文';
  }
}

function getTargetLanguageLabel(
  language:
    TranslationLanguage,
): string {
  switch (language) {
    case 'zh-Hant':
      return '繁體中文';

    case 'en':
      return '英文';

    case 'ja':
      return '日文';

    case 'ko':
      return '韓文';
  }
}
</script>

<template>
  <main
    class="popup"
    aria-labelledby="popup-title"
  >
    <header
      class="popup__header"
    >
      <div
        class="popup__brand"
      >
        <div
          class="popup__logo"
          aria-hidden="true"
        >
          文
        </div>

        <div>
          <h1
            id="popup-title"
            class="popup__title"
          >
            Instant Translator
          </h1>

          <p
            class="popup__subtitle"
          >
            Chrome 裝置端選字翻譯
          </p>
        </div>
      </div>

      <span
        class="popup__status-badge"
        :class="{
          'popup__status-badge--enabled':
            settings.enabled,

          'popup__status-badge--disabled':
            !settings.enabled,
        }"
      >
        {{
          settings.enabled
            ? '已啟用'
            : '已停用'
        }}
      </span>
    </header>

    <div
      v-if="loading"
      class="popup__loading"
      aria-live="polite"
    >
      正在載入設定……
    </div>

    <template
      v-else
    >
      <section
        class="popup__section"
        aria-labelledby="general-settings-title"
      >
        <h2
          id="general-settings-title"
          class="popup__section-title"
        >
          一般設定
        </h2>

        <label
          class="setting-row setting-row--switch"
        >
          <span
            class="setting-row__content"
          >
            <span
              class="setting-row__label"
            >
              啟用選字翻譯
            </span>

            <span
              class="setting-row__description"
            >
              選取網頁文字時顯示翻譯卡片
            </span>
          </span>

          <span
            class="switch"
          >
            <input
              class="switch__input"
              type="checkbox"
              role="switch"
              :checked="
                settings.enabled
              "
              :aria-checked="
                settings.enabled
              "
              @change="
                handleEnabledChange
              "
            />

            <span
              class="switch__track"
              aria-hidden="true"
            >
              <span
                class="switch__thumb"
              />
            </span>
          </span>
        </label>
      </section>

      <section
        class="popup__section"
        aria-labelledby="language-settings-title"
      >
        <h2
          id="language-settings-title"
          class="popup__section-title"
        >
          語言設定
        </h2>

        <label
          class="field"
        >
          <span
            class="field__label"
          >
            預設來源語言
          </span>

          <select
            class="field__select"
            :value="
              settings
                .sourceLanguageSetting
            "
            @change="
              handleSourceLanguageChange
            "
          >
            <option value="auto">
              自動判斷
            </option>

            <option value="zh-Hant">
              繁體中文
            </option>

            <option value="zh">
              中文
            </option>

            <option value="en">
              英文
            </option>

            <option value="ja">
              日文
            </option>

            <option value="ko">
              韓文
            </option>
          </select>
        </label>

        <label
          class="field"
        >
          <span
            class="field__label"
          >
            預設翻譯語言
          </span>

          <select
            class="field__select"
            :value="
              settings.targetLanguage
            "
            @change="
              handleTargetLanguageChange
            "
          >
            <option value="zh-Hant">
              繁體中文
            </option>

            <option value="en">
              英文
            </option>

            <option value="ja">
              日文
            </option>

            <option value="ko">
              韓文
            </option>
          </select>
        </label>

        <div
          class="language-summary"
        >
          <span>
            {{ sourceLanguageLabel }}
          </span>

          <span
            aria-hidden="true"
          >
            →
          </span>

          <strong>
            {{ targetLanguageLabel }}
          </strong>
        </div>
      </section>

      <section
        class="popup__privacy"
      >
        <span
          class="popup__privacy-icon"
          aria-hidden="true"
        >
          ✓
        </span>

        <p>
          翻譯由 Chrome 裝置端模型執行，
          選取內容不會傳送到外部翻譯伺服器。
        </p>
      </section>

      <footer
        class="popup__footer"
      >
        <button
          class="button button--secondary"
          type="button"
          :disabled="
            resetting ||
            saving
          "
          @click="
            handleReset
          "
        >
          {{
            resetting
              ? '重設中……'
              : '恢復預設值'
          }}
        </button>

        <p
          class="popup__save-status"
          :class="{
            'popup__save-status--success':
              statusType ===
              'success',

            'popup__save-status--error':
              statusType ===
              'error',
          }"
          aria-live="polite"
        >
          <template
            v-if="saving"
          >
            保存中……
          </template>

          <template
            v-else
          >
            {{ statusMessage }}
          </template>
        </p>
      </footer>
    </template>
  </main>
</template>