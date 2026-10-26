# ViennaFlow agent instructions

These instructions apply to the entire repository. Apply the architecture and Angular conventions below to new or substantially changed code, and keep refactors focused on the requested task. Preserve existing behavior while adopting these practices incrementally. Current implementation details and known limitations are documented separately from development guidance.

## Project overview

- ViennaFlow is a mobile-first Progressive Web App (PWA) that also supports desktop browsers.
- The interface centers on Google Maps, with a top navbar, logo, and responsive hamburger menu.
- The Angular frontend uses browser geolocation to display the user's location, transit lines, stations, live departures, and walking times.
- Vercel serverless functions in `api/` provide backend APIs. Supabase provides transit data, authentication, and user profiles; Upstash Redis supports caching and request coordination.
- Use Node.js `22.22.3` or a newer Node 22 patch, as required by both package manifests and `.nvmrc`. Angular is pinned to `22.2.3`. Consult `package.json`, `api/package.json`, and `package-lock.json` for other dependency versions.

## Architecture and responsibility boundaries

- Keep the app SPA-first: the root component owns layout, navigation, and the router outlet; feature pages belong behind routes, and reusable UI belongs in focused child components.
- Use shared API models and small local view-state types as the model layer. Components display state and delegate user intent; feature state/ViewModel services own shared state, API orchestration, derived rules, and business decisions. Simple presentation state can stay local to a component.
- Give each piece of shared state one owner. Expose read-only state and intention-based methods such as `selectStation`, `refreshDepartures`, and `clearSelection` rather than allowing consumers to mutate service state directly.
- Keep HTTP endpoint details and request mapping in `ApiService` or focused integration services. Keep Supabase authentication and profile access in their services. The current API layer uses handwritten `HttpClient` calls and shared TypeScript contracts.
- Wrap browser and third-party integrations in focused services. When extending or refactoring map rendering, move Google Maps SDK details behind a map facade that owns the map instance, polylines, markers, overlays, listeners, and their cleanup. Keep station-selection rules and departure orchestration in feature state services.
- Match service lifetime to ownership: scope map instances and feature subscriptions to the component or feature that owns them; use root-provided services for application-wide responsibilities.
- Initialize map rendering after both the map container and the Maps API are ready. Register browser listeners through lifecycle-aware code, with matching cleanup, rather than adding browser side effects during construction. Use platform guards where code may run outside the browser.

## TypeScript and API contracts

- Keep TypeScript and Angular template checking strict. Prefer inference when the type is obvious, and avoid introducing `any`; use `unknown` with explicit narrowing for uncertain external values.
- Backend TypeScript uses NodeNext module resolution. Include `.js` extensions in relative imports in API handlers, server helpers/tooling and shared modules so compiled functions load in Node ESM. TypeScript and the local `tsx` runner resolve these imports to their `.ts` sources; keep the backend compiler check aligned with the deployed runtime.
- Reuse and extend `types/api-models.ts` for contracts exchanged by the frontend and backend. Keep local UI state types separate from transport contracts, and avoid duplicate response interfaces in services and components.
- Validate external data at the integration boundary. A TypeScript interface, generic `HttpClient` response type, or type assertion does not validate runtime data. Check fields used for station IDs, DIVA identifiers, coordinates, and departure rendering before consuming them.
- Keep transformations predictable and immutable where practical. Separate request/response mapping, domain calculations, and presentation formatting so each can be tested independently.
- Follow `.editorconfig`: UTF-8, two-space indentation, a final newline, and single quotes in TypeScript. Match surrounding formatting in existing files.
- Write comments in English by default. Use German in files that already use German comments, such as `api/getStops.ts`.

## Angular components and state

- Prefer standalone components. Standalone is the default; omit redundant `standalone: true` in new components, while leaving existing declarations alone during unrelated changes.
- Keep components focused. Pass data to reusable children through inputs and receive user intent through outputs; children should not reach into parent or sibling state.
- Prefer `input()` and `output()` for new component contracts, mark required inputs explicitly, and use input transforms for boundary coercion rather than business rules. Existing decorator-based contracts remain supported.
- Prefer `inject()` for new Angular dependencies in a valid injection context. Preserve working constructor injection unless the task calls for changing it.
- Prefer signals for new synchronous UI/application state, `computed()` for derived values, and private writable state with read-only public access. Use `set()` or `update()` and replace changed collections so updates are observable. Keep existing RxJS state usable during incremental changes.
- Derive values from their source instead of maintaining duplicate state. Use `effect()` sparingly for external side effects such as updating the map or browser storage; avoid effects that propagate state or write to their own dependencies.
- Prefer `ChangeDetectionStrategy.OnPush` for new or substantially revised components when signals, async bindings, and external callback handling make updates observable to Angular. Verify that Google Maps and geolocation callbacks still update the UI.
- Prefer typed reactive forms, with validation and useful field-level feedback. Keep request mapping and nontrivial business rules outside templates.
- Prefer the decorator's `host` object for new host bindings and listeners. Keep unrelated decorator migrations out of focused changes.

