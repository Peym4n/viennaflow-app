-- Transit definitions captured read-only from PostgreSQL 15.8 / PostGIS 3.3.7.
-- Fresh databases only. On the existing project, record this baseline as applied;
-- do not run CREATE TABLE against its existing transit tables.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE TABLE public.linien (
  linien_id bigint PRIMARY KEY,
  bezeichnung varchar(50) NOT NULL,
  reihenfolge integer NOT NULL,
  echtzeit boolean NOT NULL,
  verkehrsmittel varchar(50) NOT NULL,
  stand timestamp without time zone DEFAULT now()
);

CREATE TABLE public.haltestellen (
  haltestellen_id bigint PRIMARY KEY,
  typ varchar(50) NOT NULL,
  diva integer NOT NULL,
  name varchar(255) NOT NULL,
  gemeinde varchar(255) NOT NULL,
  gemeinde_id integer NOT NULL,
  location public.geography(Point,4326),
  stand timestamp without time zone DEFAULT now()
);

CREATE TABLE public.steige (
  steig_id bigint NOT NULL,
  fk_linien_id bigint NOT NULL,
  fk_haltestellen_id bigint NOT NULL,
  richtung char(1) NOT NULL,
  reihenfolge integer NOT NULL,
  rbl_nummer integer,
  bereich integer NOT NULL,
  steig varchar(10) NOT NULL,
  stand timestamp without time zone DEFAULT now(),
  location public.geography(Point,4326),
  CONSTRAINT steigen_pkey PRIMARY KEY (steig_id, fk_linien_id, fk_haltestellen_id),
  CONSTRAINT steigen_fk_haltestellen_id_fkey FOREIGN KEY (fk_haltestellen_id)
    REFERENCES public.haltestellen(haltestellen_id) ON DELETE CASCADE,
  CONSTRAINT steigen_fk_linien_id_fkey FOREIGN KEY (fk_linien_id)
    REFERENCES public.linien(linien_id) ON DELETE CASCADE
);

CREATE INDEX linien_verkehrsmittel_idx ON public.linien (verkehrsmittel);
CREATE INDEX steige_fk_haltestellen_id_idx ON public.steige (fk_haltestellen_id);
CREATE INDEX steige_fk_linien_id_idx ON public.steige (fk_linien_id);
CREATE INDEX steige_reihenfolge_idx ON public.steige (reihenfolge);

CREATE FUNCTION public.get_nearby_steige(lat double precision, lon double precision, radius integer DEFAULT 1000)
RETURNS TABLE(steig_id bigint, fk_linien_id bigint, linien_bezeichnung text,
  fk_haltestellen_id bigint, haltestellen_name text, haltestellen_diva integer,
  richtung text, rbl_nummer bigint, location text)
LANGUAGE plpgsql AS $function$
BEGIN
  RETURN QUERY
  SELECT s.steig_id, s.fk_linien_id, l.bezeichnung::text, s.fk_haltestellen_id,
    h.name::text, h.diva, s.richtung::text, s.rbl_nummer::bigint,
    ST_AsGeoJSON(s.location)::text
  FROM steige s
  JOIN linien l ON s.fk_linien_id = l.linien_id
  JOIN haltestellen h ON s.fk_haltestellen_id = h.haltestellen_id
  WHERE ST_DWithin(s.location::geography,
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, radius);
END;
$function$;
