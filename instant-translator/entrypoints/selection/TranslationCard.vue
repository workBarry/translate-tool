<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  watch,
} from 'vue';

import type {
  TranslationPopoverState,
} from './types';

const props = defineProps<{
  state: TranslationPopoverState;
}>();

const emit = defineEmits<{
  (event: 'close'): void;

  (
    event: 'speak-source',
  ): void;

  (
    event: 'speak-translation',
  ): void;

  (
    event: 'stop-speech',
  ): void;
}>();

const cardElement =
  ref<HTMLElement | null>(null);

const isSpeechBusy =
  computed(() => {
    return (
      props.state
        .speechActionStatus ===
        'starting' ||
      props.state
        .speechActionStatus ===
        'stopping'
    );
  });

watch(
  () => props.state.status,
  async (status) => {
    await nextTick();

    console.log(
      '[Instant Translator] 卡片狀態',
      {
        status,
        card:
          cardElement.value,

        rect:
          cardElement.value
            ?.getBoundingClientRect() ??
          null,
      },
    );
  },
);
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
        <span class="translation-card__title">
          即時翻譯
        </span>

        <button
          type="button"
          class="translation-card__close-button"
          aria-label="關閉翻譯卡片"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="translation-card__content">
        <section class="translation-card__section">
          <div class="translation-card__section-heading">
            <p class="translation-card__label">
              原文
            </p>

            <button
              type="button"
              class="translation-card__speech-button"
              :disabled="isSpeechBusy"
              aria-label="朗讀原文"
              @click="emit('speak-source')"
            >
              ▶ 原文發音
            </button>
          </div>

          <p class="translation-card__text">
            {{ state.sourceText }}
          </p>
        </section>

        <div class="translation-card__divider" />

        <section class="translation-card__section">
          <div class="translation-card__section-heading">
            <p class="translation-card__label">
              翻譯
            </p>

            <button
              type="button"
              class="translation-card__speech-button"
              :disabled="
                isSpeechBusy ||
                state.status !== 'success'
              "
              aria-label="朗讀譯文"
              @click="
                emit('speak-translation')
              "
            >
              ▶ 譯文發音
            </button>
          </div>

          <div
            v-if="state.status === 'loading'"
            class="translation-card__loading"
          >
            <span
              class="translation-card__spinner"
              aria-hidden="true"
            />

            <span>正在翻譯……</span>
          </div>

          <p
            v-else-if="state.status === 'success'"
            class="
              translation-card__text
              translation-card__translated-text
            "
          >
            {{ state.translatedText }}
          </p>

          <div
            v-else-if="state.status === 'error'"
            class="translation-card__error"
            role="alert"
          >
            <strong>翻譯失敗</strong>

            <span>
              {{ state.errorMessage }}
            </span>
          </div>
        </section>

        <div class="translation-card__speech-actions">
          <button
            type="button"
            class="
              translation-card__speech-button
              translation-card__stop-button
            "
            :disabled="
              state.speechActionStatus ===
              'stopping'
            "
            @click="emit('stop-speech')"
          >
            ■ 停止發音
          </button>
        </div>

        <p
          v-if="
            state.speechActionStatus ===
            'error'
          "
          class="translation-card__speech-error"
          role="alert"
        >
          {{ state.speechErrorMessage }}
        </p>
      </div>

      <footer class="translation-card__footer">
        <span
          v-if="
            state.speechActionStatus ===
            'starting'
          "
        >
          正在啟動發音……
        </span>

        <span
          v-else-if="
            state.speechActionStatus ===
            'stopping'
          "
        >
          正在停止發音……
        </span>

        <span
          v-else-if="
            state.status === 'loading'
          "
        >
          正在使用模擬翻譯服務
        </span>

        <span
          v-else-if="
            state.status === 'success'
          "
        >
          模擬翻譯結果
        </span>

        <span
          v-else-if="
            state.status === 'error'
          "
        >
          請重新選取文字再試一次
        </span>
      </footer>
    </section>
  </Transition>
</template>