## RxJS and asynchronous work

- Use Observables for HTTP, geolocation, router streams, events, and polling. Keep pipelines declarative and avoid nested subscriptions for dependent workflows.
- Choose concurrency deliberately: `switchMap` for latest-selection/location results, `mergeMap` for independent parallel work, `concatMap` when order matters, and `exhaustMap` when overlapping triggers should be ignored. Preserve polling and request-throttling guarantees.
- Use the `async` pipe for values only displayed in templates. Use `toSignal()` when a stream becomes synchronous feature state or participates in computed state; create and reuse the conversion within its owning lifetime.
- Prefer `takeUntilDestroyed()` with the appropriate `DestroyRef` for long-lived subscriptions. Keep explicit cancellation for polling restarts and station-set changes; component destruction alone does not cover these transitions.
- Retain the same function reference when adding and removing listeners. Clean up browser listeners, geolocation watches, map listeners, timers, and subscriptions when their owner ends or the resource is replaced.
- Expose loading, success, empty, error, and stale-data states where relevant. Keep a failed departure request distinguishable from a successful response with no departures, and prevent older responses from overwriting newer selections.
- Configure `shareReplay` lifetime, ref counting, and invalidation deliberately. Cached streams must not hide stale data, leak polling, or change signing-session initialization behavior accidentally.

## Templates, navigation, and performance

- Keep template expressions simple and side-effect free. Avoid calls that trigger I/O, mutate state, or allocate heavily. Use pure, lightweight pipes for display formatting and services/helpers for business rules.
- Prefer `@if`, `@for`, and `@switch` in new or substantially revised templates. Give `@for` a stable domain key, such as the station ID, and provide intentional empty states.
- Prefer `routerLink` and `routerLinkActive` for ordinary navigation. Use programmatic navigation when it performs application logic, such as coordinating a menu action.
- Prefer `loadComponent` for new secondary routes and when revising authentication, profile, or about routing. Preserve the initial map experience and evaluate the loading cost of the primary route separately.
- Use `@defer` for optional, noncritical UI when it improves loading, with useful placeholder and loading states. Keep the main map available during the primary app flow.
- Reuse Angular Material, existing CSS/SCSS, and established theme styles. Prefer `NgOptimizedImage` for suitable static image elements, with explicit sizing; keep SDK-generated images within their integration's rendering lifecycle.

## Accessibility

- Follow WCAG AA expectations for changed UI: semantic controls, meaningful labels, visible keyboard focus, adequate contrast, and usable touch targets. Convey line and status information with text as well as color.
- Provide keyboard access to station selection, overlay close controls, map controls, and navigation. Manage focus when interactive overlays or menus open and close, including restoring focus where appropriate.
- Associate form errors with their fields and expose meaningful loading, location-error, and departure-status messages to assistive technology. Avoid announcing every polling update unnecessarily.
- Include custom Google Maps overlay HTML in accessibility checks; it is outside ordinary Angular template rendering. Use automated accessibility checks where available and verify keyboard interaction manually. Report which checks actually ran.

## Testing and verification

- Add or update tests alongside changes with clear behavioral value: state transitions, station deduplication and selection, polling cancellation, walking-time thresholds, forms, request mapping, API validation, error handling, and resource cleanup.
- Test observable behavior and public contracts. Prefer meaningful success, failure, and edge cases over private implementation assertions, creation-only checks, or test-count targets. Exercise real teardown behavior in cleanup tests.
- Mock HTTP, Supabase, Redis, Google Maps, geolocation, and browser integrations. Unit tests must not depend on live services, map tiles, credentials, or a running backend. Use controlled timers for polling and movement-update behavior.
- Cover signature validation, session expiry, cache/queue behavior, and third-party failures when changing the corresponding backend logic. Run server-side tests in an appropriate Node environment.
- Run relevant specs while iterating, `npm test` after changing tests, and `npm run build` after application implementation changes when required configuration is available. Choose checks appropriate to the affected frontend or backend code.
- Report failed checks, existing failures, and missing prerequisites accurately. If a change has no useful unit-test case, explain why; documentation or pure styling changes do not require superficial tests or an application build.
- Use the npm test scripts and current test setup described below. There is no root lint script; only report a lint check if a concrete tool was executed.

