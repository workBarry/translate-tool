import type {
  SourceLanguageSetting,
} from './types';

const MINIMUM_CONFIDENCE = 0.72;
const MINIMUM_CONFIDENCE_GAP = 0.12;

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

  if (!text || !('LanguageDetector' in self)) {
    return ambiguousResolution();
  }

  const detector = await getLanguageDetectorSession(
    input.onDownloadProgress,
  );

  const candidates = mergeNormalizedCandidates(
    await detector.detect(text),
  );

  console.log(
    '[Instant Translator] Language Detector 結果',
    {
      text: text.slice(0, 100),
      candidates: candidates.slice(0, 5),
    },
  );

  const first = candidates.at(0);
  const second = candidates.at(1);

  if (!first) {
    return ambiguousResolution();
  }

  const confidenceGap =
    first.confidence - (second?.confidence ?? 0);

  if (
    first.confidence < MINIMUM_CONFIDENCE ||
    confidenceGap < MINIMUM_CONFIDENCE_GAP
  ) {
    return {
      language: null,
      confidence: first.confidence,
      method: 'ambiguous',
    };
  }

  return {
    language: first.detectedLanguage,
    confidence: first.confidence,
    method: 'language-detector',
  };
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
    normalized === 'zh-mo'
  ) {
    return 'zh-Hant';
  }

  if (
    normalized === 'zh-hans' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh'
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
