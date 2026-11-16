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

Migration 0086 adds two private presentation helpers, `workspace_item_context`
and `content_exposure`, to that explicit database inventory. Neither is executable
by runtime roles. The exposure save route delegates through the source lock and
existing media Edit conjunctions; `content_workflow_exposure_save` is explicitly
listed as an application entry point. Existing workspace/workflow/publication
entry guards remain. No permission bit, special or account/template grant changes.
Suggestion decisions resolve the active field's default exposure server-side,
and broader forged values are rejected. The owner decision and permission card
are recorded in docs/47 section 4.5 and docs/48 W3.1.
The historical fixture JSON files above remain unchanged.

W3.2 adds `contextual-promotion-routes.json`: two contextual read projections
and one read-only POST scope resolver. All require Promotions View; SQL also
requires the actual Projects/Brands source View, plus Knowledge View for KM
suggestions. The three application functions and seven private helpers are
listed in the DB baseline inventory. No new permission bit or default grant.
New approval evidence captures the displayed resolved project IDs/hash;
publication checks current resolution while existing live versions keep their
frozen scope. Existing DATA/LEGAL and editor/approver separation remain.

W5 adds `business-content-routes.json` for the five exact fixed-reference and
Knowledge-owned content routes, plus `content-business-db.json` for two
owner-only FORCE RLS tables and ten functions. The three guarded runtime reads
are `hub.business_references`, `hub.business_content` and
`internal.assistant_business_search`. The seven private helpers remain closed.
Business references never grant descendant access. Assistant retrieval keeps
thirteen tools, requires Knowledge View and exact source access, and excludes
non-AI exposure; saved published citations pin both page and source versions.
No account, grant, template, permission-bit or historical manifest rewrite.

W6 adds `content-scope-routes.json` for five account-management routes and one
caller-specific BU notice projection. Reference/history reads require account
management; grace settings also require actual Admin. `content-scope-db.json`
inventories the exact 0089/0090 additions: seven owner-only FORCE RLS tables,
213 functions including closed delegates, 221 changed existing functions and
92 restrictive object policies. The dedicated runtime catalogue tests verify
columns, keys, partial indexes, policies, signatures and execution ACLs.

Scopes constrain each existing content View/Edit/Approve grant. Missing scope
rows retain unrestricted access; no existing grants or templates are rewritten.
Shared drafts require any applicable project, while approval requires all.
Promotion DATA/LEGAL review and separation remain unchanged. Membership refresh
uses private dedicated tables and fixture-tested clock boundaries, independently
of content approval snapshots. Partial promotion displays retain full impact
counts but hide inaccessible reference IDs; saved-resolution requests use the
promotion identity/revision, and SQL preserves omitted inaccessible targets.
See docs/47 section 7.1 and the W6 permission card in docs/48.

W7 adds `content-writing-routes.json` for two source-bound writing-aid routes
and `content-writing-db.json` for the exact 0091 inventory: two owner-only FORCE
RLS usage/budget tables, nine functions and the existing registry save function.
Only state, begin and finish are runtime SQL entry points. Registry eligibility
defaults off; actual Admin with the existing field-catalog special may opt in
only the finite marketing-text allowlist. Source View/Edit and every context's
object scope remain mandatory. The only provider is the local stub. Proposals
never write content; explicit acceptance uses the ordinary revision-checked
draft writer and retains in-review locks. No account, grant, template, permission
bit, assistant tool or public/export surface is added.