## Repository layout

- `src/app/core/services/`: API access, Google Maps loading, geolocation, signed sessions, authentication, profiles, and Supabase clients.
- `src/app/features/map/`: departure/walking state, ordinary station/card view models, and the feature-scoped Google Maps facade. `components/map-view/` coordinates startup/location and user intent; `components/station-card/` renders accessible departure cards.
- `src/app/features/profile/`: profile management UI.
- `src/app/auth/`: signup, login, and password recovery/reset UI.
- `src/app/shared/components/navbar/`: responsive navigation and current-user display.
- `types/api-models.ts`: shared frontend/backend transit and monitor types. Both TypeScript configurations map `@shared-types/*` to `types/*`; backend code also uses relative imports into this directory. Update shared contracts here rather than creating separate frontend and backend copies.
- `api/`: serverless functions and static transit data, including `lineStops.json`.
- `server/`: backend-only helpers and the local API/production-preview runner. Import Redis and other server integrations here or from API handlers; never from frontend modules. Helpers are separate from `api/` so they do not become serverless endpoints.
- `shared/`: runtime contract validation usable by both frontend and backend; keep it free of server dependencies and credentials.
- `data/transit/catalog-source.json`: versioned transit source with curated display coordinates and separate physical walking destinations. Regenerate `api/lineStops.json` with `npm run generate:transit`; preserve the coordinate rules in `data/transit/README.md`.
- `scripts/environment.js` and `scripts/generate-env.js`: select/validate configuration and generate the frontend environment module.
- `public/`, `ngsw-config.json`, and the production configuration in `angular.json`: PWA assets and service-worker configuration.
- `supabase/`: CLI configuration, captured transit baseline, transit migrations and synthetic local fixtures. See `supabase/README.md` before database work. Account schema/triggers/policies remain unversioned and outside the transit migration scope.

## Project commands and local configuration

Run commands from the repository root. The root npm workspace includes `api/`.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies from the committed lockfile. |
| `npm run generate-env` | Generate `src/environments/environment.ts` from dotenvx-managed values. |
| `npm run dev` | Start the direct local API runner and wait for its health endpoint before starting Angular. |
| `npm run dev:frontend` | Generate browser configuration and start Angular with full reloads. |
| `npm run dev:backend` | Run the API handlers directly with `tsx watch server/dev.ts`. |
| `npm run build` | Generate the environment module and build Angular with its default production configuration. |
| `npm run build:staging` / `npm run build:production` | Build using the explicitly selected managed configuration. |
| `npm run generate:transit` | Validate the transit source and regenerate the API catalog deterministically. |
| `npm run inspect:database -- --ca <path>` | Capture transit schema definitions in a read-only, TLS-verified database transaction. |
| `npm run preview` / `npm run preview:serve` | Build/serve or serve an existing production PWA with actual local API handlers on port 4300. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:frontend -- src/app/core/services/location.service.spec.ts` | Run an individual spec; substitute the relevant path. |
| `npm run test:backend` | Run backend tests in Node. |
| `npm run test:database` | Test transit migrations, RPC results, public read/admin write permissions and spatial index usage in a disposable local Docker database. |
| `npm run typecheck:backend` | Check the API's own TypeScript configuration, then handlers, local tooling and server tests. |
| `npm run typecheck:tests` | Check frontend test types and imported code. |
| `npm run check` | Run all tests, type checks, and the production build. |
| `npm run dev:backend:vercel` | Run Vercel CLI for platform-specific verification. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:coverage` | Generate V8 coverage reports. |

- The direct local API runner requires no Vercel login. Vercel-specific checks require its CLI and a linked project. Environment decryption requires the maintainer-provided key, as described in `README.md`.
- Frontend startup generates the environment module. Development uses `--no-hmr` because template replacement can detach the Google Maps host while retaining its SDK instance.
- Angular serves on `http://localhost:4200`. `proxy.conf.json` forwards `/api` requests to `http://localhost:3000`.
- `vitest.config.ts` and `src/test-setup.ts` configure isolated frontend tests with nonsecret environment fixtures. Use supported injection contexts/provider doubles without replacing Angular core globally. `vitest.backend.config.ts` runs server specs under Node.

## Current implementation details

The following sections describe the current map behavior, backend contracts, configuration, and authentication flow. Preserve these contracts unless the requested task changes them, and update this file when their implementation changes.

### Map behavior and overlays

