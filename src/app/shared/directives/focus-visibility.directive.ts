import { InputModalityDetector } from '@angular/cdk/a11y';
import { Directive, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/** Keep keyboard focus visible without sticky outlines after pointer interactions. */
@Directive({
  selector: '[appFocusVisibility]',
  host: {
    '[class.keyboard-focus]': 'keyboardFocus()',
    '(focusin)': 'onFocus()',
    '(focusout)': 'keyboardFocus.set(false)',
  },
})
export class FocusVisibilityDirective {
  private readonly modality = inject(InputModalityDetector);
  readonly keyboardFocus = signal(false);

  constructor() {
    this.modality.modalityDetected.pipe(takeUntilDestroyed()).subscribe(origin => {
      if (origin === 'mouse' || origin === 'touch') this.keyboardFocus.set(false);
    });
  }

  onFocus(): void {
    this.keyboardFocus.set(this.modality.mostRecentModality === 'keyboard');
  }
}
