import { Injectable, Injector } from '@angular/core'; // Added Injector
import {
  AuthChangeEvent,
  AuthSession,
  AuthTokenResponsePassword,
  createClient,
  Session,
  SupabaseClient,
  User,
  SignUpWithPasswordCredentials,
  SignInWithPasswordCredentials,
  AuthError,
  AuthResponse,
} from '@supabase/supabase-js';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { map, distinctUntilChanged, catchError, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment'; // Adjust path if needed

import { ProfileService } from './profile.service'; // Added import
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private supabase: SupabaseClient;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private currentSession = new BehaviorSubject<AuthSession | null>(null);
  private profileServiceInstance: ProfileService | null = null; // For lazy loading

  public currentUser$: Observable<User | null> =
    this.currentUserSubject.asObservable();

  public loggedIn$: Observable<boolean> = this.currentUser$.pipe(
    map((user) => !!user),
    distinctUntilChanged()
  );

  constructor(private injector: Injector, private supabaseService: SupabaseService) { // Injected Injector instead of ProfileService
    if (!environment.supabase.url || !environment.supabase.anonKey) {
      throw new Error('Supabase URL and Anon Key must be provided in environment.ts');
    }
    this.supabase = createClient(
      environment.supabase.url,
      environment.supabase.anonKey,
      {
        auth: {
          persistSession: true,
          detectSessionInUrl: true,
          autoRefreshToken: false, // Temporarily disable for debugging lock issue
          debug: false,
        }
      }
    );

    // Listen to auth state changes
    // The onAuthStateChange listener will be called with the initial session state (event type 'INITIAL_SESSION')
    // and will handle loading the user and profile if a session exists.
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      if (!this.profileServiceInstance) {
        this.profileServiceInstance = this.injector.get(ProfileService);
      }
      this.currentSession.next(session); // Update currentSession BehaviorSubject

      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
        console.log(`AuthService: Event '${event}', session found. Loading profile for user ${session.user.id}`);
        this.profileServiceInstance.loadProfile(session.user.id).subscribe({
          next: () => console.log(`AuthService: Profile loaded for ${session.user.id} after ${event}`),
          error: (err: AuthError | Error | any) => console.error(`AuthService: Error loading profile for ${session.user.id} after ${event}:`, err)
        });
      } else if (event === 'SIGNED_OUT') {
        console.log('AuthService: Event SIGNED_OUT. Clearing profile.');
        this.profileServiceInstance.clearProfile();
      } else if (event === 'INITIAL_SESSION' && !session) {
        console.log('AuthService: Event INITIAL_SESSION, no session found.');
      }

      this.currentUserSubject.next(session?.user ?? null);
      console.log(`Supabase auth event: ${event}`, session);
      // Handle specific events if necessary
      // if (event === 'SIGNED_IN') { ... }
      // if (event === 'SIGNED_OUT') { ... }
    });
  }


  signUp(credentials: SignUpWithPasswordCredentials): Observable<AuthTokenResponsePassword> {
    return from(this.supabase.auth.signUp(credentials)).pipe(
      map((response: AuthResponse) => { // Use AuthResponse here
        if (response.error) {
          console.error('Sign up error in map:', response.error.message);
          // This matches the error part of AuthTokenResponsePassword
          return { data: { user: null, session: null }, error: response.error };
        }
        if (response.data.user && response.data.session) {
          // This matches the success part of AuthTokenResponsePassword
          return { data: { user: response.data.user, session: response.data.session, weakPassword: (response.data as any).weakPassword }, error: null };
        }
        // Fallback for unexpected cases where user/session is null without an error
        console.error('Sign up issue: No error, but user or session is null.');
        return { data: { user: null, session: null }, error: new AuthError('User or session is null without an explicit error.') };
      }),
      tap(response => { // tap can now be used for side-effects after mapping
        if (!response.error && response.data.user) {
             // User signed up, email confirmation might be pending
             // onAuthStateChange will handle confirmed user.
        }
      }),
      catchError(error => { // This catchError is for network/unexpected errors before map
        console.error('Sign up failed (network/unexpected):', error);
        return of({ data: { user: null, session: null }, error: error instanceof AuthError ? error : new AuthError(error.message || 'Unknown sign-up error') });
      })
    );
  }

  signInWithPassword(credentials: SignInWithPasswordCredentials): Observable<AuthTokenResponsePassword> {
    return from(this.supabase.auth.signInWithPassword(credentials)).pipe(
      map((response: AuthResponse) => { // Use AuthResponse here
        if (response.error) {
          console.error('Sign in error in map:', response.error.message);
          return { data: { user: null, session: null }, error: response.error };
        }
        if (response.data.user && response.data.session) {
          // Update BehaviorSubject on successful sign-in
          this.currentUserSubject.next(response.data.user);
          return { data: { user: response.data.user, session: response.data.session, weakPassword: (response.data as any).weakPassword }, error: null };
        }
        console.error('Sign in issue: No error, but user or session is null.');
        return { data: { user: null, session: null }, error: new AuthError('User or session is null without an explicit error during sign in.') };
      }),
      // tap is optional here if all side effects are in map or handled by onAuthStateChange
      catchError(error => {
        console.error('Sign in failed (network/unexpected):', error);
        return of({ data: { user: null, session: null }, error: error instanceof AuthError ? error : new AuthError(error.message || 'Unknown sign-in error') });
      })
    );
  }

  signOut(): Observable<{ error: Error | null }> {
    return from(this.supabase.auth.signOut()).pipe(
      tap(() => {
        this.currentUserSubject.next(null);
      }),
      catchError(error => {
        console.error('Sign out failed:', error);
        return of({ error });
      })
    );
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  // Expose the Supabase client if other services need direct access (e.g., for database operations)
  // Be mindful of exposing the whole client, often better to wrap specific db calls in services.
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  resetPassword(email: string): Observable<void> {
    return from(this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`
    })).pipe(
      map(response => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      })
    );
  }

  updatePassword(newPassword: string): Observable<void> {
    return from(this.supabase.auth.updateUser({
      password: newPassword
    })).pipe(
      map(response => {
        if (response.error) {
          throw new Error(response.error.message);
        }
      })
    );
  }

  setSession(accessToken: string): void {
    this.supabaseService.setSession({
      access_token: accessToken,
      refresh_token: '',
      expires_at: 0,
      expires_in: 0,
      token_type: 'bearer'
    });
  }
}
