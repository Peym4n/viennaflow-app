import { Injectable } from '@angular/core';
import { SupabaseClient, User, PostgrestSingleResponse } from '@supabase/supabase-js';
import { BehaviorSubject, Observable, of, from } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { UserProfile } from '../models/user-profile.model';

@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  private supabase: SupabaseClient;
  private userProfileSubject = new BehaviorSubject<UserProfile | null>(null);

  public userProfile$: Observable<UserProfile | null> =
    this.userProfileSubject.asObservable();

  constructor(private authService: AuthService) {
    this.supabase = this.authService.getSupabaseClient();

    // React to user changes from AuthService
    this.authService.currentUser$.pipe(
      switchMap((user: User | null) => {
        if (user) {
          // When the auth user changes, automatically load their profile.
          // This is now primarily handled by AuthService's onAuthStateChange INITIAL_SESSION/SIGNED_IN events.
          // However, keeping this subscription can be a fallback or for direct user changes if needed.
          // Consider if this specific subscription is still necessary if AuthService handles initial load robustly.
          return this.loadProfile(user.id);
        }
        return of(null); // No user, so no profile
      })
    ).subscribe(profile => {
      // This ensures the local userProfile$ is updated if loaded through this mechanism.
      // If AuthService is the sole trigger for loadProfile, this might be redundant if loadProfile itself updates userProfileSubject.
      if (profile !== undefined) { // Check to prevent nulling if loadProfile already updated it
        this.userProfileSubject.next(profile);
      }
    });
  }

  public loadProfile(userId: string): Observable<UserProfile | null> { // Renamed and made public
    return from(this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single())
    .pipe(
      map((response: PostgrestSingleResponse<UserProfile>) => {
 
        if (response.error && response.status !== 406) { // 406: Not found, which is fine if profile not created yet
          console.error('Error fetching profile:', response.error);
          return null;
        }
        return response.data;
      }),
      catchError(error => {
        console.error('Exception fetching profile:', error);
        return of(null);
      })
    );
  }

  /**
   * Updates the user's profile.
   * The `profiles` table has an `updated_at` column that defaults to `NOW()`,
   * so it will be updated automatically by the database.
   */
  updateProfile(profileData: { username?: string; avatar_url?: string }): Observable<UserProfile | null> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      return of(null); // Or throw an error, or return an error observable
    }

    // Ensure we only pass valid fields to update
    const updateData: Partial<UserProfile> = {};
    if (profileData.username !== undefined) {
      updateData.username = profileData.username;
    }
    if (profileData.avatar_url !== undefined) {
      updateData.avatar_url = profileData.avatar_url;
    }

    // If nothing to update, return current profile or null
    if (Object.keys(updateData).length === 0) {
        return this.userProfile$; // Or fetch again if preferred
    }

    return from(this.supabase
      .from('profiles')
      .update(updateData)
      .eq('id', currentUser.id)
      .select()
      .single())
    .pipe(
      map((response: PostgrestSingleResponse<UserProfile>) => {
        if (response.error) {
          console.error('Error updating profile:', response.error);
          // Potentially return the old profile or throw
          return this.userProfileSubject.value; 
        }
        this.userProfileSubject.next(response.data); // Update local state
        return response.data;
      }),
      catchError(error => {
        console.error('Exception updating profile:', error);
        // Potentially return the old profile or throw
        return of(this.userProfileSubject.value);
      })
    );
  }

  public clearProfile(): void {
    this.userProfileSubject.next(null);
    console.log('ProfileService: Profile cleared.');
  }

  /**
   * Helper to get the current profile value directly if needed,
   * though subscribing to userProfile$ is preferred.
   */
  getCurrentProfileSnapshot(): UserProfile | null {
    return this.userProfileSubject.value;
  }
}
