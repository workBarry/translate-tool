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

    this.state.modelStatus =
      'idle';

    this.state.modelDownloadProgress =
      0;

    this.resetSpeechState();

    this.state.status =
      'loading';
  }

  showModelDownloading(
    percentage: number,
  ): void {
    this.state.modelStatus =
      'downloading';

    this.state.modelDownloadProgress =
      Math.min(
        99,
        Math.max(0, percentage),
      );
  }

  showModelPreparing(): void {
    this.state.modelStatus =
      'preparing';

    this.state.modelDownloadProgress =
      100;
  }

  showModelReady(): void {
    this.state.modelStatus =
      'ready';

    this.state.modelDownloadProgress =
      100;
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
