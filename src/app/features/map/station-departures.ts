import { BehaviorSubject, Observable, Subject, Subscription, catchError, exhaustMap, of, switchMap, timer } from 'rxjs';
import { Monitor, MonitorApiResponse } from '@shared-types/api-models';

export type DepartureStatus = 'loading' | 'data' | 'empty' | 'stale' | 'error';
export interface StationDepartures {
  status: DepartureStatus;
  monitor?: Monitor;
  updatedAt?: number;
}

/** Owns departure freshness, membership and one cancellable polling stream. */
export class StationDepartureState {
  private nearby = new Map<number, string | number>();
  private selected: { id: number; diva: string | number } | null = null;
  private readonly cache = new Map<string, StationDepartures>();
  private readonly requests = new BehaviorSubject<string[]>([]);
  private readonly changed = new Subject<void>();
  readonly changes$ = this.changed.asObservable();
  private readonly subscription: Subscription;
  private active = true;
  private key = '';

  constructor(fetch: (divas: string[]) => Observable<MonitorApiResponse>) {
    this.subscription = this.requests.pipe(
      switchMap(divas => divas.length === 0 ? of(null) : timer(0, 15000).pipe(
        exhaustMap(() => fetch(divas).pipe(
          catchError(() => of({ data: null, message: 'Departure request failed', errorOccurred: true }))
        )),
        switchMap(response => {
          this.accept(divas, response);
          return of(null);
        }),
      )),
    ).subscribe();
  }

  setNearby(stations: ReadonlyMap<number, string | number>): void {
    this.nearby = new Map(stations);
    this.refreshMembership();
  }

  select(id: number, diva: string | number): void {
    this.selected = { id, diva };
    this.refreshMembership();
  }

  clearSelection(): void {
    this.selected = null;
    this.refreshMembership();
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.refreshMembership();
  }

  get monitored(): Map<number, string | number> {
    const stations = new Map(this.nearby);
    if (this.selected) stations.set(this.selected.id, this.selected.diva);
    return stations;
  }

  get(diva: string | number): StationDepartures {
    const cached = this.cache.get(String(diva));
    if (!cached) return { status: 'loading' };
    if (cached.status === 'data' && Date.now() - (cached.updatedAt ?? 0) > 30000) {
      return { ...cached, status: 'stale' };
    }
    return cached;
  }

  destroy(): void {
    this.subscription.unsubscribe();
    this.requests.complete();
    this.changed.complete();
  }

  private refreshMembership(): void {
    const divas = this.active ? [...new Set([...this.monitored.values()].map(String))].sort() : [];
    const key = divas.join(',');
    if (key === this.key) return;
    this.key = key;
    // switchMap cancels both the old timer and its in-flight HTTP request.
    this.requests.next(divas);
  }

  private accept(divas: string[], response: MonitorApiResponse): void {
    for (const diva of divas) {
      const previous = this.cache.get(diva);
      const monitor = response.data?.monitors.find(item => String(item.locationStop.properties.name) === diva);
      const metadata = response.stations?.[diva];
      if (metadata?.status === 'pending') {
        this.cache.set(diva, { ...previous, status: previous?.monitor ? 'stale' : 'loading' });
      } else if (metadata?.status === 'stale') {
        this.cache.set(diva, { monitor: monitor ?? previous?.monitor, status: 'stale', updatedAt: metadata.updatedAt ?? previous?.updatedAt });
      } else if (metadata?.status === 'error' || response.errorOccurred) {
        this.cache.set(diva, { ...previous, status: previous?.monitor ? 'stale' : 'error' });
      } else if (monitor) {
        this.cache.set(diva, {
          monitor,
          status: monitor.lines.some(line => line.departures.departure.length) ? 'data' : 'empty',
          updatedAt: metadata?.updatedAt ?? Date.now(),
        });
      } else {
        this.cache.set(diva, { status: 'empty', updatedAt: metadata?.updatedAt ?? Date.now() });
      }
    }
    this.changed.next();
  }
}
