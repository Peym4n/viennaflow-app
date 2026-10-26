import { LatLng } from '@shared-types/api-models';
import { LineStopsResponse } from '../../core/services/api.service';
import { StationDepartures } from './station-departures';

export interface MapStation {
  id: number;
  diva: number;
  name: string;
  position: LatLng;
  routingPosition: LatLng;
  color: string;
}

export interface DepartureRow {
  key: string;
  line: string;
  towards: string;
  color: string;
  foreground: string;
  countdowns: number[];
}

export interface StationCard {
  station: MapStation;
  selected: boolean;
  walkingMinutes?: number;
  status: StationDepartures['status'];
  rows: DepartureRow[];
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
): StationCard {
  const rows = (departures.monitor?.lines ?? []).flatMap(line => {
    const countdowns = line.departures.departure.slice(0, 2).map(departure => {
      const time = Date.parse(departure.departureTime.timeReal || departure.departureTime.timePlanned);
      return Math.max(0, Number.isFinite(time) ? Math.ceil((time - now) / 60000) : departure.departureTime.countdown);
    });
    if (!countdowns.length) return [];
    const color = colors.get(line.name) || '#595959';
    return [{ key: `${line.name}:${line.towards}:${line.direction}`, line: line.name,
      towards: line.towards, color, foreground: badgeForeground(color), countdowns }];
  });
  return { station, selected, walkingMinutes, status: departures.status, rows };
}

function badgeForeground(color: string): string {
  if (!/^#[\da-f]{6}$/i.test(color)) return '#ffffff';
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return luminance > 0.179 ? '#161616' : '#ffffff';
}
