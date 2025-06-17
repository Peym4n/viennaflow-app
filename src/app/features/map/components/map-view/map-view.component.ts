import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { filter, take, takeUntil } from 'rxjs/operators';
import { MapManagerService, MapState } from '../../../../core/services/map-manager.service';
import { StationManagerService } from '../../../../core/services/station-manager.service';
import { PollingService } from '../../../../core/services/polling.service';
import { LocationManagerService } from '../../../../core/services/location-manager.service';
import { OverlayManagerService } from '../../../../core/services/overlay-manager.service';

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
  private destroy$ = new Subject<void>();
  private mediaQueryListener: (e: MediaQueryListEvent) => void;

  constructor(
    public readonly mapManager: MapManagerService,
    public readonly stationManager: StationManagerService,
    public readonly pollingService: PollingService,
    public readonly locationManager: LocationManagerService,
    public readonly overlayManager: OverlayManagerService,
    private snackBar: MatSnackBar
  ) {
    this.mediaQueryListener = (e: MediaQueryListEvent) => {
      this.mapManager.setMobileMode(e.matches);
    };
  }

  ngOnInit(): void {
    // Set up media query listener for mobile mode
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    mediaQuery.addEventListener('change', this.mediaQueryListener);
    this.mapManager.setMobileMode(mediaQuery.matches);

    // Subscribe to state changes
        this.mapManager.state$.pipe(
      filter((state: MapState) => state.isInitialized),
      take(1),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadInitialData();
    });
  }

  ngAfterViewInit(): void {
    console.log('MapViewComponent ngAfterViewInit: mapContainer', this.mapContainer);
    if (this.mapContainer) {
      console.log('MapViewComponent ngAfterViewInit: mapContainer.nativeElement', this.mapContainer.nativeElement);
    }
    this.initializeMap();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    window.matchMedia('(max-width: 768px)').removeEventListener('change', this.mediaQueryListener);
  }

  private async initializeMap(): Promise<void> {
    try {
      console.log('Attempting to initialize map...');
      await this.mapManager.initializeMap(this.mapContainer.nativeElement).toPromise();
      console.log('Map initialized successfully in MapViewComponent.');
      this.mapManager.setLoading(false);
    } catch (error) {
      console.error('Failed to initialize map in MapViewComponent:', error);
      this.snackBar.open('Failed to initialize map. Please try again.', 'Close', {
        duration: 5000
      });
    }
  }

  private async loadInitialData(): Promise<void> {
    try {
      await this.stationManager.loadInitialData();
      this.locationManager.setupLocationUpdates();
    } catch (error) {
      console.error('Failed to load initial data:', error);
      this.snackBar.open('Failed to load station data. Please try again.', 'Close', {
        duration: 5000
      });
    }
  }

  recenterMap(): void {
    const currentLocation = this.locationManager.currentState.currentLocation;
    if (currentLocation) {
      this.mapManager.recenterMap(currentLocation);
    }
  }

  toggleMetroLines(): void {
    const currentState = this.mapManager.currentState;
    this.mapManager.toggleMetroLines(!currentState.showMetroLines);
  }

  toggleStations(): void {
    const currentState = this.mapManager.currentState;
    this.mapManager.toggleStations(!currentState.showStations);
  }
}
