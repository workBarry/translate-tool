import type {
  PopoverPosition,
  TranslationPopoverState,
} from './types';

export class PopoverController {
  constructor(
    private readonly state:
      TranslationPopoverState,
  ) {}

  showLoading(
    sourceText: string,
    position: PopoverPosition,
  ): void {
    this.state.sourceText =
      sourceText;

    this.state.translatedText = '';
    this.state.errorMessage = '';

    this.state.left =
      position.left;

    this.state.top =
      position.top;

    this.resetSpeechState();

    this.state.status =
      'loading';
  }

  showSuccess(
    translatedText: string,
  ): void {
    this.state.translatedText =
      translatedText;

    this.state.errorMessage = '';
    this.state.status =
      'success';
  }

  showError(
    message: string,
  ): void {
    this.state.translatedText = '';

    this.state.errorMessage =
      message;

    this.state.status =
      'error';
  }

  beginSpeech(): void {
    this.state.speechActionStatus =
      'starting';

    this.state.speechErrorMessage =
      '';
  }

  beginStopSpeech(): void {
    this.state.speechActionStatus =
      'stopping';

    this.state.speechErrorMessage =
      '';
  }

  finishSpeechAction(): void {
    this.state.speechActionStatus =
      'idle';

    this.state.speechErrorMessage =
      '';
  }

  showSpeechError(
    message: string,
  ): void {
    this.state.speechActionStatus =
      'error';

    this.state.speechErrorMessage =
      message;
  }

  resetSpeechState(): void {
    this.state.speechActionStatus =
      'idle';

    this.state.speechErrorMessage =
      '';
  }

  hide(): void {
    this.resetSpeechState();

    this.state.status =
      'hidden';
  }
}