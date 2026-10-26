# Transit catalog

`catalog-source.json` is the versioned source for the five supported metro lines, their geometry, and 109 line-specific entries representing 98 main stations. Its transit information dates from 20 April 2025; the refactor does not claim to refresh it from a provider.

Station `geometry` preserves the existing map display position. `properties.physical_location` preserves the corresponding position from the original station dataset and is used for walking destinations and proximity ranking. Coordinates use GeoJSON order: longitude, latitude.

The existing display positions are authoritative: 26 differ from a fresh nearest-segment projection of the original stations. Regenerating projections would move markers, so the generator deliberately retains these curated positions.

Run `npm run generate:transit` from the repository root after changing the source. It validates identifiers, metadata, metro lines, geometry, physical locations and repeated station identities, then writes `api/lineStops.json` deterministically. The generated API file remains checked in for Vercel packaging. Restart the local API runner after regeneration. Do not edit the generated file or overwrite physical locations with display projections.

Catalog changes need a real data-source date/version and the transit validation tests. Updating live Supabase data is a separate migration step, based on its verified schema.
