import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorApiResponse } from '@shared-types/api-models';
import { normalizeMonitorResponse } from '../../core/services/monitor-response';
import { StationDepartureState } from './station-departures';
import fixture from '../../../../api/monitor-u6-sample.json';

describe('station departure state', () => {
  let state: StationDepartureState;
  afterEach(() => { state?.destroy(); vi.useRealTimers(); });

  it('keeps nearby membership after selection closes and cancels superseded requests', () => {
    vi.useFakeTimers();
    const first = new Subject<MonitorApiResponse>();
    const second = new Subject<MonitorApiResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    state = new StationDepartureState(fetch);
    state.setNearby(new Map([[1, 60201394]]));
    vi.advanceTimersByTime(0);
    state.select(2, 60200002);
    vi.advanceTimersByTime(0);
    expect(first.observed).toBe(false);
    state.clearSelection();
    vi.advanceTimersByTime(0);
    expect(fetch.mock.calls.at(-1)![0]).toEqual(['60201394']);
    expect(state.monitored).toEqual(new Map([[1, 60201394]]));
  });

  it('preserves earlier data on failure, distinguishes empty, and retries errors', () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValueOnce(of(normalizeMonitorResponse(fixture))).mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of({ data: { monitors: [] }, message: 'Empty' }));
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    expect(state.get(60201394).status).toBe('loading');
    vi.advanceTimersByTime(0);
    expect(state.get(60201394).status).toBe('data');
    vi.advanceTimersByTime(15000);
    expect(state.get(60201394).status).toBe('stale');
    expect(state.refresh.inFlight).toBe(false);
    expect(state.refresh.nextRequestAt).toBe(Date.now() + 15000);
    expect(state.get(60201394).monitor?.lines[0].name).toBe('U6');
    vi.advanceTimersByTime(15000);
    expect(state.get(60201394).status).toBe('empty');
  });

  it('tracks each real request separately from cached departures and retains the polling deadline', () => {
    vi.useFakeTimers();
    const first = new Subject<MonitorApiResponse>();
    const second = new Subject<MonitorApiResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const startedAt = Date.now();
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(0);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: startedAt + 15000, intervalMs: 15000 });
    vi.advanceTimersByTime(2500);
    first.next(normalizeMonitorResponse(fixture)); first.complete();
    expect(state.refresh.inFlight).toBe(false);
    expect(state.refresh.nextRequestAt).toBe(startedAt + 15000);
    vi.advanceTimersByTime(12500);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: startedAt + 30000, intervalMs: 15000 });
    expect(state.get(60201394).status).toBe('data');
    expect(state.get(60201394).monitor?.lines[0].name).toBe('U6');
  });

  it('skips overlapping ticks and counts down to the next actual opportunity after a slow request', () => {
    vi.useFakeTimers();
    const first = new Subject<MonitorApiResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(of(normalizeMonitorResponse(fixture)));
    const startedAt = Date.now();
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(21000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: startedAt + 30000, intervalMs: 15000 });
    first.next(normalizeMonitorResponse(fixture)); first.complete();
    expect(state.refresh.inFlight).toBe(false);
    vi.advanceTimersByTime(8999);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.refresh.nextRequestAt).toBe(startedAt + 45000);
  });

  it('clears refresh indicators on cancellation and teardown and schedules a fresh request on resume', () => {
    vi.useFakeTimers();
    const first = new Subject<MonitorApiResponse>();
    const second = new Subject<MonitorApiResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(0);
    expect(state.refresh.inFlight).toBe(true);
    state.setActive(false);
    expect(first.observed).toBe(false);
    expect(state.refresh).toEqual({ inFlight: false, nextRequestAt: null, intervalMs: 15000 });
    vi.advanceTimersByTime(60000);
    state.setActive(true);
    vi.advanceTimersByTime(0);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: Date.now() + 15000, intervalMs: 15000 });
    state.destroy();
    expect(second.observed).toBe(false);
    expect(state.refresh.inFlight).toBe(false);
    expect(state.refresh.nextRequestAt).toBeNull();
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses in the background, resumes immediately and leaves no work after teardown', () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => of(normalizeMonitorResponse(fixture)));
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(0);
    state.setActive(false);
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    state.setActive(true);
    vi.advanceTimersByTime(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    state.destroy();
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps pending stations loading and uses server cache age rather than response time', () => {
    vi.useFakeTimers();
    const response = new Subject<MonitorApiResponse>();
    state = new StationDepartureState(() => response);
    state.select(1, 60201394);
    vi.advanceTimersByTime(0);
    response.next({ data: { monitors: [] }, message: 'Pending', stations: { '60201394': { status: 'pending', retryAfterMs: 15000 } } });
    expect(state.get(60201394).status).toBe('loading');
    response.next({ ...normalizeMonitorResponse(fixture), stations: { '60201394': { status: 'data', updatedAt: Date.now() - 45000 } } });
    expect(state.get(60201394).status).toBe('stale');
  });
});
