import type {
  PopoverPosition,
  SpeechTarget,
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

 beginSpeech(
  target: SpeechTarget,
): void {
  this.state.activeSpeechTarget =
    target;

  this.state.speechPlaybackStatus =
    'starting';

  this.state.speechErrorMessage =
    '';
}

markSpeechStarted(): void {
  this.state.speechPlaybackStatus =
    'speaking';

  this.state.speechErrorMessage =
    '';
}

beginStopSpeech(): void {
  this.state.speechPlaybackStatus =
    'stopping';

  this.state.speechErrorMessage =
    '';
}

finishSpeech(): void {
  this.state.speechPlaybackStatus =
    'idle';

  this.state.activeSpeechTarget =
    null;

  this.state.speechErrorMessage =
    '';
}

showSpeechError(
  message: string,
): void {
  this.state.speechPlaybackStatus =
    'error';

  this.state.activeSpeechTarget =
    null;

  this.state.speechErrorMessage =
    message;
}

resetSpeechState(): void {
  this.state.speechPlaybackStatus =
    'idle';

  this.state.activeSpeechTarget =
    null;

  this.state.speechErrorMessage =
    '';
}
  hide(): void {
    this.resetSpeechState();

    this.state.status =
      'hidden';
  }
}