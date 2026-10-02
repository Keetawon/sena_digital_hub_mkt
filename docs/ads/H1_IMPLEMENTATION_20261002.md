# H1 local implementation and verification

Date: **2 October 2026 (Asia/Bangkok)**. Scope: [doc 27](../27-hosted-test-environment.md), including the owner's production-path and H1/H2 additions. Baseline commit: `2b21780`. The owner has authorized committing and pushing H1; hosted execution still awaits IT-readiness confirmation.

## 1. Delivered H1 boundary

- A reviewed 25-migration managed-permission profile, with a settings-table variant of `0014`. Canonical local `0014` is unchanged. The profile records both canonical and executed SHA-256 hashes and refuses changed or foreign history.
- Shared migration `202610020025_hosted_h1_adapters.sql` adds narrow residential environment and private asset metadata adapters. Original guards for actuals, archive and assistant remain closed outside local mode.
- Supabase browser/SSR sign-in, refresh and sign-out, server-verified callers, independently verified API JWTs and seven simulated role identities. Hosted mode rejects the local role selector, forged roles and demo tokens.
- Private asset upload, read and preview through bearer-authenticated API calls. SVG sanitization, rights records, binding history, audit, safe MIME/CSP and per-file access remain in place. No direct browser upload bypasses validation.
- A wholly fictional brand, project, model and promotion; three generated image assets; one atomic release; two seeded campaign examples for KIN and COMBAY. No HYABC/REM identifiers or other real source data are copied.
- Registry browsing and the agency ID-return inbox. IDs remain text, including leading zeros; agencies see only their own registrations.
- Deferred hosted finance/actuals, document tracking, archive and assistant pages carry a Thai H1/H2 availability remark. Their direct API paths are blocked; no document worker is started.

Both `sena_h_approved` and `hosted_test_issuing_enabled` remain **false**. The SQL fixture is inserted by the deployment operator with explicit synthetic provenance, using server-generated codes and names; it never calls issuance or changes either flag. No RAG, indexing, embeddings or ingestion was added.

## 2. Files and operational design

| Area | Main files |
|---|---|
| Migration compatibility | `scripts/supabase-test-migrations.mjs`, `supabase/hosted-test/profile.json`, `supabase/hosted-test/202609290014_ads_registry.settings-v1.sql`, migration `0025` |
| Disposable simulation | `scripts/simulate-hosted-test.mjs`, `scripts/run-hosted-h1.mjs`, `scripts/hosted-test-mock.mjs`, `scripts/hosted-test-fixtures.mjs` |
| Synthetic seed | `scripts/hosted-test-seed.mjs`, `supabase/hosted-test/h1-seed.sql` |
| API | `auth.py`, `main.py`, `hosted_assets.py`, `ads.py`, `promotions.py` under `apps/api/sena_hub_api/` |
| Admin | `apps/admin/proxy.ts`, `app/login/`, `lib/hosted-config.ts`, `lib/hosted-session.ts`, `components/hosted-session.tsx`, `components/private-assets.tsx`, existing page/asset components |
| Checks | `supabase/tests/hosted_h1.sql`, migration/profile and Auth-double Node tests, `apps/api/tests/test_hosted_h1.py`, `tests/ui/hosted-h1.spec.ts`, DB test runner |
| Documentation/configuration | doc 27, this report, root/admin package manifests and admin lockfile, `.gitattributes` |

The local simulation owns only loopback PostgreSQL `55434`, Auth/Storage `54329`, API `8001` and admin `3001`. Its migration operator has managed-style permissions and no custom-parameter grant. The real project reference is used as a private profile identity fixture; log lines naming it do **not** mean a remote connection occurred. The simulator never reads `.env.supabase-test`.

Private connection metadata stays under ignored `.local/hosted-test-simulation/`. The Auth/Storage service is a local protocol double with fictional accounts and credentials, not a deployable Auth service. It models the documented concurrent refresh reuse interval. Actual Supabase Auth configuration, Storage policies and cloud networking still require hosted acceptance after the readiness gate.

Migration execution restores temporary owner grants and schema privileges, preserves the runtime password on replay and rolls back DDL plus history on failure. Seed application is transactional and journalled with a checksum/manifest; exact replay is a no-op and retains subsequent demo edits. Temporary seed policies and actor memberships are restored before commit. SQL deployment files have stable checkout bytes for checksum comparison.

