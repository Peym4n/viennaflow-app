import { createTestInjector } from '../../../../testing/injector';
import { EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { createHmac, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { SessionService } from './session.service';

describe('ApiService request mapping', () => {
  const http = { get: vi.fn(), post: vi.fn() };
  const session = { ensureSessionSigningKey: vi.fn(), clearSession: vi.fn() };
  let injector: EnvironmentInjector;
  let service: ApiService;

  beforeEach(() => {
    vi.resetAllMocks();
    session.ensureSessionSigningKey.mockReturnValue(of('a'.repeat(128)));
    injector = createTestInjector([{ provide: SessionService, useValue: session }]);
    service = runInInjectionContext(injector, () => new ApiService(http as unknown as HttpClient));
  });

  afterEach(() => injector.destroy());

  it('requests the catalog with optional line filters', async () => {
    http.get.mockReturnValue(of({ metainfo: { version: 'test', last_updated: '2026-10-26' }, lines: {} }));
    await firstValueFrom(service.getMetroLineStops(['301', '302']));
    expect(http.get).toHaveBeenCalledWith('/api/getLineStops?linien_id=301,302');
  });

  it('sends coordinates and radius as query parameters', async () => {
    http.get.mockReturnValue(of([]));
    await firstValueFrom(service.getNearbySteige(48.2, 16.3, 800));
    const [url, options] = http.get.mock.calls[0];
    expect(url).toBe('/api/getNearbySteige');
    expect(options.params.get('lat')).toBe('48.2');
    expect(options.params.get('lon')).toBe('16.3');
    expect(options.params.get('radius')).toBe('800');
  });

  it('normalizes DIVA identifiers for departure requests', async () => {
    http.post.mockReturnValue(of({ data: { monitors: [] }, timestamp: 123 }));
    await firstValueFrom(service.getRealTimeDepartures([60201394]));
    expect(http.post.mock.calls[0].slice(0, 2)).toEqual(['/api/routes/monitor', { divaIds: ['60201394'] }]);
  });

  it('distinguishes request failures from successful empty departures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    http.post.mockReturnValue(throwError(() => new Error('offline')));
    expect((await firstValueFrom(service.getRealTimeDepartures([60201394]))).errorOccurred).toBe(true);
  });

  it('signs exactly the backend HMAC message and renews one rejected session', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('TextEncoder', TextEncoder);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const payload = { origins: [{ lat: 48.2, lng: 16.3 }], destinations: [{ lat: 48.21, lng: 16.31 }] };
    const matrix = { status: 'OK', rows: [{ elements: [{ status: 'OK', duration: { value: 120 } }] }] };
    http.post.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 401 }))).mockReturnValueOnce(of(matrix));
    expect(await firstValueFrom(service.getSecureWalkingMatrix(payload))).toEqual(matrix);
    expect(session.clearSession).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(2);
    const headers = http.post.mock.calls[1][2].headers;
    expect(headers.get('X-Timestamp')).toBe('1700000000');
    expect(headers.get('X-Signature')).toBe(createHmac('sha256', 'a'.repeat(128)).update('1700000000.' + JSON.stringify(payload)).digest('hex'));
  });

  it('does not repeat session renewal indefinitely', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('TextEncoder', TextEncoder);
    http.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    const payload = { origins: [{ lat: 48.2, lng: 16.3 }], destinations: [{ lat: 48.21, lng: 16.31 }] };
    await expect(firstValueFrom(service.getSecureWalkingMatrix(payload))).rejects.toMatchObject({ status: 401 });
    expect(session.clearSession).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(2);
  });
});
