import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { managedValue } from './environment.js';

const tables = ['linien', 'haltestellen', 'steige'];
let project: string;
try { project = new URL(managedValue('SUPABASE_URL') ?? '').hostname.split('.')[0]; }
catch { console.error('Configure SUPABASE_URL before inspecting the database'); process.exit(1); }
const candidates = [...new Set(['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL'].map(managedValue).filter((value): value is string => !!value))];
const caIndex = process.argv.indexOf('--ca');
const ca = caIndex >= 0 ? await fs.readFile(process.argv[caIndex + 1], 'utf8') : undefined;
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'supabase/baseline/transit-schema-current.json';
if (!output) throw new Error('--output requires a local filename');
let completed = false;
for (const connection of candidates) {
  let url: URL;
  let username: string;
  try { url = new URL(connection); username = decodeURIComponent(url.username); }
  catch { console.warn('Invalid database URI; check its format and percent-encoded password locally'); continue; }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    (url.hostname !== `db.${project}.supabase.co` && username !== `postgres.${project}`)) {
    console.warn('Skipped a database connection that does not match the selected Supabase project');
    continue;
  }
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(name);
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    application_name: 'viennaflow-readonly-schema-review', connectionTimeoutMillis: 8000, query_timeout: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const version = await client.query('SHOW server_version');
    const extensions = await client.query(`SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis'`);
    const columns = await client.query(`SELECT c.relname AS table_name, a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS not_null,
      pg_get_expr(d.adbin, d.adrelid) AS default_value, a.attidentity AS identity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`, [tables]);
    const constraints = await client.query(`SELECT c.relname AS table_name, k.conname AS name,
      pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1)
      ORDER BY c.relname, k.conname`, [tables]);
    const indexes = await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename, indexname`, [tables]);
    const functions = await client.query(`SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_nearby_steige' ORDER BY p.oid`);
    const policies = await client.query(`SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename, policyname`, [tables]);
    const rls = await client.query(`SELECT relname AS table_name, relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY c.relname`, [tables]);
    const grants = await client.query(`SELECT table_name, grantee, privilege_type, is_grantable
      FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, grantee, privilege_type`, [tables]);
    const functionGrants = await client.query(`SELECT grantee, privilege_type FROM information_schema.routine_privileges
      WHERE routine_schema = 'public' AND routine_name = 'get_nearby_steige' ORDER BY grantee, privilege_type`);
    const counts = await client.query(`SELECT 'linien' AS table_name, count(*) AS rows FROM public.linien
      UNION ALL SELECT 'haltestellen', count(*) FROM public.haltestellen
      UNION ALL SELECT 'steige', count(*) FROM public.steige`);
    const historyTable = await client.query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists");
    const migrationVersions = historyTable.rows[0]['exists']
      ? (await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row => String(row['version'])) : [];
    // Explain the function's SELECT directly: PL/pgSQL's outer Function Scan hides its spatial plan.
    const spatialPlans = [];
    for (const radius of [800, 5000]) {
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, TIMING FALSE, FORMAT JSON)
        SELECT s.steig_id, s.fk_linien_id, l.bezeichnung::text, s.fk_haltestellen_id, h.name::text, h.diva,
          s.richtung::text, s.rbl_nummer::bigint, ST_AsGeoJSON(s.location)::text
        FROM public.steige s JOIN public.linien l ON s.fk_linien_id = l.linien_id
        JOIN public.haltestellen h ON s.fk_haltestellen_id = h.haltestellen_id
        WHERE ST_DWithin(s.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
      [16.3738, 48.2082, radius]);
      spatialPlans.push({ radius, plan: plan.rows[0]['QUERY PLAN'] });
    }
    await client.query('ROLLBACK');
    if (!functions.rows.length || !columns.rows.length) throw new Error('Transit schema was not found');
    const baseline = { capturedAt: new Date().toISOString(), postgresVersion: version.rows[0]['server_version'],
      extensions: extensions.rows, tables: columns.rows, constraints: constraints.rows, indexes: indexes.rows,
      functions: functions.rows, policies: policies.rows, rls: rls.rows, grants: grants.rows,
      functionGrants: functionGrants.rows, counts: counts.rows, migrationHistoryExists: historyTable.rows[0]['exists'], migrationVersions, spatialPlans };
    const destination = path.resolve(output);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Recorded read-only transit baseline: ${tables.length} tables, ${functions.rows.length} nearby function(s)`);
    completed = true;
    break;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'QUERY_OR_CONNECTION_FAILED';
    console.warn(`Read-only database inspection failed (${code}); connection details are omitted`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
if (!completed) process.exitCode = 1;
