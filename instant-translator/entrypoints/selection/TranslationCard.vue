<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import {
  correctPopoverPosition,
} from './position-calculator';

import type {
  PopoverPosition,
  SourceLanguageSetting,
  SpeechTarget,
  TranslationLanguage,
  TranslationPopoverState,
} from './types';

const props = defineProps<{
  state: TranslationPopoverState;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'retry'): void;
  (event: 'speak-source'): void;
  (event: 'speak-translation'): void;
  (
    event: 'change-source-language',
    language: SourceLanguageSetting,
  ): void;
  (
    event: 'change-target-language',
    language: TranslationLanguage,
  ): void;
  (
    event: 'adjust-position',
    position: PopoverPosition,
  ): void;
}>();

const sourceLanguageOptions: ReadonlyArray<{
  value: SourceLanguageSetting;
  label: string;
}> = [
  { value: 'auto', label: '自動判斷' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const targetLanguageOptions: ReadonlyArray<{
  value: TranslationLanguage;
  label: string;
}> = sourceLanguageOptions.filter(
  (
    option,
  ): option is {
    value: TranslationLanguage;
    label: string;
  } => option.value !== 'auto' && option.value !== 'zh',
);

const cardElement = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let correctionFrame: number | null = null;
let viewportDismissed = false;

const detectedLanguageMessage = computed(() => {
  if (
    props.state.sourceLanguageSetting !== 'auto' ||
    !props.state.detectedSourceLanguage
  ) {
    return '';
  }

  const confidence = props.state.detectedSourceConfidence;
  const confidenceText =
    confidence === null
      ? ''
      : `（${Math.round(confidence * 100)}%）`;

  return `自動偵測：${getLanguageLabel(
    props.state.detectedSourceLanguage,
  )}${confidenceText}`;
});

const modelLoadingMessage = computed(() => {
  switch (props.state.modelStatus) {
    case 'downloading':
      return `正在下載翻譯模型（${props.state.modelDownloadProgress}%）`;
    case 'preparing':
      return '模型下載完成，正在準備翻譯……';
    case 'ready':
      return '模型準備完成，正在翻譯……';
    default:
      return '正在準備翻譯……';
  }
});

function getLanguageLabel(language: string): string {
  return (
    sourceLanguageOptions.find(
      (option) => option.value === language,
    )?.label ?? language
  );
}

function isTargetSpeaking(target: SpeechTarget): boolean {
  return (
    (
      props.state.speechPlaybackStatus === 'starting' ||
      props.state.speechPlaybackStatus === 'speaking'
    ) &&
    props.state.activeSpeechTarget === target
  );
}

function handleSourceLanguageChange(event: Event): void {
  const select = event.currentTarget;

  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  emit(
    'change-source-language',
    select.value as SourceLanguageSetting,
  );
}

function handleTargetLanguageChange(event: Event): void {
  const select = event.currentTarget;

  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  emit(
    'change-target-language',
    select.value as TranslationLanguage,
  );
}

function handleRetry(): void {
  emit('retry');
}

function handleWindowResize(): void {
  if (props.state.status === 'hidden') {
    return;
  }

  schedulePositionCorrection();
}

function handleVisualViewportChange(): void {
  if (props.state.status === 'hidden') {
    return;
  }

  schedulePositionCorrection();
}

function handleDocumentScroll(event: Event): void {
  if (
    props.state.status === 'hidden' ||
    viewportDismissed
  ) {
    return;
  }

  const card = cardElement.value;

  if (!card) {
    return;
  }

  const eventPath =
    typeof event.composedPath === 'function'
      ? event.composedPath()
      : [];

  if (eventPath.includes(card)) {
    return;
  }

  viewportDismissed = true;
  emit('close');
}

function schedulePositionCorrection(): void {
  if (props.state.status === 'hidden') {
    return;
  }

  if (correctionFrame !== null) {
    cancelAnimationFrame(correctionFrame);
  }

  correctionFrame = requestAnimationFrame(async () => {
    correctionFrame = null;
    await nextTick();

    const card = cardElement.value;

    if (!card || props.state.status === 'hidden') {
      return;
    }

    const position = correctPopoverPosition(
      card.getBoundingClientRect(),
      {
        left: props.state.left,
        top: props.state.top,
      },
    );

    if (
      position.left !== props.state.left ||
      position.top !== props.state.top
    ) {
      emit('adjust-position', position);
    }
  });
}

watch(
  cardElement,
  (card) => {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (!card) {
      return;
    }

    resizeObserver = new ResizeObserver(
      schedulePositionCorrection,
    );
    resizeObserver.observe(card);
    schedulePositionCorrection();
  },
  { flush: 'post' },
);

watch(
  () => [
    props.state.status,
    props.state.sourceText,
    props.state.translatedText,
    props.state.errorMessage,
    props.state.errorCode,
    props.state.canRetry,
    props.state.speechErrorMessage,
    props.state.modelStatus,
    props.state.modelDownloadProgress,
    props.state.left,
    props.state.top,
    props.state.sourceLanguageSetting,
    props.state.targetLanguage,
  ],
  schedulePositionCorrection,
  { flush: 'post' },
);

watch(
  () => props.state.status,
  (status) => {
    if (status !== 'hidden') {
      viewportDismissed = false;
    }
  },
);

onMounted(() => {
  window.addEventListener('resize', handleWindowResize);
  window.visualViewport?.addEventListener(
    'resize',
    handleVisualViewportChange,
  );
  window.visualViewport?.addEventListener(
    'scroll',
    handleVisualViewportChange,
  );
  document.addEventListener(
    'scroll',
    handleDocumentScroll,
    true,
  );

  schedulePositionCorrection();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;

  window.removeEventListener('resize', handleWindowResize);
  window.visualViewport?.removeEventListener(
    'resize',
    handleVisualViewportChange,
  );
  window.visualViewport?.removeEventListener(
    'scroll',
    handleVisualViewportChange,
  );
  document.removeEventListener(
    'scroll',
    handleDocumentScroll,
    true,
  );

  if (correctionFrame !== null) {
    cancelAnimationFrame(correctionFrame);
    correctionFrame = null;
  }
});
</script>

<template>
  <Transition name="translation-card">
    <section
      v-if="state.status !== 'hidden'"
      ref="cardElement"
      class="translation-card"
      :style="{ left: `${state.left}px`, top: `${state.top}px` }"
      role="dialog"
      aria-label="即時翻譯"
      aria-live="polite"
      @scroll.stop
      @wheel.stop
      @touchmove.stop
      @pointerdown.stop
      @pointerup.stop
      @click.stop
    >
      <header class="translation-card__header">
        <span class="translation-card__title">即時翻譯</span>
        <button
          type="button"
          class="translation-card__close-button"
          aria-label="關閉翻譯卡片"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="translation-card__language-row">
        <label class="translation-card__language-select-wrapper">
          <span class="translation-card__language-label">來源語言</span>
          <select
            class="translation-card__language-select"
            :value="state.sourceLanguageSetting"
            aria-label="選擇來源語言"
            @change="handleSourceLanguageChange"
          >
            <option
              v-for="language in sourceLanguageOptions"
              :key="language.value"
              :value="language.value"
            >
              {{ language.label }}
            </option>
          </select>
        </label>

        <span class="translation-card__language-arrow" aria-hidden="true">
          →
        </span>

        <label class="translation-card__language-select-wrapper">
          <span class="translation-card__language-label">翻譯成</span>
          <select
            class="translation-card__language-select"
            :value="state.targetLanguage"
            aria-label="選擇翻譯語言"
            @change="handleTargetLanguageChange"
          >
            <option
              v-for="language in targetLanguageOptions"
              :key="language.value"
              :value="language.value"
            >
              {{ language.label }}
            </option>
          </select>
        </label>
      </div>

      <p
        v-if="detectedLanguageMessage"
        class="translation-card__detected-language"
      >
        {{ detectedLanguageMessage }}
      </p>

      <div class="translation-card__content">
        <section class="translation-card__section">
          <div class="translation-card__section-heading">
            <p class="translation-card__label">原文</p>
            <button
              type="button"
              class="translation-card__speech-button"
              :class="{
                'translation-card__speech-button--active':
                  isTargetSpeaking('source'),
              }"
              :disabled="state.speechPlaybackStatus === 'stopping'"
              aria-label="朗讀原文"
              @click="emit('speak-source')"
            >
              {{ isTargetSpeaking('source') ? '■ 停止原文' : '▶ 原文發音' }}
            </button>
          </div>
          <p class="translation-card__text">{{ state.sourceText }}</p>
        </section>

        <div class="translation-card__divider" />

        <section class="translation-card__section">
          <div class="translation-card__section-heading">
            <p class="translation-card__label">翻譯</p>
            <button
              type="button"
              class="translation-card__speech-button"
              :class="{
                'translation-card__speech-button--active':
                  isTargetSpeaking('translation'),
              }"
              :disabled="
                state.speechPlaybackStatus === 'stopping' ||
                state.status !== 'success'
              "
              aria-label="朗讀譯文"
              @click="emit('speak-translation')"
            >
              {{
                isTargetSpeaking('translation')
                  ? '■ 停止譯文'
                  : '▶ 譯文發音'
              }}
            </button>
          </div>

          <div
            v-if="state.status === 'loading'"
            class="translation-card__loading"
          >
            <span class="translation-card__spinner" aria-hidden="true" />
            <span>{{ modelLoadingMessage }}</span>
          </div>
          <p
            v-else-if="state.status === 'success'"
            class="translation-card__text translation-card__translated-text"
          >
            {{ state.translatedText }}
          </p>
          <div
            v-else-if="state.status === 'error'"
            class="translation-card__error"
            role="alert"
            :data-error-code="state.errorCode ?? undefined"
          >
            <div
              class="translation-card__error-icon"
              aria-hidden="true"
            >
              !
            </div>

            <div class="translation-card__error-content">
              <p class="translation-card__error-title">翻譯失敗</p>
              <p class="translation-card__error-message">
                {{ state.errorMessage }}
              </p>

              <button
                v-if="state.canRetry"
                class="translation-card__retry-button"
                type="button"
                @click.stop="handleRetry"
              >
                重新翻譯
              </button>

              <p
                v-else-if="state.errorCode === 'LANGUAGE_AMBIGUOUS'"
                class="translation-card__error-hint"
              >
                請使用上方的來源語言選單指定語言。
              </p>

              <p
                v-else-if="state.errorCode === 'LANGUAGE_PAIR_UNAVAILABLE'"
                class="translation-card__error-hint"
              >
                請更換來源語言或目標語言。
              </p>
            </div>
          </div>
        </section>

        <p
          v-if="state.speechPlaybackStatus === 'error'"
          class="translation-card__speech-error"
          role="alert"
        >
          {{ state.speechErrorMessage }}
        </p>
      </div>

      <footer class="translation-card__footer">
        <span v-if="state.status === 'loading'">正在使用 Chrome 內建翻譯</span>
        <span v-else-if="state.status === 'success'">Chrome 內建翻譯結果</span>
        <span v-else-if="state.status === 'error'">可調整語言設定後重新翻譯</span>
      </footer>
    </section>
  </Transition>
</template>
