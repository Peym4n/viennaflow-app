import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { GoogleMapsService } from './google-maps.service';

describe('Google Maps SDK loading', () => {
  afterEach(() => {
    document.getElementById('google-maps-script')?.remove();
    delete window.initMap;
    vi.useRealTimers();
  });

  it('shares one SDK request until both callers complete', async () => {
    const service = new GoogleMapsService();
    const first = firstValueFrom(service.loadGoogleMapsApi());
    const second = firstValueFrom(service.loadGoogleMapsApi());
    expect(document.querySelectorAll('#google-maps-script')).toHaveLength(1);
    expect(document.querySelector<HTMLScriptElement>('#google-maps-script')!.src).toContain('libraries=geometry');
    vi.stubGlobal('google', { maps: { geometry: {} } });
    window.initMap!();
    await Promise.all([first, second]);
    expect(service.isGoogleMapsLoaded()).toBe(true);
  });

  it('removes a failed script and allows a subsequent attempt', async () => {
    const service = new GoogleMapsService();
    const first = firstValueFrom(service.loadGoogleMapsApi());
    const failed = expect(first).rejects.toThrow('Could not load Maps');
    document.querySelector('#google-maps-script')!.dispatchEvent(new Event('error'));
    await failed;
    expect(document.querySelector('#google-maps-script')).toBeNull();
    const retry = firstValueFrom(service.loadGoogleMapsApi());
    vi.stubGlobal('google', { maps: { geometry: {} } });
    window.initMap!();
    await retry;
  });

  it('bounds loading when the SDK never calls back', async () => {
    vi.useFakeTimers();
    const service = new GoogleMapsService();
    const result = firstValueFrom(service.loadGoogleMapsApi());
    const failed = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30000);
    await failed;
    expect(window.initMap).toBeUndefined();
    expect(document.querySelector('#google-maps-script')).toBeNull();
  });
});
