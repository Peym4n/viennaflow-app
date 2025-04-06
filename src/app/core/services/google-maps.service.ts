import { Injectable } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// Access the global 'google' variable in TypeScript
declare global {
  interface Window {
    initMap?: () => void;
    google: any;
  }
}

@Injectable({
  providedIn: 'root'
})
export class GoogleMapsService {
  private readonly API_KEY = environment.googleMaps.apiKey || '';
  private readonly API_URL = 'https://maps.googleapis.com/maps/api/js';
  private isLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor() {
    if (!this.API_KEY) {
      console.warn('Google Maps API key is not set. Map functionality may be limited.');
    }
  }

  /**
   * Loads the Google Maps API asynchronously
   * Returns an Observable that completes when the API is loaded
   */
  loadGoogleMapsApi(): Observable<void> {
    // If already loaded, return immediately
    if (this.isLoaded) {
      console.log('Google Maps API already loaded');
      return of(undefined);
    }

    // If loading is in progress, return the existing promise
    if (this.loadingPromise) {
      console.log('Google Maps API loading in progress');
      return from(this.loadingPromise);
    }
    
    console.log('Starting Google Maps API loading process...');

    // Create a new loading promise
    this.loadingPromise = new Promise<void>((resolve, reject) => {
      try {
        // Create a new script element
        const script = document.createElement('script');
        
        // Configure the callback function
        window.initMap = () => {
          console.log('Google Maps API loaded successfully through callback');
          this.isLoaded = true;
          resolve();
        };

        // Set the src with callback and API key
        const params = [
          `key=${this.API_KEY}`,
          'callback=initMap',
          'v=weekly',
        ].join('&');

        // Configure the script
        script.src = `${this.API_URL}?${params}`;
        script.async = true;
        script.defer = true;
        script.id = 'google-maps-script';
        
        // Add error handler
        script.onerror = () => {
          reject(new Error('Failed to load Google Maps API'));
        };
        
        // Append to document head
        document.head.appendChild(script);
      } catch (error) {
        reject(error);
      }
    });

    return from(this.loadingPromise).pipe(
      catchError(error => {
        console.error('Error loading Google Maps API:', error);
        throw error;
      })
    );
  }

  /**
   * Checks if Google Maps API is loaded
   */
  isGoogleMapsLoaded(): boolean {
    return this.isLoaded && !!window.google?.maps;
  }
}
