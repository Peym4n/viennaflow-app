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

  it('uses absolute departure times for two countdowns and keeps status and walking data separate', () => {
    const monitor = normalizeMonitorResponse(fixture).data!.monitors[0];
    monitor.lines[0].departures.departure[0].departureTime = { timePlanned: '2026-10-26T12:05:00Z', countdown: 99 };
    monitor.lines[0].departures.departure[1].departureTime = { timePlanned: '2026-10-26T12:10:00Z', countdown: 99 };
    const result = stationCard(station(1), { status: 'stale', monitor }, new Map([['U6', '#ffffff']]), true, undefined, Date.parse('2026-10-26T12:02:00Z'));
    expect(result.rows[0].countdowns).toEqual([3, 8]);
    expect(result.rows[0].foreground).toBe('#161616');
    expect(result.status).toBe('stale');
    expect(result.walkingMinutes).toBeUndefined();
  });
});
