import { describe, expect, it } from 'vitest';
import { normalizeDiva, normalizeMonitorResponse } from './monitor-response';
import fixture from '../../../../api/monitor-u6-sample.json';

describe('monitor response validation', () => {
  it('normalizes DIVA values and ignores the platform RBL for matching', () => {
    expect(normalizeDiva(' 60201394 ')).toBe('60201394');
    expect(normalizeDiva('60201394&diva=123')).toBeUndefined();
    const response = normalizeMonitorResponse(fixture);
    expect(response.data!.monitors[0].locationStop.properties.name).toBe('60201394');
    expect(response.data!.monitors[0].locationStop.properties.attributes.rbl).toBe(4640);
    expect(response.data!.monitors[0].lines[0].departures.departure).toHaveLength(3);
  });

  it('rejects malformed envelopes and keeps valid empty responses distinct', () => {
    expect(() => normalizeMonitorResponse({ data: null })).toThrow();
    expect(normalizeMonitorResponse({ data: { monitors: [] } }).errorOccurred).toBe(false);
    expect(() => normalizeMonitorResponse({ data: { monitors: [{ lines: [] }] } })).toThrow();
  });

  it('validates scheduling metadata and accepts explicit retryable failure envelopes', () => {
    const valid = normalizeMonitorResponse({ data: null, errorOccurred: true, nextPollInMs: 7500,
      timestamp: 10000, stations: { '60201394': { status: 'error', ageMs: 2000, retryAfterMs: 7500 } } });
    expect(valid.nextPollInMs).toBe(7500);
    expect(valid.data).toBeNull();
    expect(valid.stations!['60201394'].ageMs).toBe(2000);
    const invalid = normalizeMonitorResponse({ data: { monitors: [] }, nextPollInMs: Infinity,
      timestamp: NaN, stations: { '60201394': { status: 'pending', ageMs: -1, retryAfterMs: -20 } } });
    expect(invalid.nextPollInMs).toBeUndefined();
    expect(invalid.timestamp).toBeUndefined();
    expect(invalid.stations!['60201394'].ageMs).toBeUndefined();
    expect(invalid.stations!['60201394'].retryAfterMs).toBeUndefined();
  });

  it('accepts timestamp-only departures and filters departures with no usable time', () => {
    const sample = structuredClone(fixture);
    const departures = sample.data.monitors[0].lines[0].departures;
    Object.assign(departures, { departure: [
      { departureTime: { timePlanned: '2026-11-06T12:00:00Z' } },
      { departureTime: { timeReal: '2026-11-06T12:01:00Z' } },
      { departureTime: { countdown: 0 } },
      { departureTime: { timePlanned: 'invalid', countdown: null } },
    ] });
    const result = normalizeMonitorResponse(sample).data!.monitors[0].lines[0].departures.departure;
    expect(result.map(departure => departure.departureTime)).toEqual([
      { timePlanned: '2026-11-06T12:00:00Z' },
      { timeReal: '2026-11-06T12:01:00Z' },
      { countdown: 0 },
    ]);
  });
});
