# P1 SENA-H registry — implementation and verification

29 September 2026, Asia/Bangkok. **P1.1–P1.5 implemented and verified locally.**
The owner approved P1.0, Online-supplied approved per-boost corporate labels, the
P1–P5 schedule option, and agencies returning IDs while seeing only their own names.
This execution stops at P1. No P2–P6 implementation, staging, commit or push was performed.

## Delivered behavior

- One SN registration code groups immutable name variants, including `KW-BRAND` and
  `KW-COMPETITOR`. Each native binding selects the exact `name_id`. Scope, objective,
  agency and label stay frozen. This preserves the agreed grouping for later budget
  matching; P1 does not create monthly media lines or budget approval.
- The server generates code, checksum, name, UTM and launch-pack text from structured
  selections. Preview consumes no sequence. Corporate input is an approved content
  label plus Online's assertion, never a client-generated complete name.
- Thai registry list/detail, three-step registration wizard and ID-return inbox use
  the Flip7/Tailwind foundation, Google Sans Thai, Noto fallback and reduced motion.
- Agencies cannot issue names and cannot read another agency's names, registrations
  or bindings. Native platform/account/campaign IDs remain text, including leading zeros;
  repeat submission is harmless and conflicting rebinding returns 409.
- Migration 0014 supplies eight registry tables, audited guarded operations, forced RLS,
  controlled vocabulary, local synthetic fixtures and five private read-only DW views.
  A/B scope intake validates operator-exported Gold JSON before optional local application.
- `sena_h_approved` remains **false**. Screens display **รออนุมัติรูปแบบชื่อ** and local
  test results are labelled **ข้อมูลทดสอบ ห้ามใช้เปิดแคมเปญจริง**. Production issuance
  remains blocked until the separate pattern approval is recorded.

## Files changed by step

Paths are relative to the Hub repository. These are this implementation's changes,
determined against the pre-implementation file-hash baseline; unrelated pre-existing
working-tree changes are not attributed to this task.

| Step | Files |
|---|---|
| P1.1 foundation | `apps/admin/package.json`, `apps/admin/package-lock.json`, `apps/admin/postcss.config.mjs`, `apps/admin/styles/tokens.css`, `apps/admin/app/globals.css`, `apps/admin/app/layout.tsx`, `apps/admin/components/registry-motion.tsx` |
| P1.2 schema and intake | `supabase/migrations/202609290014_ads_registry.sql`, `supabase/tests/ads_registry.sql`, `supabase/tests/concurrent_ads_code.mjs`, `scripts/stage-ads-scopes.py`, `scripts/sample-ads-registry.sql`, `tests/test_stage_ads_scopes.py` |
| P1.2 local setup/test wiring | `scripts/local-credentials.mjs`, `scripts/local-db.mjs`, `scripts/local-migrations.mjs`, `scripts/test-db.mjs`, root `package.json` |
| P1.3 API/authentication | `apps/api/sena_hub_api/naming.py`, `apps/api/sena_hub_api/ads.py`, `apps/api/sena_hub_api/auth.py`, `apps/api/sena_hub_api/main.py`, `apps/api/tests/test_naming.py`, `apps/api/tests/test_ads_registry.py` |
| P1.4 screens/integration | `apps/admin/app/ads/registry/page.tsx`, `apps/admin/app/ads/registry/new/page.tsx`, `apps/admin/app/ads/registry/inbox/page.tsx`, `apps/admin/components/ads-registry.tsx`, `apps/admin/components/ads-registry.css`, `apps/admin/components/hub-admin.tsx`, `apps/admin/lib/local-session.ts`, `apps/admin/app/api/hub/[...path]/route.ts`, `tests/ui/ads-registry.spec.ts` |
| P1.5 DW contract | Export views/reader role in the same 0014 migration; contract and scope-intake instructions in `docs/19-campaign-naming-registry.md` |
| Decisions and evidence | `docs/22-hub-assistant-and-ui.md`, `docs/ads/PHASE1_PRIORITIES.md`, `docs/ads/SCOPE_CHANGE_20260929.md`, `docs/ads/OPEN_QUESTIONS.md`, this report |

