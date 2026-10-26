import { HttpClient } from '@angular/common/http';
import { firstValueFrom, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { createTestInjector } from '../../../../testing/injector';
import { SessionService } from './session.service';
import { SigningSessionResponse } from '@shared-types/api-models';

describe('client signing session', () => {
  it('shares initialization and renews its key when the server expiry is reached', async () => {
    const pending = new Subject<SigningSessionResponse>();
    const http = { get: vi.fn().mockReturnValueOnce(pending).mockReturnValue(of({
      sessionSigningKey: 'b'.repeat(128), expiresAt: Date.now() + 86400000,
    })) };
    const injector = createTestInjector([{ provide: HttpClient, useValue: http }, SessionService]);
    try {
      const service = injector.get(SessionService);
      const first = firstValueFrom(service.ensureSessionSigningKey());
      const second = firstValueFrom(service.ensureSessionSigningKey());
      expect(http.get).toHaveBeenCalledTimes(1);
      pending.next({ sessionSigningKey: 'a'.repeat(128), expiresAt: Date.now() + 120000 });
      pending.complete();
      expect(await first).toBe(await second);
      expect(await firstValueFrom(service.ensureSessionSigningKey())).toBe('a'.repeat(128));
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121000);
      expect(await firstValueFrom(service.ensureSessionSigningKey())).toBe('b'.repeat(128));
      expect(http.get).toHaveBeenCalledTimes(2);
    } finally { injector.destroy(); }
  });
});
