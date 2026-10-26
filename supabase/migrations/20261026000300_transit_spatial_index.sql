-- The deployed baseline has no spatial index and scans all 7,362 platforms.
-- Keep the nearby function/results unchanged; index its existing geography column.
CREATE INDEX IF NOT EXISTS steige_location_gist_idx ON public.steige USING gist (location);
ANALYZE public.steige;
