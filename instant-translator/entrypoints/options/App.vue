<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
} from 'vue';

import {
  errorLog,
} from '../../src/shared/logger';
import {
  createPairKey,
  getAvailableTranslationPairResults,
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

interface RecommendedModelTask {
  taskId: string;
  taskLabel: string;
  translationPairs: TranslationPair[];
  includeLanguageDetector: boolean;
}

const RECOMMENDED_TASKS: RecommendedModelTask[] = [
  ...RECOMMENDED_PAIRS.map((pair) => ({
    taskId: createPairKey(pair),
    taskLabel: `${getLanguageLabel(pair.sourceLanguage)} → ${getLanguageLabel(pair.targetLanguage)}`,
    translationPairs: [pair],
    includeLanguageDetector: false,
  })),
  {
    taskId: 'language-detector',
    taskLabel: '內建語言偵測模型',
    translationPairs: [],
    includeLanguageDetector: true,
  },
];

const TRANSLATION_MODEL_TASKS = RECOMMENDED_TASKS.filter(
  (task) => task.translationPairs.length > 0,
);

const isPreparing = ref(false);
const progress = ref<ModelPreloadProgress | null>(null);
const results = ref<ModelPreloadResult[]>([]);
const errorMessage = ref('');
const activeTaskId = ref<string | null>(null);
const activeTaskIds = ref(new Set<string>());
const taskProgressById = ref<Record<string, ModelPreloadProgress>>({});

onMounted(() => {
  void getAvailableTranslationPairResults(RECOMMENDED_PAIRS)
    .then((availableResults) => {
      const resultsByTaskId = new Map(
        results.value.map((result) => [result.taskId, result]),
      );

      for (const result of availableResults) {
        if (!resultsByTaskId.has(result.taskId)) {
          resultsByTaskId.set(result.taskId, result);
        }
      }

      results.value = RECOMMENDED_TASKS.flatMap((task) => {
        const result = resultsByTaskId.get(task.taskId);

        return result ? [result] : [];
      });
    })
    .catch((error: unknown) => {
      errorLog('[Instant Translator] Model availability check failed', error, {
        code: 'MODEL_AVAILABILITY_CHECK_FAILED',
      });
    });
});

const completedCount = computed(() =>
  results.value.filter((result) => result.status === 'completed').length,
);

const failedCount = computed(() =>
  results.value.filter((result) => result.status === 'failed').length,
);

const skippedCount = computed(() =>
  results.value.filter((result) => result.status === 'skipped').length,
);

const nextTask = computed(() =>
  RECOMMENDED_TASKS.find((task) => {
    const result = results.value.find(
      (item) => item.taskId === task.taskId,
    );

    return !result || result.status === 'failed';
  }),
);

const activeTaskPosition = computed(() => {
  const taskId = activeTaskId.value ?? nextTask.value?.taskId;
  const taskIndex = RECOMMENDED_TASKS.findIndex(
    (task) => task.taskId === taskId,
  );

  return taskIndex >= 0 ? taskIndex + 1 : RECOMMENDED_TASKS.length;
});

const failedTaskIds = computed(() =>
  new Set(
    results.value
      .filter((result) => result.status === 'failed')
      .map((result) => result.taskId),
  ),
);

const singlePrepareButtonLabel = computed(() => {
  if (isPreparing.value) {
    return '正在下載模型…';
  }

  const task = nextTask.value;

  if (!task) {
    return '所有模型已準備完成';
  }

  const previousResult = results.value.find(
    (result) => result.taskId === task.taskId,
  );

  return previousResult?.status === 'failed'
    ? `重試下載：${task.taskLabel}`
    : `下載：${task.taskLabel}`;
});

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

async function handlePrepareNextModel(): Promise<void> {
  if (isPreparing.value) {
    return;
  }

  const task = nextTask.value;

  if (!task) {
    return;
  }

  const previousResults = results.value;

  isPreparing.value = true;
  activeTaskId.value = task.taskId;
  progress.value = null;
  errorMessage.value = '';

  try {
    const newResults = await preloadRecommendedModels({
      includeLanguageDetector: task.includeLanguageDetector,
      translationPairs: task.translationPairs,
      onProgress(newProgress) {
        progress.value = newProgress;
      },
    });

    const resultsByTaskId = new Map(
      [...previousResults, ...newResults].map((result) => [
        result.taskId,
        result,
      ]),
    );

    results.value = RECOMMENDED_TASKS.flatMap((recommendedTask) => {
      const result = resultsByTaskId.get(recommendedTask.taskId);

      return result ? [result] : [];
    });
  } catch (error: unknown) {
    errorLog('[Instant Translator] Model preload start failed', error, {
      code: 'MODEL_PRELOAD_START_FAILED',
    });

    errorMessage.value =
      error instanceof Error
        ? error.message
        : '模型下載無法開始，請再試一次。';
  } finally {
    isPreparing.value = false;
    activeTaskId.value = null;
  }
}

async function handlePrepareModel(
  task: RecommendedModelTask,
): Promise<void> {
  if (activeTaskIds.value.has(task.taskId)) {
    return;
  }

  activeTaskIds.value = new Set([
    ...activeTaskIds.value,
    task.taskId,
  ]);
  errorMessage.value = '';

  try {
    const newResults = await preloadRecommendedModels({
      includeLanguageDetector: task.includeLanguageDetector,
      translationPairs: task.translationPairs,
      onProgress(newProgress) {
        taskProgressById.value = {
          ...taskProgressById.value,
          [task.taskId]: newProgress,
        };
      },
    });

    const resultsByTaskId = new Map(
      [...results.value, ...newResults].map((result) => [
        result.taskId,
        result,
      ]),
    );

    results.value = RECOMMENDED_TASKS.flatMap((recommendedTask) => {
      const result = resultsByTaskId.get(recommendedTask.taskId);

      return result ? [result] : [];
    });
  } catch (error: unknown) {
    errorLog('[Instant Translator] Model preload start failed', error, {
      code: 'MODEL_PRELOAD_START_FAILED',
    });

    errorMessage.value =
      error instanceof Error
        ? error.message
        : '模型下載無法開始，請再試一次。';
  } finally {
    const nextActiveTaskIds = new Set(activeTaskIds.value);

    nextActiveTaskIds.delete(task.taskId);
    activeTaskIds.value = nextActiveTaskIds;
  }
}

function getTaskButtonLabel(task: RecommendedModelTask): string {
  const progress = taskProgressById.value[task.taskId];

  if (activeTaskIds.value.has(task.taskId)) {
    return progress?.status === 'downloading'
      ? `下載中 ${progress.taskPercentage}%`
      : '正在準備…';
  }

  const result = results.value.find(
    (item) => item.taskId === task.taskId,
  );

  if (result?.status === 'completed') {
    return '已下載';
  }

  return result?.status === 'failed' ? '重試下載' : '下載模型';
}

function getTaskButtonStyle(
  task: RecommendedModelTask,
): Record<string, string> | undefined {
  if (!activeTaskIds.value.has(task.taskId)) {
    return undefined;
  }

  const percentage = taskProgressById.value[task.taskId]?.taskPercentage ?? 0;

  return {
    '--download-progress': `${percentage}%`,
  };
}

function getLanguageLabel(language: string): string {
  switch (language) {
    case 'en':
      return '英文';
    case 'ja':
      return '日文';
    case 'ko':
      return '韓文';
    case 'zh-Hant':
      return '繁體中文';
    default:
      return language;
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

      <div class="model-setup__actions">
        <button
          v-for="task in TRANSLATION_MODEL_TASKS"
          :key="task.taskId"
          class="model-setup__button"
          :class="{
            'model-setup__button--downloading': activeTaskIds.has(task.taskId),
          }"
          type="button"
          :disabled="activeTaskIds.has(task.taskId) || results.some((result) => result.taskId === task.taskId && result.status === 'completed')"
          :style="getTaskButtonStyle(task)"
          @click="handlePrepareModel(task)"
        >
          {{ task.taskLabel }}：{{ getTaskButtonLabel(task) }}
        </button>
      </div>
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