Local runtime setup also appended the three ads demo credentials to the ignored API/admin
environment files and local configuration, preserving existing credentials. Build, local
PostgreSQL and verification artifacts are generated files, not source changes. No credentials
are included in this report.

## Actual command results

All five required commands completed with exit code **0** on the final runs. API and
browser test suites ran sequentially against local PostgreSQL and the production Next build.
`UV_CACHE_DIR` was set to the workspace's `.cache/uv` because the default cache was inaccessible.

`npm.cmd run typecheck --prefix apps/admin`

```text
> sena-hub-admin@0.1.0 typecheck
> tsc --noEmit
```

`npm.cmd run build --prefix apps/admin` — final output excerpts:

```text
▲ Next.js 16.3.5 (Turbopack)
✓ Compiled successfully in 1188ms
  Finished TypeScript in 3.2s ...
✓ Generating static pages using 9 workers (3/3) in 672ms
Warning: Failed to find font override values for font `Google Sans`
Skipping generating a fallback font.
```

The warning concerns Next's automatic fallback metric data. Explicit Noto fallback is
configured and was verified in the browser with Google font requests blocked.

`uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests`

```text
collected 389 items
====================== 389 passed, 2 warnings in 23.97s =======================
```

The two dependency warnings are Starlette/httpx TestClient deprecation and the deprecated
AnyIO BlockingPortal alias. Dependencies were not upgraded as unrelated cleanup.

`npm.cmd run test:db` — actual output:

```text
PASS: PostgreSQL role isolation, publication, rollback and validity checks
PASS: source selection, human model review and stale-edit protection
PASS: asset rights, binding isolation and published file eligibility
PASS: brand/company identity, requests, immutable brand publication and dependent project eligibility
PASS: Gold defaults, bilingual fields, source revisions and preservation of edited values
PASS: model media scope, publication isolation, multiple plans and rights withdrawal
PASS: multiple project media per role, idempotent append, primary removal and publication rights
PASS: commercial types, shared source references, atomic intake and private scoped media
PASS: facility taxonomy, known absence, stale writes and private draft collection
PASS: ads registry agency isolation, frozen names, native binding and DW export permissions
PASS: concurrent model edit rejects stale timestamp and preserves committed fields after reload
PASS: concurrent upload dedup preserves the approved registry winner
PASS: concurrent brand edits reject stale timestamps and preserve committed fields after reload
PASS: concurrent ads registrations wait on the annual counter and commit distinct sequential SN codes
```

`npm.cmd run test:ui`

```text
Running 50 tests using 1 worker
  50 passed (2.0m)
```

This includes 45 existing tests and five registry tests. Playwright emitted the harmless
`NO_COLOR`/`FORCE_COLOR` environment warning. No tests were skipped in these final runs.

Full local logs: [typecheck](../../artifacts/p1-verification/typecheck.log),
[build](../../artifacts/p1-verification/build.log),
[API](../../artifacts/p1-verification/pytest-api.log),
[database](../../artifacts/p1-verification/test-db.log),
[UI](../../artifacts/p1-verification/test-ui.log).

Earlier failures were fixed before the final runs: extending `DEMO_ACTORS` broke an old
compatibility assertion (the original five-entry mapping is now preserved); a direct-link
card could lose its shared-layout position when its source row loaded (direct links now
fade without the row ID); two browser assertions needed Windows clipboard newline handling
and a locator scoped away from Next's route announcer. The final tests also check ordinary
motion after binding/list refresh and appending a variant without changing SN.

Additional real checks:

```text
Applied 202609290014_ads_registry.sql
Loaded local-ads-registry-samples. No enterprise data imported.
Ran 4 tests in 0.001s
OK
PASS: 25 documented contrast ratios recomputed from source hex values
PASS: HYABC/KUBON/B_PO project rows (3) and model rows (109) unchanged from baseline
Registry sena_h_approved: false
```

