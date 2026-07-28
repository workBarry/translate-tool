export type TranslationStatus =
  | 'hidden'
  | 'loading'
  | 'success'
  | 'error';

export type SpeechActionStatus =
  | 'idle'
  | 'starting'
  | 'stopping'
  | 'error';

export interface TranslationPopoverState {
  status: TranslationStatus;

  sourceText: string;
  translatedText: string;
  errorMessage: string;

  left: number;
  top: number;

  speechActionStatus:
    SpeechActionStatus;

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