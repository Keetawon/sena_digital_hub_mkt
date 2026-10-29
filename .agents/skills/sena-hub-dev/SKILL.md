---
name: sena-hub-dev
description: >
  How to work in the sena_digital_hub_mkt repo: guardrails (design-before-code
  gates, no commits unless asked, don't touch unrelated uncommitted work),
  layout (apps/admin Next.js, apps/api FastAPI + asyncpg, supabase/migrations,
  tests), role/RLS pattern, migration naming, local run and test commands on
  Windows, and the one-developer delivery constraints. Use at the start of any
  coding, migration, test or review task in this repo, alongside the domain
  skill (sena-campaign-naming, sena-marketing-ops, sena-hub-ui,
  sena-hub-assistant, sena-ememo-archive).
---

# Working in sena_digital_hub_mkt

## Guardrails

- **Gates:** when a task says design/plan only, write docs and stop. No app code, migrations, Tailwind
  setup or Apps Script changes until the owner approves.
- **Git:** don't commit or push unless asked. The working tree holds earlier uncommitted work
  (`apps/`, `supabase/`, docs 11–18, `README.md`, `REQUIREMENTS.md` …) that is not from the ads
  workstream. Don't revert, reformat, stage or "clean up" files you weren't asked to change. When you
  commit on request, stage explicit paths only (never `git add -A`).
- **Read-only systems:** REM, the DW repo (`D:\Personal\workspace\sena_idea_mkt_data_warehouse`),
  the `INVOICE Ads` ledger, the media-plan workbook, and the registry Sheet / `tools/name_builder`.
- Thai UI, Asia/Bangkok business dates, `timestamptz` storage, source IDs as text (leading zeros kept).
- One developer + agents: finish one priority end to end (schema → API → UI → tests) before starting the next.

## Layout

| Path | What |
|---|---|
| `apps/api/sena_hub_api/` | FastAPI app (`main.py` routes, `auth.py` JWT/demo actors). asyncpg; each request runs `SET LOCAL ROLE <actor role>` + `set_config('app.actor_id', …)` so Postgres RLS decides access |
| `apps/admin/` | Next.js 16 admin; calls the API through `app/api/hub/[...path]/route.ts`; tokens in `styles/tokens.css` |
| `supabase/migrations/` | `YYYYMMDDNNNN_<slug>.sql`, NNNN continues the global counter (last: `202610050033_missing_project_last_status.sql`) |
| `supabase/tests/` | SQL checks + `concurrent_*.mjs` two-connection regressions |
| `tests/ui/` | Playwright specs; `tests/*.py` intake script tests |
| `scripts/` | local DB, migrations, DW stage scripts (`stage-gold-project.py` = DW→Hub staging pattern) |
| `docs/` | numbered design docs; ads workstream = 19, 20, 21, 22 and `docs/ads/` |

Schemas in use: `hub`, `public_api`, `staging`, `audit`, `internal`, `rag`. The ads module adds `ads`.
Roles today: `editor`, `publisher`, `viewer`, `admin`, `service_consumer`. New marketing-ops roles
(e.g. online staff, agency) are added in a migration together with their RLS policies and SQL tests.

## Commands (Windows; use `npm` instead of `npm.cmd` elsewhere)

```powershell
npm.cmd run dev:db                      # local Postgres (keep running)
npm.cmd run dev:migrate                 # apply new migrations + fixtures
uv run --project apps/api --env-file apps/api/.env python -m sena_hub_api
npm.cmd run dev --prefix apps/admin
# verification
npm.cmd run typecheck --prefix apps/admin
$env:NEXT_FONT_GOOGLE_MOCKED_RESPONSES = (Resolve-Path scripts/offline-fonts.cjs).Path
try { npm.cmd run build --prefix apps/admin -- --webpack }
finally { Remove-Item Env:NEXT_FONT_GOOGLE_MOCKED_RESPONSES }
npm.cmd run test:api
npm.cmd run test:db
npm.cmd run test:ui                     # รันชุดทดสอบตามลำดับ ไม่รันพร้อมกัน
npm.cmd run test:hosted-h1              # where the slice touches hosted paths
```

คำสั่ง `test:api`, `test:db` และ `test:ui` ใช้ฐานข้อมูลทดสอบแบบใช้แล้วทิ้ง
ตัวรันจะปฏิเสธการเริ่มงานหากฐานข้อมูลทำงาน/API/admin ยังใช้พอร์ต `55432`/`8000`/`3000`
ให้ขอให้ผู้ใช้หยุดบริการหรืออนุญาตก่อน ห้ามหยุดบริการเองหรือข้ามตัวตรวจเพื่อใช้ฐานข้อมูลทำงานทดสอบ

On restricted workstations add `--cache .cache/npm` (npm) and `--cache-dir .cache/uv` (uv). See
`docs/11-local-development.md`.

## Test gates

**Quick gate:** run after every change while iterating. Aim for 1–3 minutes;
shared-area changes require the wider selection below.

- Admin code changed: `npm run typecheck --prefix apps/admin`.
- API: `npm run test:api -- <affected test files or -k expression>`.
- Browser: `npm run test:ui -- <affected spec files>`.

| Changed | Quick gate must also include |
|---|---|
| `supabase/migrations` or SQL functions/policies | `npm run test:db`, plus API tests matching `-k permission` |
| `apps/api/sena_hub_api/auth.py`, `main.py`, or shared API helpers | The full API suite (no browser run needed) |
| Shared admin components, layout, navigation, proxy route | The affected specs plus `hub-navigation.spec.ts` |
| A single screen or endpoint | That endpoint's API tests and that screen's spec(s) |

**Full gate:** run once, at the end of the slice. Run every verification command
in the Definition of done: typecheck, the documented offline build, `test:api`,
`test:db`, `test:ui`, and the H1 suite where the slice touches hosted paths.
Run it before reporting the slice done, before any commit the owner asks for,
and before any hosted TEST rollout step. Hosted rollout documents, including
`docs/46-hosted-content-rollout.md`, continue to require full-gate evidence.

**Failure loop:** fix the failure, then rerun only the failing tests and their
quick-gate set until they pass. Then run the full gate once more. Never rerun
the full gate for each fix attempt.

**Reporting:** always name the tier and give real output. For example:
"Quick gate: 41 passed (test_finance.py, ads-finance.spec.ts). Full gate: not yet
run." Never write "all tests passed" unless the full gate ran on the final code.

## Definition of done for a slice

Migration + SQL/RLS test · API endpoint + pytest (validation, permission, happy path) · admin screen
+ Playwright spec · docs updated (the numbered doc that owns the design). Use quick gates while
iterating. The verification commands listed above are the full gate, run once at the end: typecheck,
the offline build, test:api, test:db, test:ui and H1 where hosted paths are touched. Report real output
before calling the slice done, an owner-requested commit or a hosted TEST rollout step. If a command
cannot be run, say so; do not claim it passed.
