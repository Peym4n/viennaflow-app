// Defines the structure for a user's profile data
export interface UserProfile {
  id: string; // Corresponds to auth.users.id
  username: string | null;
  email: string; // Email from profiles table
  avatar_url?: string | null;
  updated_at?: string; // ISO string format from Supabase
}
