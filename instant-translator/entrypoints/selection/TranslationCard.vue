<script setup lang="ts">
import {
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
}>();

const cardElement =
  ref<HTMLElement | null>(null);

watch(
  () => props.state.status,
  async (status) => {
    await nextTick();

    const card =
      cardElement.value;

    console.log(
      '[Instant Translator] 卡片狀態',
      {
        status,
        card,
        rect:
          card?.getBoundingClientRect() ??
          null,
      },
    );
  },
);
</script>

<template>
  <Transition name="translation-card">
    <section
      ref="cardElement"
      v-if="state.status !== 'hidden'"
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
          <p class="translation-card__label">
            原文
          </p>

          <p class="translation-card__text">
            {{ state.sourceText }}
          </p>
        </section>

        <div class="translation-card__divider" />

        <section class="translation-card__section">
          <p class="translation-card__label">
            翻譯
          </p>

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
      </div>

      <footer class="translation-card__footer">
        <span v-if="state.status === 'loading'">
          正在使用模擬翻譯服務
        </span>

        <span v-else-if="state.status === 'success'">
          模擬翻譯結果
        </span>

        <span v-else-if="state.status === 'error'">
          請重新選取文字再試一次
        </span>
      </footer>
    </section>
  </Transition>
</template>