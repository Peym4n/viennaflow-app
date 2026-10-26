import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import pg from 'pg';

// Always create an isolated local database. Never consume a managed connection URI.
const exec = promisify(execFile);
const image = 'postgis/postgis:15-3.3@sha256:a2fc46b52819d25add4ed93d3da83e106e17ea3ace6883cce3791631c9820bb2';
const container = 'viennaflow-transit-check-' + randomUUID();
const password = 'local-transit-fixture-only';
let client: pg.Client | undefined;
let started = false;
const migrations = ['20261026000100_transit_baseline.sql', '20261026000200_transit_public_readonly.sql',
  '20261026000300_transit_spatial_index.sql'];
const sample = (lat = 48.2082, lon = 16.3738, radius = 800) => client!.query(
  'SELECT * FROM public.get_nearby_steige($1, $2, $3) ORDER BY fk_haltestellen_id, fk_linien_id, steig_id', [lat, lon, radius]);
const explain = async () => (await client!.query(`EXPLAIN (ANALYZE, TIMING FALSE, FORMAT JSON)
  SELECT * FROM public.steige WHERE ST_DWithin(location::geography,
    ST_Point(16.3738,48.2082,4326)::geography, 800)`)).rows[0]['QUERY PLAN'];

try {
  console.log('Starting an isolated PostgreSQL 15 / PostGIS 3.3 container');
  await exec('docker', ['run', '--rm', '-d', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`,
    '-p', '127.0.0.1::5432', image], { timeout: 300000 });
  started = true;
  const { stdout } = await exec('docker', ['port', container, '5432/tcp']);
  const address = /^127\.0\.0\.1:(\d+)\s*$/.exec(stdout);
  assert.ok(address, 'The fixture database must bind only to localhost');
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = new pg.Client({ host: '127.0.0.1', port: Number(address[1]), user: 'postgres',
      password, database: 'postgres', connectionTimeoutMillis: 1000, statement_timeout: 10000 });
    try { await candidate.connect(); client = candidate; break; }
    catch { await candidate.end().catch(() => undefined); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(client, 'The fixture database did not become ready');
  await client.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.profiles (id integer PRIMARY KEY, username text);
    INSERT INTO public.profiles VALUES (1, 'unrelated-account-fixture');
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;`);
  const accountSnapshot = async () => (await client!.query(`SELECT p.*, c.relrowsecurity, c.relacl::text
    FROM public.profiles p JOIN pg_class c ON c.oid = 'public.profiles'::regclass`)).rows;
  const accountBefore = await accountSnapshot();
  await client.query(await fs.readFile('supabase/migrations/20250612022830_legacy_history_marker.sql', 'utf8'));
  await client.query(await fs.readFile('supabase/migrations/' + migrations[0], 'utf8'));
  await client.query(await fs.readFile('supabase/seed.sql', 'utf8'));
  await client.query(`INSERT INTO public.steige (steig_id, fk_linien_id, fk_haltestellen_id, richtung,
      reihenfolge, bereich, steig, location, stand)
    SELECT n, 9, 103, 'H', n, 1, 'X', ST_Point(17 + (n % 100) * 0.0001,
      49 + (n / 100) * 0.0001,4326)::geography, '2025-04-20'::timestamp
    FROM generate_series(100,8099) n;
    ANALYZE public.linien; ANALYZE public.haltestellen; ANALYZE public.steige;`);
  const before = [await sample(), await sample(48.2082,16.3738,5000), await sample(0,0)];
  assert.equal(before[0].rows.length, 4, 'Include metro/bus platforms and repeated main stations; exclude null/far locations');
  assert.equal(before[0].rows.filter(row => row.fk_haltestellen_id === '101').length, 3);
  assert.deepEqual(JSON.parse(before[0].rows[0]['location']), { type: 'Point', coordinates: [16.3738,48.2082] });
  assert.equal(before[2].rows.length, 0);
  const beforePlan = await explain();
  for (const file of migrations.slice(1)) await client.query(await fs.readFile('supabase/migrations/' + file, 'utf8'));
  const afterPlan = await explain();
  assert.ok(JSON.stringify(afterPlan).includes('steige_location_gist_idx'), 'Use the spatial index for the selective query');
  assert.deepEqual((await sample()).rows, before[0].rows);
  assert.deepEqual((await sample(48.2082,16.3738,5000)).rows, before[1].rows);
  assert.deepEqual((await sample(0,0)).rows, before[2].rows);
  assert.equal((await client.query('SELECT * FROM public.get_nearby_steige(48.2082,16.3738)')).rowCount, 4);

  let deniedWrites = 0;
  for (const role of ['anon', 'authenticated']) {
    await client.query('SET ROLE ' + role);
    assert.deepEqual((await sample()).rows, before[0].rows, `${role} keeps the same nearby results`);
    for (const table of ['linien', 'haltestellen', 'steige']) {
      assert.ok((await client.query('SELECT * FROM public.' + table + ' LIMIT 1')).rowCount);
      for (const statement of [`INSERT INTO public.${table} SELECT * FROM public.${table} LIMIT 1`,
        `UPDATE public.${table} SET stand = stand`, `DELETE FROM public.${table}`, `TRUNCATE public.${table}`]) {
        await assert.rejects(client.query(statement), (error: unknown) =>
          !!error && typeof error === 'object' && 'code' in error && error.code === '42501');
        deniedWrites++;
      }
    }
    await client.query('RESET ROLE');
  }
  // RLS still protects data if a table write grant is added accidentally later.
  await client.query('GRANT INSERT ON public.linien TO anon; SET ROLE anon');
  await assert.rejects(client.query(`INSERT INTO public.linien VALUES (99,'Denied',99,false,'ptBus',now())`),
    (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === '42501');
  await client.query('RESET ROLE; REVOKE INSERT ON public.linien FROM anon; SET ROLE service_role');
  await client.query(`INSERT INTO public.linien VALUES (99,'Admin import',99,false,'ptBus',now());
    UPDATE public.linien SET bezeichnung = 'Admin updated' WHERE linien_id = 99;
    DELETE FROM public.linien WHERE linien_id = 99; RESET ROLE;`);
  assert.deepEqual(await accountSnapshot(), accountBefore, 'Keep unrelated account data/permissions unchanged');
  const versions = (await client.query('SELECT version(), postgis_lib_version() AS postgis')).rows[0];
  const report = { image, versions, fixturePlatforms: 8006, deniedWrites, unchangedNearbyRows: 4,
    beforePlan, afterPlan, scope: 'Synthetic local fixtures; not production performance measurements' };
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile('tmp/transit-database-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Transit database checks passed: unchanged RPC results, ${deniedWrites} denied public writes, RLS, admin imports, account isolation and GiST usage`);
} finally {
  await client?.end().catch(() => undefined);
  if (started && /^viennaflow-transit-check-[a-f0-9-]+$/.test(container)) {
    await exec('docker', ['stop', '--time', '1', container], { timeout: 20000 });
  }
}
