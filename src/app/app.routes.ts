import { Routes } from '@angular/router';
import { MapViewComponent } from './features/map/components/map-view/map-view.component';

export const routes: Routes = [
  { path: '', component: MapViewComponent },
  { path: 'auth/login', loadComponent: () => import('./auth/login/login.component').then(module => module.LoginComponent) },
  { path: 'auth/signup', loadComponent: () => import('./auth/signup/signup.component').then(module => module.SignupComponent) },
  { path: 'auth/forgot-password', loadComponent: () => import('./auth/forgot-password/forgot-password.component').then(module => module.ForgotPasswordComponent) },
  { path: 'auth/reset-password', loadComponent: () => import('./auth/reset-password/reset-password.component').then(module => module.ResetPasswordComponent) },
  { path: 'profile', loadComponent: () => import('./features/profile/profile-management/profile-management.component').then(module => module.ProfileManagementComponent) },
  { path: 'about', loadComponent: () => import('./features/about/about.component').then(module => module.AboutComponent) },
  { path: '**', redirectTo: '' }
];
