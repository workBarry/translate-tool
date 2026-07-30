import {
  browser,
} from 'wxt/browser';

import type {
  SourceLanguageSetting,
} from './types';
import {
  logTranslationError,
} from './translation-error';

const SUPPORTED_SOURCE_LANGUAGES = new Set([
  'zh',
  'zh-Hant',
  'en',
  'ja',
  'ko',
]);

type LanguageDetectorSession = Awaited<
  ReturnType<typeof LanguageDetector.create>
>;

export interface SourceLanguageResolution {
  language: string | null;
  confidence: number | null;
  method:
    | 'manual'
    | 'script'
    | 'page-language'
    | 'language-detector'
    | 'chrome-i18n'
    | 'ambiguous';
}

export interface ResolveSourceLanguageInput {
  text: string;
  sourceLanguageSetting: SourceLanguageSetting;
  pageLanguage?: string;
  onDownloadProgress?: (percentage: number) => void;
}

let detectorPromise: Promise<LanguageDetectorSession> | null =
  null;

let detectorProgress = 0;

const progressListeners = new Set<
  (percentage: number) => void
>();

export function resolveImmediateSourceLanguage(
  input: ResolveSourceLanguageInput,
): SourceLanguageResolution | null {
  const text = input.text.trim();

  if (!text) {
    return null;
  }

  if (input.sourceLanguageSetting !== 'auto') {
    return {
      language: input.sourceLanguageSetting,
      confidence: 1,
      method: 'manual',
    };
  }

  if (/[가-힯ᄀ-ᇿ]/u.test(text)) {
    return {
      language: 'ko',
      confidence: 1,
      method: 'script',
    };
  }

  if (/[぀-ヿㇰ-ㇿ]/u.test(text)) {
    return {
      language: 'ja',
      confidence: 1,
      method: 'script',
    };
  }

  const pageLanguage = normalizeLanguageCode(
    input.pageLanguage ?? '',
  );

  if (/[㐀-鿿豈-﫿]/u.test(text)) {
    if (
      pageLanguage === 'ja' ||
      pageLanguage === 'zh' ||
      pageLanguage === 'zh-Hant'
    ) {
      return {
        language: pageLanguage,
        confidence: 0.9,
        method: 'page-language',
      };
    }
  }

  return null;
}

export async function resolveSourceLanguageWithDetector(
  input: ResolveSourceLanguageInput,
): Promise<SourceLanguageResolution> {
  const immediate = resolveImmediateSourceLanguage(input);

  if (immediate) {
    return immediate;
  }

  const text = input.text.trim();

  if (!text) {
    return ambiguousResolution();
  }

  const pageLanguage = normalizeLanguageCode(
    input.pageLanguage ?? '',
  );
  const compactText = text.replace(/\s+/gu, '');
  const textLength = Array.from(compactText).length;
  const containsHan = /[\u3400-\u9fff\uf900-\ufaff]/u.test(text);

  if ('LanguageDetector' in self) {
    try {
      const detector = await getLanguageDetectorSession(
        input.onDownloadProgress,
      );

      const candidates = mergeNormalizedCandidates(
        await detector.detect(text),
      );

      return resolveBuiltInDetectorResult({
        candidates,
        textLength,
        pageLanguage,
        containsHan,
      });
    } catch (error: unknown) {
      logTranslationError(
        'Built-In Language Detector 無法使用，改用 Chrome i18n 備援',
        error,
      );
    }
  }

  const fallbackResult = await detectWithChromeI18n(text);

  if (fallbackResult.language) {
    return fallbackResult;
  }

  return resolvePageLanguageFallback({
    pageLanguage,
    containsHan,
  });
}

function resolveBuiltInDetectorResult(input: {
  candidates: Array<{
    detectedLanguage: string;
    confidence: number;
  }>;
  textLength: number;
  pageLanguage: string;
  containsHan: boolean;
}): SourceLanguageResolution {
  const supportedCandidates = input.candidates.filter(
    (candidate) => SUPPORTED_SOURCE_LANGUAGES.has(
      candidate.detectedLanguage,
    ),
  );

  const first = supportedCandidates.at(0);
  const second = supportedCandidates.at(1);

  if (!first) {
    return resolvePageLanguageFallback({
      pageLanguage: input.pageLanguage,
      containsHan: input.containsHan,
    });
  }

  const minimumConfidence =
    input.textLength >= 20
      ? 0.5
      : input.textLength >= 8
        ? 0.4
        : 0.3;

  const minimumGap = input.textLength >= 8 ? 0.08 : 0.04;
  const confidenceGap = first.confidence - (second?.confidence ?? 0);

  console.log(
    '[Instant Translator] 語言偵測判定',
    {
      textLength: input.textLength,
      pageLanguage: input.pageLanguage || '(empty)',
      first,
      second,
      minimumConfidence,
      minimumGap,
      confidenceGap,
    },
  );

  if (
    first.confidence >= minimumConfidence &&
    confidenceGap >= minimumGap
  ) {
    return {
      language: first.detectedLanguage,
      confidence: first.confidence,
      method: 'language-detector',
    };
  }

  const pageFallback = resolvePageLanguageFallback({
    pageLanguage: input.pageLanguage,
    containsHan: input.containsHan,
  });

  return pageFallback.language
    ? pageFallback
    : {
        language: null,
        confidence: first.confidence,
        method: 'ambiguous',
      };
}