The production path in doc 27 reuses the settings-based bootstrap design with an explicitly approved production profile: no TEST setting key or override, no synthetic seed, and actual SENA-H approval required. Production provisioning is not implemented here.

## 3. Verification on this workstation

All commands below target local databases or loopback doubles. No hosted preflight, SQL, bucket creation, Auth user creation, invitation, deployment or purchase was run.

| Command/check | Real result |
|---|---|
| `npm.cmd run typecheck --prefix apps/admin` | Exit 0. |
| `npm.cmd run build --prefix apps/admin` | Exit 0; existing Google Sans fallback warning, below. |
| `npm.cmd run dev:migrate` | Applied `0025` to the normal local database only; canonical `0014` skipped unchanged. |
| `npm.cmd run test:db` | Exit 0; SQL/RLS and concurrency suites, including new local/H1 compatibility checks, passed. |
| `uv --cache-dir .cache/uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests` | **1204 passed, 11 skipped, 1 warning in 194.16s**. Opt-in integration skips are not recorded as passes. |
| Focused H1 API boundary suite | **63 passed**. |
| Opt-in H1 API integration against the disposable database | **1 passed, 63 deselected**. |
| `npm.cmd run test:hosted-h1` | Exit 0; **10 Node tests passed**, 25 migrations and managed-permission/seed checks passed, **14 Edge tests passed (34.0s)**. |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm.cmd run test:ui` | Exit 0; **158 passed, 14 skipped (7.8m)**. The 14 H1 tests are intentionally skipped here and passed separately against the isolated H1 target. |

The managed-permission simulation emitted these actual checks during the fresh run:

```text
PASS: managed login reproduces 42501; no custom-parameter privilege is granted.
PASS: all migrations apply without superuser; canonical/variant hashes, exact replay, password retention, rollback and restored owner ACLs verified.
PASS: caller-forged GUC ignored; runtime/agency cannot enable flags or assume owners; H1 residential allowed while original deferred guard stays closed.
PASS: synthetic H1 seed and harmless replay; issuance flags remain false.
```

The H1 Edge coverage exercises all seven identities, login/logout, expired-session refresh, forged metadata/JWT rejection, safe return URLs, H2 denial, agency isolation, ID returns, private SVG upload and authenticated previews. Desktop/mobile sizes are **1366 × 768** and **390 × 844**. Visual inspection also checked both sizes; screenshots remain in ignored `artifacts/h1-ui/`.

Initial checks exposed and fixed a return-URL control-character redirect, missing bearer delivery for favicon previews, a damaged Thai message, overly strict refresh behavior in the test double and lazy-image test timing. Running the H1 and normal Edge suites concurrently initially collided in the shared Playwright artifact directory (`ENOENT` while closing traces). H1 now uses its own `artifacts/playwright-h1/` directory; the interrupted/failed runs are not counted as passes.

Existing non-failing warnings: Next reports no Google Sans font override and skips generating its fallback; pytest reports Starlette's deprecated AnyIO portal alias. The installed Next version's existing npm audit advisory was not resolved through an unrelated framework upgrade; review it before hosted deployment.

## 4. Local demo and next gate

```powershell
npm.cmd run build --prefix apps/admin
npm.cmd run dev:hosted-h1
```

Open `http://127.0.0.1:3001/login`. The seven fictional `hub-test-…@example.test` identities and clearly labelled local-only fixture password are in `scripts/hosted-test-fixtures.mjs`. Stop an existing simulation first; the runner refuses occupied ports. Ctrl+C stops its owned services. Normal local development continues on ports `55432`/`8000`/`3000`.

For repeatable verification after a build:

```powershell
npm.cmd run test:hosted-h1
```

The next gate is the owner's confirmation that IT inputs and credentials are ready: actual regions, access, shared-origin domain/TLS, restricted runtime/storage credentials, test mailboxes, secret custody, demo recovery and existing VPS capacity. The selected TEST plan is Supabase Free with Next.js `next start` and FastAPI on the same Hostinger VPS; no Vercel TEST project or purchase. Manually resume a paused project before demos and recover lost synthetic data by re-seeding instead of backups. Supabase Pro and optional Vercel Pro are production-only decisions. No new users or hosted changes occur before IT-readiness confirmation. H2+ remains deferred; repository commit/push authorization does not authorize deployment.
