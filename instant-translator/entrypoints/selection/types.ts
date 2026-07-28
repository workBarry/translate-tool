export type TranslationStatus = "hidden" | "loading" | "success" | "error";

export type TranslationLanguage = "zh-Hant" | "en" | "ja" | "ko";

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

  sourceText: string;
  translatedText: string;
  errorMessage: string;

  left: number;
  top: number;

  targetLanguage: TranslationLanguage;

  detectedSourceLanguage: string;

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
