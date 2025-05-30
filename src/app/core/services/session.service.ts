import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, of, tap, map, catchError, throwError, shareReplay } from 'rxjs';

interface SessionInitResponse {
  sessionSigningKey: string;
}

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  private http = inject(HttpClient);
  private sessionSigningKeyInternal: string | null = null;
  private sessionInitialization$: Observable<string | null> | null = null;

  constructor() {}

  /**
   * Ensures a session is initialized and returns the session signing key.
   * If a key is already available, it returns it. Otherwise, it fetches a new one.
   * Uses shareReplay to prevent multiple concurrent calls to /api/session/init.
   */
  public ensureSessionSigningKey(): Observable<string | null> {
    if (this.sessionSigningKeyInternal) {
      return of(this.sessionSigningKeyInternal);
    }

    if (!this.sessionInitialization$) {
      this.sessionInitialization$ = this.http.get<SessionInitResponse>('/api/session/init').pipe(
        tap(response => {
          if (response && response.sessionSigningKey) {
            this.sessionSigningKeyInternal = response.sessionSigningKey;
            console.log('Session initialized and signing key received.');
          } else {
            console.error('Failed to receive session signing key from server.');
            this.sessionSigningKeyInternal = null; 
          }
        }),
        map(response => response?.sessionSigningKey || null),
        catchError(error => {
          console.error('Error initializing session:', error);
          this.sessionSigningKeyInternal = null;
          this.sessionInitialization$ = null; // Allow retry on next call
          return throwError(() => new Error('Session initialization failed.'));
        }),
        shareReplay(1) // Cache the result and share among subscribers, replay for new ones
      );
    }
    return this.sessionInitialization$;
  }

  /**
   * Gets the currently stored session signing key.
   * This does not initiate a new session if one isn't already established.
   * Prefer ensureSessionSigningKey() for most use cases.
   */
  public getCurrentSessionSigningKey(): string | null {
    return this.sessionSigningKeyInternal;
  }

  /**
   * Clears the stored session signing key.
   * This might be useful on logout or when a session is known to be invalid.
   */
  public clearSession(): void {
    this.sessionSigningKeyInternal = null;
    this.sessionInitialization$ = null; // Allow re-initialization
    console.log('Session signing key cleared.');
  }
}
