import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service'; // Adjust path if core services are elsewhere
import { AuthTokenResponsePassword, AuthError } from '@supabase/supabase-js';
import { CommonModule } from '@angular/common';

// Custom validator for password matching
export function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');

  if (password && confirmPassword && password.value !== confirmPassword.value) {
    return { passwordsMismatch: true };
  }
  return null;
}

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss']
})
export class SignupComponent implements OnInit {
  signupForm!: FormGroup;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  isLoading: boolean = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.signupForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: passwordMatchValidator });
  }

  get email() {
    return this.signupForm.get('email');
  }

  get password() {
    return this.signupForm.get('password');
  }

  get confirmPassword() {
    return this.signupForm.get('confirmPassword');
  }

  async onSubmit(): Promise<void> {
    if (this.signupForm.invalid) {
      this.errorMessage = 'Please fill in all fields correctly and ensure passwords match.';
      if (this.signupForm.errors?.['passwordsMismatch'] && (this.password?.dirty || this.confirmPassword?.dirty)) {
        this.errorMessage = 'Passwords do not match.';
      }
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    this.successMessage = null;

    const { email, password } = this.signupForm.value;

    this.authService.signUp({ email, password }).subscribe({
      next: (response: AuthTokenResponsePassword) => {
        this.isLoading = false;
        if (response.error) {
          this.errorMessage = response.error.message;
        } else if (response.data.user?.identities?.length === 0) {
            // This case might indicate a user exists but is unconfirmed (e.g. social auth previously)
            // Supabase signUp might return a user object even if it already exists, check identities.
            // Or if email confirmation is required, the user object is returned but session is null.
            this.errorMessage = 'A user with this email already exists. Please try logging in or use a different email.';
        } else if (response.data.user) {
          this.successMessage = 'Sign up successful! Please check your email to confirm your account.';
          // Optionally, redirect or clear form
          // this.router.navigate(['/auth/login']); // Or to a 'please confirm email' page
          this.signupForm.reset();
        } else {
            // This case handles when user is null and no error, which can happen if user exists
            this.errorMessage = 'Sign up failed. A user with this email may already exist or another issue occurred.';
        }
      },
      error: (err: AuthError | Error) => {
        this.isLoading = false;
        this.errorMessage = err.message || 'An unexpected error occurred during sign up.';
        console.error('Sign up subscription error:', err);
      }
    });
  }
}
