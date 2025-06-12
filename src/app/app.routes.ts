import { Routes } from '@angular/router';
import { MapViewComponent } from './features/map/components/map-view/map-view.component';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { ProfileManagementComponent } from './features/profile/profile-management/profile-management.component';

export const routes: Routes = [
  { path: '', component: MapViewComponent },
  { path: 'auth/login', component: LoginComponent },
  { path: 'auth/signup', component: SignupComponent },
  { path: 'profile', component: ProfileManagementComponent }, // Add AuthGuard later
  // Consider adding a route guard later for authenticated areas
  { path: '**', redirectTo: '' } // Wildcard route should generally be last
];
