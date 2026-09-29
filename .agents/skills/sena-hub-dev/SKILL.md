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
| `supabase/migrations/` | `YYYYMMDDNNNN_<slug>.sql`, NNNN continues the global counter (last: `202609210013`) |
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
npm.cmd run build --prefix apps/admin
uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests
npm.cmd run test:db
npm.cmd run test:ui                     # run API/browser suites sequentially
```

On restricted workstations add `--cache .cache/npm` (npm) and `--cache-dir .cache/uv` (uv). See
`docs/11-local-development.md`.

## Definition of done for a slice

Migration + SQL/RLS test · API endpoint + pytest (validation, permission, happy path) · admin screen
+ Playwright spec · docs updated (the numbered doc that owns the design) · all commands above green
and reported with real output. If something can't be run, say so. Don't claim it passed.
