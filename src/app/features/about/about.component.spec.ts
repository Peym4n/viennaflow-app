import { DomSanitizer } from '@angular/platform-browser';
import { Injector } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutComponent } from './about.component';

describe('About embedding lifecycle', () => {
  let component: AboutComponent;
  beforeEach(() => {
    vi.useFakeTimers();
    const injector = Injector.create({ providers: [{ provide: DomSanitizer, useValue: {
      bypassSecurityTrustResourceUrl: (url: string) => url,
    } }] });
    component = new AboutComponent(injector.get(DomSanitizer));
    component.ngOnInit();
  });
  afterEach(() => { component.ngOnDestroy(); vi.useRealTimers(); });

  it('provides an unavailable state when loading times out and accepts a later load', () => {
    vi.advanceTimersByTime(12000);
    expect(component.status()).toBe('unavailable');
    component.loaded();
    expect(component.status()).toBe('ready');
  });

  it('cancels the loading deadline on navigation and on a reported failure', () => {
    component.ngOnDestroy();
    vi.advanceTimersByTime(12000);
    expect(component.status()).toBe('loading');
    component.failed();
    expect(component.status()).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});
