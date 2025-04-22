import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { GoogleMapsService } from '../../../../core/services/google-maps.service';
import { ApiService, LineStopsResponse, MetroLine } from '../../../../core/services/api.service';
import { environment } from '../../../../../environments/environment';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

// Define an extended environment interface for type safety
interface ExtendedGoogleMapsConfig {
  apiKey: string;
  mapId?: string;
}

@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule
  ],
  templateUrl: './map-view.component.html',
  styleUrl: './map-view.component.css'
})
export class MapViewComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;
  
  // Using 'any' type temporarily to resolve TypeScript errors
  private map: any = null;
  private userMarker: any = null;
  private watchId: number | null = null;
  private metroLinePolylines: google.maps.Polyline[] = [];
  private subscription = new Subscription();
  
  isLoading = true;
  hasLocationError = false;
  showMetroLines = true;
  
  private snackBar = inject(MatSnackBar);
  private mapsService = inject(GoogleMapsService);
  private apiService = inject(ApiService);
  
  constructor() {}
  
  ngOnInit(): void {
    // Initial setup - load the Google Maps API
    this.mapsService.loadGoogleMapsApi().subscribe({
      next: () => {
        console.log('Google Maps API loaded successfully');
      },
      error: (error) => {
        console.error('Failed to load Google Maps API:', error);
        this.hasLocationError = true;
        this.isLoading = false;
        this.snackBar.open('Failed to load maps. Please try again later.', 'Close', {
          duration: 5000
        });
      }
    });
  }
  
  ngAfterViewInit(): void {
    console.log('View initialized, map container element:', this.mapContainer?.nativeElement);
    
    // Initialize map after view is ready and API is loaded
    const checkAndInitMap = () => {
      console.log('Checking if Google Maps API is loaded...');
      if (this.mapsService.isGoogleMapsLoaded()) {
        console.log('Google Maps API is loaded, initializing map...');
        this.initMap();
      } else {
        console.log('Google Maps API not loaded yet, checking again in 100ms');
        // Check again in 100ms
        setTimeout(checkAndInitMap, 100);
      }
    };
    
    checkAndInitMap();
  }
  
  ngOnDestroy(): void {
    // Clean up resources
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    
    // Clear polylines
    this.clearMetroLines();
    
    // Unsubscribe from all subscriptions
    this.subscription.unsubscribe();
  }
  
  private initMap(): void {
    console.log('Initializing map...');
    console.log('Map container dimensions:', {
      width: this.mapContainer.nativeElement.offsetWidth,
      height: this.mapContainer.nativeElement.offsetHeight
    });

    // Default center (Vienna)
    const defaultCenter = { lat: 48.2082, lng: 16.3738 };
    
    try {
      // Initialize the map - using window.google to avoid TypeScript errors
      console.log('Creating Google Map instance...');
      // Create map configuration options
      const mapOptions: google.maps.MapOptions = {
        center: defaultCenter,
        zoom: 15,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        zoomControl: true,
      };
      
      // Get the Google Maps config with proper typing
      const googleMapsConfig = environment.googleMaps as ExtendedGoogleMapsConfig;
      
      // Add mapId if available in environment
      if (googleMapsConfig && typeof googleMapsConfig.mapId === 'string' && googleMapsConfig.mapId.trim() !== '') {
        (mapOptions as any).mapId = googleMapsConfig.mapId;
        console.log('Using Map ID from environment:', googleMapsConfig.mapId);
      }
      
      // Create the map instance
      this.map = new window.google.maps.Map(this.mapContainer.nativeElement, mapOptions);
      
      console.log('Map instance created:', this.map);

      // Add a listener to detect when the map is fully loaded
      window.google.maps.event.addListenerOnce(this.map, 'idle', () => {
        console.log('Map fully loaded and ready');
        
        // Load metro lines after map is loaded
        this.loadMetroLines();
      });
      
      // Get user location
      this.getUserLocation();
    } catch (error) {
      console.error('Error initializing map:', error);
      this.snackBar.open('Error initializing map. Please try again.', 'Close', {
        duration: 5000
      });
    }
  }
  
  private getUserLocation(): void {
    if (navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          const userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          
          this.updateUserLocation(userLocation);
          this.isLoading = false;
        },
        (error) => {
          console.error('Geolocation error:', error);
          this.isLoading = false;
          this.hasLocationError = true;
          this.showLocationError(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    } else {
      this.isLoading = false;
      this.hasLocationError = true;
      this.snackBar.open('Geolocation is not supported by this browser.', 'Close', {
        duration: 5000
      });
    }
  }
  
  private updateUserLocation(position: {lat: number, lng: number}): void {
    if (!this.map) return;
    
    // Update user marker
    if (!this.userMarker) {
      // Create a new marker if it doesn't exist
      this.userMarker = new window.google.maps.Marker({
        position,
        map: this.map,
        title: 'Your location',
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 2
        },
        optimized: true
      });
      
      // Center map on first location acquisition
      this.map.setCenter(position);
    } else {
      // Update existing marker position
      this.userMarker.setPosition(position);
    }
  }
  
  private showLocationError(error: GeolocationPositionError): void {
    let message = 'Unable to get your location.';
    
    switch (error.code) {
      case error.PERMISSION_DENIED:
        message = 'Location access was denied. Please enable location services.';
        break;
      case error.POSITION_UNAVAILABLE:
        message = 'Location information is unavailable.';
        break;
      case error.TIMEOUT:
        message = 'The request to get your location timed out.';
        break;
    }
    
    this.snackBar.open(message, 'Close', {
      duration: 5000
    });
  }
  
  recenterMap(): void {
    // Only recenter if we have the user marker
    if (this.userMarker && this.map) {
      this.map.setCenter(this.userMarker.getPosition());
      this.map.setZoom(15);
    }
  }
  
  /**
   * Toggles the visibility of metro lines on the map
   */
  toggleMetroLines(): void {
    this.showMetroLines = !this.showMetroLines;
    
    // Update visibility of all polylines
    this.metroLinePolylines.forEach(polyline => {
      polyline.setVisible(this.showMetroLines);
    });
  }
  
  /**
   * Loads metro line data and displays it on the map
   */
  private loadMetroLines(): void {
    // Clear existing lines
    this.clearMetroLines();
    
    // Fetch metro line data
    const sub = this.apiService.getMetroLineStops().pipe(
      catchError(error => {
        console.error('Error fetching metro lines:', error);
        this.snackBar.open('Failed to load metro lines', 'Close', { duration: 3000 });
        return of(null);
      })
    ).subscribe(response => {
      if (!response) return;
      
      // Draw the metro lines on the map
      this.drawMetroLines(response);
    });
    
    this.subscription.add(sub);
  }
  
  /**
   * Draws metro lines on the map using the response data
   */
  private drawMetroLines(response: LineStopsResponse): void {
    // Iterate through each metro line
    Object.entries(response.lines).forEach(([lineId, line]) => {
      // Check if the line has LineString data
      if (line.lineString && line.lineString.coordinates.length > 1) {
        // Extract coordinates from the LineString
        const path = line.lineString.coordinates.map(coords => {
          const [lng, lat] = coords;
          return { lat, lng };
        });
        
        // Create a polyline for the metro line
        const polyline = new google.maps.Polyline({
          path: path,
          geodesic: true,
          strokeColor: line.farbe || '#FF0000', // Use the defined color or default to red
          strokeOpacity: 1.0,
          strokeWeight: 4,
          map: this.map,
          visible: this.showMetroLines
        });
        
        // Store the polyline for later reference
        this.metroLinePolylines.push(polyline);
      } else {
        console.warn(`Line ${lineId} (${line.bezeichnung}) does not have LineString data`);
      }
    });
  }
  
  /**
   * Clears all metro lines from the map
   */
  private clearMetroLines(): void {
    // Remove all polylines from the map
    this.metroLinePolylines.forEach(polyline => polyline.setMap(null));
    this.metroLinePolylines = [];
  }
}
