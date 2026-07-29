import type {
  SourceLanguageSetting,
  TranslationLanguage,
} from '../../src/shared/translator-settings.types';

export type {
  SourceLanguageSetting,
  TranslationLanguage,
} from '../../src/shared/translator-settings.types';

export type TranslationStatus = "hidden" | "loading" | "success" | "error";

export type TranslationModelStatus =
  | 'idle'
  | 'downloading'
  | 'preparing'
  | 'ready';

export type SpeechPlaybackStatus =
  | 'idle'
  | 'starting'
  | 'speaking'
  | 'stopping'
  | 'error';

export type SpeechTarget =
  | 'source'
  | 'translation';
export interface TranslationPopoverState {
  status: TranslationStatus;
  enabled: boolean;

  sourceText: string;
  translatedText: string;
  errorMessage: string;

  left: number;
  top: number;

  sourceLanguageSetting: SourceLanguageSetting;
  targetLanguage: TranslationLanguage;

  detectedSourceLanguage: string;
  detectedSourceConfidence: number | null;

  modelStatus: TranslationModelStatus;
  modelDownloadProgress: number;

  speechPlaybackStatus:
    SpeechPlaybackStatus;

  activeSpeechTarget:
    SpeechTarget | null;

  speechErrorMessage: string;
}

export interface PopoverPosition {
  left: number;
  top: number;
}

export interface TextSelection {
  text: string;
  pointerX: number;
  pointerY: number;
}
