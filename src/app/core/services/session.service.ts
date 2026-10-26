import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, throwError } from 'rxjs';
import { SigningSessionResponse } from '@shared-types/api-models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private signingKey: string | null = null;
  private expiresAt = 0;
  private initialization: Observable<string> | null = null;

  ensureSessionSigningKey(): Observable<string> {
    if (this.signingKey && Date.now() < this.expiresAt - 60000) return of(this.signingKey);
    if (!this.initialization) {
      this.initialization = this.http.get<SigningSessionResponse>('/api/session/init').pipe(
        map(response => {
          if (typeof response?.sessionSigningKey !== 'string' || !/^[a-f0-9]{128}$/.test(response.sessionSigningKey)) {
            throw new Error('Invalid walking-session response');
          }
          this.signingKey = response.sessionSigningKey;
          this.expiresAt = typeof response.expiresAt === 'number' && Number.isFinite(response.expiresAt) ? response.expiresAt : Date.now() + 23 * 3600000;
          this.initialization = null;
          return this.signingKey;
        }),
        catchError(() => {
          this.clearSession();
          return throwError(() => new Error('Walking session could not be initialized'));
        }),
        // Initialization belongs to the app session and is shared until completion.
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.initialization;
  }

  clearSession(): void { this.signingKey = null; this.expiresAt = 0; this.initialization = null; }
}
