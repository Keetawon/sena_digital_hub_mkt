# Permission baseline contracts

These reviewed fixtures freeze the canonical local behavior at `12772c3` for
the migration programme in `docs/34-permission-map.md` §10. They contain source
metadata, not account/request data. Execution captures stay in ignored `.local/`.

- `legacy-routes.json`: 200 concrete method/path pairs and ten conditional H1
  fallback patterns. `entry_roles` is the API dependency ceiling, not an object
  permission. Inline checks, lifecycle rules, own-record checks and DB grants can
  further restrict an action. `edit/approve` records a legacy partial cell; the
  owner's normalized action semantics supersede it during migration.
- `legacy-db.json`: seven schema USAGE boundaries, 223 functions (134 SECURITY
  DEFINER), 164 policies and 119 relations. Schema access is necessary even when
  an old relation grant remains. RLS flags and expressions are included explicitly.

`test_permission_baseline.py` checks route coverage and exercises every concrete
entry with six human roles, a consumer, both agencies, all four account statuses
and forged role/agency claims. It also checks anonymous callers. Real account
lookup and real route dependencies run against the disposable database. Domain
handlers stop after those dependencies; inline read gates run normally. This is
not a replacement for successful/denied domain operations in the existing suites.
Synthetic account versions must remain unchanged throughout these read/validation
probes. Fixture setup and cleanup verify the cluster directory and unique marker
on the same operator connection before writing.

`test_permission_db_baseline.py` compares live catalog metadata through the actual
NOSUPERUSER/NOBYPASSRLS runtime login. It exercises 119 direct relation entry checks
per persona and eleven tab read RPCs per persona, with positive and negative cases.
`LIMIT 0` relation probes verify effective schema/relation access, not row scope;
the existing DB suites exercise row isolation. Questions has no DB relation/RPC.

Run through `npm run test:api -- -k permission_baseline` and
`npm run test:api -- -k permission_db_baseline`; never connect tests to the working
cluster. The full phase gates still include all API/DB/UI/H1 suites. H1 runs only
through its loopback simulation and independent database.

Keep the legacy fixtures as historical evidence. When a tab migrates, explicitly
replace its legacy equality assertions with permission checks, including one-box-
off direct SQL and every SECURITY DEFINER entry point, neighboring allowed cases,
cross-tab dependencies and mandatory agency isolation. Do not bless ACL drift by
blindly rewriting a snapshot. A new route, table or definer must be reviewed and
mapped; a hidden UI control alone is never sufficient evidence of denial.

Unified workspace additions are separate reviewed inventories. W2 adds
`workspace-home-routes.json` for read-only home, tasks and search. W3 adds
`content-workspace-routes.json` for eight read projections and the existing
project website-candidate decision. The shared `content_workspace` entry gate
admits active internal staff with any source View; each projection then applies
its exact source checks, and activity requires actual Admin. Knowledge-only
callers can read FAQ envelopes without receiving project facts or media.
Legacy `/knowledge` evidence now requires actual Admin plus the existing source
V/E/A bit. All old FAQ candidate mutations are closed; historical rows remain.
Migration 0083's 33 new or renamed functions are explicitly listed in the DB
baseline test, including private delegates with no application execution grant.
The historical fixture JSON files above remain unchanged.
