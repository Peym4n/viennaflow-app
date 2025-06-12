import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subscription, Observable } from 'rxjs'; // Removed map if not used elsewhere, check needed
import { AuthService } from '../../../core/services/auth.service';
import { ProfileService } from '../../../core/services/profile.service';
import { UserProfile } from '../../../core/models/user-profile.model';

@Component({
  selector: 'app-profile-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile-management.component.html',
  styleUrls: ['./profile-management.component.scss']
})
export class ProfileManagementComponent implements OnInit, OnDestroy {
  profileForm!: FormGroup;
  currentUserProfile: UserProfile | null = null;
  isLoading: boolean = false;
  successMessage: string | null = null;
  errorMessage: string | null = null;

  private profileSubscription?: Subscription;

  constructor(
    private fb: FormBuilder,
    public authService: AuthService, // Made public for template access to loggedIn$
    private profileService: ProfileService
  ) {}

  ngOnInit(): void {
    this.profileForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]]
    });

    this.profileSubscription = this.profileService.userProfile$.subscribe(profile => {
      this.currentUserProfile = profile;
      if (profile && profile.username) {
        this.profileForm.patchValue({ username: profile.username });
      }
    });
  }

  get usernameControl() {
    return this.profileForm.get('username');
  }

  onSubmit(): void {
    if (this.profileForm.invalid) {
      this.errorMessage = 'Please provide a valid username (3-50 characters).';
      return;
    }

    this.isLoading = true;
    this.successMessage = null;
    this.errorMessage = null;
    const newUsername = this.usernameControl?.value;

    this.profileService.updateProfile({ username: newUsername }).subscribe({
      next: (updatedProfile) => {
        this.isLoading = false;
        if (updatedProfile) {
          this.successMessage = 'Username updated successfully!';
        } else {
          // Error should be caught by the error block, but as a fallback:
          this.errorMessage = 'Failed to update username. The profile might not exist or an error occurred.';
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.message || 'An unexpected error occurred while updating username.';
        console.error('Update profile error:', err);
      }
    });
  }

  ngOnDestroy(): void {
    this.profileSubscription?.unsubscribe();
  }
}
