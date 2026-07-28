<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue';

import {
  correctPopoverPosition,
} from './position-calculator';

import type {
  PopoverPosition,
  SpeechTarget,
  TranslationLanguage,
  TranslationPopoverState,
} from './types';

const props = defineProps<{
  state: TranslationPopoverState;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'speak-source'): void;
  (event: 'speak-translation'): void;
  (event: 'stop-speech'): void;
  (
    event: 'change-target-language',
    targetLanguage: TranslationLanguage,
  ): void;
  (
    event: 'adjust-position',
    position: PopoverPosition,
  ): void;
}>();

const languageOptions: ReadonlyArray<{
  value: TranslationLanguage;
  label: string;
}> = [
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const cardElement =
  ref<HTMLElement | null>(null);

let resizeObserver: ResizeObserver | null =
  null;

let correctionFrame: number | null =
  null;

const sourceLanguageLabel = computed(() => {
  switch (props.state.detectedSourceLanguage) {
    case 'zh-Hant':
      return '繁體中文';
    case 'zh':
      return '中文';
    case 'en':
      return 'English';
    case 'ja':
      return '日本語';
    case 'ko':
      return '한국어';
    default:
      return props.state.detectedSourceLanguage || '自動偵測';
  }
});

const isSpeechActive = computed(() => {
  return (
    props.state.speechPlaybackStatus === 'starting' ||
    props.state.speechPlaybackStatus === 'speaking'
  );
});

const isStoppingSpeech = computed(() => {
  return props.state.speechPlaybackStatus === 'stopping';
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

function isTargetSpeaking(
  target: SpeechTarget,
): boolean {
  return (
    isSpeechActive.value &&
    props.state.activeSpeechTarget === target
  );
}

function handleTargetLanguageChange(
  event: Event,
): void {
  const target = event.target;

  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  emit(
    'change-target-language',
    target.value as TranslationLanguage,
  );
}

function schedulePositionCorrection(): void {
  if (props.state.status === 'hidden') {
    return;
  }

  if (correctionFrame !== null) {
    cancelAnimationFrame(correctionFrame);
  }

  correctionFrame = requestAnimationFrame(
    async () => {
      correctionFrame = null;

      await nextTick();

      correctCurrentPosition();
    },
  );
}

function correctCurrentPosition(): void {
  const card = cardElement.value;

  if (!card || props.state.status === 'hidden') {
    return;
  }

  const correctedPosition = correctPopoverPosition(
    card.getBoundingClientRect(),
    {
      left: props.state.left,
      top: props.state.top,
    },
  );

  if (
    correctedPosition.left === props.state.left &&
    correctedPosition.top === props.state.top
  ) {
    return;
  }

  emit('adjust-position', correctedPosition);
}

watch(
  cardElement,
  (card) => {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (!card) {
      return;
    }

    resizeObserver = new ResizeObserver(() => {
      schedulePositionCorrection();
    });

    resizeObserver.observe(card);
    schedulePositionCorrection();
  },
  {
    flush: 'post',
  },
);

watch(
  () => [
    props.state.status,
    props.state.sourceText,
    props.state.translatedText,
    props.state.errorMessage,
    props.state.speechErrorMessage,
    props.state.modelStatus,
    props.state.modelDownloadProgress,
    props.state.left,
    props.state.top,
    props.state.targetLanguage,
  ],
  () => {
    schedulePositionCorrection();
  },
  {
    flush: 'post',
  },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;

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
      :style="{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }"
      role="dialog"
      aria-label="即時翻譯"
      aria-live="polite"
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
        <div class="translation-card__language-info">
          <span class="translation-card__language-label">原文語言</span>
          <span class="translation-card__language-value">
            {{ sourceLanguageLabel }}
          </span>
        </div>
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
              v-for="language in languageOptions"
              :key="language.value"
              :value="language.value"
            >
              {{ language.label }}
            </option>
          </select>
        </label>
      </div>

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
              :disabled="isStoppingSpeech"
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
              :disabled="isStoppingSpeech || state.status !== 'success'"
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
          >
            <strong>翻譯失敗</strong>
            <span>{{ state.errorMessage }}</span>
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
        <span v-if="state.speechPlaybackStatus === 'starting'">
          正在啟動發音……
        </span>
        <span v-else-if="state.speechPlaybackStatus === 'speaking'">
          正在發音，點擊同一按鈕即可停止
        </span>
        <span v-else-if="state.speechPlaybackStatus === 'stopping'">
          正在停止發音……
        </span>
        <span v-else-if="state.status === 'loading'">
          正在使用 Chrome 內建翻譯
        </span>
        <span v-else-if="state.status === 'success'">
          Chrome 內建翻譯結果
        </span>
        <span v-else-if="state.status === 'error'">
          請重新選取文字再試一次
        </span>
      </footer>
    </section>
  </Transition>
</template>
