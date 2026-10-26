import { NearbySteig } from '../types/api-models.js';
import { normalizeDiva } from '../shared/monitor-response.js';
import { parsePoint } from './geometry.js';

export function normalizeNearbyPlatforms(value: unknown, allowedLines: ReadonlySet<number>): NearbySteig[] {
  if (!Array.isArray(value)) throw new Error('Invalid nearby response');
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const line = Number(row['fk_linien_id']);
    const diva = normalizeDiva(row['haltestellen_diva']);
    const location = parsePoint(row['location']);
    if (!allowedLines.has(line) || !diva || !location || !Number.isSafeInteger(row['fk_haltestellen_id']) || !Number.isSafeInteger(row['steig_id']) || typeof row['haltestellen_name'] !== 'string') return [];
    return [{
      steig_id: row['steig_id'] as number, fk_linien_id: line,
      fk_haltestellen_id: row['fk_haltestellen_id'] as number,
      haltestellen_diva: Number(diva), haltestellen_name: row['haltestellen_name'],
      linien_bezeichnung: typeof row['linien_bezeichnung'] === 'string' ? row['linien_bezeichnung'] : '',
      richtung: typeof row['richtung'] === 'string' ? row['richtung'] : '',
      rbl_nummer: typeof row['rbl_nummer'] === 'number' ? row['rbl_nummer'] : null,
      location,
    }];
  });
}
