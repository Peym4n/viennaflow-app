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
          'libraries=geometry' // Load the geometry library
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

  /**
   * Gets walking durations from an origin to multiple destinations using Distance Matrix API.
   * @param origin The starting point.
   * @param destinations An array of destination points.
   * @returns An Observable emitting the DistanceMatrixResponse or null on error/API not ready.
   */
  public getWalkingDurationsToStations(
    origin: google.maps.LatLngLiteral,
    destinations: google.maps.LatLngLiteral[]
  ): Observable<google.maps.DistanceMatrixResponse | null> {
    if (!this.isGoogleMapsLoaded() || !window.google?.maps?.DistanceMatrixService) {
      console.error('Google Maps API or DistanceMatrixService not loaded.');
      return of(null);
    }

    const matrixService = new window.google.maps.DistanceMatrixService();
    const request: google.maps.DistanceMatrixRequest = {
      origins: [origin],
      destinations: destinations,
      travelMode: window.google.maps.TravelMode.WALKING,
      unitSystem: window.google.maps.UnitSystem.METRIC,
    };

    return new Observable(observer => {
      matrixService.getDistanceMatrix(request, (
        response: google.maps.DistanceMatrixResponse | null, 
        status: google.maps.DistanceMatrixStatus
      ) => {
        if (status === window.google.maps.DistanceMatrixStatus.OK && response) {
          observer.next(response);
        } else {
          console.error('Distance Matrix request failed due to ' + status, response);
          observer.next(null); // Emit null for handled errors to not break forkJoin
        }
        observer.complete();
      });
    });
  }
}
