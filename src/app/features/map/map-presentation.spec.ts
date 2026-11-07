import { describe, expect, it } from 'vitest';
import { MapStation, catalogStations, closestStations, stationCard } from './map-presentation';
import { LineStopsResponse } from '../../core/services/api.service';
import { normalizeMonitorResponse } from '../../core/services/monitor-response';
import fixture from '../../../../api/monitor-u6-sample.json';

const station = (id: number): MapStation => ({ id, diva: id, name: `Station ${id}`, color: '#ffffff',
  position: { lat: 48.2, lng: 16.3 }, routingPosition: { lat: 48.2, lng: 16.3 } });
describe('Station presentation rules', () => {
  it('selects the closest three physical stations without changing the catalog order', () => {
    const candidates = [1, 2, 3, 4].map(id => ({ ...station(id), routingPosition: { lat: 48.2, lng: id } }));
    expect(closestStations(candidates, position => (5 - position.lng) * 100).map(station => station.id)).toEqual([4, 3, 2]);
    expect(candidates.map(station => station.id)).toEqual([1, 2, 3, 4]);
  });

  it('breaks distance ties by station identity and handles small or empty catalogs', () => {
    expect(closestStations([station(3), station(1), station(2)], () => 100).map(station => station.id)).toEqual([1, 2, 3]);
    expect(closestStations([station(2)], () => 100).map(station => station.id)).toEqual([2]);
    expect(closestStations([], () => 0)).toEqual([]);
  });

  it('counts an interchange only once when ranking catalog stations', () => {
    const feature = { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [16.3, 48.2] as [number, number] },
      properties: { haltestellen_id: 1, diva: 60200001, name: 'Interchange', linien_ids: [301, 302] } };
    const line = { bezeichnung: 'U1', farbe: '#ffffff', reihenfolge: 1, echtzeit: true, lineStrings: [],
      stops: { type: 'FeatureCollection' as const, features: [feature] } };
    const catalog: LineStopsResponse = { metainfo: { version: 'test', last_updated: '2026-10-27' }, lines: { '301': line, '302': { ...line, bezeichnung: 'U2' } } };
    expect(closestStations(catalogStations(catalog).values(), () => 0).map(station => station.id)).toEqual([1]);
  });

  it('prefers real timestamps over countdowns and keeps status and walking data separate', () => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    monitor.lines[0].departures.departure[0].departureTime = { timeReal: '2026-10-26T12:05:00Z', timePlanned: '2026-10-26T12:20:00Z', countdown: 99 };
    monitor.lines[0].departures.departure[1].departureTime = { timeReal: '2026-10-26T12:10:00Z', timePlanned: '2026-10-26T12:20:00Z', countdown: 99 };
    const result = stationCard(station(1), { status: 'stale', monitor }, new Map([['U6', '#ffffff']]), true, undefined, Date.parse('2026-10-26T12:02:00Z'));
    expect(result.rows[0].countdowns.map(countdown => countdown.minutes)).toEqual([3, 8]);
    expect(result.rows[0].color).toBe('#ffffff');
    expect(result.status).toBe('stale');
    expect(result.walkingMinutes).toBeUndefined();
  });

  it.each([
    { timeReal: '2026-10-26T12:04:00Z', countdown: 9, status: 'on-time' },
    { timeReal: '2026-10-26T12:05:00Z', countdown: 9, status: 'on-time' },
    { timeReal: '2026-10-26T12:06:00Z', countdown: 9, status: 'on-time' },
    { timeReal: '2026-10-26T12:06:01Z', countdown: 0, status: 'delayed' },
    { timeReal: undefined, countdown: 2, status: 'on-time' },
    { timeReal: undefined, countdown: 3, status: 'on-time' },
    { timeReal: undefined, countdown: 4, status: 'on-time' },
    { timeReal: undefined, countdown: 4.1, status: 'delayed' },
    { timeReal: 'invalid', countdown: 5, status: 'delayed' },
    { timeReal: undefined, countdown: undefined, status: 'scheduled' },
    { timeReal: 'invalid', countdown: NaN, status: 'scheduled' },
  ])('classifies departure punctuality before rounding: %j', ({ timeReal, countdown, status }) => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    monitor.lines[0].departures.departure = [{ departureTime: {
      timeReal, countdown, timePlanned: '2026-10-26T12:05:00Z',
    } }];
    const card = stationCard(station(1), { status: 'data', monitor }, new Map(), false, undefined,
      Date.parse('2026-10-26T12:02:00Z'));
    expect(card.rows[0].countdowns[0].status).toBe(status);
  });

  it('anchors a countdown to its original snapshot so remaining minutes age without changing punctuality', () => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    const sampledAt = Date.parse('2026-10-26T12:00:00Z');
    monitor.lines[0].departures.departure = [{ departureTime: {
      countdown: 3, timePlanned: '2026-10-26T12:02:00Z',
    } }];
    const departures = { status: 'data' as const, monitor, updatedAt: sampledAt, sampledAt };
    const first = stationCard(station(1), departures, new Map(), false, undefined, sampledAt);
    const later = stationCard(station(1), departures, new Map(), false, undefined, sampledAt + 75000);
    expect(first.rows[0].countdowns[0]).toEqual({ minutes: 3, status: 'on-time' });
    expect(later.rows[0].countdowns[0]).toEqual({ minutes: 1, status: 'on-time' });
  });

  it('keeps countdown aging and punctuality accurate when the browser clock differs from the server', () => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    const sampledAt = Date.parse('2026-10-26T12:00:00Z');
    const receivedAt = sampledAt + 600000;
    monitor.lines[0].departures.departure = [{ departureTime: {
      countdown: 3, timePlanned: '2026-10-26T12:02:00Z',
    } }];
    const card = stationCard(station(1), { status: 'data', monitor, sampledAt, updatedAt: receivedAt }, new Map(), false,
      undefined, receivedAt + 60000);
    expect(card.rows[0].countdowns[0]).toEqual({ minutes: 2, status: 'on-time' });
  });

  it('omits expired snapshots and obsolete departures instead of keeping them at Now', () => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    const sampledAt = Date.parse('2026-10-26T12:00:00Z');
    monitor.lines = [monitor.lines[0]];
    monitor.lines[0].departures.departure = [{ departureTime: {
      timeReal: '2026-10-26T11:58:59Z', timePlanned: '2026-10-26T12:00:00Z',
    } }];
    expect(stationCard(station(1), { status: 'stale', monitor, updatedAt: sampledAt }, new Map(), false,
      undefined, sampledAt).rows).toEqual([]);
    monitor.lines[0].departures.departure = [{ departureTime: { countdown: 10, timePlanned: '2026-10-26T12:10:00Z' } }];
    expect(stationCard(station(1), { status: 'stale', monitor, updatedAt: sampledAt }, new Map(), false,
      undefined, sampledAt + 120000).rows).toEqual([]);
  });

  it('ignores malformed optional timestamps instead of coercing them into real-time predictions', () => {
    const raw = structuredClone(fixture);
    Object.assign(raw.data.monitors[0].lines[0].departures, { departure: [{ departureTime: {
      timeReal: 2026, timePlanned: null, countdown: 3,
    } }] });
    const monitor = normalizeMonitorResponse(raw).data!.monitors[0];
    const card = stationCard(station(1), { status: 'data', monitor }, new Map(), false);
    expect(card.rows[0].countdowns[0]).toEqual({ minutes: 3, status: 'scheduled' });
  });

  it.each([
    { timeReal: '2026-10-26T12:05:59Z', countdown: 99, expected: 3 },
    { timeReal: '2026-10-26T12:02:59Z', countdown: 99, expected: 0 },
    { timeReal: '2026-10-26T12:01:59Z', countdown: 99, expected: 0 },
    { timeReal: undefined, countdown: 0, expected: 0 },
    { timeReal: undefined, countdown: 4.9, expected: 4 },
    { timeReal: 'invalid', countdown: 4, expected: 4 },
    { timeReal: undefined, countdown: undefined, expected: 8 },
    { timeReal: 'invalid', countdown: NaN, expected: 8 },
  ])('falls back through countdown and planned time: %j', ({ timeReal, countdown, expected }) => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    monitor.lines[0].departures.departure = [{ departureTime: {
      timeReal, countdown, timePlanned: '2026-10-26T12:10:59Z',
    } }];
    expect(stationCard(station(1), { status: 'data', monitor }, new Map(), false, undefined,
      Date.parse('2026-10-26T12:02:00Z')).rows[0].countdowns.map(countdown => countdown.minutes)).toEqual([expected]);
  });
});
