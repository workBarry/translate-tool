import type {
  PopoverPosition,
  TranslationPopoverState,
} from './types';

export class PopoverController {
  constructor(
    private readonly state: TranslationPopoverState,
  ) {}

  showLoading(
    sourceText: string,
    position: PopoverPosition,
  ): void {
    this.state.sourceText = sourceText;
    this.state.translatedText = '';
    this.state.errorMessage = '';
    this.state.left = position.left;
    this.state.top = position.top;
    this.state.status = 'loading';
  }

  showSuccess(translatedText: string): void {
    this.state.translatedText = translatedText;
    this.state.errorMessage = '';
    this.state.status = 'success';
  }

  showError(message: string): void {
    this.state.translatedText = '';
    this.state.errorMessage = message;
    this.state.status = 'error';
  }

  hide(): void {
    this.state.status = 'hidden';
  }
}