- Preserve the responsive map interface, transit-line rendering, station markers, and user-location marker.
- Nearby results represent individual platforms or transit points (`Steige`). Link each result to its main station (`Haltestelle`) using `fk_haltestellen_id`, and use `haltestellen_diva` to request monitor data.
- Deduplicate nearby highlights and overlays by main station ID, even when several nearby platforms belong to the same station. Keep station IDs and DIVA identifiers distinct when matching monitor data and updating overlays.
- Keep the nearby search radius at 800 meters. From eligible main stations, preload departures and walking estimates for up to three closest stations, ranked by physical coordinates with station ID as the distance tie-breaker. Do not extend the radius to reach three. Keep their dots visible independently of card visibility.
- Show one station card on desktop and mobile: the closest nearby station by default, or the explicitly selected station. Clicking or choosing the closest station restores default mode without a close button; other selections remain dismissible. Closing explicit selection returns to the closest nearby station. Size cards to their content while bounding them to the map viewport; preserve the selected station independently of nearby polling membership. Focus the card's title when it has no close control.
- Fetch and process updated nearby data before replacing its highlights and overlays. Remove stale map objects and listeners, and avoid duplicate overlays or polling subscriptions. Preserve the separate handling of nearby stations and explicitly clicked stations.
- Use custom HTML overlays for detailed station information and departures. The current station-click handler also creates a custom overlay; do not assume ordinary station clicks use only default InfoWindows.
- Define overlay subclasses through `createCustomMapOverlayClass` in `custom-map-overlay.ts`, after the Google Maps API has loaded. Do not define a subclass of `google.maps.OverlayView` at module load time.
- Keep the Google Maps `geometry` library loaded through `GoogleMapsService`; movement detection depends on its distance calculations.
- Walking durations come from `ApiService.getSecureWalkingMatrix()`, not a browser-side call using the server API key. Preserve updates when the monitored station set changes and when movement exceeds the existing 50-meter threshold.
- Preserve walking-time/location tracking and the overlay display of walking minutes, the `directions_walk` icon, and loading, error, and empty-departure states.
- Use safe DOM construction for custom overlays: insert external text with `textContent` where possible, or explicitly escape/sanitize it before inclusion in HTML. Angular template escaping does not protect strings assigned directly to an overlay's `innerHTML`.

### Backend APIs

Keep frontend calls and backend request/response contracts consistent. Browser-facing URLs omit the `.ts` extension.

| Function | Responsibility |
| --- | --- |
| `api/getLineStops.ts` | Serve line metadata, stop data, and line geometry from `api/lineStops.json`, optionally filtered by `linien_id`. |
| `api/getLines.ts` | Query Supabase `linien` for metro line metadata. |
| `api/getStops.ts` | Query main stations by line, station IDs, or the default metro selection; convert WKB geometry to GeoJSON. |
| `api/getSteige.ts` | Query platforms for a main station and convert WKB geometry to GeoJSON. |
| `api/getNearbySteige.ts` | Call the Supabase `get_nearby_steige` RPC with latitude, longitude, and radius; filter platforms against the allowed line IDs from `lineStops.json`. |
| `api/routes/monitor.ts` | Primary live-departure endpoint, accepting POST requests with `divaIds`; batch and throttle Wiener Linien OGD requests using caching, distributed locks, and a pending-request queue. |
| `api/session/init.ts` | Initialize the request-signing session using a `sessionId` cookie and a Redis-backed signing key. |
| `api/routes/walking-matrix.ts` | Accept signed POST requests and calculate walking durations through the Google Distance Matrix API using a server-side key. |

- Preserve the monitor endpoint's U-Bahn filtering for U1, U2, U3, U4, and U6, its limit of three departures per line, and aggregation of monitors belonging to the same station.
- Departure delivery uses focused helpers in `server/`: a shared Redis-time gate, owned lease, bounded pending queue and per-station cache with original fetch timestamps. Preserve the minimum 15-second provider interval and pending/empty/stale/error distinctions. Memory caching is an explicit development/test option only; production Redis failure returns a retryable response. Signing sessions and walking estimates require Redis.
- `vercel.json` defines function builds, execution durations, API rewrites, and the SPA fallback. With `cleanUrls` enabled, the SPA fallback targets `/index`; `/index.html` is not a valid rewritten destination. Keep API namespaces and file requests outside the fallback. Verify hosted API routing, frontend deep links and missing-asset responses when changing it.
- Map integration errors into useful UI state. Do not render raw backend stack traces, internal request details, or third-party error objects in components or overlays.

### Environment configuration and request signing

