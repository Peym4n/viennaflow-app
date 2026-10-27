import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Focus newly opened inputs after their view, including deferred content, renders. */
@Directive({ selector: 'input[appAutofocus]' })
export class AutofocusDirective {
  constructor() {
    const element = inject<ElementRef<HTMLInputElement>>(ElementRef);
    afterNextRender(() => element.nativeElement.focus({ preventScroll: true }));
  }
}