async function detectWithChromeI18n(
  text: string,
): Promise<SourceLanguageResolution> {
  try {
    const result = await browser.i18n.detectLanguage(text);

    const firstSupported = result.languages
      .map((candidate) => ({
        language: normalizeLanguageCode(candidate.language),
        confidence: candidate.percentage / 100,
      }))
      .filter(
        (candidate) =>
          candidate.language !== 'und' &&
          SUPPORTED_SOURCE_LANGUAGES.has(candidate.language),
      )
      .sort((first, second) => second.confidence - first.confidence)
      .at(0);

    if (!firstSupported) {
      return ambiguousResolution();
    }

    return {
      language: firstSupported.language,
      confidence: firstSupported.confidence,
      method: 'chrome-i18n',
    };
  } catch (error: unknown) {
    logTranslationError('Chrome i18n 語言偵測失敗', error);

    return ambiguousResolution();
  }
}

export async function destroyLanguageDetector(): Promise<void> {
  const currentPromise = detectorPromise;

  detectorPromise = null;
  detectorProgress = 0;
  progressListeners.clear();

  if (!currentPromise) {
    return;
  }

  const [result] = await Promise.allSettled([currentPromise]);

  if (result?.status === 'fulfilled') {
    result.value.destroy();
  }
}

function getLanguageDetectorSession(
  onDownloadProgress?: (percentage: number) => void,
): Promise<LanguageDetectorSession> {
  if (onDownloadProgress) {
    progressListeners.add(onDownloadProgress);
    onDownloadProgress(detectorProgress);
  }

  if (!detectorPromise) {
    detectorPromise = LanguageDetector.create({
      monitor(monitor) {
        monitor.addEventListener(
          'downloadprogress',
          (event) => {
            detectorProgress = Math.round(
              Math.max(0, Math.min(1, event.loaded)) * 100,
            );

            for (const listener of progressListeners) {
              listener(detectorProgress);
            }

            console.log(
              '[Instant Translator] Language Detector 模型下載中',
              { percentage: detectorProgress },
            );
          },
        );
      },
    }).catch((error: unknown) => {
      detectorPromise = null;
      detectorProgress = 0;
      throw error;
    });
  }

  return detectorPromise.finally(() => {
    if (onDownloadProgress) {
      progressListeners.delete(onDownloadProgress);
    }
  });
}

function mergeNormalizedCandidates(
  results: Awaited<
    ReturnType<LanguageDetectorSession['detect']>
  >,
): Array<{
  detectedLanguage: string;
  confidence: number;
}> {
  const candidateMap = new Map<string, number>();

  for (const result of results) {
    if (
      typeof result.detectedLanguage !== 'string' ||
      typeof result.confidence !== 'number'
    ) {
      continue;
    }

    const language = normalizeLanguageCode(
      result.detectedLanguage,
    );

    if (!language) {
      continue;
    }

    candidateMap.set(
      language,
      Math.max(
        candidateMap.get(language) ?? 0,
        result.confidence,
      ),
    );
  }

  return Array.from(
    candidateMap,
    ([detectedLanguage, confidence]) => ({
      detectedLanguage,
      confidence,
    }),
  ).sort(
    (first, second) => second.confidence - first.confidence,
  );
}

function ambiguousResolution(): SourceLanguageResolution {
  return {
    language: null,
    confidence: null,
    method: 'ambiguous',
  };
}

interface ResolvePageLanguageFallbackInput {
  pageLanguage: string;
  containsHan: boolean;
}

function resolvePageLanguageFallback(
  input: ResolvePageLanguageFallbackInput,
): SourceLanguageResolution {
  const {
    pageLanguage,
    containsHan,
  } = input;

  if (!SUPPORTED_SOURCE_LANGUAGES.has(pageLanguage)) {
    return ambiguousResolution();
  }

  if (
    containsHan &&
    pageLanguage !== 'ja' &&
    pageLanguage !== 'zh' &&
    pageLanguage !== 'zh-Hant'
  ) {
    return ambiguousResolution();
  }

  return {
    language: pageLanguage,
    confidence: null,
    method: 'page-language',
  };
}

export function normalizeLanguageCode(language: string): string {
  const normalized = language
    .trim()
    .replaceAll('_', '-')
    .toLowerCase();

  if (!normalized) {
    return '';
  }

  if (
    normalized === 'zh-hant' ||
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized.startsWith('zh-hant-')
  ) {
    return 'zh-Hant';
  }

  if (
    normalized === 'zh-hans' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh' ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh';
  }

  if (normalized.startsWith('ja')) {
    return 'ja';
  }

  if (normalized.startsWith('ko')) {
    return 'ko';
  }

  if (normalized.startsWith('en')) {
    return 'en';
  }

  return normalized.split('-')[0] ?? normalized;
}
