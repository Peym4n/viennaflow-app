import { Routes } from '@angular/router';
import { MapViewComponent } from './features/map/components/map-view/map-view.component';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { ProfileManagementComponent } from './features/profile/profile-management/profile-management.component';
import { AboutComponent } from './features/about/about.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './auth/reset-password/reset-password.component';

export const routes: Routes = [
  { path: '', component: MapViewComponent },
  { path: 'auth/login', component: LoginComponent },
  { path: 'auth/signup', component: SignupComponent },
  { path: 'auth/forgot-password', component: ForgotPasswordComponent },
  { path: 'auth/reset-password', component: ResetPasswordComponent },
  { path: 'profile', component: ProfileManagementComponent }, // Add AuthGuard later
  { path: 'about', component: AboutComponent }, // Added about route
  // Consider adding a route guard later for authenticated areas
  { path: '**', redirectTo: '' } // Wildcard route should generally be last
];
