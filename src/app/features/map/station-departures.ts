import { BehaviorSubject, EMPTY, Observable, Subject, Subscription, catchError, defaultIfEmpty, defer, finalize, of, repeat, switchMap, take, tap, timeout, timer } from 'rxjs';
import { Monitor, MonitorApiResponse } from '@shared-types/api-models';
import { DEPARTURE_MAX_AGE_MS, DEPARTURE_MAX_RETRY_MS, DEPARTURE_MIN_RETRY_MS, DEPARTURE_REFRESH_MS,
  DEPARTURE_REQUEST_TIMEOUT_MS, departureDelay } from '../../../../shared/departure-timing';

export type DepartureStatus = 'loading' | 'data' | 'empty' | 'stale' | 'error';
export interface StationDepartures {
  status: DepartureStatus;
  monitor?: Monitor;
  /** Local-clock equivalent of the original sample time, used for aging. */
  updatedAt?: number;
  /** Original server timestamp, retained separately from local cache aging. */
  sampledAt?: number;
}

export interface DepartureRefresh {
  readonly inFlight: boolean;
  readonly nextRequestAt: number | null;
  readonly intervalMs: number;
}

export const IDLE_DEPARTURE_REFRESH: DepartureRefresh = {
  inFlight: false, nextRequestAt: null, intervalMs: DEPARTURE_REFRESH_MS,
};

/** Owns departure freshness, membership and one cancellable polling stream. */
export class StationDepartureState {
  private nearby = new Map<number, string | number>();
  private selected: { id: number; diva: string | number } | null = null;
  private readonly cache = new Map<string, StationDepartures>();
  private readonly requests = new BehaviorSubject<string[]>([]);
  private readonly changed = new Subject<void>();
  readonly changes$ = this.changed.asObservable();
  private readonly subscription: Subscription;
  private readonly clock: Subscription;
  private active = true;
  private online = true;
  private key = '';
  private refreshState = IDLE_DEPARTURE_REFRESH;

  get refresh(): DepartureRefresh { return this.refreshState; }

  constructor(fetch: (divas: string[]) => Observable<MonitorApiResponse>) {
    this.subscription = this.requests.pipe(
      switchMap(divas => {
        if (!divas.length) return EMPTY;
        let failures = 0;
        let delay = DEPARTURE_REFRESH_MS;
        const failure: MonitorApiResponse = { data: null, message: 'Departure request failed', errorOccurred: true };
        const request = defer(() => {
          this.refreshState = { ...this.refreshState, inFlight: true, nextRequestAt: null };
          this.changed.next();
          return fetch(divas);
        }).pipe(
          timeout({ first: DEPARTURE_REQUEST_TIMEOUT_MS }), take(1), defaultIfEmpty(failure),
          catchError(() => of(failure)),
          tap(response => {
            failures = response.errorOccurred ? Math.min(failures + 1, 3) : 0;
            const stationDelays = Object.values(response.stations ?? {}).flatMap(station => {
              const delay = departureDelay(station.retryAfterMs);
              return delay === undefined ? [] : [delay];
            });
            const recommended = departureDelay(response.nextPollInMs) ??
              (stationDelays.length ? Math.min(...stationDelays) : DEPARTURE_REFRESH_MS);
            delay = Math.max(DEPARTURE_MIN_RETRY_MS, recommended,
              failures ? Math.min(DEPARTURE_REFRESH_MS * 2 ** (failures - 1), DEPARTURE_MAX_RETRY_MS) : 0);
            this.refreshState = { inFlight: false, nextRequestAt: Date.now() + delay, intervalMs: delay };
            this.accept(divas, response);
          }),
          finalize(() => {
            if (!this.refreshState.inFlight) return;
            this.refreshState = IDLE_DEPARTURE_REFRESH;
            this.changed.next();
          }),
        );
        // One response-driven timer owns both the next request and the bar's deadline.
        return timer(0).pipe(switchMap(() => request.pipe(repeat({ delay: () => timer(delay) }))));
      }),
    ).subscribe();
    // Presentation only: age cached minutes and expire old data even while offline.
    this.clock = timer(1000, 1000).subscribe(() => {
      if (this.active && this.monitored.size) this.changed.next();
    });
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

  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
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
    if (cached.updatedAt !== undefined && Date.now() - cached.updatedAt >= DEPARTURE_MAX_AGE_MS) return { status: 'error' };
    if (cached.status === 'data' && Date.now() - (cached.updatedAt ?? 0) > 30000) {
      return { ...cached, status: 'stale' };
    }
    return cached;
  }

  destroy(): void {
    this.refreshState = IDLE_DEPARTURE_REFRESH;
    this.subscription.unsubscribe();
    this.clock.unsubscribe();
    this.requests.complete();
    this.changed.complete();
  }

  private refreshMembership(): void {
    const divas = this.active && this.online ? [...new Set([...this.monitored.values()].map(String))].sort() : [];
    const key = divas.join(',');
    if (key === this.key) return;
    this.key = key;
    this.refreshState = IDLE_DEPARTURE_REFRESH;
    // switchMap cancels both the old timer and its in-flight HTTP request.
    this.requests.next(divas);
    this.changed.next();
  }

  private accept(divas: string[], response: MonitorApiResponse): void {
    for (const diva of divas) {
      const previous = this.cache.get(diva);
      const monitor = response.data?.monitors.find(item => String(item.locationStop.properties.name) === diva);
      const metadata = response.stations?.[diva];
      const serverAge = metadata?.ageMs ?? (metadata?.updatedAt !== undefined && response.timestamp !== undefined
        ? Math.max(0, response.timestamp - metadata.updatedAt) : undefined);
      const updatedAt = serverAge !== undefined ? Date.now() - serverAge : metadata?.updatedAt ?? Date.now();
      const sampledAt = metadata?.updatedAt ?? (response.timestamp !== undefined ? response.timestamp - (serverAge ?? 0) : updatedAt);
      if (metadata?.status === 'pending') {
        this.cache.set(diva, { ...previous, status: previous?.monitor ? 'stale' : 'loading' });
      } else if (metadata?.status === 'stale') {
        this.cache.set(diva, { monitor: monitor ?? previous?.monitor, status: 'stale',
          updatedAt: monitor ? updatedAt : previous?.updatedAt, sampledAt: monitor ? sampledAt : previous?.sampledAt });
      } else if (metadata?.status === 'error' || response.errorOccurred) {
        this.cache.set(diva, { ...previous, monitor: monitor ?? previous?.monitor,
          updatedAt: monitor ? updatedAt : previous?.updatedAt, sampledAt: monitor ? sampledAt : previous?.sampledAt,
          status: monitor || previous?.monitor ? 'stale' : 'error' });
      } else if (monitor) {
        this.cache.set(diva, {
          monitor,
          status: monitor.lines.some(line => line.departures.departure.length) ? 'data' : 'empty',
          updatedAt,
          sampledAt,
        });
      } else {
        this.cache.set(diva, { status: 'empty', updatedAt });
      }
    }
    this.changed.next();
  }
}
