export type TranslationStatus =
  | 'hidden'
  | 'loading'
  | 'success'
  | 'error';

export interface TranslationPopoverState {
  status: TranslationStatus;
  sourceText: string;
  translatedText: string;
  errorMessage: string;
  left: number;
  top: number;
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

export interface TranslationResult {
  originalText: string;
  translatedText: string;
}