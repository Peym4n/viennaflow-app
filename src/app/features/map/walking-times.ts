import { Observable, Subject, Subscription, catchError, of, switchMap, tap } from 'rxjs';
import { LatLng } from '@shared-types/api-models';

export interface WalkingTarget { stationId: number; latLng: LatLng; }
interface WalkingRequest { origin: LatLng; targets: WalkingTarget[]; key: string; }
interface WalkingElement { status?: string; duration?: { value?: number }; }
interface WalkingResponse { rows?: { elements?: WalkingElement[] }[]; }

/** One latest-intent walking request. Failed destinations never discard successful siblings. */
export class WalkingTimes {
  private readonly requests = new Subject<WalkingRequest | null>();
  private readonly subscription: Subscription;
  private lastSuccess: WalkingRequest | null = null;
  private pending: WalkingRequest | null = null;

  constructor(
    fetch: (payload: { origins: LatLng[]; destinations: LatLng[] }) => Observable<WalkingResponse>,
    private readonly distance: (a: LatLng, b: LatLng) => number,
    update: (times: Map<number, number>) => void,
  ) {
    this.subscription = this.requests.pipe(switchMap(request => !request ? of(null) : fetch({
      origins: [request.origin], destinations: request.targets.map(target => target.latLng),
    }).pipe(
      tap(response => {
        const elements = response.rows?.[0]?.elements;
        if (!Array.isArray(elements)) return;
        const times = new Map<number, number>();
        elements.forEach((element, index) => {
          const seconds = element?.duration?.value;
          if (request.targets[index] && (!element?.status || element.status === 'OK') && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
            times.set(request.targets[index].stationId, Math.ceil(seconds / 60));
          }
        });
        if (times.size) {
          // Partial failures stay retryable at the same origin.
          if (times.size === request.targets.length) this.lastSuccess = request;
          update(times);
        }
      }),
      catchError(() => of(null)),
      tap(() => { if (this.pending === request) this.pending = null; }),
    ))).subscribe();
  }

  request(origin: LatLng, targets: WalkingTarget[], enabled: boolean): void {
    if (!enabled || !targets.length) { this.cancel(); return; }
    const sorted = [...targets].sort((a, b) => a.stationId - b.stationId);
    const key = JSON.stringify(sorted);
    if (this.pending?.key === key && this.distance(origin, this.pending.origin) <= 50) return;
    if (this.lastSuccess?.key === key && this.distance(origin, this.lastSuccess.origin) <= 50) return;
    const request = { origin, targets: sorted, key };
    this.pending = request;
    this.requests.next(request);
  }

  destroy(): void { this.subscription.unsubscribe(); this.requests.complete(); }

  cancel(): void { this.pending = null; this.requests.next(null); }
}
