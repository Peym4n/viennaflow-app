import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      environment.supabase.url,
      environment.supabase.anonKey
    );
  }

  setSession(params: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    expires_in: number;
    token_type: string;
  }): void {
    this.supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token
    });
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }
} 