# Transit database

`baseline/transit-schema.json` records a read-only inspection of the hosted transit schema, grants, row counts, PostGIS version and spatial query plans. It contains definitions and aggregate counts, not credentials or account records. Transit data was imported manually. Authentication/profile schema remains outside this baseline.

[`certs/prod-ca-2021.crt`](certs/prod-ca-2021.crt) is the public Supabase Root 2021 CA certificate downloaded from Supabase Dashboard → Database Settings → SSL Configuration. It contains no private key or credentials and expires on 26 April 2031. From the repository root, run `npm run inspect:database -- --ca supabase/certs/prod-ca-2021.crt` to use it for database-server verification. See [Supabase's SSL documentation](https://supabase.com/docs/guides/platform/ssl-enforcement) for the certificate's purpose and download location.

The original baseline has 197 lines, 1,959 main stations and 7,362 platforms. All three transit tables had RLS disabled and granted anonymous/authenticated users write privileges. The nearby function used `ST_DWithin` on a geography column without a spatial index. Its captured inner SELECT scanned the platforms; the 800-meter sample returned 137 platforms before the API's metro filter. Its measured execution was 117 ms, and the 5,000-meter sample was 285 ms. These individual observations are not latency guarantees.

The migration sequence is:

1. `20261026000100_transit_baseline.sql`: existing transit tables, constraints, nonspatial indexes and nearby RPC, for a fresh database.
2. `20261026000200_transit_public_readonly.sql`: public SELECT policies and grants, administrator/service-role import privileges, and an explicit RPC search path. Only the three transit tables and their RPC are affected.
3. `20261026000300_transit_spatial_index.sql`: a GiST index on the existing platform geography column and refreshed platform statistics. The nearby query and results stay unchanged.

After explicit maintainer approval, migrations 2 and 3 were applied to the hosted project in one transaction, with unchanged nearby results verified as owner/anon/authenticated and administrator privileges checked before commit. The existing baseline was recorded as applied without executing CREATE TABLE. The original `20250612022830` history entry was preserved; it stores no SQL statements, represented by the explicitly empty legacy marker file. Account definitions remain outside the reproducible transit snapshot.

`baseline/transit-schema-after-refactor.json` captures the deployed result: RLS/read policies, public SELECT-only grants, the GiST index and migration versions. The 800-meter sample retains 137 platforms and measured 2.2 ms with the index; the 5,000-meter sample retains 2,794 platforms and stayed around 285 ms despite using the index. Do not infer a general latency guarantee or a broad-radius speedup from these samples.

For another existing project, verify its schema/history before recording the baseline as applied. Do not execute its CREATE TABLE statements against existing tables. Review [`db push --dry-run`](https://supabase.com/docs/reference/cli/supabase-db-push) before applying future migrations. Supabase also documents [migration history repair](https://supabase.com/docs/reference/cli/supabase-migration-repair).

Apply hosted changes only after the tested SQL and affected roles are reviewed. Verify the real anonymous-key nearby/line/stop API calls afterward, confirm admin imports and inspect the new spatial plan. Retain the public read policies and index when rolling back a frontend release; restoring anonymous write privileges is unnecessary for old read-only clients.

Run `npm run test:database` with Docker available. The script creates a disposable, localhost-only PostgreSQL 15/PostGIS 3.3 container from a pinned image digest, applies migrations and synthetic fixtures, and stops/removes that container afterward. It never reads managed database credentials or targets the hosted project. Initial setup requires downloading the public image.

`seed.sql` contains small synthetic local fixtures. The check adds 8,000 distant platforms to exercise index selection, compares results before/after, checks repeated station membership and null geometry, verifies read access, denies writes for both public roles, verifies RLS independently of table grants, exercises service-role imports, and preserves an unrelated account fixture. Its report is ignored at `tmp/transit-database-check.json`. Local PostGIS is 3.3.4 and hosted PostGIS is 3.3.7; the tests verify the shared contract across that patch difference. Fixture timings are not production benchmarks. Never seed/reset the hosted database.
