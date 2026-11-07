import { NEVER, Subject, of, throwError } from 'rxjs';
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

  it('starts the next deadline from the server response rather than the previous request start', () => {
    vi.useFakeTimers();
    const first = new Subject<MonitorApiResponse>();
    const second = new Subject<MonitorApiResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const startedAt = Date.now();
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(0);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: null, intervalMs: 15000 });
    vi.advanceTimersByTime(2500);
    first.next(normalizeMonitorResponse(fixture)); first.complete();
    expect(state.refresh.inFlight).toBe(false);
    expect(state.refresh.nextRequestAt).toBe(startedAt + 17500);
    vi.advanceTimersByTime(15000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: null, intervalMs: 15000 });
    expect(state.get(60201394).status).toBe('data');
    expect(state.get(60201394).monitor?.lines[0].name).toBe('U6');
  });

  it('times out a stalled request without overlap and retries after a bounded delay', () => {
    vi.useFakeTimers();
    const first = new Subject<MonitorApiResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValue(of(normalizeMonitorResponse(fixture)));
    const startedAt = Date.now();
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(19999);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: null, intervalMs: 15000 });
    vi.advanceTimersByTime(1);
    expect(first.observed).toBe(false);
    expect(state.refresh.inFlight).toBe(false);
    expect(state.refresh.nextRequestAt).toBe(startedAt + 35000);
    vi.advanceTimersByTime(14999);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.refresh.nextRequestAt).toBe(startedAt + 50000);
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
    expect(state.refresh).toEqual({ inFlight: true, nextRequestAt: null, intervalMs: 15000 });
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
    const fetch = vi.fn().mockReturnValueOnce(of({ data: { monitors: [] }, message: 'Pending',
      stations: { '60201394': { status: 'pending', retryAfterMs: 15000 } } }))
      .mockReturnValue(of({ ...normalizeMonitorResponse(fixture), stations: { '60201394': { status: 'data', updatedAt: Date.now() - 45000 } } }));
    state = new StationDepartureState(fetch);
    state.select(1, 60201394);
    vi.advanceTimersByTime(0);
    expect(state.get(60201394).status).toBe('loading');
    vi.advanceTimersByTime(15000);
    expect(state.get(60201394).status).toBe('stale');
  });

  it('checks B at the shared slot after selecting A at zero and B five seconds later', () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValueOnce(of({ ...normalizeMonitorResponse(fixture), nextPollInMs: 15000 }))
      .mockReturnValueOnce(of({ data: { monitors: [] }, message: 'Pending', nextPollInMs: 10000,
        stations: { '60200002': { status: 'pending', retryAfterMs: 10000 } } }))
      .mockReturnValue(of({ data: { monitors: [] }, message: 'Empty', nextPollInMs: 15000 }));
    state = new StationDepartureState(fetch);
    const startedAt = Date.now();
    state.select(1, 60201394); vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(5000);
    state.select(2, 60200002); vi.advanceTimersByTime(0);
    expect(state.refresh).toEqual({ inFlight: false, nextRequestAt: startedAt + 15000, intervalMs: 10000 });
    vi.advanceTimersByTime(9999);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toEqual(['60200002']);
  });

  it('backs off consecutive failures, caps the delay, and resets after a successful snapshot', () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValue(throwError(() => new Error('offline')));
    state = new StationDepartureState(fetch);
    state.select(1, 60201394); vi.advanceTimersByTime(0);
    expect(state.refresh.intervalMs).toBe(15000);
    vi.advanceTimersByTime(15000);
    expect(state.refresh.intervalMs).toBe(30000);
    vi.advanceTimersByTime(30000);
    expect(state.refresh.intervalMs).toBe(60000);
    vi.advanceTimersByTime(60000);
    expect(state.refresh.intervalMs).toBe(60000);
    fetch.mockReturnValue(of({ ...normalizeMonitorResponse(fixture), nextPollInMs: 7000 }));
    vi.advanceTimersByTime(60000);
    expect(state.refresh.intervalMs).toBe(7000);
  });

  it('pauses online work while offline, expires cached data, and resumes immediately', () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValueOnce(of(normalizeMonitorResponse(fixture))).mockReturnValue(NEVER);
    state = new StationDepartureState(fetch);
    state.select(1, 60201394); vi.advanceTimersByTime(0);
    state.setOnline(false);
    expect(state.refresh.nextRequestAt).toBeNull();
    vi.advanceTimersByTime(120000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.get(60201394)).toEqual({ status: 'error' });
    state.setOnline(true); vi.advanceTimersByTime(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.refresh.inFlight).toBe(true);
    state.setOnline(false);
    expect(state.refresh.inFlight).toBe(false);
  });

  it('preserves original snapshot time and ages data independently of browser clock skew', () => {
    vi.useFakeTimers();
    const serverTime = Date.now() - 600000;
    state = new StationDepartureState(() => of({ ...normalizeMonitorResponse(fixture), timestamp: serverTime,
      stations: { '60201394': { status: 'data', ageMs: 10000, updatedAt: serverTime - 10000 } } }));
    state.select(1, 60201394); vi.advanceTimersByTime(0);
    expect(state.get(60201394).updatedAt).toBe(Date.now() - 10000);
    expect(state.get(60201394).sampledAt).toBe(serverTime - 10000);
    expect(state.get(60201394).status).toBe('data');
  });

  it('rejects unsafe timing and never spins on a zero or invalid delay', () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValueOnce(of({ ...normalizeMonitorResponse(fixture), nextPollInMs: 0 }))
      .mockReturnValue(of({ ...normalizeMonitorResponse(fixture), nextPollInMs: Infinity }));
    state = new StationDepartureState(fetch);
    state.select(1, 60201394); vi.advanceTimersByTime(0);
    expect(state.refresh.intervalMs).toBe(1000);
    vi.advanceTimersByTime(1000);
    expect(state.refresh.intervalMs).toBe(15000);
  });

  it('does not give an old cached snapshot a new countdown origin when it is delivered again', () => {
    vi.useFakeTimers();
    const sampledAt = Date.now();
    const fetch = vi.fn(() => of({ ...normalizeMonitorResponse(fixture), timestamp: Date.now(), nextPollInMs: 5000,
      stations: { '60201394': { status: 'data' as const, updatedAt: sampledAt, ageMs: Date.now() - sampledAt } } }));
    state = new StationDepartureState(fetch);
    state.select(1, 60201394); vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.get(60201394).updatedAt).toBe(sampledAt);
    expect(state.get(60201394).sampledAt).toBe(sampledAt);
  });
});
