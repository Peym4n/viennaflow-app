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
    expect(state.get(60201394).monitor?.lines[0].name).toBe('U6');
    vi.advanceTimersByTime(15000);
    expect(state.get(60201394).status).toBe('empty');
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
