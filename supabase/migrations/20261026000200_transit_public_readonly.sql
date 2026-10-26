-- Public clients read transit data; Dashboard/administrator imports retain writes.
-- Only transit tables/RPC are changed. Account tables, triggers and policies are untouched.
REVOKE ALL ON public.linien, public.haltestellen, public.steige FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.linien, public.haltestellen, public.steige TO anon, authenticated;
GRANT ALL ON public.linien, public.haltestellen, public.steige TO service_role;

ALTER TABLE public.linien ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haltestellen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.steige ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_public_read ON public.linien FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY transit_public_read ON public.haltestellen FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY transit_public_read ON public.steige FOR SELECT TO anon, authenticated USING (true);

ALTER FUNCTION public.get_nearby_steige(double precision, double precision, integer)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_nearby_steige(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_steige(double precision, double precision, integer)
  TO anon, authenticated, service_role;
