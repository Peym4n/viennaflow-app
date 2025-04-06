import { Routes } from '@angular/router';
import { MapViewComponent } from './features/map/components/map-view/map-view.component';

export const routes: Routes = [
  { path: '', component: MapViewComponent },
  { path: '**', redirectTo: '' }
];
