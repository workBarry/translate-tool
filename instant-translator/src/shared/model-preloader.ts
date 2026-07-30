import {
  errorLog,
} from './logger';

export type PreloadModelStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface TranslationPair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface ModelPreloadProgress {
  taskId: string;
  taskLabel: string;
  taskIndex: number;
  taskCount: number;
  taskPercentage: number;
  overallPercentage: number;
  status: PreloadModelStatus;
}

export interface ModelPreloadResult {
  taskId: string;
  taskLabel: string;
  status: 'completed' | 'skipped' | 'failed';
  reason?: string;
}

interface PreloadRecommendedModelsOptions {
  translationPairs: TranslationPair[];
  includeLanguageDetector?: boolean;
  onProgress?: (progress: ModelPreloadProgress) => void;
}

interface PreloadTask {
  id: string;
  label: string;
  execute: (
    onProgress: (
      percentage: number,
      status: PreloadModelStatus,
    ) => void,
  ) => Promise<void>;
}

class ModelPreloadSkippedError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'ModelPreloadSkippedError';
    Object.setPrototypeOf(this, ModelPreloadSkippedError.prototype);
  }
}

export async function preloadRecommendedModels(
  options: PreloadRecommendedModelsOptions,
): Promise<ModelPreloadResult[]> {
  /*
   * 必須從 Options Page 的點擊處理函式直接呼叫。
   * 不可由 background、onMounted 或 timer 自動觸發下載。
   */
  if (
    navigator.userActivation &&
    !navigator.userActivation.isActive
  ) {
    throw new Error('下載模型前需要使用者操作。');
  }

  const tasks = createPreloadTasks(options);
  const results: ModelPreloadResult[] = [];

  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
    const task = tasks[taskIndex];

    if (!task) {
      continue;
    }

    const reportProgress = (
      taskPercentage: number,
      status: PreloadModelStatus,
    ): void => {
      const normalizedPercentage = clampPercentage(taskPercentage);

      options.onProgress?.({
        taskId: task.id,
        taskLabel: task.label,
        taskIndex: taskIndex + 1,
        taskCount: tasks.length,
        taskPercentage: normalizedPercentage,
        overallPercentage: Math.round(
          ((taskIndex + normalizedPercentage / 100) / tasks.length) * 100,
        ),
        status,
      });
    };

    try {
      reportProgress(0, 'checking');
      await task.execute(reportProgress);
      reportProgress(100, 'completed');

      results.push({
        taskId: task.id,
        taskLabel: task.label,
        status: 'completed',
      });
    } catch (error: unknown) {
      if (error instanceof ModelPreloadSkippedError) {
        reportProgress(100, 'skipped');
        results.push({
          taskId: task.id,
          taskLabel: task.label,
          status: 'skipped',
          reason: error.message,
        });
        continue;
      }

      errorLog('[Instant Translator] 模型預載失敗', error, {
        code: 'MODEL_PRELOAD_FAILED',
      });

      reportProgress(0, 'failed');
      results.push({
        taskId: task.id,
        taskLabel: task.label,
        status: 'failed',
        reason: getSafePreloadErrorMessage(error),
      });
    }
  }

  return results;
}

function createPreloadTasks(
  options: PreloadRecommendedModelsOptions,
): PreloadTask[] {
  const tasks: PreloadTask[] = [];

  if (options.includeLanguageDetector !== false) {
    tasks.push({
      id: 'language-detector',
      label: '語言偵測模型',
      execute: preloadLanguageDetector,
    });
  }

  for (const pair of options.translationPairs) {
    if (pair.sourceLanguage === pair.targetLanguage) {
      continue;
    }

    tasks.push({
      id: createPairKey(pair),
      label: `${getLanguageLabel(pair.sourceLanguage)} → ${getLanguageLabel(pair.targetLanguage)}`,
      execute: (onProgress) => preloadTranslatorPair(pair, onProgress),
    });
  }

  return tasks;
}

async function preloadLanguageDetector(
  onProgress: (
    percentage: number,
    status: PreloadModelStatus,
  ) => void,
): Promise<void> {
  if (!('LanguageDetector' in self)) {
    throw new ModelPreloadSkippedError(
      '此版本 Chrome 不支援內建語言偵測，將使用 Chrome i18n 備援。',
    );
  }

  let availability: Awaited<ReturnType<typeof LanguageDetector.availability>>;

  try {
    availability = await LanguageDetector.availability();
  } catch {
    throw new ModelPreloadSkippedError(
      '無法取得內建語言偵測模型狀態，將使用 Chrome i18n 備援。',
    );
  }

  if (availability === 'unavailable') {
    throw new ModelPreloadSkippedError(
      '目前裝置不支援內建語言偵測，將使用 Chrome i18n 備援。',
    );
  }

  onProgress(
    availability === 'available' ? 100 : 0,
    availability === 'available' ? 'completed' : 'downloading',
  );

  let lastPercentage = -1;
  let detector: Awaited<ReturnType<typeof LanguageDetector.create>>;

  try {
    detector = await LanguageDetector.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const percentage = Math.round(
            Math.max(0, Math.min(1, event.loaded)) * 100,
          );

          if (percentage === lastPercentage) {
            return;
          }

          lastPercentage = percentage;
          onProgress(percentage, 'downloading');
        });
      },
    });
  } catch (error: unknown) {
    if (
      error instanceof DOMException &&
      error.name === 'NotSupportedError'
    ) {
      throw new ModelPreloadSkippedError(
        '此環境無法建立內建語言偵測器，將使用 Chrome i18n 備援。',
      );
    }

    throw error;
  }

  detector.destroy();
}

async function preloadTranslatorPair(
  pair: TranslationPair,
  onProgress: (
    percentage: number,
    status: PreloadModelStatus,
  ) => void,
): Promise<void> {
  if (!('Translator' in self)) {
    throw new Error('目前瀏覽器不支援 Translator API。');
  }

  const availability = await Translator.availability(pair);

  if (availability === 'unavailable') {
    throw new DOMException(
      'Unsupported translation pair.',
      'NotSupportedError',
    );
  }

  onProgress(
    availability === 'available' ? 100 : 0,
    availability === 'available' ? 'completed' : 'downloading',
  );

  let lastPercentage = -1;
  const translator = await Translator.create({
    ...pair,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        const percentage = Math.round(event.loaded * 100);

        if (percentage === lastPercentage) {
          return;
        }

        lastPercentage = percentage;
        onProgress(percentage, 'downloading');
      });
    },
  });

  translator.destroy();
}

export function createPairKey(pair: TranslationPair): string {
  return `${pair.sourceLanguage}→${pair.targetLanguage}`;
}

function getLanguageLabel(language: string): string {
  switch (language) {
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
    default:
      return language;
  }
}

function clampPercentage(percentage: number): number {
  return Math.round(Math.min(100, Math.max(0, percentage)));
}

function getSafePreloadErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return '瀏覽器需要使用者重新點擊下載按鈕。';
      case 'NotSupportedError':
        return '目前瀏覽器或裝置不支援此模型。';
      case 'NetworkError':
        return '模型下載失敗，請檢查網路後重試。';
    }
  }

  return '模型準備失敗。';
}
