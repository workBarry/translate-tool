<script setup lang="ts">
import {
  errorLog,
} from "../../src/shared/logger";


import {
  ref,
} from 'vue';

interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
  label: string;
}

const COMMON_LANGUAGE_PAIRS:
  LanguagePair[] = [
    {
      sourceLanguage: 'en',
      targetLanguage:
        'zh-Hant',
      label:
        '英文 → 繁體中文',
    },
    {
      sourceLanguage:
        'zh-Hant',
      targetLanguage: 'en',
      label:
        '繁體中文 → 英文',
    },
    {
      sourceLanguage: 'ja',
      targetLanguage:
        'zh-Hant',
      label:
        '日文 → 繁體中文',
    },
    {
      sourceLanguage:
        'zh-Hant',
      targetLanguage: 'ja',
      label:
        '繁體中文 → 日文',
    },
    {
      sourceLanguage: 'ko',
      targetLanguage:
        'zh-Hant',
      label:
        '韓文 → 繁體中文',
    },
  ];

const status =
  ref<
    'idle' |
    'downloading' |
    'completed' |
    'error'
  >('idle');

const currentLabel =
  ref('');

const progress =
  ref(0);

const errorMessage =
  ref('');

async function prepareCommonLanguages():
  Promise<void> {
  if (!('Translator' in self)) {
    status.value =
      'error';

    errorMessage.value =
      '目前 Chrome 不支援 Translator API';

    return;
  }

  status.value =
    'downloading';

  errorMessage.value =
    '';

  try {
    /*
     * 在同一次按鈕點擊中，
     * 立即呼叫每一組 Translator.create()。
     *
     * 不要在建立第一組之前先 await。
     */
    const createJobs =
      COMMON_LANGUAGE_PAIRS.map(
        (pair) => {
          return {
            pair,

            promise:
              Translator.create({
                sourceLanguage:
                  pair.sourceLanguage,

                targetLanguage:
                  pair.targetLanguage,

                monitor(monitor) {
                  monitor.addEventListener(
                    'downloadprogress',
                    (event) => {
                      currentLabel.value =
                        pair.label;

                      progress.value =
                        Math.round(
                          event.loaded *
                            100,
                        );
                    },
                  );
                },
              }),
          };
        },
      );

    const results =
      await Promise.allSettled(
        createJobs.map(
          (job) =>
            job.promise,
        ),
      );

    const failedResult =
      results.find(
        (result) =>
          result.status ===
          'rejected',
      );

    /*
     * 預下載完成後不需要持續占用 session。
     * 語言包會由 Chrome 管理。
     */
    for (const result of results) {
      if (
        result.status ===
        'fulfilled'
      ) {
        result.value.destroy();
      }
    }

    if (
      failedResult?.status ===
      'rejected'
    ) {
      throw failedResult.reason;
    }

    progress.value = 100;

    status.value =
      'completed';
  } catch (error: unknown) {
    errorLog(
      '[Instant Translator] 常用語言準備失敗',
      error,
    );

    status.value =
      'error';

    errorMessage.value =
      error instanceof Error
        ? error.message
        : '語言模型下載失敗';
  }
}
</script>

<template>
  <main>
    <h1>
      即時翻譯設定
    </h1>

    <p>
      第一次使用前，可先準備常用翻譯語言。
    </p>

    <button
      type="button"
      :disabled="
        status ===
        'downloading'
      "
      @click="
        prepareCommonLanguages
      "
    >
      {{
        status ===
        'downloading'
          ? '正在準備……'
          : '準備常用語言'
      }}
    </button>

    <div
      v-if="
        status ===
        'downloading'
      "
    >
      <p>
        {{ currentLabel }}
      </p>

      <progress
        :value="progress"
        max="100"
      />

      <span>
        {{ progress }}%
      </span>
    </div>

    <p
      v-if="
        status ===
        'completed'
      "
    >
      常用語言已準備完成
    </p>

    <p
      v-if="
        status ===
        'error'
      "
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </main>
</template>