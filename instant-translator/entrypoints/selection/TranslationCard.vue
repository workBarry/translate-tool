<script setup lang="ts">
import type { TranslationPopoverState } from './types';

defineProps<{
  state: TranslationPopoverState;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();
</script>

<template>
  <Transition name="translation-card">
    <section
      v-if="state.visible"
      class="translation-card"
      :style="{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }"
      role="dialog"
      aria-label="即時翻譯"
      @pointerdown.stop
    >
      <header class="translation-card__header">
        <span class="translation-card__title">
          測試翻譯
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

          <p class="translation-card__text translation-card__translated-text">
            {{ state.translatedText }}
          </p>
        </section>
      </div>

      <footer class="translation-card__footer">
        真正翻譯功能將在後續階段加入
      </footer>
    </section>
  </Transition>
</template>