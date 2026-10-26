import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { WalkingTimes } from './walking-times';

describe('walking request workflow', () => {
  const origin = { lat: 48.2, lng: 16.3 };
  const targets = [1, 2].map(stationId => ({ stationId, latLng: { lat: 48.21, lng: 16.31 } }));
  const response = { rows: [{ elements: [{ status: 'OK', duration: { value: 61 } }, { status: 'ZERO_RESULTS' }] }] };

  it('keeps valid destinations when a sibling fails and retries at the same origin', () => {
    const fetch = vi.fn(() => of(response));
    const update = vi.fn();
    const walking = new WalkingTimes(fetch, () => 0, update);
    walking.request(origin, targets, true);
    expect(update).toHaveBeenCalledWith(new Map([[1, 2]]));
    walking.request(origin, targets, true);
    expect(fetch).toHaveBeenCalledTimes(2);
    walking.destroy();
  });

  it('uses the last successful origin for the 50-meter threshold and retries failures', () => {
    const fetch = vi.fn().mockReturnValueOnce(throwError(() => new Error('offline'))).mockReturnValue(of({
      rows: [{ elements: [{ status: 'OK', duration: { value: 120 } }] }],
    }));
    const distance = vi.fn(() => 0);
    const walking = new WalkingTimes(fetch, distance, vi.fn());
    walking.request(origin, targets.slice(0, 1), true);
    walking.request(origin, targets.slice(0, 1), true);
    walking.request(origin, targets.slice(0, 1), true);
    expect(fetch).toHaveBeenCalledTimes(2);
    distance.mockReturnValue(51);
    walking.request({ lat: 48.201, lng: 16.3 }, targets.slice(0, 1), true);
    expect(fetch).toHaveBeenCalledTimes(3);
    walking.destroy();
  });

  it('cancels old destination requests when intent changes and on teardown', () => {
    const first = new Subject();
    const second = new Subject();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const walking = new WalkingTimes(fetch, () => 0, vi.fn());
    walking.request(origin, targets.slice(0, 1), true);
    walking.request(origin, targets, true);
    expect(first.observed).toBe(false);
    expect(second.observed).toBe(true);
    walking.request(origin, targets, false);
    expect(second.observed).toBe(false);
    walking.destroy();
    expect(second.observed).toBe(false);
  });
});
