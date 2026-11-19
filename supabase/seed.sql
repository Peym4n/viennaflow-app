-- Synthetic LOCAL fixtures, not a copy of the deployed transit dataset.
-- Never run a seed/reset against the hosted project.
-- Configure the app schema after loading the historical transit migrations.
CREATE SCHEMA IF NOT EXISTS api;
GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;

ALTER TABLE public.linien SET SCHEMA api;
ALTER TABLE public.haltestellen SET SCHEMA api;
ALTER TABLE public.steige SET SCHEMA api;
ALTER FUNCTION public.get_nearby_steige(double precision, double precision, integer)
  SET SCHEMA api;
ALTER FUNCTION api.get_nearby_steige(double precision, double precision, integer)
  SET search_path = api, public, pg_temp;

INSERT INTO api.linien (linien_id, bezeichnung, reihenfolge, echtzeit, verkehrsmittel, stand) VALUES
  (1, 'U1', 1, true, 'ptMetro', '2025-04-20'),
  (3, 'U3', 3, true, 'ptMetro', '2025-04-20'),
  (9, 'Fixture bus', 9, false, 'ptBus', '2025-04-20');
INSERT INTO api.haltestellen (haltestellen_id, typ, diva, name, gemeinde, gemeinde_id, location, stand) VALUES
  (101, 'Haltestelle', 60200001, 'Fixture Central', 'Wien', 90001, ST_Point(16.3738,48.2082,4326)::geography, '2025-04-20'),
  (102, 'Haltestelle', 60200002, 'Fixture East', 'Wien', 90001, ST_Point(16.3758,48.2082,4326)::geography, '2025-04-20'),
  (103, 'Haltestelle', 60200003, 'Fixture Far', 'Wien', 90001, ST_Point(17,49,4326)::geography, '2025-04-20');
INSERT INTO api.steige (steig_id, fk_linien_id, fk_haltestellen_id, richtung, reihenfolge, rbl_nummer, bereich, steig, location, stand) VALUES
  (1, 1, 101, 'H', 1, 111, 1, '1', ST_Point(16.3738,48.2082,4326)::geography, '2025-04-20'),
  (1, 3, 101, 'R', 1, 112, 1, '2', ST_Point(16.3739,48.2082,4326)::geography, '2025-04-20'),
  (2, 1, 102, 'H', 2, null, 1, '1', ST_Point(16.3758,48.2082,4326)::geography, '2025-04-20'),
  (3, 9, 101, 'H', 1, 113, 1, 'A', ST_Point(16.3738,48.2083,4326)::geography, '2025-04-20'),
  (4, 1, 101, 'R', 1, null, 1, '3', null, '2025-04-20'),
  (5, 1, 103, 'H', 3, 114, 1, '1', ST_Point(17,49,4326)::geography, '2025-04-20');