The four intake tests ran with `uv run --project apps/api python -m unittest discover
-s tests -p test_stage_ads_scopes.py -v`. The DB agent also tested A/B application,
exact replay and conflict quarantine against a disposable database, then removed that
database. Real Gold scopes were not activated.

Browser rendered-font evidence: Google Sans 18pt on the Thai heading, Noto Sans Thai
on Thai table cells, and Noto Sans Thai on the heading when Google `.woff2` requests
were blocked. Font responses were same-origin HTTP 200; no page JavaScript errors were
observed in the visual check. The 375px/200% text-size check reported no horizontal overflow.
See [font/viewport evidence](../../artifacts/p1-verification/visual-evidence.json),
[desktop](../../artifacts/p1-verification/registry-desktop.png),
[detail](../../artifacts/p1-verification/registry-detail.png),
[wizard](../../artifacts/p1-verification/registry-wizard.png),
[agency inbox](../../artifacts/p1-verification/registry-agency-inbox.png),
[mobile](../../artifacts/p1-verification/registry-mobile.png) and
[fallback](../../artifacts/p1-verification/registry-fallback.png).

## Deviations and practical limits

| Doc/requirement | Implementation and reason |
|---|---|
| Doc 19 real A/B scope seeds | Replayable staged importer and synthetic fixtures are complete. Real activation was withheld because available DW snapshots lack verified source timestamps/English labels and require reconciled current bridge evidence. No guessed labels, IDs or dates were imported. |
| Doc 19 shared-SN variants | Added preview and append-variant operations within the approved P1.0 design so live preview and multiple frozen variants work without allocating another SN. No deviation from the owner's identity decision. |
| Doc 22 Thai readability | Engineering font/fallback, screenshots and text-size checks completed. Timed Online/agency review and native-browser-zoom review are still pending; Noto-first tables follow the documented default. |
| Doc 22 fonts | Build retains a Google Sans automatic fallback-metric warning. Explicit locally served Noto fallback works; no unrequested font replacement or dependency upgrade was made. |
| Production browser access | Registry follows the existing local-only session/proxy architecture. API verified JWT role/agency support is implemented; production browser sign-in/session integration remains a deployment dependency. No local persona cookie is accepted outside local mode. |
| Test database startup | The embedded-Postgres wrapper failed in this restricted Windows environment. The existing local cluster was started using its native `pg_ctl`; migrations/tests then ran against it. |

## Remaining go-live gates

1. P'Note's SENA-H approval with evidence; `P1.0 approved` does not set it.
2. Reviewed Gold group/bridge exports, English labels, source timestamps and required
   steward aliases; approved real brand/CORP/BU masters, including KITH vs SENA-KITH.
3. DW acceptance of source key `hub`, dedicated read-only login and coherent five-view
   snapshot ingestion. The DW job/marts have not been deployed or modified here.
4. Real Online/agency identities and production browser authentication; verified hosted
   environment/region assessment before real personal/approval data use.
5. Human Thai readability acceptance. Engineering screenshots are not user approval.
6. Google `{campaignid}` capture through redirects/forms/CRM before claiming attribution
   coverage. P1 only returns the macro and instructions.

E-memo access, frozen ledger/memo column, correction-table ownership and `adinv`/`mplan`
remain later-priority questions in [OPEN_QUESTIONS](OPEN_QUESTIONS.md). Existing external
Online budget/launch approval remains necessary. The chosen P1–P5 schedule direction
is recorded in the scope-change note; REQUIREMENTS and doc 15 were not re-baselined.

The file-hash audit confirms unrelated existing files stayed unchanged, including
REQUIREMENTS, README, docs 11–18 and `tools/name_builder`. Real local pilot project/model
hashes also match the baseline. REM, the ledger Sheet and DW repository were not modified.
