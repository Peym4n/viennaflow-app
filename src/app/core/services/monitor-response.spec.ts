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
});
