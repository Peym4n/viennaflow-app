import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service'; // Adjust path if core services are elsewhere
import { AuthTokenResponsePassword, AuthError } from '@supabase/supabase-js';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, MatButtonModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  errorMessage: string | null = null;
  isLoading: boolean = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      this.errorMessage = 'Please fill in all fields correctly.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const { email, password } = this.loginForm.value;

    this.authService.signInWithPassword({ email, password }).subscribe({
      next: (response: AuthTokenResponsePassword) => {
        this.isLoading = false;
        if (response.error) {
          this.errorMessage = response.error.message;
        } else if (response.data.user) {
          // Navigate to home or dashboard on successful login
          this.router.navigate(['/']); // Adjust as needed
        } else {
          this.errorMessage = 'Login failed. Please try again.';
        }
      },
      error: (err: AuthError | Error) => {
        this.isLoading = false;
        this.errorMessage = err.message || 'An unexpected error occurred during login.';
        console.error('Login subscription error:', err);
      }
    });
  }
}
