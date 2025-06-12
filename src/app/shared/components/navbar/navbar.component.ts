import { Component, inject, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { Router, RouterModule } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap, catchError } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service'; // Adjust path if needed
import { ProfileService } from '../../../core/services/profile.service'; // Added ProfileService
import { UserProfile } from '../../../core/models/user-profile.model'; // Added UserProfile
import { User } from '@supabase/supabase-js';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule
  ],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css',
  encapsulation: ViewEncapsulation.None // This will use the global configuration
})
export class NavbarComponent {
  authService = inject(AuthService);
  profileService = inject(ProfileService); // Injected ProfileService
  isLoggedIn$: Observable<boolean> = this.authService.loggedIn$;
  // currentUser$: Observable<User | null> = this.authService.currentUser$; // No longer directly needed for userDisplay$

  // Display username from profile, or email, or 'Profile'
  userDisplay$: Observable<string | null> = this.authService.currentUser$.pipe(
    switchMap(authUser => {
      if (!authUser) {
        return of(null); // No user logged in, display null
      }
      // User is logged in, fetch their profile
      return this.profileService.userProfile$.pipe(
        map(profile => {
          if (profile && profile.username) {
            return profile.username;
          }
          if (authUser.email) {
            return authUser.email;
          }
          return 'Profile'; // Fallback if no username or email
        }),
        catchError(() => {
          // If profile fetch fails, fallback to email or 'Profile'
          if (authUser.email) {
            return of(authUser.email);
          }
          return of('Profile');
        })
      );
    }),
    shareReplay(1) // Cache the last emitted value
  );
  private breakpointObserver = inject(BreakpointObserver);
  private router = inject(Router);
  
  isHandset$: Observable<boolean> = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );
    
  navItems = [
    { label: 'Home', route: '/', icon: 'home' },
    { label: 'About', route: '/about', icon: 'info' }
  ];
  
  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  logout(): void {
    this.authService.signOut().pipe(
      catchError(error => {
        console.error('Logout failed:', error);
        // Optionally, show a user-facing error message here
        return of(null); // Continue the stream or handle error appropriately
      })
    ).subscribe(() => {
      this.router.navigate(['/login']); // Or to home page, or wherever appropriate
    });
  }
}
