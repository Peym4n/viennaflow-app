import fs from 'node:fs/promises';
import { normalizeTransitCatalog } from '../shared/transit-catalog.js';

const catalog = normalizeTransitCatalog(JSON.parse(await fs.readFile('data/transit/catalog-source.json', 'utf8')));
if (Object.keys(catalog.lines).length !== 5) throw new Error('The full catalog must contain the five supported metro lines');
for (const line of Object.values(catalog.lines)) {
  if (line.stops.features.some(stop => !stop.properties.physical_location)) throw new Error('The catalog source needs physical station locations');
}
await fs.writeFile('api/lineStops.json', JSON.stringify(catalog) + '\n');
console.log('Generated transit catalog from versioned display and physical coordinates');
