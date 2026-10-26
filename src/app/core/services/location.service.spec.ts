import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { LocationService } from './location.service';

describe('location watch ownership', () => {
  let service: LocationService;
  afterEach(() => {
    service?.ngOnDestroy();
    Reflect.deleteProperty(navigator, 'permissions');
    vi.useRealTimers();
  });

  function geolocation() {
    const watchPosition = vi.fn((_success: PositionCallback, _failure?: PositionErrorCallback) => 7);
    const clearWatch = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } });
    return { watchPosition, clearWatch };
  }

  it('reports unsupported browsers without terminating the location stream', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    service = new LocationService();
    expect((await firstValueFrom(service.state$)).status).toBe('unsupported');
    expect(await firstValueFrom(service.locationAvailable$)).toBe(false);
  });

  it('uses one retry/watch owner, preserves stale coordinates, and cancels on teardown', async () => {
    vi.useFakeTimers();
    const geo = geolocation();
    service = new LocationService();
    const [success, failure] = geo.watchPosition.mock.calls[0] as unknown as [PositionCallback, PositionErrorCallback];
    success({ coords: { latitude: 48.2, longitude: 16.3, accuracy: 10 }, timestamp: 100 } as GeolocationPosition);
    failure({ code: 2 } as GeolocationPositionError);
    expect((await firstValueFrom(service.state$)).status).toBe('stale');
    vi.advanceTimersByTime(5000);
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    service.ngOnDestroy();
    vi.advanceTimersByTime(30000);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });

  it('does not repeatedly request denied permission and recovers on explicit retry', async () => {
    vi.useFakeTimers();
    const geo = geolocation();
    service = new LocationService();
    const failure = geo.watchPosition.mock.calls[0][1] as unknown as PositionErrorCallback;
    failure({ code: 1 } as GeolocationPositionError);
    vi.advanceTimersByTime(30000);
    expect((await firstValueFrom(service.state$)).status).toBe('denied');
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    service.retryLocationAccess();
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });

  it('recovers when permission is granted and removes its permission listener on teardown', async () => {
    const geo = geolocation();
    const permission = new EventTarget();
    Object.defineProperty(permission, 'state', { configurable: true, value: 'denied' });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => permission } });
    service = new LocationService();
    await Promise.resolve();
    Object.defineProperty(permission, 'state', { value: 'granted' });
    permission.dispatchEvent(new Event('change'));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    service.ngOnDestroy();
    permission.dispatchEvent(new Event('change'));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });
});
