import { LatLng } from '@shared-types/api-models';
import { LineStopsResponse } from '../../core/services/api.service';
import { DepartureRefresh, IDLE_DEPARTURE_REFRESH, StationDepartures } from './station-departures';
import { DEPARTURE_MAX_AGE_MS } from '../../../../shared/departure-timing';

export interface MapStation {
  id: number;
  diva: number;
  name: string;
  position: LatLng;
  routingPosition: LatLng;
  color: string;
}

export interface DepartureCountdown {
  minutes: number;
  status: 'on-time' | 'delayed' | 'scheduled';
}

export interface DepartureRow {
  key: string;
  line: string;
  towards: string;
  color: string;
  countdowns: DepartureCountdown[];
}

export interface StationCard {
  station: MapStation;
  selected: boolean;
  walkingMinutes?: number;
  status: StationDepartures['status'];
  rows: DepartureRow[];
  refresh: DepartureRefresh;
}

export function catalogStations(catalog: LineStopsResponse): Map<number, MapStation> {
  const stations = new Map<number, MapStation>();
  for (const line of Object.values(catalog.lines)) {
    for (const feature of line.stops.features) {
      const { haltestellen_id: id, diva, name } = feature.properties;
      const [lng, lat] = feature.geometry.coordinates;
      const [routingLng, routingLat] = feature.properties.physical_location?.coordinates ?? feature.geometry.coordinates;
      if (!stations.has(id)) stations.set(id, { id, diva, name, position: { lat, lng },
        routingPosition: { lat: routingLat, lng: routingLng }, color: line.farbe });
    }
  }
  return stations;
}

/** Rank physical locations independently of departures, walks and display offsets. */
export function closestStations(stations: Iterable<MapStation>, distance: (position: LatLng) => number): MapStation[] {
  return [...stations].map(station => ({ station, distance: distance(station.routingPosition) }))
    .sort((a, b) => a.distance - b.distance || a.station.id - b.station.id)
    .slice(0, 3).map(candidate => candidate.station);
}

export function stationCard(
  station: MapStation, departures: StationDepartures, colors: ReadonlyMap<string, string>,
  selected: boolean, walkingMinutes?: number, now = Date.now(),
  refresh: DepartureRefresh = IDLE_DEPARTURE_REFRESH,
): StationCard {
  const receivedSourceTime = departures.updatedAt ?? now;
  const sourceTime = departures.sampledAt ?? receivedSourceTime;
  const displayNow = sourceTime + (now - receivedSourceTime);
  const lines = now - receivedSourceTime >= DEPARTURE_MAX_AGE_MS ? [] : departures.monitor?.lines ?? [];
  const rows = lines.flatMap(line => {
    const countdowns = line.departures.departure.flatMap(({ departureTime }): DepartureCountdown[] => {
      const real = typeof departureTime.timeReal === 'string' ? Date.parse(departureTime.timeReal) : NaN;
      const countdown = departureTime.countdown;
      const planned = typeof departureTime.timePlanned === 'string' ? Date.parse(departureTime.timePlanned) : NaN;
      const estimated = Number.isFinite(real) ? real
        : typeof countdown === 'number' && Number.isFinite(countdown) && countdown >= 0 ? sourceTime + countdown * 60000 : undefined;
      const time = estimated ?? planned;
      // Retain the current departure briefly, but never keep obsolete rows at "Now" indefinitely.
      if (!Number.isFinite(time) || time < displayNow - 60000) return [];
      return [{ minutes: Math.max(0, Math.floor((time - displayNow) / 60000)),
        status: estimated === undefined || !Number.isFinite(planned) ? 'scheduled'
          : estimated - planned > 60000 ? 'delayed' : 'on-time' }];
    }).slice(0, 2);
    if (!countdowns.length) return [];
    const color = colors.get(line.name) || '#595959';
    return [{ key: `${line.name}:${line.towards}:${line.direction}`, line: line.name,
      towards: line.towards, color, countdowns }];
  });
  return { station, selected, walkingMinutes, status: departures.status, rows, refresh };
}
