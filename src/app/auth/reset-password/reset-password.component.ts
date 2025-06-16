import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule
  ],
  providers: [SupabaseService]
})
export class ResetPasswordComponent implements OnInit {
  resetForm: FormGroup;
  isLoading = false;
  isValidResetLink = true;
  errorMessage = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private supabase: SupabaseService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validator: this.passwordMatchValidator });
  }

  ngOnInit() {
    // Check for error in URL hash
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      
      if (error === 'access_denied' && errorDescription?.includes('expired')) {
        this.errorMessage = 'The password reset link has expired. Please request a new password reset link.';
        this.isValidResetLink = false;
        return;
      }

      // Check for access token
      const accessToken = params.get('access_token');
      const type = params.get('type');
      const refreshToken = params.get('refresh_token');
      const expiresAt = params.get('expires_at');
      const expiresIn = params.get('expires_in');
      const tokenType = params.get('token_type');

      if (!accessToken || type !== 'recovery') {
        this.errorMessage = 'Invalid or missing reset token. Please request a new password reset link.';
        this.isValidResetLink = false;
        return;
      }

      // Set the session with all token parameters
      this.supabase.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
        expires_at: expiresAt ? parseInt(expiresAt) : 0,
        expires_in: expiresIn ? parseInt(expiresIn) : 0,
        token_type: tokenType || 'bearer'
      });
    } else {
      this.errorMessage = 'Invalid reset link. Please request a new password reset link.';
      this.isValidResetLink = false;
    }
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('password')?.value === g.get('confirmPassword')?.value
      ? null
      : { mismatch: true };
  }

  onSubmit() {
    if (this.resetForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const { password } = this.resetForm.value;

    this.authService.updatePassword(password).subscribe({
      next: () => {
        this.successMessage = 'Password has been reset successfully. You will be redirected to login.';
        this.isLoading = false;
        setTimeout(() => {
          this.router.navigate(['/auth/login']);
        }, 3000);
      },
      error: (error) => {
        this.errorMessage = error.message || 'Failed to reset password. Please try again.';
        this.isLoading = false;
      }
    });
  }
} 