<script setup lang="ts">
import {
  computed,
  ref,
} from 'vue';

import {
  errorLog,
} from '../../src/shared/logger';
import {
  createPairKey,
  preloadRecommendedModels,
} from '../../src/shared/model-preloader';

import type {
  ModelPreloadProgress,
  ModelPreloadResult,
  TranslationPair,
} from '../../src/shared/model-preloader';

const RECOMMENDED_PAIRS = [
  {
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hant',
  },
  {
    sourceLanguage: 'ja',
    targetLanguage: 'zh-Hant',
  },
  {
    sourceLanguage: 'ko',
    targetLanguage: 'zh-Hant',
  },
] satisfies TranslationPair[];

const isPreparing = ref(false);
const progress = ref<ModelPreloadProgress | null>(null);
const results = ref<ModelPreloadResult[]>([]);
const errorMessage = ref('');

const completedCount = computed(() =>
  results.value.filter((result) => result.status === 'completed').length,
);

const failedCount = computed(() =>
  results.value.filter((result) => result.status === 'failed').length,
);

const skippedCount = computed(() =>
  results.value.filter((result) => result.status === 'skipped').length,
);

const failedTaskIds = computed(() =>
  new Set(
    results.value
      .filter((result) => result.status === 'failed')
      .map((result) => result.taskId),
  ),
);

const prepareButtonLabel = computed(() => {
  if (isPreparing.value) {
    return '模型準備中……';
  }

  if (failedCount.value > 0) {
    return '重試失敗項目';
  }

  return results.value.length > 0
    ? '重新檢查模型'
    : '下載常用模型';
});

async function handlePrepareModels(): Promise<void> {
  if (isPreparing.value) {
    return;
  }

  const isFirstPreparation = results.value.length === 0;
  const previousResults = results.value;
  const retryOnlyFailedTasks =
    !isFirstPreparation && failedTaskIds.value.size > 0;

  const translationPairs = retryOnlyFailedTasks
    ? RECOMMENDED_PAIRS.filter((pair) =>
        failedTaskIds.value.has(createPairKey(pair)),
      )
    : RECOMMENDED_PAIRS;

  const includeLanguageDetector =
    isFirstPreparation ||
    failedTaskIds.value.has('language-detector');

  isPreparing.value = true;
  progress.value = null;
  errorMessage.value = '';

  try {
    /*
     * 此函式僅由按鈕 click handler 呼叫。
     * 呼叫前不可加入 setTimeout 或其他非使用者互動的流程。
     */
    const newResults = await preloadRecommendedModels({
      includeLanguageDetector,
      translationPairs,
      onProgress(newProgress) {
        progress.value = newProgress;
      },
    });

    const refreshedTaskIds = new Set(
      newResults.map((result) => result.taskId),
    );

    results.value = [
      ...previousResults.filter(
        (result) => !refreshedTaskIds.has(result.taskId),
      ),
      ...newResults,
    ];
  } catch (error: unknown) {
    errorLog('[Instant Translator] 準備離線模型失敗', error, {
      code: 'MODEL_PRELOAD_START_FAILED',
    });

    errorMessage.value =
      error instanceof Error
        ? error.message
        : '模型準備失敗。';
  } finally {
    isPreparing.value = false;
  }
}
</script>

<template>
  <main
    class="model-setup"
    aria-labelledby="model-setup-title"
  >
    <header class="model-setup__header">
      <p class="model-setup__eyebrow">
        Instant Translator
      </p>

      <h1 id="model-setup-title">
        準備離線翻譯模型
      </h1>

      <p>
        下載常用模型後，第一次選字翻譯就不需要等待完整下載。
      </p>
    </header>

    <section
      class="model-setup__card"
      aria-labelledby="recommended-models-title"
    >
      <h2 id="recommended-models-title">
        將準備的模型
      </h2>

      <ul class="model-setup__list">
        <li>語言偵測模型</li>
        <li>英文 → 繁體中文</li>
        <li>日文 → 繁體中文</li>
        <li>韓文 → 繁體中文</li>
      </ul>

      <button
        class="model-setup__button"
        type="button"
        :disabled="isPreparing"
        @click="handlePrepareModels"
      >
        {{ prepareButtonLabel }}
      </button>
    </section>

    <section
      v-if="progress"
      class="model-setup__progress"
      aria-live="polite"
    >
      <div class="model-setup__progress-heading">
        <strong>{{ progress.taskLabel }}</strong>
        <span>
          第 {{ progress.taskIndex }} / {{ progress.taskCount }} 項
        </span>
      </div>

      <progress
        :value="progress.overallPercentage"
        max="100"
      />

      <p>
        {{ progress.overallPercentage }}%
        <span v-if="progress.status === 'checking'">
          · 正在確認模型狀態
        </span>
        <span v-else-if="progress.status === 'downloading'">
          · 正在下載
        </span>
        <span v-else-if="progress.status === 'completed'">
          · 已完成
        </span>
      </p>
    </section>

    <template v-if="!isPreparing && results.length > 0">
      <ul class="model-result-list">
        <li
          v-for="result in results"
          :key="result.taskId"
          class="model-result-item"
        >
          <div>
            <strong>{{ result.taskLabel }}</strong>
            <small v-if="result.reason">
              {{ result.reason }}
            </small>
          </div>

          <span
            class="model-result-item__status"
            :class="`model-result-item__status--${result.status}`"
          >
            {{
              result.status === 'completed'
                ? '已完成'
                : result.status === 'skipped'
                  ? '不需要'
                  : '失敗'
            }}
          </span>
        </li>
      </ul>

      <p
        class="model-setup__summary"
        aria-live="polite"
      >
        已完成 {{ completedCount }} 項
        <template v-if="skippedCount > 0">
          ，略過 {{ skippedCount }} 項
        </template>
        <template v-if="failedCount > 0">
          ，失敗 {{ failedCount }} 項
        </template>
        。
        <span v-if="failedCount > 0">
          可再次按下載按鈕重試失敗項目。
        </span>
      </p>
    </template>

    <p
      v-if="errorMessage"
      class="model-setup__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <p class="model-setup__note">
      模型由 Chrome 管理；若系統日後釋出磁碟空間，Chrome 可能需要在下次翻譯時重新下載。
    </p>
  </main>
</template>