- Use dotenvx for encrypted `.env`, `.env.staging`, and `.env.production` files. Follow the existing `dotenvx.get()` pattern for managed values and keep development, staging, and production configuration separate.
- `VIENNAFLOW_ENV` selects one managed environment explicitly, defaulting to development; Vercel preview selects staging. Platform variables take precedence. Use the shared configuration helper and never fall back to another environment's credentials. Browser generation validates required public values and serializes them with `JSON.stringify`.
- Never commit decrypted credentials or `.env.keys`. The Husky pre-commit hook checks root `.env*` files for unencrypted values, except dotenvx public-key entries and the ignored key file.
- `src/environments/environment.ts` is generated and ignored by Git. Change `scripts/generate-env.js` or the managed configuration instead of editing the generated file.
- Treat values emitted into the frontend environment module as browser-visible configuration. Keep `GOOGLE_MAPS_SERVER_API_KEY`, Redis credentials, and other server secrets out of frontend modules and bundles.
- Keep credentials, authentication sessions, signing keys, and access/refresh tokens out of logs and user-facing error messages.
- `SessionService.ensureSessionSigningKey()` shares `/api/session/init`, keeps its key in memory until expiry, and renews when needed. Walking requests may retry once after a 401. This signing session is separate from Supabase user authentication.
- The backend reuses Redis signing sessions for their remaining 24-hour lifetime and returns expiry metadata. Concurrent tabs renewing the same expired cookie share a new key through NX plus reread. Preserve HttpOnly, Secure, SameSite=Strict cookie protections and the bounded legacy-key compatibility window.
- `ApiService.getSecureWalkingMatrix()` signs `timestamp + '.' + JSON.stringify(payload)` with native Web Crypto HMAC-SHA256. It sends the hexadecimal signature in `X-Signature` and the Unix timestamp in seconds in `X-Timestamp`.
- The backend reconstructs the same message and checks the cookie, Redis session, timestamp, and signature before calling Google. Its timestamp acceptance window is five minutes. Keep client/server serialization and signing logic synchronized.

### Authentication and profiles

- Preserve email/password signup, email-confirmation guidance, login, logout, and password recovery/reset flows. After successful signup, the UI hides the form and prompts the user to check their email.
- `AuthService` manages Supabase authentication state. `ProfileService` loads the current user's profile and updates their username.
- `AuthService` obtains `ProfileService` lazily through Angular's `Injector` to avoid their circular dependency. Account for this dependency when refactoring either service.
- The profile UI displays the email and allows username changes. The navbar prefers the username, then the user's email, with a generic profile label as a final fallback.
- The documented database design includes `public.profiles` with an `id` referencing `auth.users.id`, a unique username, and an email; a `handle_new_user` trigger creates profiles from new auth users and optional username metadata.
- Preserve user-specific access through Row Level Security for `profiles` and `user_favorite_stations`. Verify the deployed policy and trigger definitions before relying on or changing them; their definitions are not versioned in this repository.

## Known limitations and assumptions

- `MapViewComponent` owns startup/nearby orchestration and selection intent. `GoogleMapFacade` owns SDK maps, polylines, markers, overlays, listeners and mounted Angular card views. `StationDepartureState` owns departure membership, cache/status and polling; `WalkingTimes` owns cancellable walking requests and the movement threshold. Station identity/ranking is independent of marker instances.
- Station cards use one OnPush Angular component with signal inputs and typed outputs. Update its existing component reference during polling; preserve focus and selection across responsive changes. Mobile cards dock within the viewport; desktop overlays use bounded collision placement and reserve room for map controls.
- `ApiService` validates monitor responses before exposing the shared `MonitorApiResponse` contract. Match monitors by canonical DIVA in `locationStop.properties.name`; platform RBL values are separate identifiers.
- `AuthService` sets `autoRefreshToken: false` as a temporary lock-debugging workaround. Investigate this when changing session handling. `AuthService` and `SupabaseService` also create separate clients; account for their interaction during auth changes.
- Transit table definitions, grants, the nearby RPC and spatial query plans are captured in `supabase/baseline/transit-schema.json`, with tested migrations and synthetic fixtures. Inspect the existing project's migration history before applying a baseline to it; never recreate populated tables or seed hosted data. Profile/authentication triggers and policies remain unverified and unversioned; the account database description above records expected setup only.
- Local `vercel dev` routing has historically required troubleshooting. Reproduce current behavior before claiming a routing problem is fixed or still present.
- Frontend unit tests use Angular compiler JIT and real injection contexts without Zone testing or global Angular injection mocks; test-file isolation is enabled. `testing/angular-jit.ts` uses the installed Angular CLI JIT transform for signal contracts/DI and inlines external component resources. Rendering tests use TestBed with zoneless change detection and mocked integrations. Vitest is the sole configured test runner.
