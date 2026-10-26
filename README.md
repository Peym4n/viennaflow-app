# ViennaFlow
Real-Time Transit, Effortless Journeys!

## Prerequisites

Use Node.js 22.22.3 or a newer Node 22 patch and npm (`.nvmrc` records the minimum). Local development runs the existing API functions directly; Vercel login is only needed when checking Vercel-specific behavior or deployment.

## Getting started

1. Run `npm ci` from the repository root.
2. Obtain the environment decryption key from a maintainer and keep it in the ignored `.env.keys` file. Never commit this file or decrypted credentials.
3. Run `npm run dev`; frontend startup generates and validates browser configuration automatically.

Angular serves the app at `http://localhost:4200`. Its `/api` proxy points to the local API runner at `http://localhost:3000`; `/health` reports runner readiness. The runner uses the actual handlers and configured external providers. It does not emulate Vercel routing or replace unavailable Supabase/Redis services.

Use `npm run dev:frontend` or `npm run dev:backend` to run one service separately. Changes reload automatically. To check Vercel behavior, install its CLI, log in/link the project, and run `npm run dev:backend:vercel` instead of the direct runner. Both backends use port 3000, so run only one.

Local Angular development uses full reloads (`--no-hmr`): template replacement otherwise detaches the Google Maps container while retaining its SDK instance. Map data and credentials still come from the selected local configuration.

## Environments and transit data

`VIENNAFLOW_ENV` selects `development` (`.env`), `staging` (`.env.staging`), or `production` (`.env.production`). The default is development. On Vercel, preview maps to staging and production maps to production unless explicitly overridden. Platform environment values take precedence; configuration never falls back to a different environment file. Use `npm run build:staging` or `npm run build:production` for an explicit local build target. Server configuration uses the same selection.

Browser generation fails on missing required values, rejects server Supabase keys, and serializes only the public Maps key/map ID and Supabase URL/anonymous key. Keep the server Maps key and Redis/database credentials out of browser modules.

The versioned transit source and its coordinate rules are described in [data/transit/README.md](data/transit/README.md). Run `npm run generate:transit` after editing that source. Marker display coordinates are separate from physical walking destinations.

`npm run inspect:database -- --ca supabase/certs/prod-ca-2021.crt` records the deployed transit schema, constraints, indexes, nearby RPC, transit policies/grants and bounded spatial query plans in a read-only transaction. It verifies TLS and does not change the database or read account records. The public Supabase CA certificate is included under `supabase/certs/`; its source is Supabase Dashboard → Database Settings → SSL Configuration. See [supabase/README.md](supabase/README.md) for certificate details, the captured baseline, tested migrations, local fixtures and hosted rollout requirements.

New inspections write `supabase/baseline/transit-schema-current.json`; use `--output <path>` for another snapshot. The original and post-refactor snapshots are retained separately.

For this local inspection, store the Supabase Connect → Session pooler → URI value in encrypted `POSTGRES_URL_NON_POOLING`. Replace the password placeholder locally and percent-encode reserved password characters. The variable name is retained for configuration compatibility; the script also accepts a session-pooler connection. The running app continues using the Supabase Data API.

## Checks

- `npm test`: isolated frontend tests followed by Node backend tests.
- `npm run test:frontend -- path/to/file.spec.ts`: one frontend spec.
- `npm run test:backend`: backend tests.
- `npm run test:database`: isolated migration/RPC/permission/spatial-index checks in a disposable Docker database; uses synthetic fixtures and no service credentials.
- `npm run typecheck:tests`: frontend tests and their imported code.
- `npm run typecheck:backend`: the API's own TypeScript configuration, followed by handlers, local tooling and backend tests. Both use NodeNext resolution to enforce runtime-compatible ESM imports.
- `npm run build`: generate browser configuration and build production assets; requires local environment configuration.
- `npm run check`: all tests, type checks and the production build.
- `npm run preview`: build and serve the production PWA and local API handlers together on `http://localhost:4300`.
- `npm run preview:serve`: serve an existing production build on port 4300. This verifies local assets, deep links, and service-worker behavior; deployed Vercel routing still needs its own checks.

Unit tests use nonsecret configuration and mocked external integrations; they require neither service credentials nor running servers. Angular rendering specs use the installed CLI JIT transform for signal contracts/DI, real component templates and zoneless TestBed. Browser tests use Chrome DevTools MCP against the local app. Android installed-PWA gesture, install/update, and offline behavior require separate device verification. CI runs checks with nonsecret browser configuration and reviews production dependency vulnerabilities.

## Transit delivery and walking limits

Development and staging currently share a nonproduction Redis database; production uses a separate database. The shared database also shares departure caches, request coordination and the daily walking budget. Update the encrypted local values with `npx --no-install dotenvx set UPSTASH_REDIS_REST_URL "<nonproduction REST URL>" -f .env` and the corresponding `UPSTASH_REDIS_REST_TOKEN`, then restart the backend. Manage staging values in `.env.staging` and matching Vercel Preview variables explicitly; changing one file does not update the other configuration. Values stay encrypted; do not copy production credentials into local configuration. To inspect decrypted development values in your own terminal without changing the file, run `npx --no-install dotenvx get -f .env`.

Departure delivery uses shared Redis coordination and a minimum 15-second provider interval. Redis failure returns retryable errors rather than bypassing coordination. A process-local departure cache can be selected explicitly with `NODE_ENV=development` and `VIENNAFLOW_LOCAL_CACHE=memory`; it is rejected on Vercel/production and does not replace the Redis requirement for walking sessions.

Walking estimates preserve the HMAC contract, renew expired sessions, and use an eight-second provider deadline. The approved initial-release application limits are 10 requests per session per minute and 2,000 billable matrix elements per UTC day across the configured database. `WALKING_SESSION_REQUESTS_PER_MINUTE` and `WALKING_DAILY_ELEMENT_LIMIT` configure these caps. They do not change Google billing settings; provider billing/quotas still need review before deployment.

## Release verification and rollback

Use a Vercel preview with staging configuration before promoting a release. Keep a record of the previous deployment URL and its matching configuration; do not change production configuration or database definitions as part of a frontend rollback.

- Run `npm ci`, `npm run check` and `npm audit --omit=dev --audit-level=high` with the supported Node version. Generate the transit catalog and confirm that a second run produces no diff.
- On the preview, verify API JSON and methods, `/about` as a direct deep link, manifest/icons/fonts/compiled asset content types, and a missing asset returning 404. Check the deployed routes separately from the direct local runner.
- Compare the five lines, 98 station identities, directions, countdowns and walking results with the baseline. Exercise cold/warm/rapid station switching, API failure, location recovery and navigation away from the map. Inspect bounded request counts, pending/stale/error metrics and provider quotas.
- Test a service-worker-controlled update from the previous version, then reload, reopen, resume and offline shell behavior. Check one-finger drag and pinch zoom in installed Android Chrome and Brave PWAs. Live departures/walking remain unavailable offline; private and signed responses must not enter service-worker caches.
- Promote only after the remaining acceptance gates in [REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md) pass. If verification fails, restore the prior Vercel deployment, then verify its API routes and a controlled PWA reload. Existing tabs may retain a cached client, so verify both retained and newly loaded clients.

Departure cache entries use the separate `viennaflow:departures:v2:` namespace. Signing keys use `viennaflow:signing:v2:`; the backend accepts legacy signing keys only for their remaining original lifetime. Retain that compatibility during rollout, avoid clearing session/cache databases, and verify one-time session renewal when testing a rollback. Record hosted preview, promotion and rollback verification separately in [REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md).
