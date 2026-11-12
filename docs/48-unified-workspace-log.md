# 48 — Unified content workspace delivery log

Authority: [docs/47](47-unified-content-workspace.md), owner instructions of
4 November 2026. Local implementation only. The lead owns `main`, migration
numbers, the test lock, review, commits and pushes. No hosted rollout is part
of this programme.

## Baseline and standing rules

- Started on `main` at `809273a`. Only the seven owner-listed paths were dirty.
  Reviewed the requirements diff and both logo images, staged exactly those
  paths, and committed `5a087ea` with the requested message:
  `Record unified content workspace requirements (owner decisions 4 Nov 2026)`.
  Push to `origin/main` succeeded; subsequent `git pull --ff-only origin main`
  reported already up to date.
- Git had no configured author. The commit used the same identity as the five
  preceding commits through command-local options; global settings were not
  changed.
- Read REQUIREMENTS, docs/47, docs/11 Test gates, docs/30 knowledge-library
  sections 2 and 7, docs/36, docs/41 and the required skills. The shell agent
  read all docs/22; the governance agent read all docs/34 and later permission
  migrations; the writing agent read all docs/46 and reported the standing
  H5i rules. Their findings are incorporated below. Historical rollout
  authorization does not authorize this programme to deploy.
- No account, grant, template, existing content, review or historical snapshot
  is to be rewritten by a migration. The N1 catalog flag change is expressly
  allowed. New relationship/review records must preserve original identities.
- Thai UI labels are copied from docs/47; existing reusable validation/message
  constants remain authoritative for existing wording. New pending-question
  prose is written to UTF-8 files, never through a terminal.
- No live provider call, REM access, DW repository change, R2 write, hosted
  migration or deployment. `sena_h_approved` remains false.

### Credential-harness clarification — resolved before implementation

Inspection of source code found that the mandatory disposable runner and
fixtures internally read `.local/development.json`. No credential file was
opened and no affected command was run while clarification was pending.

Owner resolution, 4 November 2026: the original prohibition was too broad.
Agents must never open, print, quote, copy or commit credential files. The
documented scripts and test harnesses (`dev:db`, `test:api`, `test:db`,
`test:ui`, `test:local`, H1 and their fixtures) may internally read the existing
random local-only configuration in `.local/development.json`, `apps/api/.env`
and `apps/admin/.env.local`, as described by docs/41 section 8 and docs/11.

Do not change how the harnesses load configuration. Do not copy `.local` or
environment files into agent worktrees. Run port-bound gates from the main
checkout under the lead's lock. `.env.supabase-test`, `.local/dw-reader.json`
and VPS `/etc` remain untouched. Run `git check-ignore` on the credential paths
before every commit. **Blocker cleared; Wave 1 may proceed.**

## Workstreams and waves

| ID | Scope from docs/47 section 10.1 | Dependencies | Delivery owner / status |
|---|---|---|---|
| W1 | Service shell, logo, theme, collapse, overflow fix; assistant leaves sidebar | None | Complete: `93b04cc`, pushed to origin/main |
| W2 | Global search, floating assistant, home greeting and read-only personal tasks | W1 merged | Complete: `b5dc456`, pushed; receipt `d3ec1d6` |
| W3 | Entity tree/pages, reused sections, readiness deep links, FAQ, inline suggestions/N7, media, history, Admin activity, redirects | W1 merged | Complete: `487e090`, pushed to origin/main |
| W3.1 | Registry-default suggestion exposure, exposure chips/notices and compact contextual overview | W4 committed | Complete: `375d7c9`, pushed; receipt `5dcdbae` |
| W3.2 | Contextual Promotions tabs, owning brand, reviewed exclusions and legacy suggestions | W3.1 committed | Complete: `7ceed6f`, pushed; receipt `cdfeb42` |
| W4 | N1 governance, per-item approve/return, FAQ withdraw, N2 publisher boundary, N6 single queue | Backend independent; UI after W3 | Complete: `16b38cd`, pushed; receipt `5a59e13`; migrations 0084/0085 |
| W5 | Fixed business level and composition order | W4 merged | Complete: `9ac800c`, pushed to origin/main; migration 0088; full gate passed |
| W6 | BUD scopes, dated daily BU sync and account scope controls | W5 delivered | Lead integration on 0089/0090; design updated to latest owner rules; runtime gates pending |
| W7 | Stub-only writing aid, registry flag, budget and diff UI | Backend independent; UI after W3 | Backend/UI prepared; lead integration/runtime gates after W6 |
| W9 | Optimize future uploads, retain only stored result, allowlisted private file metadata suggestions | Bounded preparation parallel; shared adapters serialized; before W8 | Decision/card recorded; isolated processor has 49 preparation checks passing; integration/full gate pending |
| W8 | Thai UAT pack covering all docs/47 flows; final full gate | W1–W7, W3.2 and W9 | Fifty-four-case draft including Promotions and W9 amendments reviewed; fixtures, rehearsal and final programme gate pending |

Current owner-ordered merge sequence: W1 → W2 → W3 → W4 → W3.1 → W3.2
→ W5 → W6 → W7 → W9 → W8. Bounded W9 preparation may continue independently;
shared adapters wait for their active file owner. W8 covers all delivered slices
and the final programme gate. Historical wave notes below describe earlier
planning and are superseded by the owner decision received on 6 November.

The W1 menu initially uses existing working destinations: `/`,
`/?view=projects`, `/promotions`, `/articles`, `/releases` and existing settings
query tabs. W2/W3/W4 replace these destinations in their serialized slots.
This keeps every visible item usable; no placeholder service or destination is
introduced. The existing app was light-only; W1 adds a system-dark token set to
meet docs/47 section 8.1 and checks both themes. The logo keeps a light plate.

## Written agent briefs and exclusive file ownership

All three worktrees were cut from `5a087ea`. Agents never commit or push; the
lead reviews their diff and quick gate before creating any branch snapshot or
integrating explicit paths. Agents may inspect all non-secret repository
source, but write only the exact paths below. No port-bound tests in worktrees.
Typecheck, syntax/lint and other checks that bind no port are permitted.

### A — W1 shell

Worktree: `D:/Personal/workspace/sena_hub_wt/w1-service-shell`.
Branch: `ws/w1-service-shell`. Implements docs/47 sections 3.1 and 8.1.

Owned files:

- `apps/admin/components/hub-shell.tsx`
- `apps/admin/components/hub-navigation-data.ts`
- `apps/admin/components/hub-navigation.tsx`
- `apps/admin/components/hub-navigation.css`
- `apps/admin/styles/tokens.css`
- `apps/admin/app/globals.css` (shell, focus and theme rules only)
- `tests/ui/hub-navigation.spec.ts`
- `tests/ui/assistant.spec.ts` (retain floating-opener checks)
- `tests/ui/hosted-h1.spec.ts` (shell checks only)
- `tests/ui/brand-review.spec.ts`, `tests/ui/dw-brands.spec.ts`,
  `tests/ui/permission-navigation.spec.ts`, `tests/ui/permissions-uat.spec.ts`,
  `tests/ui/residential-operations.spec.ts`, `tests/ui/knowledge-review.spec.ts`
  (navigation expectations only; all behavior and denial assertions retained)
- `docs/22-hub-assistant-and-ui.md` (current shell/palette sections)
- `.agents/skills/sena-hub-ui/SKILL.md`

Forbidden: all API, migrations, permission manifests, accounts, content editors,
question catalog, docs/48 and any file outside the list. Report a needed ownership
extension before editing. Preserve `hubPages` as the reviewed permission-route
inventory, separate from service/group presentation data.

Done: permission-filtered services and the six requested content items, unchanged
ads items, settings/bottom utilities, logo/mark, persistent collapse with reachable
expand control, ellipses/tooltips, mobile drawer, visible focus, reduced motion,
no sidebar assistant/overflow, measured light/dark contrast, 1280/1024/390 local
and H1 checks. Local assistant remains mounted with its existing floating opener.
The lead runs all browser/full gates and records artifacts.

### B — W4 governance backend

Worktree: `D:/Personal/workspace/sena_hub_wt/w4-governance`.
Branch: `ws/w4-governance`. Implements docs/47 section 5, with section 8.4 audit
compatibility. Uses the W4 permission card below before code.

Owned new files:

- `supabase/migrations/202611040084_content_workflow.sql`
- `supabase/migrations/202611040085_unified_publication.sql`
- `supabase/tests/unified_content_workflow.sql`
- `supabase/tests/unified_publication.sql`
- `apps/api/sena_hub_api/content_workflow.py`
- `apps/api/sena_hub_api/publication_queue.py`
- `apps/api/tests/test_content_workflow.py`
- `apps/api/tests/test_publication_queue.py`
- `tests/permissions/content-workflow-routes.json`
- `tests/permissions/publication-queue-routes.json`

Owned existing API files: `main.py`, `content_permissions.py`,
`project_content.py`, `unit_types.py`, `project_commercial.py`,
`project_amenities.py`, `articles.py`, `web_publication.py`, `promotions.py`, all
under `apps/api/sena_hub_api/`. Existing test ownership under `apps/api/tests/`:
`test_project_content_core.py`, `test_unit_type_workflow.py`,
`test_project_commercial.py`, `test_project_amenities.py`, `test_articles.py`,
`test_web_publication.py`, `test_real_promotions.py`, `test_promotions_db.py`,
`test_permission_publication.py`, `test_permission_content.py`,
`test_permission_accounts.py`, `test_permission_db_baseline.py`,
`test_permission_feature_coverage.py`. Current permission route manifests may
be amended in this exclusive slot; `legacy-db.json` and `legacy-routes.json`
are immutable historical baselines.

Forbidden: admin UI, old migrations, frozen manifests, account/grant/template
data, W2/W3/W7 modules, docs/48. The lead owns proxy/H1 integration and account
special controls. Agents must report every additional required path first.

Done: all publishable kinds inventoried below covered, shared guarded decisions
on old and new entry points, N1 reason and atomic save/approve, promotion
separation retained, pinned approved snapshots and contributor checks, per-item
stale/return outcomes, histories preserved, runtime denial/positive-neighbour
tests and no unauthorized data migration. No API/UI/test bypasses.

### C — W7 writing backend

Worktree: `D:/Personal/workspace/sena_hub_wt/w7-writing-aid`.
Branch: `ws/w7-writing-aid`. Implements docs/47 section 8.3 under the W7 card.

Owns only `apps/api/sena_hub_api/writing_aid.py`,
`apps/api/tests/test_writing_aid.py`,
`supabase/migrations/202611040089_writing_aid.sql`, and
`supabase/tests/writing_aid.sql`. Main registration, permission/proxy/H1
inventories and UI are lead integration in a later serialized slot.

Forbidden: all existing workers/provider configuration, shared API files,
permission inventories, UI, other migrations and docs/48. Reuse helpers by import,
never widen translation eligibility or media-worker authority.

Done: deterministic stub with no credential lookup/network client, default-off
registry eligibility plus hard exclusions, protected number/placeholder checks,
actor/source-bound proposals, budget reservation/usage metadata and exact existing
budget message, no automatic retry or content write, runtime denial/neighbour
and zero-network checks. Acceptance is the ordinary revision-checked draft save.

### Lead and later ownership

Lead exclusively owns this log, pending-question catalog/document changes,
test orchestration and integration. Later agents receive a new exact-path brief
and worktree from then-current main before beginning W3/W5/W6. No later
assignment is permission to edit a currently leased shared file.

### Wave 2 briefs — activated at `2387dd3`

W1 implementation `93b04cc` and receipt `2387dd3` are pushed. The following
two worktrees were created from `2387dd3`; their briefs are now active. A's
ignored dependency-directory junctions reuse installed packages for read-only
typecheck/discovery only. No install or dependency mutation; no credential,
`.local` or environment files are copied or linked.

A receives `ws/w3-entity-ui` in
`D:/Personal/workspace/sena_hub_wt/w3-entity-ui`, cut from then-current main.
Scope: docs/47 sections 3.2, 4.1–4.5 and 8.4, with the W3 card above.

New owned UI files:

- `apps/admin/app/website/page.tsx`
- `apps/admin/app/website/[level]/[id]/page.tsx`
- `apps/admin/app/settings/page.tsx`
- `apps/admin/app/settings/activity/page.tsx`
- `apps/admin/components/website-tree.tsx`
- `apps/admin/components/entity-workspace.tsx`
- `apps/admin/components/workspace-settings.tsx`
- `apps/admin/components/content-history.tsx`
- `apps/admin/components/content-activity-log.tsx`
- `apps/admin/components/unified-workspace.css`
- `apps/admin/lib/unified-workspace.ts`
- `tests/ui/unified-workspace.spec.ts`
- `tests/ui/unified-workspace-h1.spec.ts`

Existing owned routes: `apps/admin/app/content/page.tsx`,
`apps/admin/app/content/fields/page.tsx`, `apps/admin/app/media/page.tsx`,
`apps/admin/app/faq/page.tsx`, `apps/admin/app/knowledge/page.tsx`.
Existing components under `apps/admin/components/`: `hub-admin.tsx`,
`brand-admin.tsx`, `project-content-workspace.tsx`,
`project-media-workspace.tsx`, `faq-workspace.tsx`, `faq-bank.tsx`,
`faq-intake.tsx`, `faq-coverage.tsx`, `knowledge-review.tsx`,
`website-content-sources.tsx`, `website-media-queue.tsx`, `project-assets.tsx`,
`content-operations-shared.tsx`, `commercial-types.tsx`, `unit-type-wizard.tsx`,
`project-amenities.tsx`, `content-facts.tsx`, `content-buildings.tsx`,
`content-narrative.tsx`, `content-contacts.tsx`, `project-commercial-workspace.tsx`.
Editor changes are limited to embedded modes, dirty-navigation callbacks,
exact target anchors/context and existing command integration.

Existing owned browser specs under `tests/ui/` (each name ends `.spec.ts`):
`assets`, `brands`, `brand-logo-upload`, `brand-review`, `commercial-types`,
`faq-coverage-permissions`, `faq-intake`, `knowledge-dashboard`,
`knowledge-followup`, `knowledge-review`, `media-ai-controls`,
`pilot-provenance`, `project-content-phase1`, `project-content-phase2`,
`project-content-phase3`, `project-content-phase5`, `project-content-phase6`,
`project-content-phase7`, `project-content-phase9`, `project-facilities`,
`project-groups`, `project-dashboard`, `project-multi-media`, `project-review`,
`project-form`, `project-media-draft`, `project-workflow`, `source-selection`,
`website-content-review`. Adapt routes/selectors while retaining every behavior
and denial assertion. Ask lead for any additional concrete path before editing.

Forbidden for A: root `app/page.tsx`, shell/navigation/tokens/global styles,
`lib/hub-permissions.ts`, W2 home/search/assistant files, all API/SQL/manifests,
publication/account specs and this log. New layout styles stay in the owned CSS.
Done: canonical entity tabs reusing forms, all required FAQ states and exact
override/source links, inline evidence decisions, media queue, content history,
Admin activity, context-preserving redirects, dirty draft protection and
1280/390 keyboard/reduced-motion coverage. Permitted checks: typecheck,
diff/encoding checks and Playwright discovery; no port-bound command.

C receives `ws/w3-workspace-api` in
`D:/Personal/workspace/sena_hub_wt/w3-workspace-api`, cut from then-current main.
Its four W7 files remain frozen in the original W7 worktree. Scope: the same
W3 sections and permission card; only new
`apps/api/sena_hub_api/content_workspace.py`,
`apps/api/tests/test_content_workspace.py`,
`supabase/migrations/202611040083_unified_content_workspace.sql`,
`supabase/tests/content_workspace.sql`, and existing
`apps/api/sena_hub_api/knowledge.py` are owned. The latter is limited to actual
Admin plus source checks, read-only FAQ candidates/cluster references and
legacy mutation denial. No other domain file, shared registration, inventory,
UI or log is writable. Lead integrates existing test expectation changes.

C done: bounded permission-filtered tree/page/FAQ/history/activity DTOs agreed
with A; read-only composition, exact source fields and targets, confirmed-only
grouping, no raw audit/account leakage, authoritative SQL/API N7 closure and
atomic website-text decisions with ordinary draft saves. Include runtime deny
and positive-neighbour tests, query/input bounds, no GET mutations, exact source
and per-project decision independence. Syntax/lint/collection only in the
worktree; all database/API/browser execution remains with the lead.

Lead W2 owns migration 0082, its home/search API and tests, `/home`, new home
and search components/styles, existing assistant component/styles and shared
shell/navigation integration. Lead serializes `main.py`, `content_permissions.py`,
permission manifests, database inventory, `scripts/test-db.mjs` registration,
proxy/content-route/H1 allowlists, root route integration and its browser specs.
Adding SQL-suite registration never changes harness configuration loading.

Shared-file lease order:

- Shell/navigation/tokens: W1 → W2 → W3 → W4 UI → W6/W7 integration as needed.
- `main.py`, `content_permissions.py`, `tests/permissions/*.json`: W4 backend
  preparation first; release the lease before W2/W3 registration, then rebase
  and integrate W4; W5 → W6 → W7 thereafter. Never concurrent edits.
- Docs/48: lead only. Agent reports are incorporated by the lead.

## Migration lane

Last merged migration: `202610290081_media_worker_heartbeat.sql`. Reservations
are allocated by the lead only, in intended merge order. No migration is applied
to the working database or hosted TEST by this programme.

| Number | Workstream | Purpose |
|---|---|---|
| 0082 | W2 | Authorized read-only workspace/search/task projections |
| 0083 | W3 | Entity/FAQ/history reads, N7 closure and audited website-text decision adapter |
| 0084 | W4 | Per-item lifecycle, N1 flags and revision/contributor checks |
| 0085 | W4 | Single queue, N2 and both publication-system entry points |
| 0086 | W3.1 | Registry-default suggestion exposure and bounded overview/notice projections |
| 0087 | W3.2 | Additive promotion ownership and reviewed exclusions |
| 0088 | W5 | Fixed business list, new associations and composition support |
| 0089 | W6 | Object-aware content grant scopes and account preview/confirm |
| 0090 | W6 | Dated BU membership, guarded sync and notices |
| 0091 | W7 | Default-off writing eligibility and bounded budget/usage state |

An unnecessary reserved migration must be reported before changing unmerged
allocations. Never renumber or edit a merged migration. New defaults/relations
must not rewrite historical content, versions, reviews or permissions.

## Permission cards (docs/36)

These cards precede implementation. Exact live route/DB inventories and runtime
tests form part of each workstream's completion; later W5/W6 implementation must
first add its concrete discovered SQL inventory and exact ownership brief here.

### W2 — search and personal read projections

| Field | Decision |
|---|---|
| Feature / owner | Lead; top search and `/home` aggregate existing authorized content and personal tasks |
| Tab / View | Existing Projects, Brands, Knowledge, Promotions and Releases source View; no new permission checkbox. ACTIVE internal accounts only; each result and task keeps its source and object guard |
| Edit / Approve / specials | No content mutation. Approval tasks require the owning A; publication tasks require source V and the existing publish special. Opening the assistant only fills its composer; sending stays explicit |
| Separation / templates | No changes to accounts, grants, templates or existing publication rules; W4 supplies the approved-only workflow semantics |
| Agency / sensitivity | Agency denied. No account/permission rows, credentials, private document contents, raw audit payloads or AI run text in search/home |
| Shared boundaries | Filter before totals, groups and pagination. Recheck each request. The private finite `content_scope_allowed` wrapper calls canonical `content_scope_access` and catches only 42501/P0002; W6 upgrades the canonical object guard |
| API / SQL | GET `/v1/admin/content/search` and `/v1/admin/content/home`; bounded query/filter inputs; migration 0082 supplies read-only search, task and readiness functions. Existing API/proxy/H1 inventories updated in the lead's exclusive slot |
| Assistant | Staff-only existing panel/provider boundary. Search row and floating entry pass current entity context; no automatic send. H1 keeps working search and a short disabled assistant state |
| Rollout / verification | No new storage/DML. Test cross-tab and inactive/agency denial, allowed neighbours, exact links, no GET gap writes, revocation and stale-response suppression, keyboard/focus, 1280/390 and both themes. Stub provider only |

The new home uses `/home`; legacy root project URLs keep working until the W3
redirect pass. This avoids mixing W3's editor-route changes into W2. BUD labels
come only from exact local REM-derived BU fields, with W6 replacing the read
projection with its dedicated last-good membership tables. No business-sheet
mapping or live source connection is involved.

### W3 — unified pages, evidence and content history

| Field | Decision |
|---|---|
| Feature / owner | A: reused editor UI; C: guarded read projections and N7 closure; lead: shared registrations and redirects |
| Tab / View | Owning source View for every page, nested section, FAQ, media item, readiness target and history event. FAQ retains Knowledge authority; Projects V additionally protects fact slots and project coverage |
| Edit / Approve | Existing draft/review commands and source E/A unchanged. New website-text decision requires Projects E/object access and current revisions; FAQ clusters retain existing intake commands. All legacy FAQ decisions are denied |
| Specials / separation / templates | No new special or permission checkbox; no account/grant/template changes. Existing approval/publish separation preserved until W4 |
| Agency | Internal workspace and activity/evidence APIs deny agency; existing external registry stays unchanged |
| Admin evidence / activity | ACTIVE actual `hub_role=admin`, plus each source View/object check. `can_manage_users` neither grants this access nor is required. Apply the same boundary to direct legacy evidence routes and candidate file reads |
| Sensitivity | Closed content-table and field allowlists over existing audit/version data. Legal evidence retains E/A-only visibility. No account/grant/template, worker/budget, raw staging/RAG or whole mixed-source batch payloads |
| Shared surfaces | Existing form APIs remain authoritative. Inherited answers and source links recheck source scope; all applicable approved questions shown; read-only composer never records gaps. Old URLs preserve phase, item, question, unit, media slot and version context |
| API / SQL | New `/v1/admin/content/workspace/tree`, entity page/FAQ/history/event reads, `/v1/admin/content/activity`, website-text decision and a guarded legacy FAQ-cluster reference projection; migration 0083, new route manifest, existing knowledge route restriction |
| Rollout / verification | No migration-time rewrite of content/evidence/reviews. Runtime deny and neighbour checks, actual Admin without account-management flag, audit redaction, scoped batch filtering, exact inheritance/override targets, independent per-project suggestion decisions, direct SQL legacy denial, keyboard/mobile/H1 and preserved legacy behaviors |

Affirmative grouping evidence is an explicitly composed, published website
page whose phase selection still matches that published version. Its explicit
entity reference must resolve to a member public project; every member must be
authorized and no competing confirmed page may claim a member. Unresolved
anchors, cross-brand/conflicting mappings and DW dictionary memberships alone
remain separate phase pages with a link to the existing configuration review.
Names, prefixes, matching IDs and absence of conflicts are never confirmation.

### W4 — governance and publishing

| Field | Decision |
|---|---|
| Feature / owner | Manager reviews each content revision; Online Marketing publishes approved items and returns individual items |
| Tab | Existing `projects`, `brands`, `knowledge`, `promotions`, `releases`; queue is presentation over existing domains, no new checkbox |
| View | Only authorized source drafts, review state, queue items, snapshots and redacted histories; every source tab/object checked |
| Edit | Source E saves/submits drafts; own FAQ draft withdrawal with reason; submitted/approved FAQ withdrawal requires source A |
| Approve | Source A approves or returns exact frozen items. E+A plus reason saves and approves in one transaction. N1 applies to content; promotions retain DATA + LEGAL and separation |
| Special actions | Existing `knowledge.publish_web`; source V plus this special permits publication preparation, publish, publisher return, withdrawal and rollback. Change its prerequisite from A to V without changing assignments |
| Separation | Projects/Brands catalog `separate_edit_approve=false`; Promotions stays true. Own approval requires reason and history flag. Publisher differs from editors, English reviewers and approver of each included revision |
| Templates | No changes or propagation; no account/grant mutations |
| Agency | Denied internal workflow and publication queue, including direct SQL/API; external registry boundary unchanged |
| Sensitivity | Internal draft/review data; Legal evidence remains E/A-only and outside public, assistant and AI output |
| Other tabs | All source V checks at publication; each write uses its owning E/A. Asset rights and validity remain independent. No hidden-source cache or reference leakage |
| Shared surfaces | Both publication stores/public projections/rollback, assistant and preview readers, assets, exports and history must use pinned approved revisions and current withdrawal/rights/validity |
| Endpoints | GET `/v1/admin/content-workflow`; POST same prefix `/submit`, `/review`, `/save-approve`; GET `/v1/admin/publication-queue`; POST same prefix `/prepare`, `/publish`, `/return`. Existing save/review/publish/withdraw/rollback routes retain exact classification and share SQL decisions |
| SQL | New `content_workflow_read`, `content_workflow_submit`, `content_workflow_review`, `content_workflow_save_approve`, `publication_queue_read`, `publication_queue_prepare`, `publication_queue_publish`, `publication_queue_return`; finite typed kind dispatch with closed helpers. Extend existing review functions, `web_assert_sources`, `web_publish`, `web_source_available`, `publish_project`, `publish_brand`, `promotion_command`, `release_publish`, `release_rollback`, web pointer commands and special normalization/constraint in new migrations |
| Rollout / verification | Audited FORCE-RLS new relations; closed direct DML/PUBLIC helper execution. Runtime deny plus allowed neighbour, inactive/agency denial, author permission changes, approval reason, stale single item, mixed batches, preservation of published revisions during new drafts, rights/expiry, concurrent edits and disposable replay |

The owning tab follows the content kind, not the entity-page location. FAQ,
articles, question bank and glossary retain Knowledge V/E/A. Showing a project
FAQ on a project page does not grant Projects editors FAQ authority. Existing
Projects V checks for actual fact slots/coverage and other cross-tab guards stay.

Inventory: projects and canonical models; brands and asset bindings; FAQ;
sections; selling points; contacts; facts/buildings; facilities/features/places;
asset metadata and context bindings; clips/tours; unit types; prices;
disclosures/sales/programmes/progress; solar scenarios; articles; question bank;
glossary; promotions; website-page configuration (URL, locales, AI policy and
phase selection). Page configuration needs its own Knowledge approval before
publication, so an editable configuration cannot bypass the Manager step.
Use existing immutable version tables where present and
add review versions only for currently unversioned kinds. Read history from
audit/version records, never a second activity log.

Observed defects to cover: web publication currently accepts unapproved FAQ,
sections and media, overwrites FAQ approval actor, rejects a whole stale batch,
and can hide pinned published price/type/commercial content when a new draft is
saved. The new boundary must fix old entry points as well as the new queue.

### W5 — fixed business level

| Field | Decision |
|---|---|
| Feature / owner | Owner-maintained fixed business list; staff edit content/FAQ at the business level |
| Tab | Existing Knowledge for shared business narrative/FAQ; Brands for brand relationships and content; Projects for actual project data |
| View | Fixed business references and authorized scoped content, applicability and history; no hidden descendant payloads |
| Edit | Existing source E drafts business content and explicit applicability; no API/UI creates or renames businesses |
| Approve | Existing source A under W4; shared affected-project rule is applied with W6 |
| Specials | No new special; publication uses W4 N2 |
| Separation | W4 N1 and independent publisher; promotion rules unchanged |
| Templates | No template/account/grant changes; existing scope remains unchanged |
| Agency | No internal business content access |
| Sensitivity | Internal drafts; only approved published projection reaches consumers |
| Other tabs | Brand/project details still require respective V; a business reference grants no broader access |
| Shared surfaces | FAQ composition, coverage, search, entity pages, readiness, assistant, preview and publication; order unit type > project > project group > programme > brand > business > corporate |
| Endpoints / SQL | Read-only GET `/v1/admin/content/businesses`; existing scoped section/FAQ/contacts reads and draft/review routes extended for `business`. Fixed `hub.businesses` and additive brand-business associations, guarded scope validation and composition functions. Exact discovered function/route list required before W5 code |
| Rollout / verification | Seed only residential and new relationship records; no old FAQ rescoping/content rewrite. FORCE RLS, closed catalog writes; scope denial/positive neighbour, inheritance and collision tests, legacy snapshot preservation, runtime inventory and disposable replay |

### W6 — BUD scope and daily sync

| Field | Decision |
|---|---|
| Feature / owner | Account managers preview/confirm content scopes; read-only DW BU relay maintains dated project membership |
| Tab | Existing content tabs and Accounts boundary; `can_manage_users` does not grant content access |
| View | Each grant's V scope: unrestricted or selected exact REM BU IDs plus project exceptions. Every list/detail/search/count/history/file/export/preview filters before returning data |
| Edit | E scoped to affected objects. Shared content may be drafted when scope includes at least one currently affected project |
| Approve | A scoped to objects; shared approval needs all currently affected projects or unrestricted scope (pending owner confirmation; required default). Publication separately applies W4 |
| Specials | No new checkbox. Existing account preview/confirm controls scope changes; existing special actions also enforce object scope |
| Separation | W4 governance and account self/last-manager protections remain |
| Templates | Existing accounts/grants/templates stay unchanged and unrestricted; absence of new scope record means unrestricted for an otherwise authorized grant. New scopes only through explicit preview/confirm |
| Agency | Fixed external profiles unchanged; no BUD-based expansion |
| Sensitivity | Account scope diffs and impacted-account notices are account-manager-only; never content history, assistant, export, RAG or AI payloads |
| Other tabs | Source/destination checks in same transaction; shared objects compute exact affected projects, never substitute brand for BUD |
| Shared surfaces | Every guarded SQL/RLS/API/cache/search/coverage/home task/publication/assistant/export/preview path in docs/47 section 7.2, including next-request revocation and private bytes |
| Endpoints / SQL | Existing account preview/confirm endpoints gain bounded scope input/diff/digest. Proposed GET `/v1/admin/accounts/content-scopes` and `/v1/admin/accounts/bu-sync-runs`; typed object-scope helpers, dated membership and sync run relations, GET `/v1/admin/accounts/content-scope-settings`, POST `/v1/admin/accounts/content-scope-settings/preview` and `/apply` (actual Admin plus account management), GET `/v1/admin/content/bu-notices` (bounded own notices; manager-only failure details). Existing POST `/v1/admin/promotions/resolve` gains a saved identity/revision body only. Exact route/function/policy inventories accompany the migration |
| Rollout / verification | Fixture-only default-deny new scope operations; unchanged existing accounts. Exact `rem_bu_id` keys and unmodified code/name. NULL BUD projects retain unrestricted and explicit per-project access; no BUD assignment is inferred. Dynamic BU moves, project exceptions, mixed/shared scope, revoked caches, preview drift, every runtime deny/neighbour, replay and concurrency |

Daily sync: after DW 16:00 Asia/Bangkok relay; narrow project ID/BU fields/source
snapshot read only. Idempotent dated membership (`valid_from`, `valid_to`, source
snapshot, run). Failed/empty/>48-hour stale input preserves prior membership and
records a warning. Local fixtures plus reviewed 5 October package; no REM read,
DW repository change or business-sheet mapping. Hosted enablement remains STOP
until separately authorized and the dedicated credential is installed by owner.

W6 integration contract for W7: migration 0089 defines private
`hub.require_content_translation_scope(translation_id uuid, required_level text)`
returning void, with closed runtime EXECUTE. It resolves the tracked source,
current affected projects, owning tab and grant scope. W7 calls it for read,
request and completion in addition to its existing source/eligibility checks;
there is no fallback if the helper is missing.

Read-only preparation verified the staged 5 October manifest SHA-256 and
`gold_projects.json` payload hash/length/count: 278 rows, each with all six BU
fields in `gold`, keyed by outer `project_id`. Its exact BU-code counts match
docs/47, including 39 blank codes. The source snapshot is
`2026-10-05T02:50:00.717680+00:00` package capture; membership source evidence retains each Gold BU timestamp from 3 October, not package/fetch time. Raw `projects.json` carries REM identity;
BU membership comes from `gold_projects.json`, not that raw identity file.
No database, source package or credential was changed.

Latest owner-rule refinement, integrated with the W6 design on 9 November:
docs/47 section 7.1 now contains the exact eight-column read contract, complete
48-hour admission checks, independent seven-day stale and move grace, NULL
semantics, dated intervals, account/own-user alerts and effective-access history.
No source connection is made locally. The fixture job and maintenance entry
points accept injected connections; hosted scheduling and credentials stay off.

W3.2 promotion refinement: Promotions View/Edit use the existing any-affected
project rule; DATA/LEGAL approval requires all resolved projects. Individual
references also require their Projects/Brands View scope. Complete impact count
and hash remain server-authoritative; hidden references are projected away and
marked incomplete. Saved scope resolution derives immutable ownership from
promotion_id plus expected_revision. Resolve and save preserve omitted hidden
prior targets/exclusions and deny new inaccessible references. Historical
versions use frozen target_project_ids; reviews use their recorded exact scope
or exact retained revision, never a later unrelated draft. Raw table reads may
not expose references removed by the staff projection. No existing row is
rewritten. All new helpers remain private and the exact resolver RPC stays mapped.

Lead-owned additions: content_promotion_reference_visible(text,text),
content_promotion_scope_input(uuid,integer,jsonb), the promotion projection,
resolver/access/visibility/read/command refinements, business_references scope
filtering and corresponding DTO/browser/runtime tests. Private dated relation
content_bu_membership_interval has FORCE RLS, existing audit triggers and no
runtime grants. The two migrations remain additive and run only in disposable
local test databases during this programme.

### W7 — writing aid

| Field | Decision |
|---|---|
| Feature / owner | Marketing requests Thai/English writing proposals, reviews a diff and explicitly accepts through normal draft save |
| Tab | Existing source Projects, Brands or Knowledge; no new checkbox |
| View | Authorized field eligibility/budget state and actor-owned proposals |
| Edit | Source E plus object scope requests proposal. Existing draft-save permission and optimistic revision apply to acceptance |
| Approve | Unavailable; generation never submits, approves, publishes or changes rights |
| Specials | None |
| Separation | Existing W4 source review rules remain; a proposal confers no authority |
| Templates | No accounts/grants/templates change |
| Agency | Agencies, inactive identities and service consumers denied before generation |
| Sensitivity | Marketing text only. Hard exclusions: Legal/disclosures, sales terms, prices/promotion conditions, finance/investor figures, contacts/customer data. Registry flag defaults off |
| Other tabs | Every source/context is checked with its normal source permission/object scope; no arbitrary prompt/data fetch |
| Shared surfaces | No new assistant tool, RAG, embedding, public feed, export or worker authority. Usage audit contains metadata, not raw proposal/source text |
| Endpoints / SQL | GET `/v1/admin/content/writing-aid/{translation_id}`; POST `/v1/admin/content/writing-aid/{translation_id}/proposals`. Source-resolving guarded SQL, `field_catalog.ai_writing_enabled DEFAULT false`, bounded FORCE-RLS budget reservation/usage relations and closed helpers |
| Rollout / verification | Stub only with no credential access/network constructor. Runtime deny/neighbour, revoked scope, prohibited registry override, stale source, no content mutation, protected token/number multiset, budget race/month reset, ambiguous no-retry and zero network |

Reuse translation protection helpers, not `translation_allowed()` (it allows
ad-disclaimer text excluded by N5). Import the exact existing
`provider_messages.MESSAGES['state_budget']`. Existing monetary ledger is
media-only; writing needs its own operational reservation/usage records following
that mechanism, without altering media budgets or translation jobs. Live writing
allowance stays zero pending owner budget approval. Audit uses existing
`audit.change_log`, not a second content-logging system.

## W3 route and component map (lead's read-only preparation)

Target route proposal: `/website` tree and `/website/[level]/[id]` entity page
with `tab`, phase, field, question, asset and item query context. `/settings`
hosts configuration. Final concrete hrefs are frozen in W3's brief/tests.

| Existing route/components | New placement / retained context |
|---|---|
| `/?project=...`, `HubAdmin`, project editor/source/review/dashboard | Project overview/data; canonical REM model/source history retained; project, version and draft revision query preserved |
| `/?brand=...`, `brand-admin`, `brand-review`, `brand-dashboard` | Brand overview/data/media/history; exact brand and version context |
| `/?view=groups`, `project-groups` | Website tree and confirmed multi-phase project page; unknown grouping stays separate |
| `/content?project=...`, `ProjectContentWorkspace` | Project overview/data: `ContentFacts`, `ContentBuildings`, `ContentNarrative`, `ContentContacts`, `ProjectCommercialWorkspace`, `ProjectAmenities`, website evidence sections |
| `/content?brand=...` | Brand data, existing contacts/narrative/editor |
| `commercial-types`, `unit-type-wizard` | Project unit-type tab; six steps, prices, exact commercial type and source/model context |
| `/media?project=...`, `ProjectMediaWorkspace` | Entity media tab; grid/context/tagging, `MediaClips`, `WebsiteMediaQueue`; source page, fetch time, position, batch maximum 40 and separate rights |
| `/faq` drafts, `FaqWorkspace`, `FaqApplicability` | Entity FAQ tab; page fixes level, missing core first, inheritance/source edit, exact question/FAQ context |
| `/faq?tab=coverage`, `FaqCoverage` | Home and overview readiness; exact question/fact destination |
| `/faq?tab=intake`, `FaqIntake` | Inline FAQ suggestions using existing intake decision commands |
| `/faq?tab=contacts` | Corporate data tab using `ContentContacts` |
| `/faq?tab=bank`, `FaqBank` | Settings standard questions |
| `/faq?tab=glossary`, `FaqGlossary` | Settings standard translations |
| `/content/fields`, `ContentFieldRegistry` | Settings field registry, existing special boundary |
| media tag/requirement controls, `MediaRules` | Settings tag/rule screens with existing permissions |
| `/knowledge`, `KnowledgeReview` | Admin evidence only; FAQ candidates read-only with cluster link; SQL/API legacy accept path closed |
| `/releases`, `ReleasesWorkspace`; `/faq?tab=publication`, `WebPublication` | W4 single publication queue, both histories retained, release/page/item context preserved |
| Existing version/audit readers | Entity history and Admin activity projection, never account/permission rows in content views |

Redirect tests must cover every old path/query combination above for one release.
No readiness action may resolve to a generic list. Existing editor dirty guards
must survive the tab shell; shared source names do not authorize source payloads.

### W3 implementation refinement from the source review

Migration 0083's original read-projection lane also closes the N7 legacy FAQ
write path and adds the smallest website-text command required by section 4.5.
This is an explicit refinement of section 10.1's read-only shorthand: no
migration-time content or review rewrite is allowed. The old intake command
does not save these narrative fields through the current versioned section
writer and cannot represent independent decisions for different projects.

The new runtime command resolves immutable candidate/project applicability and
the finite concept/concept-name/description mapping on the server. It requires
Projects Edit and the canonical object guard, an expected latest decision ID,
and the current section revision. Use/edit-use invokes the existing section
draft save in the same transaction; reject invokes no content writer. Numbers
and prices remain evidence for manual confirmation. Candidate evidence and
wiring are never rewritten. Decisions use bounded metadata events in the
existing `audit.change_log`, following the existing media-request precedent;
there is no second log or new decision table. FAQ suggestions continue to use
`hub.faq_intake_decisions`.

New FAQ/home reads must call the existing composer with gap recording disabled:
the older FAQ composition/coverage wrappers can write gaps during GET. New
activity access checks ACTIVE plus actual `hub_role=admin`, then each source
View/object scope; the account-management flag is not a content permission.

## Test lock and gate protocol

Shared API lease update: B released `main.py`, `content_permissions.py` and
`tests/permissions/*.json` untouched during Wave 1. Lead owns their sequential
W2/W3 registrations; B supplies W4 registration/rule/manifests as a reviewed
handoff patch and does not edit them concurrently. Its existing domain modules
and new W4 modules remain assigned to B.
The same release applies to `test_permission_db_baseline.py`,
`test_permission_feature_coverage.py` and `test_project_content_core.py` under
`apps/api/tests/`. B leaves them untouched and supplies W4 inventory additions
as handoff text; lead owns their W2/W3/W4 integration in order. W3 updates the
legacy FAQ test to assert denial and no mutation, retaining section behavior.

Lock owner: lead only. State: **held — W3 integration and serial local gates**.
Before each run check 55432/8000/3000; if occupied by owner/another process,
report and wait. Never terminate another process. Runner cleanup may stop only
its own disposable services. All port-bound suites run sequentially from main.

Quick gates: admin typecheck; affected UI plus navigation for shared shell;
full API for shared API files; full DB plus permission API selection for SQL.
Full gate once per completed workstream: typecheck, documented offline webpack
build, production install/import gate, full API, DB, UI including 1280/390,
H1 where paths change, disposable migration replay, changed-source and browser
bundle credential scan. Fix failures with targeted quick gates before the next
full gate. Never skip/quarantine/weaken a test to obtain a pass.

Before each commit: explicit path review, `git diff --check`, credential scan,
`git check-ignore` for local credential paths, then explicit staging only.
After passing: commit to main, push, record hash and receipts here. Screenshot
evidence stays ignored under `artifacts/`, never force-added.

## Pending-question registration

Registered Q77–Q82 after the existing Q76 in
`apps/api/sena_hub_api/data/questions.json` and `docs/ads/OPEN_QUESTIONS.md`:
DW narrow BU relation/credential; official vector logo/brand colors; shared-level
approval scope rule; Online Marketing publisher accounts; writing monthly
budget; additional businesses/timing. Lead owns both files. Catalog/document
agreement check passes for all 82 IDs; UTF-8 question text is in the catalog.
API quick verification passed (20 tests). No business answer or grant is inferred.

## Delivery receipts

### Preparation

- Commit/push: `5a087ea`, confirmed on origin/main. No implementation commit yet.
- Migrations: none added/applied; lane reserved above.
- Agents: A shell/UI review; B full content/publication inventory and permission
  card; C full hosted safety review and writing/budget design. All read-only
  worktrees clean at handoff.
- Quick gate: question API **20 passed, 0 skipped, 0 failed**. Initial run
  correctly found five assertions still pinned to Q76; their exact expected ID
  set now extends to Q82 and the rerun passes. All 81 migrations replayed in
  the disposable database. Catalog/doc agreement **82 IDs**, diff check passed.
  The first sandbox attempt failed before database startup on Windows
  `uv_os_get_passwd` / `ENOMEM`; the approved outside-sandbox runner succeeded.
  Full W1 gate not yet run. No browser screenshots yet.
- Deviation: three-agent wave plus lead W3 map due available slots; existing
  navigation destinations used during W1; writing has no reusable generic
  monetary ledger, so uses separate operational state following current pattern.
- Resolved blocker: credential-harness clarification above. Harnesses unchanged.
- W1 ownership extension: A may change `apps/admin/components/brand-admin.css`
  and `apps/admin/components/project-content.css` only to correct action-fill
  text contrast in both themes. These files have no concurrent owner.
- A also owns `apps/admin/components/completeness-bar.css` for the same theme
  correction. Eight frozen core files were reviewed and copied to main after
  A's admin typecheck passed; docs/specs and this final token fix follow.
- All 18 W1 paths are now reviewed and integrated. Main typecheck and the
  preliminary offline build passed. A's static contrast audit covers 61 pairs
  in each theme (zero failures); browser confirmation is pending. The agent's
  Playwright listing loaded 70 local and 22 H1 cases without parse failures.
- First affected browser run: **66 passed, 0 skipped, 4 failed** (navigation,
  mobile focus containment and two palette/tooltip cases). Failure evidence is
  under `artifacts/playwright/`; receipt is
  `artifacts/unified-workspace/w1/quick-ui.log`. Fixes and targeted rerun precede
  the full gate; no test is skipped or weakened.
- Reviewed fixes: mobile and tablet shell dialogs/backdrops now disable the
  inherited animation; screenshots assert opaque stable state. Tests use the
  existing brand destination for View/Edit users, scope the duplicate home
  link, measure browser-normalized RGB colors, and exercise real keyboard
  focus for tooltips. Main offline rebuild passed on these fixes.
- Targeted rerun after the fixes: **40 passed, 0 skipped, 0 failed** across
  navigation and assistant. Receipt:
  `artifacts/unified-workspace/w1/quick-ui-rerun.log`; updated light/dark,
  1280/390, rail, focus and tablet screenshots are in the same directory.
  Proceeding to the complete W1 gate on the frozen integrated tree.
- Screenshot review then found a mobile tooltip below the viewport after
  focusing the last Settings item. A fixed its mobile position and added full
  viewport/content-bound assertions, retaining all contrast thresholds. The
  updated offline build passed; both light/dark focused cases passed (**2/0/0**).
  The close button's partial position in that screenshot is ordinary drawer
  scrolling caused by focusing the final item, not a layout or animation fault.
- W1 full gate so far: typecheck and offline webpack build passed; production
  install/import isolation **4 passed, 0 skipped, 0 failed**; API **2,152 passed,
  11 existing opt-in skips, 0 failed**; DB **95 Node tests, 37 SQL suites and
  10 concurrency scripts (23 reported scenarios), all passed, 0 skipped/failed**.
  All 81 migrations replayed. Changed-source plus browser-bundle credential scan
  found **0 matches in 108 files**, with no credential files read. Browser and
  H1 full gates are still pending completion. Receipts are under
  `artifacts/unified-workspace/w1/`.
- W4 automatic approval review rejected the addition of
  `hub.content_rem_values(project_id)` to a Manager approval snapshot twice,
  treating REM-derived staging as forbidden REM access. The verified helper in
  migration 0058 reads only local `staging.dw_projects` joined to `hub.projects`.
  The owner expressly authorized this local-staging read on 4 November; live
  REM connections remain prohibited. Retry is authorized with value-only
  comparisons of fields actually used/displayed, excluding source timestamps
  and BU membership. Relevant drift requires re-approval with before/after REM
  evidence and existing audit history; identical-value reimports do not.
- Owner W6 steering supersedes the earlier sync design: use the delivered
  `serving.hub_project_bu` eight-column contract (DW commit `3b425c0`), read
  contract documentation only, fixtures/fake clock locally and no DW connection.
  Membership is stored separately from content staging. Accept only complete,
  unique project IDs and non-null, non-future snapshots at most 48 hours old;
  reject the whole invalid refresh and retain last-good data. One admin setting
  defaults to seven days: stale BU-based grants end seven days after their source
  snapshot; A-to-B moves grant B immediately and retain A for seven days.
  Unrestricted/per-project grants remain. Account-manager/user alerts on
  failures, stale day 5/day 7 and moves, project handover banners, and effective
  access history are required. Update docs/47 section 7.1 in the W6 design
  commit, not this W1 commit. The relay skipped 29/31 October and 1 November.
- Next: complete W1 and parallel W4/W7 backend; questions are registered.

### W1 — service shell and theme

- Commit/push: `93b04cc29a3fd65a8b442e78c046aa2adaa279e4`
  (`Build unified workspace service shell and SENA theme`). Normal push to
  `origin/main` succeeded (`5a087ea..93b04cc`); local HEAD and origin/main both
  resolve to that full hash. This follow-up receipt changes documentation only;
  the tested implementation is unchanged.
- Built: permission-filtered service/group navigation, six content menu items,
  unchanged Ads destinations, Settings and bottom utilities, SENA logo/mark,
  persistent desktop rail, tablet overlay, mobile drawer, full labels on keyboard
  focus/hover, reduced motion and light/dark semantic palettes. Assistant sidebar
  entry removed; its existing local floating entry remains for W2 integration.
- Migrations: none. Question catalogue Q77–Q82 registered as programme preparation.
- Full gate: admin typecheck **passed**; offline webpack build **passed**;
  production **4/0/0**; API **2152/11/0**; DB **95 Node tests + 37 SQL suites +
  10 concurrency scripts (23 scenarios), all passed, no skips/failures**;
  local UI **308/0/0**; local H1 **68 Node + 10 smoke + 51 browser checks,
  all passed, no skips/failures**. Counts use passed/skipped/failed order.
  Disposable replay covered all 81 migrations. Existing API opt-in cases remain
  unchanged; no test was skipped, quarantined or weakened for this programme.
- Credential scan: **108 changed-source/bundle files, 0 matches**, no credential
  files opened. All five credential paths pass `git check-ignore`; diff check
  and question catalogue/document agreement (82 IDs) pass.
- Screenshots: `artifacts/unified-workspace/w1/local-{light,dark}-1280.png`,
  `local-{light,dark}-390-reduced.png`, `local-sidebar-{1280,1024,390}.png`,
  rail/focus/tablet-overlay images, and `h1-{light,dark}-{1280,1024,390}.png`
  plus H1 drawer images. Lead inspected local/H1 desktop and mobile evidence.
  Browser contrast checks cover 61 pairs per theme, text >=4.5 and UI >=3.
- Logs: `typecheck.log`, `offline-build-final.log`, `production.log`, `api.log`,
  `db.log`, `ui.log`, `h1.log`, `credential-scan.json` in that artifact directory.
- Deviations: W1 keeps existing destinations until W2/W3/W4 take their serialized
  integration slots; dark mode was added because the old app was light-only.
  Official vector artwork/brand colour confirmation remains Q78. No additional
  pending question arose from W1. The initial four quick-browser failures and
  screenshot-found tooltip clipping were fixed and verified above.
- Agents: A implemented the shell, palette, documentation/skill and browser
  checks; lead reviewed every changed file, integrated explicit paths and ran
  all full gates. B prepared W4 governance in parallel. C delivered the stub W7
  backend and read-only W3/W6 designs; their changes are not in this W1 commit.
- Next: W2 home/search/assistant with lead; W3 UI and backend in new isolated
  worktrees from committed main. W4 backend continues in parallel. Local only.

## W2 projection correction assignment (active)

Agent B froze W4 without committing. Its read review found native returned
revisions missing from home, incomplete item-family coverage, source/object
eligibility gaps, and no Brands-only readiness. B now works in
`D:/Personal/workspace/sena_hub_wt/w2-home-projection`, branch
`ws/w2-home-projection`, cut from main `2387dd3`. It owns exactly
`supabase/migrations/202611040082_workspace_home.sql` and
`supabase/tests/workspace_home.sql`. Lead pauses edits to those paths while B
owns them. All API, UI, shared registration/inventories, docs and other files
remain lead/A/C-owned. W4 files stay frozen in their earlier worktree.

Implement docs/47 sections 4.3, 4.6 and 8.2: source/object-scoped read-only
search, all existing native personal task families with exact version context,
literal REM BU identity, separate fact expiry/review dates, readiness targets,
and brand readiness independent of Projects View. Add private finite
`workspace_content_tasks(bud,brand)` as the W4 replacement point, deriving the
caller internally. Never use the Projects readiness array as FAQ authority.
Home stays a no-write projection. No legacy draft/source/account/grant rewrites.
Done means reviewable SQL and meaningful SQL regressions, syntax/PL parsing and
diff checks; lead performs the disposable replay/API/DB gates from main.
B may run only syntax/static checks without ports. No credential files, ports,
commits, pushes, shared inventories or unallocated migrations.

W2 quick API attempt: 17 passed, 1 failed (42702 ambiguous SQL alias in home).
The project alias was corrected before copying the two files to B. Test lock
is released after harness cleanup; no local stack is running. UI typecheck
passed after the initial search/assistant changes. The home implementation
and remaining projection review are still in progress; this is not a full gate.

UI copy gaps are resolved by the additive docs/47 section 8.5 catalogue. It
centralizes shared labels before they are copied into new components and does
not change business rules or permissions.

W3 A ownership extension: `apps/admin/components/media-rules.tsx`, solely
stable `tags`/`requirements` section IDs on the existing editors so Settings
links resolve exactly. No overlap with another agent or permission change.
Also assigned A `tests/ui/unified-workspace-helpers.ts` for the shared typed
workspace fixture/navigation adapters in its existing owned browser specs;
all prior save, denial and dirty-state assertions remain required.

W2 production check: initial sandbox invocation failed the import isolation
check with RuntimeError; the unchanged documented runner passed outside the
Windows sandbox (four tests, zero skipped/failed; no writes/network/provider
calls in the self-check). No configuration loading or guard was changed.

Lead owns `playwright.config.ts`. W2 makes the full local browser suite run in
two sequential projects at 1280 and 390 pixels, as docs/47 section 10.3 asks.
Tests with explicit viewport overrides keep their wider responsive checks.
H1 keeps its existing separate simulation selection and responsive cases.
W1's recorded 308-test run used the previous base viewport plus its explicit
1280/1024/390 feature checks; W2 also rechecks the shared shell in the complete
two-project run. No harness configuration/credential loading is changed.

B's W2 projection correction is integrated after lead review of both files;
the two-file lease is now returned to lead. Handoff migration SHA-256:
`9a724cf635d22aa8500acfcfdac52444fd0e17ddb5e2d99dab2f5dceddfde20e`.
Static parser: 18 migration statements/9 PL functions; SQL suite 44 statements/
10 DO blocks. No source data, accounts or grants are rewritten by migration.
The SQL regressions mutate only rollback-protected disposable fixture data.
No runtime pass is claimed before the following quick gate.

W2 integrated quick gate: migration replay passed; 25 API checks passed and
one transactional SQL regression failed because its synthetic DW row omitted
the required `project_id`. Lead corrected the fixture. Lead also closed B's
reported inherited-only unit-price gap by composing every current unit context,
retaining deduplication for shared project facts, with an API regression.

## W4 integration follow-up assignment

B resumes only its existing worktree `w4-governance`, with a narrowed lease on
the two allocated migrations (0084/0085), the two new SQL suites and the two
new API test modules. Existing domain/API modules stay frozen. Add the W2
private task-hook replacement and the W3 finite history extension for review
versions, using existing audit data and current source/object guards. Retain
authorized first-draft read-only preview when publication becomes APPROVED-only.
No raw payload/account/staging expansion, migration data rewrite, new migration,
credential, port test, commit or push. Lead owns all shared registrations.

For the retained-version English-reviewer issue, do not retry the previously
rejected guard removal unchanged. Any refinement must positively verify the
exact included approved version and every frozen editor/reviewer/approver,
deny missing evidence, and prove that newer draft reviewers are not treated
as contributors to older included versions. Docs/47 N2 applies to the included
version. Report any unresolved automatic-review rejection; continue unaffected
work. Lead reviews the final diff and runs all runtime gates from main.

W3 retained-workflow placement: `/website` stays the hierarchy tree, with
permitted links to `/website?view=projects|brands`. Those views embed existing
source choosers, creation/request and brand-review workflows under one shell.
Legacy root list URLs redirect there; groups redirect to the confirmed tree.
A uses its existing owned project/brand components. No new grouping or
permission behavior is introduced.

W2 integrated API/SQL quick gate now passes: 27 passed, zero skipped/failed,
including all transactional SQL assertions and inherited unit-price context.
Both fixture issues (required staging project ID and a local SQL alias) were
fixed without changing production constraints. Migration 0082 replay passed.
The working database and file stores were not used. Full gate is not yet run.

W3 safe default retained: automatic approval review rejected changing new
website-suggestion Use drafts from `ai_exposure=internal` to the registry's
ordinary default because it could persistently broaden exposure without
explicit authorization. C retained the internal draft default; existing draft
exposure stays preserved, and explicit ordinary editor saves remain available.
The suggestion still creates only a draft. No workaround or permission prompt
is needed for this conservative implementation; include it in the W3 receipt.

W2 browser quick gate: 93 passed, 19 failed, zero skipped. Failures exposed
a home grid minimum-width issue under 200% text and desktop-only drawer
assumptions in old navigation tests. The home readiness assertion now opens
the existing details control. The lead owns the two navigation specs and new
`tests/ui/hub-navigation-helpers.ts`; all denial, focus and target assertions
remain. C also found internal unit UUIDs in W2 navigation: contexts now use
`public_commercial_type_id`, preserving internal media binding target keys.
These corrections are under repeat quick validation before the full gate.

## W6 design preparation assignment

C's W3 five-file handoff is frozen for lead integration (33 tests collected,
no runtime pass claimed). While W2/W3 gates run, C prepares design only in
`D:/Personal/workspace/sena_hub_wt/w6-scope-design`, branch
`ws/w6-scope-design`, cut from `2387dd3`. This advances design review without
advancing W6 implementation ahead of W4/W5.

Owned files: docs/47 section 7.1 (replace with final owner rules), and an appended
W6 concrete design/inventory section in that worktree's docs/48. The lead will
merge those exact sections in the W6 design commit; do not copy whole documents
over newer main work. Forbidden: every other file, credentials, port commands,
commits/pushes, live REM/DW connections, DW repository writes, hosted resources.
Read only the named DW contract section and Hub source, including frozen W3/W4
branches, to inventory every affected guard, policy, API/cache/export/assistant/
worker and corresponding deny/neighbour regression. Propose precise file leases
for scope/permission versus sync versus UI implementation, and the minimum
finite canonical object guards. Preserve no-record=unrestricted for existing
grants; account management alone never grants content. Keep sensitive account
scope history out of content/assistant reads. Require exact-value eight-column
validation, fake-clock fixtures, dedicated membership tables, 48-hour acceptance,
7-day stale/handover behavior, admin setting, alerts and effective-access audit.
No caller-controlled clock can weaken authorization. No implementation code yet.

Done: updated section 7.1 exactly reflects the latest owner reply; explicit
finite inventory and permission card refinements cover all section 7.2 paths;
no new unresolved safety issue or guessed grouping/source mapping. Allowed
checks: document diff/UTF-8/whitespace and read-only code searches, no ports.
Use docs/47 sections 7 and 10 plus the owner final 4 November clarification.

W3 preservation follow-up before final freeze: C may change only 0083's
workspace_faq envelope, test_content_workspace.py and content_workspace.sql to
expose authorized unmatched legacy FAQ clusters (no approved question mapping),
with exact targets and existing hold/reject/propose-question commands. A adds
its typed display in owned FAQ components. N7's old FAQ accept path stays closed.
C refreezes this narrow change before continuing W6 design. Lead W3 integration
will retain the existing guarded FaqCoverage component at
`/home?section=coverage`, with original project/phase/filter context; W2's
ordinary home summary is unchanged. This preserves old workflow access during
redirect migration rather than silently stranding unmatched evidence.

W2 first full API: 2176 passed, 11 existing opt-in skips, 3 failed. Two exact
inventory assertions needed the newly registered two-route shared boundary;
the third exposed a record alias typo in the public-unit-context correction.
Lead corrected the alias, added the exact two-entry classification assertion
in test_permission_shared.py and extended the existing route count. No guard
or test was weakened. Migration profile 0082 hash refreshed before replay.

W2 corrected API quick gate: 29 passed, zero skipped/failed; replay 0082
passed. All three full-API failures are covered in this quick selection.

W2 browser correction run: 56 passed, 10 failed, zero skipped. All responsive
navigation/permission interactions pass; the remaining repeated failures are
the new home test's exact label selector (the combobox accessible name is
correct) and local persona-selector overflow at 200% text. The test now uses
that combobox role/name and the new home wrapper constrains the local selector.
The native details control is exercised before asserting its readiness link.

W2 final browser quick gate: 48 passed, zero skipped/failed. Home/search
light/dark, 1280/390, keyboard, 200% text, reduced motion, inherited target,
revocation, abort and assistant-prefill regressions pass. Full gates restarted
on the corrected candidate; no W3/W4 implementation is integrated yet.

## W5 read-only design assignment

B's W4 backend follow-up is frozen for lead runtime review. B now inventories
W5 in `D:/Personal/workspace/sena_hub_wt/w5-business-design`, branch
`ws/w5-business-design`, cut from `2387dd3`. Owned writable files: none;
return findings to lead, who appends the design here. This avoids a concurrent
docs/48 lease with C's W6 design. No implementation before the detailed card
and W4 integration; this is read-only preparation under docs/47 sections 6/10.

Read current main plus frozen W3/W4 files and identify exact constraints,
functions, RLS policies, route models, proxy validators, UI inputs, inheritance,
search, readiness, history, assistant and both publication/private-preview
composer clones needing business support. Propose precise disjoint code leases
and runtime positive/deny/inheritance/conflict/snapshot tests. Use reservation
0086 only for later implementation. Fixed residential catalog, additive
brand-business relationship rows, no existing brand/FAQ/content rewrite, no
account/grant/template change, no create/rename catalog UI/API. New brands must
also have an explicit fixed-business relation. Copy the residential label from
docs/47 when implementing. No guessing business-sheet or BUD mapping.

Forbidden: all writes, port commands, credentials, hosted actions, live providers,
REM/DW connections or DW repository changes, commits/pushes. Done: concrete
finite inventory, smallest design and missing decisions identified with reasons;
no blanket table/function replacement or undocumented access widening.

W3 source-ownership correction from lead review: canonical project/brand page
guards were accidentally also gating Knowledge-owned FAQ targets. Existing
FAQ View/Edit/Approve authority must remain independent; Projects View is
additional only for fact slots/coverage and project details. C's W6 document
work is paused. Reopened only 0083 and its API/SQL tests for a private exact
FAQ-reference guard and minimal FAQ/history entity envelope when source View
is absent. Do not change content_scope_access or grant source data. Such pages
omit source sections/readiness/preview and skip fact composition; resolver and
history admit only current Knowledge-owned FAQ/intake contexts. Existing
minimal reference names are the ceiling. W6 later strengthens the new helper's
Knowledge object scope. A tests this envelope and verifies no unauthorized
project/brand editor API is fetched. All ordinary source guards stay intact.

## W4 standalone UI preparation assignment

A's W3 63-file handoff is frozen; receipt and exact file hashes are in its
worktree artifacts/unified-workspace/w3/ui-handoff.json. While lead gates W2
and integrates W3, A prepares only new W4 UI files in
`D:/Personal/workspace/sena_hub_wt/w4-workflow-ui`, branch
`ws/w4-workflow-ui`, from `2387dd3`. This advances independent components after
the W3 page contract is frozen; existing-form wiring waits for W3 integration.

Owned new files only: apps/admin/components/content-workflow.tsx,
publication-workspace.tsx, content-workflow.css;
apps/admin/lib/content-workflow.ts; apps/admin/app/publish/page.tsx;
tests/ui/content-workflow.spec.ts, unified-publication.spec.ts and
unified-publication-h1.spec.ts. All existing files (including W3 frozen files),
shared shell/nav/tokens, API/SQL/manifests/scripts/docs are forbidden to edit.
No W3 overlay or credential/config copies. A can read frozen W3/W4 contracts
and use existing stable helpers. Lead will later allocate precise form wiring
and shared proxy/navigation work after W3 passes.

Implement docs/47 section 5: reusable exact-item read/status/submit/approve/
return/FAQ-withdraw controls, optional normal-form changes for atomic
save-and-approve with required reason, stale handling that preserves typed
values, explicit per-item outcomes and submit-all support without hiding
individual failures. The page queue groups approved web/release targets,
prepares a concrete review, publishes only via existing special, shows each
accepted/rejected result and retains both publication histories and original
withdraw/rollback paths. Do not create a generic JSON editor or a new workflow
state store. No account/special configuration UI changes. Ordinary source
View/Edit/Approve plus server flags govern controls; editors/reviewers/
self-approvers never gain publisher bypasses.

Copy Thai labels from main docs/47, report missing catalogue keys to lead.
Preserve keyboard focus, error recovery, minimal motion, dark/light contrast,
390px overflow and explicit final publishing click. New API DTO gaps are
reported as concrete integration needs, never guessed authority or silently
empty actions. Done: types/static checks and regression specs ready, exact
form-integration contract and file list handed back, no claim of runtime pass.
Allowed checks: admin typecheck and no-port test collection/static checks.
Forbidden: port commands, credentials, external services, commits/pushes.

### W4 review DTO correction lease

A identified concrete missing authority and review data in the frozen backend.
B may reopen only 0084, 0085, content_workflow.py, publication_queue.py,
web_publication.py, their existing W4 API tests and the two W4 SQL suites in
the W4 worktree. Add authoritative action flags (including self-approval reason
and exact FAQ withdrawal eligibility), finite human-readable item descriptors
with workflow identity/hash and exact workspace targets, and concrete prepared
publication review data. Extend the existing publication-read contract rather
than inventing another review endpoint. Partial publication eligibility must
not be replaced by an all-items preflight failure; preserve every item outcome,
source View, special permission, immutable snapshot and contributor check.
No other branch/files, broad grants, ports, credentials, commits or pushes.
Done: precise DTO handoff to A, targeted static checks and positive/deny/partial
regression cases ready for lead runtime gates. C's limited 0083 FAQ correction
remains independent; coordinate any history replacement anchors explicitly.

W2 browser corrections retain all permission and money assertions. Lead owns
the additional test-only adaptations in permissions-uat.spec.ts,
ads-finance.spec.ts, brand-review.spec.ts and brands.spec.ts: new home landing,
opening the mobile drawer before inspecting navigation, responsive cell names,
and finding the test's own brand independently of list pagination. W3's frozen
diff will be integrated without overwriting these W2 corrections.

### W5 finite design review received

B completed read-only design in ws/w5-business-design; its worktree is clean.
0086 adds the fixed businesses(code,label) catalog and brand_business relation,
residential associations for current brands, and a closed AFTER INSERT brand
trigger for future brands. FORCE RLS, owner-only writes, guarded reads and the
existing audit system apply. Existing brand/FAQ/publication/account/grant rows
are not rewritten. Business membership does not bypass CONT-43 applicability:
empty rules match nothing; unit > project > group > programme > brand > business
> corporate applies only to explicitly matching answers, preserving conflicts.

Finite inventory: section/contact scope constraints; question default level;
cluster suggested level; web page type; assistant citation entity type;
save_faq validation; content_scope_tab/access/allowed and the new private FAQ
scope helper. Extend faq_rule_projects, faq_applicability_preview,
faq_references, compose_project_faq and publication_compose_faq; workspace
projects/name/tree/faq/impact/resolve/page/preview plus search/context/filter
matching and finite history mapping. Verify existing submit/intake/coverage,
section/contact RLS, translation and workflow/task wrappers rather than
replacing them blindly. No invented required business fields or narrative copy.

Both public and private preview composer graphs need business scope:
web_compose/content_preview_compose, web_scope_faq/content_preview_scope_faq,
their section/project/FAQ dependencies and approved inheritance. Classify fixed
catalog dependencies explicitly in web_source/publication_certificate; they
are never editable workflow items. Retained snapshots and contributor checks
must remain unchanged.

Backend lease to allocate after W4: 0086, business_level.sql, business_content.py
and tests, content_workspace/faq_coverage/faq_intake/faq_clusters validators,
both PageKey models (web_publication and publication_queue), workspace_home
target adaptation. UI lease: business references/labels in faq-bank,
faq-workspace and faq-intake; entity-workspace data editor; exact tree/search/
publication targets. Lead keeps proxy, shared registrations/inventories and
gate scripts. Assistant lease: assistant.py, assistant_tools.py, hub-assistant
and their tests. Extend existing search_content with bounded canonical FAQ
evidence and exact citations; preserve thirteen tools and source reauthorization.

Runtime cases: catalog write denial, new-brand association, invalid/neighbor
scope denial, Knowledge-only FAQ, all seven precedence levels and same-level
conflicts, explicit applicability, unit context, business/brand/corporate
preview, history targets, unchanged published history, N2 contributor
separation, assistant citation revocation. No additional residential decision
is needed; additional businesses remain Q82. This is design only, not a claim
of implementation or tests passed.

Lead W3 review found the activity log sends bare date inputs while its API
requires timezone-aware timestamps. Reopen only content-activity-log.tsx and
the existing new unified-workspace UI spec in A's W3 worktree for Thai calendar
day boundaries (+07:00, inclusive end of selected day), retaining all other
filters and permissions. A refreshes the frozen receipt after typecheck and
the date-query regression. No other W3 files reopen under this correction.

Additional W3 permission review: Knowledge-only users need to discover the
minimal FAQ entity pages, not only reopen an existing FAQ link. C may reopen
0083 and its two tests for tree/search discoverability using only the existing
FAQ-reference name/code ceiling and exact FAQ scope helper. Such results target
FAQ, never source editors, readiness or facts. The ordinary Projects/Brands
guards remain unchanged. C then verified that the existing corporate composer
has an explicit question-bank show_on_project_pages opt-in for global corporate
answers (docs/41 K3 and its specificity regression). Preserve that existing
composition behavior in W3; affected counts must follow the same opt-in and
manual/rule applicability instead of inventing a count. Business membership
alone never supplies applicability. This refines the earlier proposed removal
after checking the actual contract; no content is rescoped or rewritten.
This is a correction to the existing W3 card, not a new grant or scope policy.

W2 first full browser matrix completed: 593 passed, 37 failed, 0 skipped.
Desktop had two old landing-URL expectations; mobile additionally exposed
closed-drawer assertions, desktop-only initial assumptions, responsive money
cell names and fixed write fixtures repeated against one database. Subsequent
full runs use PLAYWRIGHT_VIEWPORT_WIDTH=1280 and 390 in separate unchanged
disposable harness invocations, documented in docs/11. All specs and assertions
remain; no quarantine or skip. Lead also owns test-only corrections in
project-dashboard, project-groups, questions and residential-operations specs.
Tests with an explicit desktop-then-mobile flow now establish their first
viewport explicitly. W3 frozen diffs must preserve these corrections.

A may additionally correct only legacyWorkspaceHref in its W3
lib/unified-workspace.ts: preserve explicit root tab=faq for minimal FAQ search
targets, with the existing leased UI spec regression. No source permission or
other URL mapping changes under this addition.

B's W4 DTO review also identified a prepared-release hash gap: reapproving a
child can change the payload without changing the parent revision. The existing
0085 correction lease includes recomputing and comparing that certified hash
inside the publication transaction before release_publish. Reject only the
stale item and preserve other valid outcomes. Add unchanged and child-change
regressions; no additional authority or workflow store is introduced.

W2 correction quick gate: 116 passed, 0 skipped, 0 failed in the fresh 390px
disposable run (7.0 minutes), covering every failing spec plus navigation and
home. Repeated fixture collisions disappeared; exact permission, financial,
publication and history checks remained. Final typecheck passed. Credential
scan: 129 files, zero matches, credential_files_read=false. Question sync:
82 IDs agree. Final serial DB/H1/API/1280/390 gate now starts from this code.

W2 final DB gate passed, including 0082 and disposable replay. H1 stopped before
browser execution: the historical combined-release rehearsal deliberately
admits exactly migrations 79/80/81, while the new canonical profile contains
0082. The rollback probe surfaced ERR_ASSERTION because its expected SQLSTATE
42883 was preempted by the historical runtime-upgrade guard. No hosted action
was attempted and no credential was read by an agent.

Lead owns the narrow H1 correction in scripts/simulate-hosted-test.mjs,
scripts/supabase-test-migrations.mjs and tests/supabase-test-migrations.test.mjs.
Retain every historical prefix, rollback, Auth, privilege and worker test against
the exact 81-migration baseline. After those pass, rehearse and attest newer
canonical migrations on the verified disposable loopback database only, then
verify the full checksum history and harmless replay. Hosted admission remains
held at the existing release; config/credential loading is unchanged. Add a
non-loopback/working-database rejection test before any SQL is issued.

### Additional independent preparation assignments

B's W4 DTO handoff is frozen. B now independently reviews W3 from
`D:/Personal/workspace/sena_hub_wt/w3-review`, branch `ws/w3-review`, base
2387dd3. Writable file lease: none. Read C's frozen 0083/API/tests and A's UI
contract, concentrating on object/source authority, minimal FAQ references,
exact context targets, bounded history masks, projection side effects and N7.
Return concrete defects with lines and a minimal correction; do not modify
either frozen branch or run ports. Lead integrates conclusions and owns docs.
Done: finite review findings or explicit reviewed boundaries, not a runtime
pass. W4 and W5 handoffs remain untouched.

C, after completing the W6 design handoff, prepares only new reusable W7 UI
files in `D:/Personal/workspace/sena_hub_wt/w7-writing-ui`, branch
`ws/w7-writing-ui`, base 2387dd3. Exact lease: components/writing-aid.tsx,
components/writing-aid.css and lib/writing-aid.ts under apps/admin;
tests/ui/writing-aid.spec.ts and writing-aid-h1.spec.ts. Existing forms, common
inputs, API, SQL, shared navigation/permissions, docs and other worktrees are
forbidden to edit. Existing-form wiring waits for W6 and a separate lease.

Implement docs/47 section 8.3 against C's frozen backend: registry-controlled
default-off eligibility; Thai/English modes; server proposal request; explicit
before/after review; accept through a caller-provided ordinary revision-checked
draft save, reject without mutation. Never silently replace an unsaved field;
the current form value and source revision must still match the reviewed input.
No submission/approval/publication, live provider, auto retry after ambiguous
response, raw text logging or permission inference. Preserve focus, reduced
motion, contrast and 390px layout. Copy Thai strings from main docs/47 and
report missing keys. Cases cover deny/disabled, no autosave, explicit accept,
stale edits, revoked authority, protected tokens, ambiguity and budget message.
Allowed: typecheck/collection/static checks, dependency-only links if needed;
no credential/config copies, ports, commits or pushes. Done: typed callback
contract, standalone UI/specs and exact later wiring map; no runtime claim.

A's W4 form map found a stale-form boundary: a workflow hash loaded later must
not authorize fields still based on an older form stamp. B may reopen only
0084's workflow-read DTO and its existing W4 API/SQL tests to expose authoritative
source_revision/source_updated_at (nullable for kinds without those fields).
No source payload or new authority is returned. UI wiring must match those
stamps to the loaded normal form before save-and-approve, preserve dirty input
on conflict, and require an explicit parent-form reload before refreshing the
hash for that draft. The changes value stays the ordinary writer's inner
payload; expected-version wrappers are not merged into content fields.

B's independent W3 review found W4 compatibility work: W3 confirms grouping
using the old published _publication.approved_by, while W4 records publisher
metadata and pinned item certificates. Reopen only the W4 0085 grouping helper
extension and W4 tests to accept verified pinned page-config approval for the
exact configuration revision. Preserve legacy approval evidence, ambiguity,
same-brand and every-source authority checks; published_by alone is never an
approval. Regression must retain confirmed grouping after a new W4 multi-phase
publication and deny unapproved/mismatched evidence.

H1 correction quick evidence: 15 operator unit tests passed; Auth-write inventory
passed (82 migrations/89 scripts). The first smoke correction stopped at
SQLSTATE 42501 because an added SHOW data_directory probe requires a privileged
server setting. Removed that new probe from the non-superuser migration path;
the unchanged simulation marker/path/address guard and initial admin-owned
data-directory verification remain. No role privilege was added. Second smoke:
historical H1 checks, attested 0082/replay and 10 smoke tests passed.

B's W3 review found unversioned audit events have nullable version number/state,
but ContentTimeline called toUpperCase on state unconditionally. Reopen only
A's W3 content-history.tsx and existing unified-workspace.spec.ts: model the
nullable contract, render only present version metadata, and test ordinary
project/brand edits without a version state. Keep all source/date/reason/diff
content and permissions; no SQL or other W3 file changes under this lease.

A refroze the nullable history correction with an ordinary project and brand
edit regression (no version metadata and no browser page errors). Typecheck and
13 test collections passed. B's independent finite W3 review parsed 47 SQL
statements and 32 PL blocks, checked Python ASTs and left its review worktree
clean. No additional source/Knowledge authority leak or GET mutation was found.

Two further W3 corrections are assigned before integration. A may reopen only
entity-workspace.tsx, faq-workspace.tsx and unified-workspace.spec.ts: render
changes_since_publication as ContentEvent/ContentTimeline, and consume an
authorized exact selected-question projection so a FAQ deep link beyond the
first 50 questions remains exact. Preserve normal filtering and paging. A also
owns a precise website-content-review.spec.ts correction: the two media image
queue URLs retain tab=website; only the content nearby-text URL uses tab=places.
No other test assertions change under this lease.

C pauses standalone W7 UI for the matching W3 backend correction, owning only
0083, content_workspace.py, test_content_workspace.py and content_workspace.sql
in the existing W3 API worktree. Add a bounded exact-question lookup/projection
under identical entity, phase and scope authority, with over-50 questions,
unauthorized, neighbouring and missing-target regression cases. Keep private
ACLs and the nine W4 history extension anchors. A and C coordinate the explicit
response contract, then return updated hashes/static evidence and refreeze.
No ports, commits, pushes or shared-file writes by either agent.

C handed off W6 design in its isolated worktree: docs47 section 7.1 replacement
and a finite security/ownership appendix to docs48. The lead will review and
merge only these sections with W6 design; existing main documentation additions
are preserved. No W6 implementation or connection has occurred. W7 canonical
writing-status copy was added to docs47 for exact UTF-8 reuse by C.

W2 final serial gate progress: the second final DB suite and final H1 rehearsal
passed, including the new 0082 attestation/replay, all historical checks and
browser coverage. The same lead-held serial session continues with full API
and separately isolated 1280px and 390px browser suites. Main code is frozen
during those runs; only programme documentation is being updated.

W3 correction contract refinement: C preserves the existing workspace_faq SQL
signature/ACL and adds a finite exact-key discriminator internally. The existing
FAQ HTTP route accepts question_key, exclusive with q/after, returning the same
envelope with at most one authorized approved-bank question and null cursors.
Normal search/pagination remains unchanged; missing/unapproved keys return no
row. A loads this target independently, preserves the list filters/cursors and
deduplicates an already visible row. The lease includes the single authoritative
changes_since_publication type line in lib/unified-workspace.ts (type-only
ContentEvent import), and the .workspace-preview CSS rule plus regression: a
white/light-color-scheme plate keeps default-black preview HTML readable in the
dark app theme.

Lead reviewed C's W6 design and the named read-only DW contract section. The
contract explicitly caps last-good BU access at seven days from the oldest
source watermark, so the proposed one-setting range 1..7/default 7 is supported.
Account scope rows must remain independent of account_permission replacement;
every clock boundary applies in authorization before an asynchronous history
tick. NULL/removal closes BU-derived handovers without affecting explicit
project/unrestricted grants. The finite inventory includes direct RLS, worker
pre-fetch/finish, queued SSE delivery, caches/bytes and public-consumer exceptions.
No source connection or DW repository change occurred. The staged 5 October
package remains a required offline historical fixture in W6 implementation,
using its real timestamp and a fake clock, never relabelled as current data.

Root URL review reopened only these finite target corrections: A's W3 legacy
mapper converts JSON-array media tags to the established tag list format and
question_key to the effective question query (preserving an explicit question).
B's W4 content_workflow.py adapter and existing tests normalize direct entity
query names: question_key/question, media_category/category, rule_key/rule and
asset_id/asset. B may extend only publication_task_context's target fields in
0085: existing asset upload/editor receives its guarded owning asset UUID,
canonical bindings retain their binding identity and canonical section, clips
retain their clips section. No Python guess of a parent ID or new permission.

Additional W4 lead integration lease: account-permissions.tsx and the existing
account permission UI regressions must remove the obsolete Approve prerequisite
for knowledge.publish_web, retaining source View and the special checkbox.
Removing Approve alone must not silently remove that special. The exact existing
POST /v1/admin/web/publications route also changes from Knowledge Edit to View
plus knowledge.publish_web, matching 0085 web_prepare/publication_actor and the
new unified prepare path. Page-configuration save stays Knowledge Edit. Lead
owns current permission inventory updates; historical manifests stay frozen.

W2 current evidence: H1 passed 69 Node checks, 10 smoke tests and 53 browser
tests (43 + 3 + 7), with no skips/failures. DB passed 95 Node checks, 38 SQL
suites and all existing concurrency regressions. Latest changed-source and
browser-bundle scan covered 131 files, zero matches, no credential files read.
Lead visually reviewed dark 390px search and 1280px H1 home screenshots. Full
API and the two browser invocations are still running/pending; no completion
or commit is claimed yet.

W2 final API completed: 2,179 passed, 11 unchanged opt-in skips, 0 failed;
six existing dependency warnings. The lead-held serial session now runs the
complete 1280px browser suite, followed by a separate disposable 390px suite.

W3 final pre-integration static receipt: lead independently verified all 63 A
file hashes (aggregate 87d568518e07cc08711bf532a94df6e1871c41e4eb6a020110ec00ecec7edbd3),
all five C file hashes and three Python ASTs, and ran A's admin typecheck with
incremental writes disabled: passed. A collected 19 focused tests (15 workspace,
two intake, two website); C collected 39. These are static/collection evidence,
not substitutes for the later main runtime gate. W3 is frozen for integration.

B's next read-only assignment activates after its final W4 handoff: worktree
`D:/Personal/workspace/sena_hub_wt/w6-review`, branch `ws/w6-review`, cut from
current main 2387dd3. Writable lease: none. Review C's frozen W6 design section
and finite inventory against the owner reply, named DW contract and existing
Hub source/W3/W4 handoffs; concentrate on object-path omissions, expiry and race
semantics, and effective-access history. Return concrete defects or reviewed
boundaries with minimal corrections. No DW source beyond the named contract,
credentials, ports, commits, pushes or implementation. Root records decisions;
W6 code still waits for the W4/W5 migration lane.

W7 design refinement from lead review supersedes the earlier lead-approved
16-field initial enablement. To follow docs47's default-off wording directly,
0089 must leave every existing field's ai_writing_enabled false. Keep the finite
marketing allowlist/hard exclusions, but enable fields only through an explicit
authorized registry save. C pauses its five-file UI lease and may reopen only
0089, test_writing_aid.py and writing_aid.sql for this correction. Positive
fixtures opt in synthetic eligible fields through the existing guarded writer;
assert all-default-off after migration and forbidden opt-in denial. No content,
account, grant or template rewrite. Later W7 UI wiring includes the explicit
registry boolean control and UAT setup step. This is a lead decision refinement,
not a claim that C departed from its earlier brief. Stub-only and zero live
provider authority remain unchanged.

Lead prepared a non-mutating W3 integration preview under artifacts: 68 leased
files total, 18 new, 46 unchanged-base replacements, three clean three-way test
merges, and one reviewed import-only conflict in brand-review.spec.ts. Both
W2 mobile-menu helpers and W3 workspace helpers are retained; W2 fixture and
viewport corrections are preserved. Main application/test files remain frozen
for W2's active browser gates. Integration will recheck current/source hashes.

W4 standalone UI refroze at eight new files; A's final typecheck and local 21 /
H1 four test collections passed, with no runtime claim. Its finite API/UI kind
union contains 31 kinds (earlier prose saying 32 was a count error). A flagged
required later wiring: exact commercial-media unit/binding selection, parent
clip focus, brand-scoped asset metadata, and a full current-entity/current-phase
saved-item inventory for submit-all. Mounted-form callbacks alone cannot supply
the last item. B is proposing the smallest read projection; no new endpoint
or SQL implementation is authorized until its contract is reviewed.

A found a finite W3 placement gap during the W4 form map: existing legacy text
matching already covers unit-types and media, but only the data tab mounted the
component. Reopen only entity-workspace.tsx and unified-workspace.spec.ts in A's
W3 worktree to mount those matching inline suggestions for authorized project
tabs. Keep the website-image queue separate, preserve manual entry for numeric
evidence and prevent suggestion callbacks from clearing another form's dirty
state. FAQ-only pages must not request source evidence. Typecheck, focused
collection and hashes follow; root refreshes only these integration-preview
files. No main app/test change during W2 gates.

W4 submit-all contract accepted. After its current W6 read-only review, B may
reopen only 0085, content_workflow.py, test_content_workflow.py and
unified_publication.sql to add GET /v1/admin/content-workflow/items and
hub.content_workflow_items(level,ref,phase,after,limit). The W4 permission card
adds this read-only entry: coarse active internal source View, exact entity or
Knowledge-only FAQ ownership, then each candidate's current source View/Edit
and existing can_submit. Page size defaults 50/max100, deterministic bounded
cursor, no hidden totals or raw content/history. Items carry exact kind/identity,
expected_hash, ordinary source stamps, state, can_submit/can_edit, source tab
set, label and server-owned target. Only own current-entity/current-phase DRAFT
or needs-reapproval saved items appear; exclude inherited/descendant drafts,
unbound intake assets, promotions and unchanged APPROVED items. Brand asset
metadata keeps its actual bindings and source intersections.

The existing submit endpoint remains per item. Tests cover more than 100 items,
off-tab drafts, exact own FAQ without Projects, other-phase/inherited exclusion,
revocation with an allowed neighbour, unchanged approved exclusion, GET zero
writes, private ACLs and one stale item not cancelling another. W5 adds business
own-scope resolution; W6 must extend the same source guard and inventory before
paging. No new migration number, accounts/grants/templates or source mutation.
Root owns shared route/proxy/inventory registration.

After the W3 mount correction refreezes, A may reopen only its W4
lib/content-workflow.ts, components/content-workflow.tsx and existing
content-workflow.spec.ts to consume all bounded inventory pages with a narrow
submission DTO. Keep original hashes, de-duplicate exact identities, preserve
dirty drafts and show independent outcomes. Do not fabricate full history/read
metadata or hydrate every item separately. Actual entity-header mounting stays
in the later W4 existing-form integration lease.

W2 desktop final: all 315 browser tests passed, zero skipped/failed (15.1m).
The serial command stopped before mobile because its port check briefly found
an occupied test port after desktop completion. A fresh check found no entries
on 55432/8000/3000; no process was stopped. Lead started the separate 390px full
suite under the same held lock, with the unchanged documented harness.

Independent W6 review accepted three refinements. First, capture the accepted
run/epoch before refresh read and reject acceptance if that epoch changed:
overlapping older data must not reverse a newer BUD move, even when watermarks
are equal. Retry means a new read, not reusing fetched rows. Second, the lead's
Python lease includes knowledge.py after embedding and main.py after awaited
private file work: reauthorize the exact current source/epoch/deadline immediately
before returning already loaded data, discarding a stale card/release. Third,
permission_event remains the only access history; account_directory and the
Admin renderer need finite bounded scope-event projections with logical and
observed times, not an unbounded daily stream interpreted as tab-grant changes.
C is incorporating these into only its two W6 design files after freezing W7 UI.

W7 standalone UI static handoff: exactly five new files, typecheck passed,
21 protocol and two H1 tests collected only. No actual visual/component runtime
claim. Later integration supplies the ordinary form writer and original revision,
registry flag/type/control, actual browser interactions and final scope epoch.
The registry label writing_enabled was added to docs47 for exact UTF-8 copying.
Current default-off W7 backend has 34 collected tests and no registry true-seed;
positive fixtures explicitly opt in with the normal guarded registry save.

C's final W6 design refreeze is 534 appendix lines, with accepted-run fencing,
post-await source checks and bounded scope-event history included. Only the
two designated sections will merge. C now takes an independent read-only W4
review in D:/Personal/workspace/sena_hub_wt/w4-review, branch ws/w4-review,
current main base 2387dd3. Writable lease: none. First inspect B's frozen 0084,
its source/review/staged-evidence helpers and tests against docs47 section5 and
the owner's local-staging authorization; review exact source authority,
immutable versions, self-approval/contributor evidence, stale hash/form guards,
values-only REM invalidation and exclusion of BU/as_of. After B refreezes its
0085 inventory addition, inspect that final publication/inventory boundary too.
Return concrete defects and minimal regressions, or a finite reviewed-boundary
receipt. Read only existing Hub source and designated handoffs; no credentials,
DW access, code, ports, commits or pushes. No runtime proof is claimed by review.

W4 independent review found three concrete corrections before integration. B's
0084 lease is reopened for (1) a native unit/price/commercial parent form stamp
included in the command hash and rechecked under the parent lock, but excluded
from approved authored material; (2) one exact current selling-point revision
contributor source used consistently by metadata, approval and publication;
and (3) retaining included authors during staging-only reapproval, while
rejecting unchanged APPROVED submission. Required regressions cover a parent
edit between metadata and save/approve, unchanged sibling success, accurate
self-approval reason flags, no lifetime contributor carryover and retained
authors after relevant local staging drift. The existing four-file inventory
lease continues. C reviews these corrections read-only. No HTTP guard bypass,
history rewrite or unrelated migration change is authorized.

A's W4 standalone inventory integration refroze: eight new files, typecheck
passed, 29 local and four H1 tests collected, all 66 copied Thai labels checked,
31 workflow kinds. The narrow inventory loader retains first hashes, exact
scope/phase, finite cursors and independent outcomes; no per-item hydration.
Actual forms/header integration and all runtime gates remain lead-owned.

W2 mobile final attempt encountered one timeout in the existing English-input
test. Its trace records a fill call spanning 4,720,156ms, followed by a closed
browser session and the unchanged 30-second test timeout. Windows System events
report exit from Modern Standby at 2026-11-05 01:22:27 +07, matching the observed
clock gap. This supports an environmental interruption, not a proven application
defect. Later tests continue passing. Keep the failure receipt; rerun the exact
affected test and then the complete 390px suite on unchanged code. No timeout,
assertion, harness configuration-loading or skip policy is changed.

Wave adjustment: while W2's serial runtime gate finishes and B/C correct/review
W4, A may draft W8's owner UAT pack early in its own worktree
`D:/Personal/workspace/sena_hub_wt/w8-uat-draft`, branch `ws/w8-uat-draft`,
cut from current main 2387dd3. Its sole writable file is
`docs/49-uat-unified-workspace-th.md`; all other files are read-only. Scope:
Thai owner walkthrough/checklist covering docs47 sections 3-8 and 10.3, latest
owner W6 decisions and W7 default-off stub-only behavior. Use exact canonical
UI labels from main docs47. Record observable acceptance and evidence slots,
not implementation/test success claims. Include persona-specific jobs,
permission denial/revocation, N1/N2 exclusions and partial stale batches,
legacy redirects/read-only evidence, object-aware BUD move/expiry scenarios,
history, accessibility/themes and fixture-only AI diff acceptance/rejection.
Use documented fixture/fake-clock prerequisites, never credential instructions
or hosted actions. Done: a finite executable local UAT pack, explicit pending
setup details to verify against final W8 main, UTF-8 and whitespace checks,
changed-file/hash receipt. No code, new migrations, ports, commits or pushes.
This is preparation only; W8 acceptance and its gate still follow W1-W7.

W4 review also confirmed project.phase_count is an exposed fact read directly
from local staged group membership by 0071 and included by 0076 web_project.
B's narrow 0084 lease now includes that displayed count in values-only review
evidence and invalidates affected old/new-group projects when a staged neighbour
is inserted, removed or moved. Group identities, BU membership and timestamps
remain excluded; identical count refreshes must not invalidate. C independently
reviews count-change, no-op and author-history regressions. This uses only the
owner-authorized local Hub staging data and never connects to a source system.

W2 mobile attempt finished 312 passed, three failed, zero skipped. Besides the
standby timeout, the publication test's unscoped alert selector matched both
the expected denial and Next's route announcer; the following viewport then
encountered two prepared previews after that interrupted publication. Lead
scoped the denial assertion to the publication workbench and its preview
assertion to the exact tested page heading. Assertions remain intact; no first
match, timeout change, skip, app change or harness change. Add only
tests/ui/web-publication.spec.ts to W2's explicit commit paths (45 total).
Run the affected specs and navigation quick gate, then the final full gate.

Lead preparation moves to `D:/Personal/workspace/sena_hub_wt/w3-lead-integration`
on `ws/w3-lead-integration`, cut from current main 2387dd3. This is a separate
integration candidate, overlaid only with W2's explicit noncredential paths and
the hash-verified 68 W3 handoff files. W2 main remains frozen during its gates.
The shared-file editing lease now belongs to W3 preparation in this worktree;
no W3 change reaches main until W2 passes and is committed. Lead owns route,
proxy, permission inventory, migration profile/test registration, legacy root
redirect, navigation, home coverage and N7 regression integration there. No
port suite runs from the worktree and no local/env configuration is copied.

C's temporary W3 regression lease while B finishes W4 corrections:
`D:/Personal/workspace/sena_hub_wt/w3-legacy-tests`, branch
`ws/w3-legacy-tests`, cut from 2387dd3 with an enumerated noncredential W2/W3
source overlay. Exactly six writable files: apps/api/tests/test_knowledge.py,
apps/api/tests/test_permission_publication.py,
apps/api/tests/test_permission_feature_coverage.py, apps/api/tests/test_r2_assets.py,
supabase/tests/knowledge_review.sql and supabase/tests/knowledge_followup.sql.
Implement docs47 section4.5/N7 test expectations: actual Admin plus the existing
source V/E/A, no account/template changes, read-only FAQ candidates and denial
of every old FAQ mutation without new draft/review/withdraw side effects.
Retain positive non-FAQ evidence, rights, preview and private-file assertions
using explicit synthetic Admin permissions where needed. Preserve immutable
legacy FAQ fixtures through documented guarded fixture setup, not the closed
accept command. No app/migration/shared inventory or other test edits. Done:
focused reviewed diff, AST/collection/UTF-8 checks and exact six-file hash receipt;
runtime remains lead-only on main. No ports, credentials, commits or pushes.
Resume independent W4 review after B freezes its corrected hashes.

A froze an early W8 draft containing 30 Thai cases, all not run, with explicit
fixture/fake-clock/setup/evidence placeholders. UTF-8, whitespace and 111 uses
of 95 canonical labels passed. SHA256:
42f0dea90d6669d1e3b282804dab7f969a53d1a00cdc1fae194bff3bf1496cd8.
This is preparation, not W8 completion; final implementation/setup validation
and the final main gate still precede owner UAT.

A now owns W3 navigation regression adaptation in
`D:/Personal/workspace/sena_hub_wt/w3-navigation-tests`, branch
`ws/w3-navigation-tests`, cut from 2387dd3 and overlaid with enumerated W2/W3
candidate source. Writable files, all under tests/ui: hub-navigation.spec.ts,
permission-navigation.spec.ts, permissions-uat.spec.ts, hosted-h1.spec.ts,
accounts-h1.spec.ts, accounts-followup-h1.spec.ts, accounts-redesign-h1.spec.ts,
auth-design-h1.spec.ts, accounts-flags-h1.spec.ts, accounts-outage-h1.spec.ts,
workspace-home.spec.ts, workspace-home-h1.spec.ts and hub-navigation-helpers.ts.
Everything else, including unified-workspace-helpers.ts, is read-only. Scope:
docs47 sections3/4/8 legacy redirects, canonical menu destinations, actual
Admin evidence and unchanged permission revocation/recovery/auth behavior.
Use the existing projection helper for synthetic entity containers; never mock
ordinary writes or replace real integration with mock success. Preserve every
existing security, focus, responsive and source-isolation assertion. Report
app defects to lead rather than weakening tests. Done: focused test diffs,
typecheck/collection/UTF-8 and exact file hashes. No ports, credentials, app
edits, commits or pushes. W3 main runtime remains lead-owned after W2 commit.

Lead reviewed C's six N7 regression diffs and verified their exact hashes before
copying them into the separate W3 integration candidate. Four Python AST checks
passed; execution awaits the main test lock. The tests preserve positive
non-FAQ evidence and private previews, explicitly grant synthetic Admin rights
where required, and prove all three old FAQ decisions leave drafts, versions,
reviews and audit counts unchanged. W3 navigation review also found two app
issues: source-specific website entry must recheck View after permission refresh,
and the activity menu needed a distinct history icon. Both are corrected in the
lead candidate while retaining recovery and icon-uniqueness assertions.

W4's final narrow review reopened migration 0085 and its publication adapter/tests
for previous-preview access. Every previous snapshot must independently pass
current source View and asset checks. Unauthorized previous payloads/assets are
omitted with an explicit previous_redacted flag; an independently authorized new
preview and publish action remain available. Retained dependencies in the new
preview are checked for every reader, including readers who cannot publish.
Lead will wire the explicit redaction state into both publication displays.
C found no further concrete defect in corrected 0084's finite source review;
the two-connection import/approval race regression remains a lead runtime gate.

W2 final gate attempt 3 has passed typecheck, offline webpack build, production,
database and local H1 suites. API and the two full browser viewport runs remain
under the lead's serial test lock. Main application and test files stay frozen.

W2 final API result: 2,179 passed, 11 existing skips, zero failures. The full
1280/390 browser runs are in progress. The changed-file/provider scan checked
132 files with zero matches; the broader scan checked 736 source and 65 browser
files with zero matches and no credential-file reads. Questions still match all
82 catalogue IDs. Normal repository git diff --check passed.

W3 preparation: admin typecheck passed; four pure proxy/permission checks and
15 pure migration-profile checks passed without ports or fixture setup. The
integrated API suite collects 2,240 tests. The exact reviewed migration inventory
assertion advances to 0083; historical manifests and hosted admission remain
unchanged. Runtime checks still await W2 completion and integration onto main.

Final W4 preview review found an older JSON-null presence bug: no-brand projects
could be marked redacted merely because Brands View was absent. Lead authorized
only the two null-presence checks in project_permission_projection, replaced
additively in 0085 with the existing definition and ACL preserved. C verified
that reversing this narrow block and its positive/negative tests reproduces the
prior frozen hashes exactly. Missing/null brands remain readable; real hidden
brand content remains redacted. Final 0085 SHA256:
79dbb62f4fd4b2c0d83b520d74bd2018368ed34c7008b984a96d8c3d214e78e1.

W4 form preparation now follows the completed W3 page-shell candidate in separate
worktrees while W2 finishes its browser gates. This advances preparation only;
the merge order and one-workstream shared-file lease remain unchanged.

A: `D:/Personal/workspace/sena_hub_wt/w4-primary-forms`, branch
`ws/w4-primary-forms`, cut from current main and overlaid with enumerated,
noncredential W2/W3 candidate files and the reviewed W4 control/API files.
Owns exactly apps/admin/components/{hub-admin,brand-admin,content-narrative,
content-contacts,content-facts,content-buildings,project-content-workspace,
entity-workspace}.tsx and new tests/ui/content-workflow-forms.spec.ts.

C: `D:/Personal/workspace/sena_hub_wt/w4-record-forms`, branch
`ws/w4-record-forms`, with the same base and overlay. Owns exactly
apps/admin/components/{project-assets,project-media-workspace,media-clips,
commercial-types,unit-type-wizard,project-commercial-workspace,
project-facilities,project-amenities,faq-workspace,faq-bank,articles-workspace,
web-publication}.tsx and new tests/ui/content-workflow-records.spec.ts.

Both implement docs47 sections4.2,5 and8.5. Wire the frozen ContentWorkflow to
exact saved native identities and existing ordinary form payloads; never invent
an identity or replace a loaded form's stamp with fresh workflow metadata.
Model and the six native commercial forms use their original owning project
timestamp; other records use their ordinary revision/stamp. New records keep
the ordinary create path. Bindings without a text writer expose saved-item
review controls without a fabricated save. Preserve dirty-form recovery,
permissions, English review and ordinary writer restrictions. Successful actions
reload through existing parent callbacks; a conflict preserves input and requires
explicit reload. Header submission uses the complete bounded exact-scope/phase
inventory and independent item results. C also honors previous_redacted and
preview_redacted in the old publication display, using canonical copy and leaving
an independently authorized after preview usable.

Forbidden to both: all other files, API/SQL, shared shell/navigation/tokens,
proxy/inventories, workflow controls/types/styles, credentials, commits/pushes
and port-bound tests. Missing shared DTO/type changes are reported to lead.
Lead retains shared workflow files, the new publication display, promotion
publish handoff, permission controls and route integration. Done criteria:
all assigned item kinds and dirty/revoked/stale cases wired, focused real-component
browser regressions authored, non-port typecheck/collection and UTF-8/diff checks
passed, exact path/hash receipt. Lead alone runs browser/API/DB/H1 gates on main.

The form map identified model's original parent timestamp versus its row timestamp.
B has a narrow 0084/test lease to include model in the existing ephemeral parent
stamp/hash logic; this token remains excluded from approval material. C reviews
the delta before starting its UI lease. No other W4 backend file is reopened.

W4 backend is refrozen after the model correction: 0084 SHA256
c2599363c11a875b66b242faf0b9fcba436096c531724cf275c2a597a4eb4f1a.
The two-connection regression is inside test_content_workflow.py, not a new
standalone harness. Lead's W4 candidate is prepared in
`D:/Personal/workspace/sena_hub_wt/w4-lead-integration` / `ws/w4-lead-integration`.
Its work before W3 integration is limited to the separately owned workflow
controls/types, publication display and permission/promotion controls; shared
shell/navigation/API registration files remain leased to W3 until that slice ends.

With 0084/0085 frozen, B may prepare 0086 in
`D:/Personal/workspace/sena_hub_wt/w5-business-level` / `ws/w5-business-level`,
cut from current main with an enumerated reviewed W2/W3/W4 source overlay.
This advances isolated preparation; W5 still merges and gates after W4.
Its exact lease is new supabase/migrations/202611040086_business_level.sql,
supabase/tests/business_level.sql, apps/api/sena_hub_api/business_content.py,
apps/api/tests/test_business_content.py; existing apps/api/sena_hub_api/
{content_workspace,content_workflow,faq_coverage,faq_intake,faq_clusters,
web_publication,publication_queue,workspace_home}.py. No other edits.
Implement docs47 section6 and the W5 card/finite design inventory above. Preserve
explicit applicability, all seven precedence levels/conflicts, private and public
preview graphs, current source authorization, immutable historical content and
N2 contributor restrictions. Fixed business references are never editable
workflow items. Only additive catalog/association rows; no existing content,
version, review, history, account, grant or template rewrite. Thai labels copied
from docs47. Shared registrations/proxy/inventories/assistant/UI/gate scripts are
integration notes only. No ports, configuration files, live systems, commits or
pushes. Done: finite implementation and denial/positive-neighbour regressions,
SQL/PL parse and Python AST/collection/encoding/diff checks, exact hashes and
integration notes. Lead reviews and runs runtime/full gates on main.

W2 desktop final gate passed all 315 browser tests; the independent 390 run is
in progress. Origin/main was fetched and remains equal to local HEAD. No W3/W4
application change has reached the main checkout under test.

W3 lead review unified actual-Admin evidence checks across page, menu and client
projections, giving an explicit current hub_role precedence over a legacy label.
Role changes now invalidate cached client authority. Typecheck and all four pure
route/permission checks passed again, including demoted-Admin denial. A verified
103-path transfer plan is ready; it preserves current docs47/48 and validates
every W2 predecessor before applying to clean main after W2's commit.

W4 lead preparation now honors independent before/after redaction in the new
publication display and removes Knowledge Approve as a publisher-checkbox
prerequisite. The View prerequisite remains. Browser regression sources cover
hidden before/after payloads, an allowed neighbour, and a real-catalog unsaved
permission grid: project/brand E+A, promotion separation, and a publisher special
that survives removing A but clears when V is removed. The latter extends
tests/ui/permissions-uat.spec.ts in the lead W4 candidate only. Positive publication
component fixtures now explicitly supply their synthetic special rather than
assuming a default grant. No account, grant or template is changed by this setup.

B's W5 assistant SQL lease includes only read-evidence citation types business,
faq and section, with exact canonical source reauthorization and bounded private
helpers. Existing tools and proposal/write types remain unchanged. Lead retains
the Python/UI assistant integration. W6 will use the same canonical object guard.

W2 final3 mobile run ended 314 passed, one failed, zero skipped after 6.5 hours.
The feature/solar test's click lasted 22,596,187 ms before the next expectation
hit the test timeout. Windows recorded standby transitions during that interval,
including 02:24 and 08:41-08:42 Bangkok on 5 November. Timing-only evidence is
artifacts/unified-workspace/w2/mobile-final3-interruption-timing.json; no trace
parameters, credentials or tokens are printed. This strongly indicates another
environment interruption rather than a reproducible app failure; verify with
the affected feature spec and navigation checks before repeating the complete
390 suite. No application, test, timeout, assertion or harness changes are made.
The previously passed final3 build/production/API/DB/H1/1280 results remain tied
to the same verified source hashes while its incomplete mobile gate is resumed.
Lead uses a temporary process-scoped Windows idle-sleep assertion for this run,
released in finally; no persistent power setting or harness configuration changes.
Test lock remains lead-owned; W2 is not yet committed.

W5 permission-card endpoint refinement before implementation: fixed catalog GET
`/v1/admin/content/businesses` plus GET
`/v1/admin/content/businesses/{code}/content` (Knowledge V), PUT
`.../{code}/sections/{section_key}`, POST `.../{code}/contacts`, and PUT
`.../{code}/contacts/{contact_id}` (Knowledge E). The latter four live only in
B's leased business_content.py. Existing closed request models and ordinary
section/contact save commands validate the fixed business code, exact ownership,
revision and translation rules. These mutate authored content, never the business
catalog. Existing W4 generic submit/review handles lifecycle; deny and positive
neighbour API cases are required. No broader scope or new review endpoint.

W4 compatibility details: the canonical C4 facility editor supports combined
edit/approve with its original row revision. The older ProjectFacilities editor
keeps its different ordinary parent-stamp/note-field writer and exposes saved-item
lifecycle; it does not fabricate a compatible combined payload. The publishing
screen preserves Releases View-only history through its existing source-filtered
reader without fetching Knowledge projections. Exact page-configuration targets
now use /publish?tab=configuration&page=...&item=...&field=page.url, mounting only
the existing configuration editor; old publishing aliases use the single queue.
Lead and both UI agents keep independent per-control busy ownership so one
completed item cannot unlock a peer action still in flight.

A's W4 primary forms are frozen at nine files (aggregate
8f69124552689b0740f1629b63609917c18335b895fc0461c627897bc4f8ff5d),
with typecheck/static checks passed and 17 browser cases collected per viewport.
C's W4 record forms are frozen at thirteen files (aggregate
332332ba200edbf6a0092fc94d2cfad35663192aea14f33a56d698d3f7676b36),
with typecheck/static checks passed and 62 browser cases collected. None of these
browser cases has run yet. Lead is reviewing both deltas before integration.

Lead review identified two required W4 integration details. A successful explicit
form reload must also refresh workflow metadata, because a dependency hash can
change without changing the form's native revision; failed commands must never
silently reload or rebase an unsaved draft. The single queue must preserve source
project/brand withdrawal and source-version rollback as well as web-page pointers
and release rollback. Existing lifecycle tests asserting public API absence after
withdrawal remain required. Queue controls will use the existing guarded source
readers and commands with exact source identities and retained history.

While these form handoffs remain frozen, A maps affected legacy browser tests and
C maps API/SQL fixture adaptations in their own worktrees, read-only. They must
preserve denial, concurrency, recovery, withdrawal and rollback assertions, and
identify explicit disposable fixture permissions rather than changing default
accounts, grants or templates. B continues the isolated W5 backend lease. Lead
alone retains the test lock and all integration writes.

## W2 full gate and delivery (5 November 2026)

Built the workspace home and personal task projections, exact-source search,
brand/BUD filters and readiness links, and the floating assistant handoff that
fills its composer without sending a message. Migration 0082 adds bounded private
read projections; it does not change account, grant or template assignments.
Pending questions 77-82 remain in the existing catalogue; no additional question.

Final frozen-source gate results (all logs under artifacts/unified-workspace/w2):
- Admin typecheck and documented offline webpack build: passed.
- Production: 4 passed, 0 skipped, 0 failed.
- API: 2,179 passed, 11 existing opt-in skips, 0 failed.
- DB: 95 Node checks, 38 SQL suite files and 23 scenarios in 10 concurrency
  scripts passed; 0 skipped/failed. Disposable migration replay passed.
- H1 local rehearsal: 69 Node checks, 10 smoke tests and 53 browser tests passed;
  0 skipped/failed. The attested 0082 replay and unchanged assignment checks passed.
- UI 1280: 315 passed, 0 skipped/failed. UI 390 resumed final run: 315 passed,
  0 skipped/failed in 14.5 minutes. The interruption recovery probe also passed
  all 23 cases. No suite, timeout or assertion was weakened.
- Changed-file credential scan: 132 files, 0 matches. Source/browser scan:
  736 source files and 65 browser files, 0 matches, credential_files_read=false.
  Question catalogue: 82 IDs agree. Normal git diff --check passed.

Screenshots reviewed: home-search-light-390.png and home-search-dark-390.png;
desktop and H1 evidence is also retained as home-search-{light,dark}-{1280,390}.png
and h1-home-search-{1280,390}.png in the same artifact directory. Keyboard focus,
both themes, reduced motion and viewport overflow checks passed.

Gate deviation: the first final mobile pass was interrupted by Windows standby,
as recorded above. Its unchanged-source affected probe and entire mobile suite
were rerun successfully; other completed final3 suites retain their exact source
hashes. The temporary idle-sleep assertion was released when the run completed.
No product requirement deviation or hosted action.

Lead built/integrated W2; A delivered shell/navigation prerequisites and reviewed
navigation adaptations; B corrected the scoped home/search SQL projections; C reviewed
backend boundaries and helped isolate later workstream contracts. Exact handoffs
and reviews are recorded above. All 45 W2 paths are explicit in the local commit
receipt. Test lock is released after the completed W2 run and will be acquired
by lead for W3. Next workstream: W3 entity workspace, history and canonical routes.
Code commit and origin/main push receipt will be recorded immediately after push.

W2 delivery receipt: code commit
`b5dc4563970d223c54fa9f427cfdd1b43455ba70` pushed successfully to origin/main
(`2387dd3..b5dc456`). All five protected configuration paths passed git check-ignore
immediately before commit. The staged set was checked against the exact 45-path
receipt, with no unrelated path present. W2 is complete; W3 integration begins
after this log receipt is pushed.

W3's reviewed 103-path delta is now integrated over clean main receipt d3ec1d6.
The transfer validated every source hash and predecessor before copying and
preserved current docs47/48. Lead acquires the test lock for W3's typecheck,
offline build, disposable DB/API, browser checks and final full gate. W4/W5
remain in external worktrees; no W4/W5 code is included in this gate.

Isolated preparation adjustment: B's W5 twelve-file backend is frozen after
static checks. While lead gates W3/W4, B may prepare W6 scope/security in
`D:/Personal/workspace/sena_hub_wt/w6-scopes`, branch `ws/w6-scopes`, cut from
current main d3ec1d6 with enumerated W3/W4 and frozen W5 backend overlays. This
does not advance merge order or authorize a live source connection.

Its exact write lease is migration
`supabase/migrations/202611040087_content_scopes.sql`, new
`apps/api/sena_hub_api/content_scopes.py`, existing
`apps/api/sena_hub_api/accounts.py`, new
`apps/api/tests/test_content_scopes.py`, `supabase/tests/content_scopes.sql`,
and `supabase/tests/concurrent_content_scopes.mjs`. Migration 0088 is reserved
for the later BU importer lease; B must provide its minimal shared-schema
contract before that lease starts. Implement the frozen W6 design/finite
inventory in C's w6-scope-design docs48 appendix, incorporating the owner's
replacement rules in its docs47 section 7.1. B owns no other existing API file,
shared registry, permission inventory, UI, script, test, migration or document.

Scope done criteria: independent additive scope rows; missing scopes remain
unrestricted; object-aware canonical guards and direct RLS across the finite
inventory; exact account preview/apply with stale/time/epoch rejection; bounded
manager history; actual Admin grace setting; W7 private translation-scope guard;
real deny/allowed-neighbour, shared-object, expiry and two-connection regressions.
No existing content/history/account/grant/template rewrite or guessed BUD
mapping. Allowed checks are AST/collection, SQL/PL parse, encoding and diff
checks with no ports. Lead reviews every delta and runs all runtime/full gates
on main. Docs47's owner-rule replacement and the full W6 design merge together
in the eventual W6 commit, not in this preparation entry.

W4 regression adaptation leases, after A/C's read-only maps and form refreezes:

- A: `D:/Personal/workspace/sena_hub_wt/w4-browser-regressions`, branch
  `ws/w4-browser-regressions`. Own exactly tests/ui/{project-workflow,
  project-review,brands,brand-review,brand-completeness,assets,
  project-content-phase1,project-content-phase2,project-content-phase5,
  project-content-phase7,project-content-phase9,articles,web-publication,
  residential-operations,phasec-accounts}.spec.ts and new
  tests/ui/content-workflow-fixtures.ts. Existing real lifecycle tests stay real;
  generic mocks get explicit authoritative metadata, not invented default grants.
- C: `D:/Personal/workspace/sena_hub_wt/w4-lifecycle-tests`, branch
  `ws/w4-lifecycle-tests`. Own scripts/sample-brands.sql,
  scripts/seed-hub-content-contract.mjs, scripts/hosted-test-seed.mjs,
  scripts/hosted-test-fixtures.mjs, supabase/hosted-test/h1-seed.sql;
  apps/api/tests/{test_permission_foundations,test_permission_accounts,
  test_permission_content,test_permission_assistant,test_permission_publication,
  test_integration,test_brand_integration,test_coordinates_db,test_promotions_db,
  test_real_promotions,test_assistant_tools_db,test_residential_seed,test_api,
  test_promotions,test_web_publication,test_articles,test_unit_type_workflow,
  test_project_commercial,test_project_amenities}.py; new
  apps/api/tests/content_workflow_fixture.py; supabase/tests/{core_slice,
  brands,asset_library,model_media,project_media_collections,source_selection,
  public_content_boundary,residential_demo,web_publication,articles,
  project_commercial,workspace_home}.sql and supabase/tests/{
  brand_completeness.test,concurrent_residential_release,hub_export.test}.mjs.

Both worktrees start at current main d3ec1d6 plus enumerated predecessor overlays.
All other files are read-only, including sample-accounts.sql, conftest.py,
base permission fixture defaults, configuration loaders, production source and
shared registrations/inventories. Lead supplies any required separate fixture
integration after reviewing a concrete interface. Implement docs47 section5
N1/N2/N6 and preserve W3 routes/N7 closure. Keep immutable history, source/rights
revocation, stale revisions, independent review/publish, public 404 withdrawal,
rollback, concurrency, exact decimal/time, dirty recovery and viewport checks.
Only obsolete all-or-nothing item failure expectations change to required N2
per-item outcomes with a successful neighbour; batch digest conflicts stay atomic.
Positive fixtures use explicit guarded synthetic permissions and real approval
commands, never forged certificates or weakened guards. No default account,
grant or template changes, no harness configuration-loading changes. Done means
reviewable diffs, collected tests, AST/typecheck/SQL/static checks and exact hashes;
all runtime gates remain lead-owned and serialized on main. No ports, credential
access, hosted execution, commits or pushes in either lease.

W3 quick gate: typecheck, offline build and full disposable DB suite passed.
The targeted API run exposed a fixture lifetime error in test_content_workspace:
it imported the rollback-scoped runtime helper but also queried/updated through
HTTP and independent operator connections. A retained project write blocked the
operator update. Lead verified only wait states and relation names through the
existing attested disposable_operator fixture, then cancelled only the exact
blocked fixture query so the test could unwind; no process was terminated.
The new test module now uses the existing non-bypass runtime connection with
per-command transactions, making committed state visible across its connections.
All assertions remain; the API gate must rerun after the interrupted attempt.

Automatic approval review rejected A's proposed new credential-loading browser
helper. Nothing from that rejected helper was written and no credential opened.
Resolution: existing authenticated Accounts APIs perform and restore the explicit
disposable browser fixture permissions; no new credential reader or DB loader.
C's bulk fixture rewrite was separately rejected because it could remove negative
assertions; C is applying finite per-file changes with each denial preserved.
These review rejections do not authorize bypasses or require changing configuration
loading. C additionally owns new supabase/tests/fixtures/content_workflow.sql as
a reviewed disposable pg_temp fixture; lead retains its runner integration.

W4 queue integration contract for legacy regressions: source history uses
`/publish?source=project|brand|promotion&id=<publicID>`, with current-authorized
readiness evidence, retained snapshots, exact source-version rollback and source
withdrawal. Brand dashboard passes repeated `brand=<publicBrandID>` keys (maximum
100) to preselect only matching currently allowed release candidates; no automatic
POST or silent replacement of a missing source. Root owns these source controls.

Root W4 preparation mounted the configuration-only editor at the exact canonical
configuration URL, suppressing queue/history fetches in that mode. Peer ordinary
page edits are blocked while a workflow command is pending. Non-port typecheck
passed. Shared explicit reload now clears its conflict latch and refreshes workflow
metadata only after the normal form reload succeeds; failed reload preserves it.
The generic control also gains a native submit-readiness input. Pending integration
must wire article current.readiness.length, unit workflow.ready, price readiness.ready
and native commercial readiness.ready; narrative/FAQ keep their existing dirty,
pending and server validation behavior. The existing disabled-submit tests remain.

W3 recovery, 5 November: the focused API gate now passes 39 tests, and the five
affected API suites pass 192 tests with no skips or failures. The workspace
fixture now assigns each synthetic project an explicit synthetic brand instead
of assuming the website fixture resolves one. The earlier source-name and group
updates set their audit actor. Migration 0083's two FAQ queries use qualified
aliases to avoid the PL/pgSQL state-variable collision; the reviewed replay
profile records its new canonical hash
`1fcf6097f5fa4019558ad0e797b5a6c461d0a300b72b2e8661b7065fd6b6e2c9`.
No already committed migration changed. Initial browser quick gate: 45 passed,
5 failed. The FAQ cases now create and independently approve their own question;
the subsequent browser run passed those cases. Two UI cases still used the
previous bundle. Lead fixed the Brands view's shell context and separated the
tree search styles from the global search class, then started a fresh offline
build and affected browser gate. The W3 full gate and commit remain pending.

W4 isolated lead preparation now includes the source history panel at
`apps/admin/components/publication-source-history.tsx`, with independently
authorized before/after projections, exact source-version selection, actor names,
excluded model names/REM IDs/reasons, explicit retry, reason and confirmation.
Source withdrawal and retained-version restore use the existing guarded APIs;
promotion DATA/LEGAL reviews remain on their original form and release rollback
remains in the shared queue. Brand selection passes at most 100 exact public IDs
to the queue without a write. The configuration editor and source panel passed a
non-port typecheck; runtime verification remains pending on final integration.

A froze its 16 browser regression files in ws/w4-browser-regressions with
aggregate `ef9ae17d9374b168056af43bac05bf9da1665a20e958ee65317572247aa7761f`.
Typecheck, strict UTF-8, whitespace and diff checks passed; desktop and mobile
each collect 82 tests. Runtime was not run. A now performs a read-only review of
C's 12 frozen record components using the lead's review-record diff artifacts,
focusing on pending commands, source stamps and explicit reload. This adds no
component write lease and no port permission. Root found a missing workflow-busy
guard on the media batch save/clear controls and will resolve review findings
before integration.

C's exact promotion expiry fixture will use the actual public promotion view
definition with only its clock expressions replaced inside an operator-only
temporary read projection. It retains a genuinely approved/published immutable
version, the exact exclusive end boundary, unchanged public output before expiry,
and existing source-revocation assertions. It does not fabricate approval
evidence or change a production clock/view. The historical Hub export fixture
also pins the changing synthetic seed's generator checksum; root owns a truthful
provenance resolution and will not relabel old export bytes with a new generator.

A's record review confirmed pending-command gaps on Add/check actions in media
clips and FAQ question/glossary lists, plus peer translation controls. Lead now
extends A's ws/w4-browser-regressions write lease to exactly the 11 frozen record
components other than web-publication: project-assets, project-media-workspace,
media-clips, commercial-types, unit-type-wizard, project-commercial-workspace,
project-facilities, project-amenities, faq-workspace, faq-bank and
articles-workspace (all .tsx under apps/admin/components), plus new
tests/ui/content-workflow-locks.spec.ts. Preserve the frozen 16 browser files.
No root or other agent edits those 11 components until A freezes the correction.
Scope: block ordinary peer mutations/unmounting while workflow controls are
pending; preserve the owning confirmation control, original source stamps and
dirty recovery; wire original native submit readiness into the shared control.
Web configuration's equivalent gap is already fixed by root and remains outside
A's lease, as do shared controls, API/SQL, navigation, docs and configurations.
Done requires finite diff review, actual-component pending/reload regressions,
typecheck/collection/encoding checks and exact final hashes. No runtime ports,
credential reads, commits or pushes. Implements docs47 sections 4.2 and 5.

W3 final quick recovery passed: typecheck, offline webpack build, 192 affected
API tests and 50 affected browser tests, zero skips/failures in those test runs.
The measured remaining overflow was the local persona label/select at 437px in
a 390px viewport with 200% root text. Its dedicated grid/width styles now keep
the original text size and visible controls inside the viewport. The navigation
assertion retains its original no-overflow requirement and includes element-bound
diagnostics. Website brand view context and genuine approved FAQ fixtures also
passed. A temporary PowerShell wrapper first treated normal server stderr as a
terminating error; only that ignored lead wrapper was corrected, and listener
inspection confirmed the three test ports free before rerunning. No process was
stopped, harness altered or test weakened. Lead now holds the lock for W3's full
typecheck/build/production/API/DB/H1/UI-1280/UI-390/replay/scan gate on main.

C froze W4's 40 lifecycle fixture files with aggregate
`f4c98051d97459a49eb289f08713a0465900762b81051c7a4d991b8aca2b49be`.
Python AST20, Node syntax5, SQL15/PL136, strict UTF-8/whitespace/diff40 passed;
545 API cases collect, zero executed. Existing harness configuration loading,
default accounts/grants/templates and hosted Auth fixtures are unchanged. Root
must preload the reviewed pg_temp SQL fixture once before suite transactions,
review every diff, resolve historical export provenance and adapt the new W3
publication fixtures before W4 runtime gates. Seed/sample initialization remains
self-contained; the seed helper does not require a new credential loader.

W6 D/importer preparation is now assigned to C in
`D:/Personal/workspace/sena_hub_wt/w6-bu-import`, branch `ws/w6-bu-import`, cut
from then-current main d3ec1d6. Its enumerated read-only predecessors include
current W3 fixes, frozen W4 backend/lifecycle fixtures, frozen W5 and a captured
draft of B's 0087 interface. Refresh that predecessor after B freezes; C must
never transfer or alter those files. This isolated preparation does not change
W4 -> W5 -> W6 merge order.

C exclusively owns `supabase/migrations/202611040088_bu_membership.sql`,
new `apps/api/sena_hub_api/bu_membership.py`, `scripts/sync-content-bu.py`,
`apps/api/tests/test_bu_membership.py`, `supabase/tests/bu_membership.sql`,
and exactly `supabase/tests/fixtures/bu_membership/{valid,move,no-bu,invalid}.json`.
All other files are read-only. Implements docs47 section7.1 owner replacement
and the frozen W6 design in ws/w6-scope-design docs48, including its exact
eight-column contract, all-or-nothing 48h validation, pre-fetch pointer/epoch
fence, unchanged-input no-op, independent dated membership, stale/handover grace,
alerts, history and local fake-clock tests. Do not write any staging table.
Use an injected read-only connection to test the one-transaction,
sslmode=verify-full source contract; local CLI and tests use fixtures only, with
no DW/REM connection, credential/config file, hosted job enablement or DW edit.
The actual 5 October package keeps its source timestamp and is accepted only
under its historical fake clock or rejected as stale under November.

B is adding private `content_scope_settle_deadlines()` as a no-op in 0087;
0088 replaces its body. The exclusive-lock helper invokes it after acquiring
account/settings/state locks and before account/base/scope/settings/publication
mutations. D must not recursively reacquire that helper. Read-only authorization
never settles or writes history. This records elapsed stale/handover effects
against the old grants before a later mutation obscures them. Use trusted clock,
existing permission_event/audit history, exact effect sets and idempotent event
keys. Coordinate the bounded project/home notice projection interface with root;
root owns existing routes, shared registrations, clients, permission inventories
and notice mounts. Allowed checks: pure validation, AST/collection, SQL parsing,
encoding, diff and other checks that bind no ports. Done requires fixtures and
source-adapter/fake-clock/runtime test definitions, finite diff and exact hashes;
root alone runs runtime gates, integrates, commits and pushes.

The staged 5 October package's manifest extraction time is not its row source
time. C verified the manifest and gold-project file hashes: the 278 rows carry
source_snapshot_at from 3 October 2026, 18:06:28 through 18:07:51 +07. The
historical adapter preserves those timestamps, accepts them under the 5 October
02:50 UTC fake clock (within 48 hours), and rejects them under November. Earlier
references to a 5 October source timestamp in this log mean extraction time and
are corrected here. Missing BU activity/deletion flags remain unknown, never
invented. This package is legacy offline evidence, not a serving.hub_project_bu
snapshot; the W6 design merge must state that distinction and the exact hashes.

W3 full API attempt: 2210 passed, 11 existing skips, 19 failed. Root fixed the
history projection's article translation ownership (owner_key includes a field
path; use row_ref.article_id), added its real leaf-translation regression, and
made four SQL-only page/cluster fixtures roll back on their attested operator
connection while retaining hub_app calls. The focused run then passed 137 with
one remaining global corporate FAQ fixture failure. The SQL-only impact fixture
now rolls back and HTTP-only private Knowledge fixtures explicitly use internal
exposure. Legacy FAQ expectations now assert N7 denial with no draft creation;
the W2 search test retains Knowledge-only FAQ targets while proving that source
data and BU results disappear, then proves full denial after Knowledge removal.
No production guard or existing assertion was bypassed. Current 0083 canonical
hash is 2172d2acbfd93e540d1069965cd4e53cbee1963de7a698a3b16880a61ed3e65f.

A froze the 11 W4 record components plus content-workflow-locks.spec.ts with
aggregate aa73cef4de2e1f998a9da8e8a9a4b4311acbc2b48f3c453f9ba5b6a7bd6e11a2.
Typecheck/static checks passed; 21 browser cases collect per viewport, no runtime
executed. B froze the six W6 scope backend files; 0087 is
65ab6816f2a591cffabc2f5543762f16a6e6ba07e3210dc63402e2e9a4ce82d6.
117 SQL/73 PL migration statements/bodies and 25 SQL/6 PL suite statements/bodies
parsed, Python3/Node checks passed, 30 API cases collected, runtime0. Exact
receipts are under artifacts/unified-workspace/w4/locks-frozen.json and
w6/scope-frozen.json. Root refreshed only B's six verified predecessors in C's
importer worktree; C's owned importer files were untouched.

Next isolated UI assignments, both cut from current main d3ec1d6 with 194 explicit
predecessors and dependency-only junctions (no configuration copies):

- A: ws/w5-business-ui, D:/Personal/workspace/sena_hub_wt/w5-business-ui.
  Owns apps/admin/components/{entity-workspace,website-tree,faq-workspace,
  faq-bank,faq-applicability,faq-intake,content-narrative,content-contacts}.tsx;
  apps/admin/lib/unified-workspace.ts; apps/admin/app/website/[level]/[id]/page.tsx;
  new components/business-workspace.tsx, lib/business-workspace-text.ts and
  tests/ui/{business-workspace,business-workspace-h1}.spec.ts. Also owns only the
  finite business addition to WorkflowInventoryScope in lib/content-workflow.ts.
  Implements docs47 sections4/6: fixed business hierarchy/content/FAQ seven-level
  composition, exact links/history/preview, preserving W4 stamps/locks. Includes
  a stale-response guard for applicability callbacks. No new business CRUD.
- B: ws/w6-account-ui, D:/Personal/workspace/sena_hub_wt/w6-account-ui.
  Owns existing apps/admin/components/admin-accounts.tsx; new components/
  content-scope-editor.tsx, content-scope-settings.tsx, content-scope.css;
  lib/content-scope-text.ts; tests/ui/{content-scopes,content-scopes-h1}.spec.ts.
  Implements docs47 sections7.2/7.3 and owner-replaced7.1: independent V/E/A
  scope selections, exact BU/project tree, existing preview/confirm gained/lost
  workflow, finite paged effective history and actual-Admin grace setting.

All other files are read-only, including API/SQL, shared shell/navigation/tokens,
proxy/permission registrations and docs. Root owns those integrations and the
authoritative UTF-8 label catalogue. Agents must preserve dirty selections,
discard stale responses, test permission denials and exact links, and report
typecheck/collection/encoding/diff checks plus hashes. No ports, credentials,
commits or pushes. Root reviews every diff and performs all runtime/full gates
before the W4 -> W5 -> W6 merge order proceeds.

W3 recovery completed: the six affected API files passed 138 cases, followed by
the complete DB quick gate and 403 permission API cases (1,838 deselected).
The final full gate restarted on unchanged application code; typecheck, offline
webpack and production checks passed. Full API, DB, H1 and both browser widths
remain in the serial root test lane until their logs report completion.

Root reviewed and integrated C's 40 W4 lifecycle fixture files and A's 28 browser
and record-control files into the isolated W4 lead candidate. Review corrections
keep the solar fixture's operator observation in its rolled-back transaction,
attribute publication to the real synthetic publisher, and await wizard parent
refresh callbacks before releasing its lock. Historical Hub export bytes and
checksums remain unchanged; an exact archived generator preserves the recorded
checksum while the current generator exercises ordinary guarded publication.
The W4 candidate typecheck and 15 port-free migration manifest checks passed.
Runtime checks have not run. The finite local/H1 workflow transport allowlist,
SQL fixture preload and W4 suite registration are prepared in that candidate;
no configuration loader was changed.

W6 frozen receipts: B's seven account UI files are recorded in
artifacts/unified-workspace/w6/account-ui-frozen.json (11 local and three H1 cases
collected, no runtime). C's nine importer files are recorded in importer-frozen.json
in the same directory: 24 pure cases passed; 58 API cases collected; SQL/PL and
UTF-8 checks passed, no database runtime. Root corrected the unmerged 0087 grace
durations to exact 24-hour units; its canonical candidate SHA256 is now
f3e8fbbd957585599da1e61c29b7186aa8e6d2e06f71c2074b9e261ee7de68d9.
0088 excludes only the operational deadline-settlement cursor from preview
fingerprints and pins affected fingerprint functions to UTC; membership,
permission, settings and authorization epochs remain part of stale detection.
B is auditing non-SQL revocation boundaries read-only. C is mapping remaining W7
field-button integration read-only. Neither owns further edits yet.

W3 full API passed 2,230 cases with 11 existing skips and zero failures; the full
DB and H1 suites passed. The 1280 browser invocation is collecting failures on
the unchanged candidate. Root will repair persona navigation, persistent editor
tab behavior, publication-action placement, exact citation read-only mode,
coverage denial rendering and individual FAQ hold markup before rerunning the
affected quick gate and then the full gate. No assertion is removed or weakened.

Corrective lease for C: `ws/w3-browser-recovery`, outside main at
`D:/Personal/workspace/sena_hub_wt/w3-browser-recovery`, cut from d3ec1d6 with the
108 explicit W3 predecessors and dependency junctions only. Owns exactly
`tests/ui/{brand-review,assistant,dw-project-intake,entity-thumbnails,permission-publication}.spec.ts`.
Scope: update authorized route/tab destinations, exact synthetic workspace
projection and actual-Admin N7 disposable fixture while preserving all original
semantic assertions. Existing config loading is unchanged. All production,
shared helpers, docs and other files are read-only. Done requires finite diff,
typecheck/static/collection and exact hashes; no ports, credentials, commits or
pushes. Root owns the product fixes, serial runtime gate and integration.

A's W6 entity and home containers are frozen with only the finite notice import
and mount additions, so root can repair the W3 containers without overlapping
edits. A continues only the notice component/styles/tests. B continues the W6
assistant expiry and queued-stream authority checks, having frozen the separate
W5 business citation adapter and its tests. W7 actual field-button wiring waits
for C's W3 recovery handoff; its read-only map found ordinary guarded writers
for every currently exposed allowlisted editor, with corporate section keys
remaining disabled because no ordinary authoring surface exists.

C's W3 corrective test lease also includes project-content-phase2.spec.ts for
the same finite entity navigation and fixed-scope FAQ adaptation. A's W6 notice
handoff is frozen in artifacts/unified-workspace/w6/notices-frozen.json: six
files, 14 local cases per width and eight H1 cases collected; typecheck and
static checks passed, runtime not run. Container changes are import/mount only.

New A lease: `ws/w6-read-boundaries`, outside main at
`D:/Personal/workspace/sena_hub_wt/w6-read-boundaries`, current main plus 244
explicit predecessors. Owns only apps/api/sena_hub_api/knowledge.py and
brand_completeness.py, plus new apps/api/tests/test_content_scope_read_boundaries.py.
Scope is docs47 7.1/7.2: recheck exact private file identity after storage or
thumbnail awaits, fresh source/version authority after preview embedding/gap
awaits, and final multi-query project/brand projections at an access deadline.
Keep N7 Admin authority, private no-store and ordinary consumer behavior.
No new authorization system or configuration loader. All other files, including
shared main/auth/assistant, SQL, inventories and docs, are read-only. Done requires
finite diff, fake-await/fake-clock denial and positive-neighbour cases, AST and
collection evidence, exact hashes. No ports, credentials, commits or pushes.

W3 browser full gate completed with 290 passed and 48 failed at 1280 px;
390 px did not run after that failure. C's recovery lease was extended only to
project-form.spec.ts, project-groups.spec.ts, project-media-draft.spec.ts and
project-multi-media.spec.ts for exact synthetic media read envelopes and the
canonical safe return URL. All ten recovery test files are frozen; 63 cases
collected, no assertions removed. Root reviewed and integrated 24 finite product
and test corrections, recorded in
artifacts/unified-workspace/w3/browser-recovery-integrated.json. The 115-path W3
commit manifest includes three existing local-test strings copied into docs47's
canonical copy table. The shared dirty guard now protects persona changes,
without storing draft text or changing authority. The targeted browser gate
runs at 1280 and 390 before another full gate; no W3 commit or push yet.

A's W6 read-boundary lease had one narrow addition: staff_media.py extracts its
unchanged thumbnail SQL as a constant for the final guarded projections. Four
files are frozen in artifacts/unified-workspace/w6/read-boundaries-frozen.json.
Six pure checks passed, 39 new cases and 148 affected cases collected; database
and API runtime remain pending. Root will preserve the existing R2 denial tests
while adjusting the two exact query-count expectations for the final re-read.
A now performs a read-only review of 0087/0088 grace, refresh validation and
effective-access history. C performs a read-only W4 governance/route review.

New B lease: ws/w6-client-boundaries, external worktree of the same name,
current main plus 248 explicit predecessors. Owns only
apps/admin/lib/hub-permissions.ts, components/accounts.tsx,
components/workspace-search.tsx, app/api/hub/[...path]/route.ts, and new
tests/ui/content-scope-proxy.spec.ts and content-scope-expiry.spec.ts.
Scope: docs47 7.1/7.2 caller scope fingerprints/deadlines, immediate cache
invalidation and late-response guards, with fresh uncached identity validation
after private buffered responses. Preserve same-account authored text and the
existing H1/account-own transport behavior. No duplicate BUD authorization
model, route expansion or config loader changes. All other files are read-only;
root reserves the finite shell change removing the assistant remount key.
Done requires fake-clock/delayed-response denial and positive-neighbour tests,
typecheck, collection, finite diffs and hashes. No ports, credentials, commits
or pushes. Root's W3 LocalPersonaPicker changes will be forwarded separately.

W3 focused recovery now passes 12 cases at 1280 px and 12 at 390 px, following
the wider 123-pass/six-failure run. The fixes retain the publication status and
reader notice outside hidden legacy headings, preserve the FAQ English-review
tab across refreshes, use canonical IN_REVIEW text, and complete the exact
empty-media facility fixture. The full gate restarted on this repaired source.
Previous full-attempt logs are retained in artifacts/unified-workspace/w3/full-attempt2.

W4 follow-up lease for C: ws/w4-http-gates, current main plus 208 explicit
predecessors. Owns only apps/api/tests/test_permission_publication.py and new
test_publication_queue_http.py. The review found two obsolete release grant
assertions and missing positive HTTP publication coverage. The frozen delivery
adds 15 real HTTP/hub_app cases, with 64 cases collected and static checks
passed; runtime is pending. Coverage keeps independent source View, publication
special, contributor exclusions, stale-item isolation, immutable history and
positive neighbours. No production/config/helper changes, ports, commits or
pushes. Root keeps W3 and W4 shared-file leases separate until W3 commits.

B's W6 lease adds only components/hub-request.ts to the previous six-file list.
Explicit invalidate_access errors clear protected source caches immediately
and request fresh authority; ordinary object-specific denials remain local.
Root forwarded three finite W3 predecessor changes for persona copy and the
unsaved-edit event, recorded in w6/client-w3-predecessor-delta.json. Root still
owns the shell and the remaining raw-fetch caller integrations.

New A corrective lease: ws/w6-scope-audit-fixes, current main plus 249 explicit
predecessors. Owns only already allocated migrations 0087 and 0088 and new
apps/api/tests/test_content_scope_history.py. Fix clock capture after notice
lock acquisition and record invitation activation's effective-access gains
through existing audit history. Preserve the original invitation authority and
ACL, current grants/templates, seven-day duration, and independent scopes.
Done requires finite diffs, SQL/PL parse, static/collection evidence and hashes;
root performs the two-connection/fake-clock runtime checks later. No credentials,
ports, live connections, commits or pushes; every other file is read-only.

A's corrective delivery is frozen in w6/scope-audit-frozen.json: 0087 now records
invitation activation gains through the original guarded entry point, and 0088
captures notice time after the scope lock. Ten new tests cover real lock waits,
invitation history, preserved scopes, denied activation and private ACLs.
SQL/PL parse, AST, UTF-8, whitespace and credential checks passed; 131 affected
cases collected, runtime pending. The 247 read-only predecessors are unchanged.
A next reviews W7 backend read-only; no new file lease or runtime test authority.

B's frozen W6 client/proxy delivery has 29 cases per viewport collected and
admin/test typechecks passed. The follow-up lease ws/w6-client-callers owns only
components/workspace-home.tsx, knowledge-review.tsx, commercial-types.tsx,
project-assets.tsx and new tests/ui/content-scope-raw-callers.spec.ts. It connects
the remaining raw fetch paths to explicit invalidate_access handling. Ordinary
errors retain draft text and partial-upload retries; authority invalidation
closes protected components without caching files or automatically retrying.
All other files are read-only. Root alone runs port-bound checks.

Wave adjustment: C starts W7 native field bindings during the final W3 gate;
integration remains W3, W4, W5, W6, W7. The external ws/w7-field-bindings lease
owns components/hub-admin.tsx, brand-admin.tsx, content-narrative.tsx,
faq-workspace.tsx, unit-type-wizard.tsx, project-amenities.tsx,
project-facilities.tsx, articles-workspace.tsx, business-workspace.tsx,
content-common.tsx, content-field-registry.tsx, writing-aid.tsx,
lib/writing-aid.ts and new writing-fields.spec.ts/writing-fields-h1.spec.ts.
Scope is docs47 8.3: opt-in saved fields, exact locale/revision/authority binding,
explicit proposals, ordinary draft writers and awaited refresh. Corporate
sections lacking an ordinary editor stay disabled. Commercial types remain
with B until root forwards that frozen delta and explicitly transfers its lease.
No shared shell, API, SQL, config, inventories or docs changes; no ports,
credentials, live provider, commits or pushes. Both worktrees received the exact
frozen scope catalogue as a documented read-only predecessor, without config.

Current W3 full gate has passed typecheck, offline webpack build, production
checks and API (2230 passed, 11 existing skips). DB, H1 and both browser widths
are pending under the root test lock. No W3 commit or push yet.

B's raw-caller follow-up is frozen in w6/raw-callers-frozen.json: five exact
files, 24 cases collected at each width, admin/test typechecks and static checks
passed. Runtime remains pending. Root forwarded only commercial-types.tsx to C's
W7 predecessor and transferred that file's lease to C for writing-aid bindings.

New B lease ws/w4-publication-navigation owns only
components/hub-navigation-data.ts, lib/hub-permissions.ts,
lib/unified-workspace.ts, app/releases/page.tsx, app/publish/page.tsx and new
publication-navigation.spec.ts/publication-navigation-h1.spec.ts. It implements
the single queue destination, Knowledge-or-Releases View entry, legacy aliases,
context-preserving redirects and the existing local persona picker. All other
files are read-only; no ports, credentials, commits or pushes. Root retains
shared API/SQL/profile changes until W3 commits. W3 DB and local H1 now passed;
the 1280 px browser gate is running, with 390 px queued after it.

The W4 navigation delivery is frozen in w4/navigation-frozen.json. Admin/test
typechecks and static/integrity checks passed; 16 local cases at each width and
five H1 cases collected, runtime pending. Repeated query values survive both
aliases. Root will update the existing H1 no-View assertion from 404 to the
earlier page-proxy 403 denial; the server component's own guard remains tested.
Later W6 integration must preserve this publication-entry guard.

A's read-only W7 review found two lock issues: input was captured before the
budget wait, and quota completion inverted the scope/budget order. B's next
lease ws/w7-admission-order owns only already allocated migration 0089 and new
apps/api/tests/test_writing_admission.py. It acquires scope before budget/row
locks, validates source/context after waiting, and adds real lock-barrier,
fake-clock and account-change concurrency tests. Existing idempotency, usage,
private ACLs and stub-only behavior remain required. Every other file is
read-only; only static/collection checks, no port commands or credentials.

A's next lease ws/w6-asset-delivery owns only new
apps/api/sena_hub_api/content_asset_delivery.py and
apps/api/tests/test_content_asset_delivery.py. Root retains main.py integration.
The helper buffers bounded private canonical file/thumbnail bytes, then checks
current caller and exact asset authority after storage awaits before delivery.
Preserve original MIME, attachment, CSP, integrity and no-store behavior;
public assets stay on their existing path. Done includes delayed-authority and
integrity regressions plus positive neighbours. No ports, credentials, config,
commits or pushes; all predecessor sources are read-only.

W3 third full attempt passed typecheck, offline build, production, API (2230
passed/11 existing skips), DB and H1. Desktop browser result: 336 passed, two
failed; 390 px did not run. Both failures were the same product regression:
the new preserve-permitted-route persona switch kept an active account on
/account/request after switching from a suspended persona. Root excludes that
status page from route preservation; existing content routes and dirty-form
confirmation remain unchanged. No test assertion changed. The targeted quick
gate runs permissions-uat, hub-navigation and project-form at both widths after
typecheck/build, then another complete gate is required. Evidence retained in
artifacts/unified-workspace/w3/full-attempt3. Root will preserve this exact
one-line correction when applying W6's frozen accounts.tsx later.

A's W6 private asset helper is frozen in w6/asset-delivery-frozen.json. Exactly
two new files; 241 read-only predecessors unchanged. AST, UTF-8, whitespace and
credential checks passed; one pure integrity regression passed and 147 affected
tests collected (50 new). Runtime pending. Root reviewed the bounded-byte,
fresh-authentication and exact-metadata check; integration replaces only staff
file/thumbnail route bodies, preserving the public asset path. A next reviews
W5 backend read-only, with no additional file ownership or runtime authority.

The W3 persona recovery passed all 28 targeted browser cases at 1280 px and
all 28 at 390 px after typecheck and the offline build. The fourth full gate
now runs against the same 114 frozen source files; only this log may change.

B's W7 admission correction is frozen in w7/admission-frozen.json: migration
0089 and four new real database concurrency cases. Root reviewed both finite
SQL changes and every new test. Begin and finish acquire the shared scope lock
before budget/usage locks; source/context revisions and BUD expiry are checked
after any budget wait. Barrier assertions inspect actual database locks rather
than treating elapsed time as proof. SQL/PL parsing, collection, AST, UTF-8,
whitespace and credential checks passed; runtime remains pending in W7's gate.

W5 review found an unqualified SQL state column that conflicts with the local
PL/pgSQL variable in assistant_saved_source. Root transfers only migration
0086 in the existing external ws/w5-business-level worktree to B for a finite
alias/qualification correction. Every other file, including its existing
saved-citation regression, stays read-only. This implements docs47 section 6
and preserves exact source/version and caller checks. Done requires a reviewed
diff, SQL/PL parsing, UTF-8/whitespace checks and an updated SHA-256 receipt;
no ports, configuration reads, commits or pushes. A's review stays read-only.
The lease also covers apps/api/tests/test_business_content.py for a positive
Knowledge-only business FAQ publication-task regression and retained source/N2
denials. Migration 0086 must add business to W4's shared-page branch in
publication_task_native_ready; otherwise the home task disappears for a
publisher who correctly lacks Projects View. No other file is writable.

The same two-file W5 repair lease includes preserving resolved phase IDs and
the existing faq_applicability_changed guard on business FAQ shared-page
composition. A changed rule match after approval must require re-approval;
unchanged neighbours remain publishable. Two HTTP assertions will use the
existing final middleware no-store directive, without changing cache policy.

C's next isolated lease ws/w5-business-transport owns only
apps/admin/lib/hub-permissions.ts, workspace-api-routes.ts, new
business-api-routes.ts and new tests/ui/business-proxy.spec.ts. It adds the fixed
business kind to the existing workspace transport and finite ordinary business
content endpoints, with Knowledge-only page entry. Root will wire the helper
into hosted-config.ts; no broader path regex or source permission fallback.
Implement docs47 section 6 and the W5 permission card, preserve W4 publication
entry, and test positive/negative methods, query bounds, identifiers and page
entry. Only typechecks and pure tests/collection; no ports, config, other edits,
commits or pushes. All source authorization remains in API and SQL.

C's 16 W7 field-binding files are frozen in w7/fields-frozen.json; all read-only
predecessor hashes remain unchanged. Admin typecheck, UTF-8 and diff checks
passed; 27 cases per browser width and one H1 case collected, runtime pending.
Root starts diff review and A performs an additional read-only review of exact
field identity, ordinary revision-checked acceptance, awaited reload, authority
loss and partial-save recovery. Corporate narrative has no ordinary editor and
stays unwired; drafting without eligible context remains disabled. Integration
requires the W5 business mount and existing synthetic H1 catalogue-management
special. No live provider calls, commits or pushes occurred.

Root extended B's existing W5 migration/test lease with one business-only
publication_dependency_check guard: on unchanged=true, compare an approved
business FAQ's saved phase set with the current rule resolution and reject
drift after preparation too. Retained publications/rollback use unchanged=false
and remain unchanged. Before-prepare and after-prepare regressions must retain
an independently publishable neighbour. No migration data rewrite is allowed.

C's W5 transport lease also closes JavaScript end-anchor acceptance of a
trailing newline in existing workspace references/query values, using bounded
full-string matches and valid-neighbour tests. Root added only dependency
junctions for port-free checks; no configuration was copied.

The fourth W3 full gate API result is 2230 passed, 11 existing skips and six
warnings; typecheck, offline webpack and production checks also passed. DB,
local H1 and both browser widths remain pending. A completed W7's independent
read-only review with no additional defects; all 16 frozen hashes matched.

A now owns only docs/49-uat-unified-workspace-th.md in the existing external
ws/w8-uat-draft worktree to reconcile the preparatory Thai UAT pack against
reviewed W4-W7 behavior and the owner's replacement BUD rules. The prior draft
hash is 42f0dea90d6669d1e3b282804dab7f969a53d1a00cdc1fae194bff3bf1496cd8.
This is preparation, not W8 completion: every owner execution result remains
not run, and final commit/gate receipts stay explicitly pending. Read the final
source fixtures and existing scripts without opening configuration; never
invent setup commands. Copy UI labels from docs47 and write UTF-8 files only.
No other edits, ports, credentials, commits or pushes. Root later integrates
the pack and supplies final-main evidence after W7.

B's two-file W5 repair is frozen in w5/backend-repairs-frozen.json. Migration
0086 now has SHA-256 ba371303c50f291476f67f460d7e73a9bc95c2659525046158960df77095fe68.
Root reviewed the full finite SQL and test diff. SQL/PL and expanded definition
parsing, AST, encoding/whitespace and credential checks passed; 15 API cases
collected, runtime pending. The original 12-file receipt is retained as review
evidence; these two corrected files supersede it at integration.

C's four-file W5 transport delivery is frozen in w5/transport-frozen.json.
Root reviewed all four diffs/tests. Admin and strict typechecks, 15 pure cases,
collection, UTF-8 and whitespace checks passed. Six read-only predecessors are
unchanged. Root must dispatch the exact business namespace through both helpers
before hosted/proxy fallbacks. W6's later hub-permissions merge must preserve
both W4 publication entry and W5 Knowledge-only business entry.

Root found one W6 alert-placement gap: an account manager with no source View
lands on account management and cannot open Home, so Home/project-only notice
mounts do not reach that manager. After C's read-only W7 inventory report, C's
next lease in ws/w6-account-ui owns only content-scope-settings.tsx and new
tests/ui/content-bu-account-notices.spec.ts. Reuse ContentBuNotices visibly on
account management, outside collapsed run-history details. Cover manager-only
access, failed/stale/day-five/day-seven notices, temporary-project-grant link,
and loss of manager authority. No extra grants, new notification system or
source-content read. Root supplies only the two frozen notice component/style
predecessors; every other file stays read-only. Typechecks and collection only;
no ports, configurations, commits or pushes.

B's W6 inventory review found 211 new functions across 0087/0088, including
private delegates. Root allocates ws/w6-permission-inventory from current main
to preserve that reviewed mapping in exactly one owned file,
tests/permissions/content-scope-db.json. Record explicit table/policy/function
names, expected execution roles, SECURITY DEFINER and search_path/TimeZone
exceptions; distinguish existing modified entries. No automatic live catalogue
snapshot or legacy-manifest rewrite. All other paths are read-only, with only
JSON/static validation allowed. Root reviews and integrates this inventory with
runtime boundary assertions in W6; no ports, credentials, commits or pushes.

A's reconciled W8 draft has SHA-256
382325f4042e1849d0b75e89e1182293d1f1dab42d619efb58d70d3b33078bfe.
All 30 cases remain not run. UTF-8/whitespace, 96 canonical quoted labels and
32 source references passed static validation. Root will review the finite
delta and supply final-main evidence only after W7.

A's next lease ws/w7-proxy-transport owns only new
apps/admin/lib/writing-aid-routes.ts and tests/ui/writing-proxy.spec.ts. Provide
finite GET state and POST proposals routes using exact UUIDs, no query/extra
method/suffix, and no accept endpoint. Root retains content-routes/hosted-config
wiring and API registration. Positive and malformed-neighbour pure tests,
typechecks and collection are allowed; no ports, configs, live provider,
commits or pushes. All other files stay read-only.

Root verified the new frozen handoffs: w6/inventory-frozen.json (211 explicit
new functions, six owner-only tables, 92 restrictive policy relations),
w6/account-notices-frozen.json (two files, visible manager alerts above collapsed
history), and w7/transport-frozen.json (two files, exact state/proposal routes).
The account notice repair passed admin/test typechecks and one pure case; eight
cases per viewport collected, seven require browser runtime. Writing transport
passed typechecks and seven pure cases. Root reviewed both UI/transport deltas;
catalogue assertions and runtime integration remain pending.

Follow-on inventory leases, while root retains the sole W3 port-test lock:

- A, ws/w5-business-transport: only new tests/permissions/content-business-db.json
  and apps/api/tests/test_content_business_inventory.py. Review corrected 0086;
  cover two FORCE-RLS owner-only tables and nine closed functions. Preserve the
  four frozen transport files and six read-only predecessors.
- B, ws/w6-permission-inventory: only new
  apps/api/tests/test_content_scope_inventory.py. Keep content-scope-db.json
  frozen. Assert explicit function ACL/signature/config, table/trigger and
  restrictive-policy contracts, including private delegate relationships.
- C, ws/w7-admission-order: only new tests/permissions/content-writing-db.json
  and apps/api/tests/test_content_writing_inventory.py. Review corrected 0089;
  cover two FORCE-RLS tables, nine closed functions, field opt-in and settings
  defaults. Preserve all prior frozen sources.

Each brief implements its docs47 workstream and docs36 exhaustive inventory
gate. Existing runtime()/catalogue SQL test helpers may be imported; no harness
loader changes or direct config reads. Only static/type/collection checks are
allowed. No DB/ports, credentials, provider calls, commits or pushes. Root owns
shared baseline classification and final runtime checks. Done means exact
leased files, frozen hashes, review notes and check results.

W5 and W7 two-file inventories are frozen in w5/inventory-frozen.json and
w7/inventory-frozen.json. Their static/AST/JSON/encoding checks passed; three
W5 and five W7 tests collected. W7's pure contract test passed and four database
cases remain pending. W5's optional parser check was unavailable in that
worktree's cache; no package was installed. No DB tests have run for either
handoff. Their prior frozen predecessors remain unchanged.

C next owns exactly new apps/admin/lib/content-scope-routes.ts and
tests/ui/content-scope-transport.spec.ts in ws/w6-route-transport, cut from
current main d3ec1d6. Implement the six reviewed W6 routes with finite methods,
bounded known queries, duplicate/control/traversal rejection and exact raw BUD
references. All shared proxy/hosted wiring stays with root. API/SQL retain
authority. Only port-free type/static/collection/pure checks; no config copies,
ports, credentials, commits or pushes. Root supplied dependency junctions only.

A is reviewing final W6 acceptance/expiry/handover and private-delegate ACLs
read-only in ws/w6-scope-audit-fixes, with no owned files or runtime commands.

W3 fourth full gate: typecheck, offline build, production (4), API (2230 passed,
11 existing skips), DB (95 Node, 39 SQL suites and 23 concurrent scenarios),
H1 (69 Node, 10 smoke, 57 browser) and desktop (338) passed. Mobile finished
337 passed / one failed: brand-review's unavailable-version case opened the
drawer twice and clicked a trigger behind the modal. Root removed that duplicate
open and replaced the local blind helper with the existing state-aware helper;
all publication/retry assertions remain. The matching W4 prepared test received
the same finite fix. Production code is unchanged. Evidence is preserved in
w3/full-attempt4. Per docs11's failure loop, run focused checks at both widths,
then the full gate again. An initial restricted-process attempt failed inside
Node os.userInfo before database setup; retry uses the authorized disposable
harness outside that process restriction. No working port was occupied.

Root reviewed the three new permission-inventory test modules. B's W6 test
hash is frozen in w6/inventory-tests-frozen.json. A independently found no new
concrete W6 timing/ACL defect in the final 0087/0088 source: rejection retains
last-good membership, exact 24-hour grace arithmetic and NULL BU handling are
preserved, production has no injectable clock, accepted changes avoid staging
and approval data, and existing wrapper ACLs/private delegate closure remain.
This is static evidence only; runtime remains pending.

Preparation timing adjustment: root may forward the hash-frozen W3 predecessor
into the W4 integration worktree while W3's final gate runs. The preparation
checks the complete 115-path lease, empty index and frozen source hashes before
writing only the external candidate. Main integration, port gates and commits
still wait for W3's successful full gate and push. This advances static review
without overlapping tests or changing the source under the active gate.

The navigation-only W3 recovery passed 23 cases at each viewport; the fifth
full gate is now running. Root forwarded 121 reviewed predecessor files into
the external W4 candidate. A tracked navigation base file was absent from its
dependency-overlay list; the preparation stopped before writes, then verified
that file against the actual branch base before proceeding. W4's admin
typecheck passed. Root restored W4-only proxy dispatch that the W3 forward had
omitted and added malformed-neighbour/prototype-key/final-newline coverage:
three actual pure protocol cases passed. Main remains unchanged by W4.

Final W4 static review leases (all read-only, no owned files or runtime): A
reviews API modules and 0084/0085; B reviews lifecycle fixtures, tests, H1 seed
and archived export provenance; C reviews native editor controls, publication
UI and preservation of W3 draft behavior. The finite reviewed transfer now has
132 paths in w4/main-transfer.json. Root alone retains registration/transport
edits and the eventual main integration after W3 passes.

W6's six-route transport is frozen in w6/transport-frozen.json. Root reviewed
the helper and 18 pure cases: typechecks, all 18 executions and collection at
both widths passed. No ports/config loaders were involved. Exact raw BUD
identities are preserved; settings accept no queries, account history needs
an exact UUID, unknown/duplicate/control-bearing parameters are rejected.

W4 final review findings and disjoint repair leases:

- A found a post-wait authority race: publication_actor ran before the shared
  account-decision lock, so a special revoked during that wait needed a fresh
  check. In new ws/w4-publication-recheck, A owns only still-uncommitted 0085
  and new apps/api/tests/test_publication_authority_wait.py. Recheck authority
  after acquiring that lock, preserve lock order, and prove revoke-while-waiting
  denial with real two-connection tests plus an unchanged-special neighbour.
- A found that disclosure staged evidence included raw imported area/unit and
  building totals even when the ordinary comparison used unchanged saved
  manual facts or an override. In new ws/w4-disclosure-evidence, C owns only
  still-uncommitted 0084 and new apps/api/tests/test_disclosure_source_evidence.py.
  Restrict imported dependencies to exact comparison sources/choices and
  registered imported building values actually used. Keep old/new evidence,
  drafts and approved history; prove unused import changes remain independent.

Both branches were cut from current main d3ec1d6. Root copied 157 explicit
Python, permission JSON and 0084/0085 source predecessors only; the per-branch
overlay manifests record hashes. All other files are read-only. No new migration
numbers, ports, credential/config copies, commits or pushes. Static/parse/collect
checks only; root will review and run all runtime gates. C's prior W4 UI review
found no further concrete issue, with browser evidence explicitly pending.

Root reviewed A's two-file publication-authority repair and integrated it only
into the external W4 candidate. Eight collected two-connection cases cover
special revocation and an unrelated-grant positive neighbour for prepare,
publish, return and withdrawal. The command rechecks authority immediately
after the account-decision lock and before source locks or writes. No lock was
added. AST/encoding/collection passed; runtime is pending. The receipt is
w4/publication-recheck-integrated.json; C will supply separate finite 0085
caller changes after completing its 0084 disclosure-source repair.

B's fixture review prompted two strict True assertions in the rich-project
publication test. The existing ordinary lifecycle already supplies source View
and the publish special; equality could previously pass with two false values.
The following source-View revocation denial is unchanged. This tests permission
to attempt the batch; per-item readiness and stale-source checks remain separate.
The first exact-edit preparation failed its AST guard before writing; the full
line and indentation were then matched and the two-line change passed parsing.

Root declined B's suggestion to delete immutable synthetic review certificates
from a concurrency fixture: docs11 permits retained immutable test history until
the complete disposable database is removed. No history guard was weakened.
C's private disclosure source selectors will remain in the existing authorized
evidence-table boundary, with no new ACL, and be excluded from application and
history DTOs and value comparisons.

Follow-on read-only reviews: B reviews the complete W8 UAT draft and feasible
existing disposable setup; A reviews the W7 H1 synthetic field-catalog special
setup. Neither owns files or may run ports, configuration readers or mutations.
Root retains all integration and test ownership.

W5 preparation is an ignored-artifact merge preview only: 31 frozen source
deltas in w5/merge-preview, no worktree or main change. Root resolved two
overlaps as finite edits: business entity mounting keeps W3's navigation/draft
recovery, and business task routing keeps W4's complete publication query and
version. API/database registration and canonical copy remain separate future
steps. All before hashes must be rechecked after W4's final commit.

B's W8 review identified missing explicit checks for home readiness by BUD and
brand, corporate FAQ opt-in beside empty business applicability, Releases-only
history, and client deadline/fingerprint invalidation with authored-input
recovery. B now owns only docs/49 in the existing ws/w8-uat-draft branch to add
those cases, exact source-suite references and the documented retained local
H1 walkthrough command with its limitations. The original draft hash is
382325f4042e1849d0b75e89e1182293d1f1dab42d619efb58d70d3b33078bfe.
All actual fixture, final-main and gate details remain pending. Thai labels
must come from docs47; static checks only, no ports/config/credentials or
commits/pushes. The owner has not run UAT.

C's disclosure repair is frozen and reviewed: 0084
f4d2c2a1182314be192a2e4975093b583bb5b27bf40c20b687ed6bb0c74ccec6;
combined 0085 beb20e95ca4239f4a3ee5bd037b69210ceaee83ab092f158f4be7bd23543b3cd.
Root integrated both finite publication callers and matching canonical replay
hashes in the external W4 candidate. Eleven collected disclosure tests cover
manual/unused imports, total versus counted selection, registered building
units, frozen source reassignment, pending approvals, private metadata and
history preservation. SQL/PL parsing and static checks passed; runtime pending.
C independently verified the combined callers and preserved authority recheck.
The complete W4 transfer now contains 134 finite paths.

A's H1 review found that the synthetic Admin lacks the existing field-catalog
special, and self-assignment is correctly prohibited. In new
ws/w7-h1-catalog-fixture cut from d3ec1d6, A owns exactly
tests/ui/writing-catalog-h1-fixture.ts, tests/ui/writing-aid-h1.spec.ts and
tests/ui/writing-fields-h1.spec.ts. Use the ordinary Accounts API with two
synthetic actors, explicit manager confirmation, fresh revisions and finally
restoration of the field flag and both exact access snapshots. Preserve denials
for Admin without the special and an actual non-Admin with the special. Root
supplied three source-only predecessors and dependency junctions. No default
template, archived seed, configuration-loading or production changes; static
type/collection checks only, no ports/credentials/commits/pushes.

B's repaired W8 draft is frozen at
72970a8ff05f3521e8325a288a8210ae2e1018024ddfb3c88f9736fb2ea116b5.
All 112 quoted labels and 47 source references passed static checks. The stock
retained H1 walkthrough has seven synthetic identities and a small seed; it
does not provide all advanced BUD/multi-phase/pagination fixtures or positive
assistant streaming. Final W8 setup must distinguish actual owner walkthrough
steps from separately executed API/fake-clock and mocked browser evidence.

### Owner delegation change, 5 November 2026

The owner requested bounded sub-agents for suitable confined tasks and retained
harder work with the lead. Previous agents are no longer active. Bounded
sub-agents receive fresh context, disjoint files and narrow written briefs.
The lead owns architecture, permission and migration decisions, concurrency
fixes, code integration, runtime gates and final review. Existing frozen
handoffs remain subject to lead review.

The first bounded sub-agents performed a read-only documentation check from
main d3ec1d6. They owned no editable files and inventoried the frozen UAT draft's
remaining placeholders and U01-U30 case/result-row correspondence. No design,
translations, fixtures, ports, credentials, configuration, commits or pushes.

## W3 final gate and delivery preparation

The fifth full gate passed on the unchanged 114-source hash manifest. The lead
retained the only port-test lock throughout, and each browser width used its own
disposable database. Session 68041 exited successfully and released the lock.

| Suite | Passed | Skipped | Failed |
|---|---|---|---|
| Admin typecheck / offline webpack build | both | 0 | 0 |
| Production isolation | 4 | 0 | 0 |
| API | 2230 | 11 pre-existing | 0 |
| DB | 95 Node tests, 39 SQL suites, 23 concurrent cases in 10 scripts | 0 | 0 |
| Local H1 | 69 Node, 10 smoke, 57 browser | 0 | 0 |
| Browser 1280 px | 338 | 0 | 0 |
| Browser 390 px | 338 | 0 | 0 |
| Disposable migration replay / populated H1 replay | both | 0 | 0 |
| Provider scan / broad source and browser scan | zero matches | 0 | 0 |

Evidence: artifacts/unified-workspace/w3/*-full.log,
full-gate-receipt.json, final-gated-source.json and credential-scan-broad.json.
The broad scan covered 756 source files and 72 browser files without opening
credential files. All five credential paths remained ignored. The explicit
commit lease contains 115 paths including this log.

Built: hierarchical entity pages and reused native editors, exact readiness and
legacy deep links, fixed-scope FAQ and inline imported suggestions, media views,
private previews, version/audit history and actual-Admin activity projection.
The legacy unkeyed FAQ accept route is closed and imported FAQ evidence is
read-only. Migration: 202611040083_unified_content_workspace.sql, canonical
SHA256 2172d2acbfd93e540d1069965cd4e53cbee1963de7a698a3b16880a61ed3e65f.

Screenshots include artifacts/unified-workspace/w3/history.png, activity.png,
faq-390.png, entity-light-1280.png, entity-dark-390.png, preview-dark-390.png
and navigation/h1-dark-390-drawer.png. The loading-state H1 history capture is
not used as proof of populated history; the loaded local history capture is.

Agents A and C supplied the entity UI/navigation and workspace API/history/N7
handoffs; the lead reviewed, integrated and repaired cross-workstream behavior
and all runtime failures. No tests were skipped, quarantined or weakened.
Deviation retained: accepting legacy suggestions keeps their existing internal
draft exposure; an ordinary explicit edit is required to broaden it. Automatic
approval review rejected broadening that default without authorization, and the
safe existing default allowed implementation to continue. Earlier failed full
attempts and focused recoveries remain recorded above and in their artifacts.
No new pending questions; Q77-Q82 remain in the existing catalogue.

Commit/push receipt follows after the explicit-path commit. Next: W4 finite
integration, the required quick gates, then its complete workstream gate.

W3 delivery receipt: commit 487e090f807690ad0db8e1a340d407d0c435a5bf,
`Unify content entity pages and history`. Push to origin/main succeeded
(d3ec1d6..487e090). The 115-path commit matches the tested source. No hosted
action occurred. W4's 134-path external candidate is ready for a fresh transfer
manifest against this final predecessor; all W4 runtime gates remain pending.

## W4 lead integration and runtime gates

W3's receipt was pushed as 9c6beb730bf07695b9733fec260ec34a421a543e.
Root regenerated the W4 transfer against that clean main/origin revision and
verified every before/after hash before applying 134 explicit deltas. Main now
contains W4 for local testing only; no staging, commit or hosted change. The
135-path commit lease adds this lead log. Migrations remain 0084 and 0085 with
the reviewed disclosure-source and post-lock authority repairs recorded above.
Root holds the single port-test lock for the quick gate: typecheck, offline
build, DB replay, complete API, local H1 and affected browser specs plus
navigation at both widths. A successful quick gate must precede the full gate.

W7's three-file H1 fixture repair is frozen in w7/h1-fixture-frozen.json.
Root reviewed the ordinary Accounts API setup and restoration against the
actual account-access functions. Strict TypeScript, nine pure failure/cleanup
checks and three-case collection passed; runtime remains pending. The field
flag, Admin access and temporary Editor manager access are restored with fresh
revisions and preserved audit. The extra login/assignment steps use a 180-second
test timeout; all existing functional and security assertions remain intact.

Bounded sub-agents completed the read-only documentation task: the UAT
draft hash matched, all 30 case headings and 30 result rows appeared exactly
once. It identified 54 pre-UAT factual placeholder cells and separated these
from intentional owner observation/result fields. Final gate receipts and
concrete fixture setup remain lead-owned W8 work; no UAT result was inferred.

W4 quick attempt 1: typecheck and offline build passed. Both migrations applied,
but disposable fixture initialization failed on a qualified local variable in
content_submission_freeze. The lead corrected four routines with the same
pattern using explicit PL/pgSQL block labels: submission freeze, glossary
version capture, pinned-source lookup and queue publication outcomes. Function
parameters, SQL predicates, authority checks and immutability rules are unchanged.
Replay hashes were updated for the still-uncommitted 0084/0085; the receipt is
w4/local-variable-labels.json. Resume the quick gate at DB; admin source/build
did not change. No API/browser result is claimed from the failed attempt.

Further focused DB recovery found two JSON subtraction precedence errors and
one more local-variable qualifier in publication_certificate, plus its ambiguous
kind reference inside a source query. The lead corrected these and audited every
remaining function-name qualifier in 0084/0085: each now names an actual argument;
locals use explicit block labels. The existing publication predicates remain.
Still-uncommitted migration hashes are in w4/latest-migration-hashes.json.

Fixture initialization then correctly rejected the local synthetic brand logo:
it still had default internal/needs-review metadata. The lead added an explicit
ordinary media_save_asset confirmation before its ordinary content approval,
using the existing promotion_ad category for the synthetic marketing artwork,
its existing alt text and web_only exposure. No application default, existing
content migration or validation gate was relaxed. A trial with the unsupported
logo category was rejected and corrected to the existing catalogue value.
Failed DB attempts are preserved under w4/quick-attempt1 through quick-attempt6.
The next DB run reached the existing H5i attestation tests successfully.

The historical populated-upgrade test then exposed its use of today's brand
fixture against a pre-0047 schema. Root pinned the exact pre-workspace fixture
from 9c6beb7 in tests/fixtures/pre-workspace/sample-brands.sql, SHA256
218b1b80a11b1dc04feca8812d8c8369f217636d5937224dc577262a071985ae.
The populated-upgrade and early brand-intake tests now verify that digest before
loading it; current local development still uses the ordinary W4 lifecycle.
Bounded sub-agents verified identical 4,718-byte provenance, both reference sites
and preservation of every existing assertion in that finite change.

An additional upgrade assertion distinguished 0085's new nullable review_evidence
columns from changed historical payloads. Root retained full comparisons of all
old fields, asserted null evidence on every old project/brand/promotion version,
and asserted that the upgrade creates zero content-review approvals. The focused
populated-upgrade test passed (1/1, no skips). The complete DB quick gate is
running again. The explicit W4 lease now contains 139 paths; the full workstream
gate has not started. No harness configuration-loading logic changed.

W4 quick attempt 9 rejected the legacy publication-boundary fixture because
its two fixed synthetic assets still had internal/unconfirmed metadata. Root
added explicit ordinary media confirmation in five positive SQL fixture suites;
approval itself never changes exposure or rights. The boundary suite then passed.
Attempt 10 reached the home-task fixture, whose question and glossary were saved
but never submitted under W4. Root added their ordinary submissions and retained
the existing construction_progress home-task kind while using progress inside
the new workflow. Existing task assertions remain intact.

Bounded sub-agents' read-only inventory covered all 41 registered SQL suites and identified
13 separate positive-publication fixture assets needing explicit confirmation.
The same bounded sub-agents now own only asset_library.sql, brands.sql,
model_media.sql, project_media_collections.sql and residential_demo.sql in
a separate worktree cut from 9c6beb7. Written briefs and exact before
copies remain in W4 artifacts. Root owns the attested helper, all production decisions,
diff review and runtime gates. No ports, configuration readers or commits are
delegated. No hosted resource or live provider is used.

Root reviewed bounded sub-agents' five fixture diffs against the exact forwarded bytes: 13
explicit confirmations, 14 added lines, no removed original lines. UTF-8,
byte-preservation and diff checks passed. The finite integration receipt is
the recorded handoff. Runtime testing remains lead-owned.

Attempt 11 passed the home and new workflow/publication suites, then exposed
missing EXECUTE on the session-local W4 fixture helpers under legacy SQL roles.
Root granted only those temporary INVOKER helpers to the test's staff roles;
each helper now runs ordinary content calls as hub_app and restores its caller
role and actor. w4_setup remains owner-only. Production functions, account
permissions, defaults and harness configuration loading are unchanged.
Attempt 12 reached the final core audit assertion. Root corrected its expected
actor to the explicit independent fixture publisher, and made the brand audit
assert both that exact publisher and hub_app. Bounded sub-agents verified the three unrelated
direct rights-review expectations must remain unchanged; they were preserved.
Failed attempts 9-12 are retained. Complete DB quick gate is running again;
no W4 full-gate or commit/push result is claimed.

Attempt 13 passed core, coordinates, source selection, progress and asset-library
suites, then found a real rollback regression: after replacing a brand logo and
withdrawing the current brand, the old approved asset has no current binding,
so require_asset_access rejected the retained historical version. Root repaired
0085 with private publication_retained_media_source, which requires the exact
stored dependency, still-approved version and the existing caller-scoped history
projection. Only unchanged=false retained checks can use it. Assets still pass
current rights/metadata/validity rules; a replaced binding can ignore only its
soft-delete marker if every other material value matches the frozen approval.
Source View, independent publisher and all certificate checks remain required.
No file reader or production grant was broadened. The legacy rollback assertions
remain, with added missing-current-binding, altered-evidence, missing-View and
private-helper ACL checks. Replay hashes and qualifier audit passed; runtime
gate is running. The private helper must be retained in later W5/W6 integration;
W6 authorization continues through its existing history/scope projection.

Attempt 14 passed every registered SQL suite, including retained-media rollback
and all 23 concurrency scenarios. The later Node group had three passes and two
failures: brand-completeness rejected both members because its ready member's
new logo was still internal/unconfirmed; the synthetic export seed hit the same
media predicate. Root added explicit ordinary metadata confirmation for that
one named bulk logo and the export seed's six named assets. Existing bindings
supply their alt text; rights reviews and all assertions are unchanged. Syntax
checks passed. This is no claim that the full DB or workstream gate passed;
the complete serial quick gate is running again.

W4 DB quick gate passed on attempt 15: 95 Node tests, 41 SQL suites and 23
concurrency scenarios across 10 scripts, zero failures/skips in that gate.
All migrations replayed on the disposable cluster; teardown confirmed that the
working database and file stores were not used. Receipt: w4/db-quick-receipt.json.
Canonical migration hashes: 0084
835335012929d02c4ad289564f72f25977d5bc94b4cd72dd1eabc10e28ffbdc2;
0085 83db638062c512eeaad5eea89a2b842cd945e841e507513f237cb1949ec62f23.
The complete API quick suite is now running under the same lead test lock.
The 139-path dirty tree exactly matches the explicit W4 lease.

The API quick run did not complete: it reported 81 failures among 2,295 completed
cases, then waited indefinitely in test_web_publication_stale_batch_atomic_four_eyes_and_revocation.
Port-free collection identified all 2,346 node IDs and mapped the flushed progress;
the partial failure/remaining list is w4/api-progress-failures.json. Root verified
the exact pytest executable ancestry and start time, stopped only its hung Python
child (24084), and the existing harness exited and cleaned up its owned run.
The failed log is preserved in w4/api-attempt1. No other process was stopped.

The fixture attempted a second-connection account grant while its own publication
transaction held the account-decision lock. Root changed its helper to use the
existing guarded account-directory/configuration commands on the supplied test
connection. The web tests' explicit permission changes now use ordinary manager
commands on that same transaction. Their revocation/contributor assertions and
production lock remain unchanged. Root added the new retained-media predicate to
the explicit permission-function inventory. Syntax passed; a focused disposable
recovery with diagnostic stack timeout runs next. API/H1/UI and the full W4 gate
are still pending; no W4 commit/push exists.

The focused deadlock recovery completed in 3.19 seconds: the same fixture now
reaches its contributor-denial assertion rather than hanging. It exposed a real
read-projection mismatch: can_publish advertised the special even when every
prepared item rejected that publisher. Root changed the projection to require
at least one eligible item, preserving eligible neighbours in a partial batch;
the write still rechecks every item. The previous successful DB receipt therefore
precedes this new uncommitted 0085 change and must be rerun.

The failed-file diagnostic run is recorded in w4/api-failures.log. It began
before the new projection and fixture changes and is not final gate evidence.
bounded sub-agents performed a read-only audit of two positive-publication fixtures. Root
reordered their ordinary binding/metadata confirmation/rights-review steps;
all contributor, revocation and stale-child assertions remain intact. Bounded sub-agents did
not edit production code, run ports, read configuration or commit. Root retains
all permission, migration, concurrency and runtime work.

The failed-file diagnostic completed with 257 passed and 83 failed in 296.26s.
Root found that the shared test command released a nested savepoint while leaving
SET LOCAL ROLE/actor active in its outer operator transaction. Both explicit W4
helpers now restore the caller after success; transaction rollback still handles
errors. Atomic fixture bit changes also avoid an invalid intermediate grant row.
No harness configuration loading or production permission was changed.

The first focused rerun passed 39 of those 83 cases and failed 44 (112.90s), with
all staged-value/disclosure and workflow cases passing. Failure traces are kept
in w4/api-recovery1-failure-details.json. Root fixed two SQL name ambiguities,
preserved exact included-tour contributors in new native unit-type reviews, and
forwarded the existing explicit legacy-intake reason to its withdrawal audit.
The explicit permission inventory now includes publication_compose_faq. A legacy
FAQ regression now asserts frozen-save denial, explicit return and retained answer
history; its previously clean file was added to the finite W4 lease (140 paths).

Further review found the pre-web residential catalogue trigger adding residential
defaults to new web snapshots. The uncommitted migration now leaves new web-page
payloads exact; existing version rows are untouched. Descriptor tests assert the
actual kind/identity/hash contract. The coordinate fixture now uses hub_app like
the real API; its focused regression passed. Positive publication fixtures now
explicitly confirm the two named demo images and complete required human English
reviews, separate from content approval. These are synthetic local fixture choices,
not changes to upload defaults, templates, credentials or production content.
The second focused recovery is running. Full API/DB/H1/UI gates, credential scans,
W4 commit and push remain outstanding; the earlier DB receipt is not final evidence
for these later SQL changes. No new pending owner question or hosted action.

Second recovery: 72 passed, 11 failed in 103.38s. Nine failures shared one real
listing defect: the project list selected soft-deleted rows before invoking a
detail reader which correctly rejects them. Root filtered deleted projects and
added a real HTTP regression proving that the deleted detail stays 404 while a
live neighbour remains available. Temporary diagnostic instrumentation was removed.
The remaining two expectations now preserve the residential insertion's exact
catalogue flag and prove that an identical web page retains its version/history
instead of creating a duplicate. All 83 original failing cases then passed in
108.48s; log: w4/api-recovery3-passed.log. This is focused quick-gate evidence only.
The full API suite also needs to run the new deleted-project regression.

Root has restarted the wider serial quick gates (DB replay, full API, local H1,
affected UI plus navigation at 1280/390). The prior successful DB run is archived
under w4/quick-attempt15. Current canonical hashes are 0084
38c2a170bd31c5dda0ecd3fe6352ce075ecd59a4e0d43905da89f4c77c70ff3c
and 0085 c9ba255a2d3e24b0711c91065792cfb966a778928e11cc35a392024ab9c04bad.
All 140 dirty paths match the explicit W4 lease; no unrelated work was touched.
bounded sub-agents' bounded read-only review found no descriptor-shape or duplicate-publication
assumption in the four publication/navigation browser suites. No ports or edits
were delegated. W4's final full gate and commit/push remain pending.

Wider quick-gate recovery: DB attempt 16 passed on the current hashes above:
95 Node tests, 41 SQL suites and 23 concurrency scenarios across 10 scripts;
zero failures/skips and normal disposable teardown. The refreshed receipt is
w4/db-quick-receipt.json, with its log hash and preserved attempt-15 evidence.
The full API suite is now running; H1 and both affected-browser widths follow
serially. No full-gate or commit/push success is claimed yet.

While that serial run continues, bounded sub-agents inspected the three W5 preview predecessor
hash mismatches without editing files or running tests. faq_coverage.py and
faq-applicability.tsx still match their stored source bases; the preview adds
the business scope and stale-request guards respectively. The assistant preview
retains existing exact-source checks and adds saved business/FAQ/section evidence.
All three preview hashes match their receipt's after hash. No W3/W4 regression
was found by this bounded source comparison; root will still refresh the receipt
and review the actual W5 integration after W4 commits. This is not runtime or
permission validation of W5. The running full API quick suite has reported one
failure so far; its final result and failure trace remain pending.

The wider API quick run completed in 1,271.35 seconds: 2,332 passed, 11 existing
skips and 4 failures. Full output remains in w4/api-quick.log and the four exact
traces/nodes in w4/api-quick-failure-details.json and
w4/api-quick-failed-node-args.txt. H1 and UI did not start because the serial
wrapper correctly stopped on that failure.

Root repaired the four test dependencies: the media clock fixture explicitly
keeps its editor attribution after command helpers restore the caller; the
private-function privilege probe runs as its intended hub_app caller; the
publication feed asserts exactly both locale publish events after its saved
cursor instead of assuming no preceding test has published; and the standalone
workspace SQL projection test loads its attested temporary workflow helpers.
No application or SQL migration changed in this recovery. The previously clean
media-worker and public-website-import test files expand the explicit W4 lease
from 140 to 142 paths. All four complete affected files are rerunning under the
lead's serial lock, preserving every existing negative and history assertion.
The DB attempt-16 receipt remains applicable; the W4 full gate is still pending.

The four complete affected API files passed: 69 tests, zero skips/failures,
40.36 seconds, normal disposable teardown (w4/api-remaining-recovery.log).
bounded sub-agents' read-only review found no weakened negative or history assertions in
those four repairs. The feed cursor uses its first page; the failed full run's
19 entries are below that API's 1,000-entry page limit, as are the isolated
fixture's two entries. Root has started the remaining serial quick gates:
local H1 simulation, then affected browser specs plus navigation at 1280/390.
The full W4 gate, commit and push remain outstanding.

The H1 quick attempt passed its 69 preliminary Node tests and migration/replay
preservation checks, then stopped before smoke/browser startup at the seed's
three-member publication assertion. Safe diagnostic artifacts are
w4/h1-seed-diagnostic.log, h1-seed-recovery.log, h1-seed-recovery2.log and
h1-seed-release-diagnostic.log; they contain no connection values. The seed now
explicitly confirms only its three named synthetic images before separate
rights review, preserving all existing UTF-8 labels. Its guarded metadata RPC
runs as the already verified deployment operator with the explicit fixture actor;
no new role membership or configuration loader was introduced.

Root also found a real release-order regression: the W4 preflight rejected a
promotion whose approved project was being published for the first time in the
same release. The uncommitted 0085 release command now validates source-tab View,
locks its members, and publishes brands, projects, then promotions through the
existing ordinary commands. Each item rechecks current approval, contributor
separation, rights, readiness and expected source; a rejected item's subtransaction
rolls back only its own writes. Successful items share one release/history row;
an entirely rejected batch creates none. Promotion DATA and LEGAL checks remain
unchanged. Existing versions, review/history rows, accounts and grants are not
rewritten.

The corrected disposable H1 seed published all three fixture members with zero
rejections and passed harmless replay (w4/h1-seed-order-recovery.log). This is a
focused recovery, not the full H1 gate. Because 0085 changed, DB attempt 16 is
no longer final evidence. Root has started the required serial SQL quick set:
DB replay/concurrency; API permission/publication/promotion/residential tests;
then full local H1 and affected UI plus navigation at both widths. No owner
decision or hosted action is needed. W4 remains uncommitted.

DB attempt 17 passed on the release-order fix: 95 Node tests, 41 SQL suites,
23 concurrency scenarios across 10 scripts, zero failures/skips and normal
disposable teardown. Receipt: w4/db-release-quick-receipt.json; log:
w4/db-release-quick.log. Current 0084 hash remains
38c2a170bd31c5dda0ecd3fe6352ce075ecd59a4e0d43905da89f4c77c70ff3c;
0085 is c5963feac4f7b61e6e54e8bba496c038a734bfc860d8239f57d94dba94be5817.
The required permission/publication API selection is running next under the
same serial lock; H1 and browser gates follow only if it passes.

The SQL-change API quick selection passed: 655 passed, 2 existing skips,
1,690 deselected by the documented focused selection, zero failures in 565.80s
(w4/api-release-quick.log). The H1 retry has completed setup and started its
owned local services; browser checks are now running. Its original failed log
is preserved as w4/h1-quick-attempt1.log.

Bounded sub-agents also inventoried the eight W4 browser specs read-only: nine screenshot
writing sites cover primary forms, light/dark review/results, web/release history,
return conflicts and local/H1 navigation. Existing tests check the required
1280/390 widths, focus retention/restoration, overflow and six contrast token
pairs in both themes. Reduced motion is selected; the new W4 stylesheet itself
adds no animation or transition. This is a source inventory, not a runtime pass
or a claim that every rendered state has been individually measured. Runtime
screenshots and all browser results remain to be verified.

H1 attempt 2 passed the 69 Node checks, 10 smoke tests and 55 of its first 56
browser cases. The remaining case referenced DEMO-001, which belongs to the
ordinary local harness; this simulation seeds the exact H1-PROJECT-001 instead.
Root corrected only that source reference, retaining source View, submit denial
and missing-publication-special assertions. Failure evidence is preserved in
w4/h1-quick-attempt2.log and w4/h1-attempt2-fixture-failure.png. The serial H1
retry is running; browser flag/outage checks and both local UI widths remain
pending. No SQL, runtime code or permission behavior changed in this repair.

H1 quick attempt 3 passed: 69 Node checks, 10 smoke tests and 66 browser tests
(56 main, 3 provider-flags, 7 outage cases), zero failures/skips. Root inspected
the generated h1-queue-1280.png (light) and h1-queue-390.png (dark); their queue,
controls and histories fit the page width. Evidence: w4/h1-quick.log and the
W4 screenshot paths inventoried above. The serial runner has advanced to the
affected local UI specs plus navigation at 1280, then 390. W4's final full gate
still has not run; no commit/push success is claimed.

## Owner addition, 5 November 2026: W3.2 contextual promotions

Recorded the owner's ten requirements and complete pre-code docs/36 permission
card in docs47 section 4.7; updated navigation mapping, tab order and UTF-8 copy
catalogue in sections 3.2, 4.2 and 8.5. Source review confirms migration 0070
resolves primary project plus up to 100 targets, freezes published project IDs,
and has no brand ownership without primary project or exclusions. Planned
additive ownership/exclusion fields preserve all existing rows and published
payloads. Project and brand tabs only; no business/group ownership expansion.
W6 must apply any-resolved-project draft permission and all-resolved-project
DATA/LEGAL/approval scope. No grant or template change is authorized.

The requested dependency is W3.1. No W3.1 definition or receipt exists in this
checkout; a concise clarification is pending while current W4 work continues.
Do not silently equate W3.1 to delivered W3 or allocate a conflicting migration.
W3.2 implementation will receive a separate frozen file/route/migration lease,
full gate, explicit commit, push and four-theme/width screenshot receipt under
artifacts/unified-workspace/w3.2/. This is a recorded design, not delivered code.
docs47 is now a root-owned programme decision file included in the next receipt.

W4 affected-browser quick gate at 1280 finished: 167 passed, 24 failed, zero
skips (14.9 minutes); 390 did not start because the serial runner stopped.
All failures remain in w4/ui-1280-quick.log and preserved Playwright artifacts.
Root owns the native form freeze, solar withdrawal reason, navigation and
publication concurrency investigations. No assertion is dropped or quarantined.

Bounded sub-agents repair assignment in a separate worktree cut from
current main 9c6beb7. The written brief is retained in W4 artifacts.
Exclusive owned paths:
tests/ui/{assets,project-workflow,brand-completeness,publication-navigation,
unified-publication,residential-operations}.spec.ts. Root seeded only those
current files and three read-only source dependencies, never configs. Bounded sub-agents may
repair finite fixture metadata, selection reset assertions, VM Promise handling,
reason locators, real capability-refresh fixture transitions and contextual
links. Port-free inspection only; root retains all runtime gates and integration.
No agent commit or push. Root reviews diff plus quick gate before accepting it.

W4 UI recovery, continuing 6 November: root reviewed and hash-integrated all six
bounded sub-agents files (the recorded handoff). Static parser checks passed 6/6;
48 test definitions and 347 prior assertions were retained with exact locator
and context corrections. Root corrected the brand queue badge destination,
distinct publication icon, initial queue-action placement, FAQ/narrative frozen
edit controls and a reasoned solar withdrawal dialog. Lifecycle tests now assert
the submitted FAQ is frozen, return it through the ordinary Manager command,
then create a new draft; the section test returns its shared fixture after all
viewer denials so the second width does not edit an IN_REVIEW source.

Typecheck and documented offline webpack build passed. A restricted-execution
attempt failed before database startup at Windows userInfo/uv_os_get_passwd;
the unchanged owner-authorized harness ran under scoped escalation. Its recovery
finished 137 passed, 4 failed, zero skipped in 8.9 minutes. The remaining cases
were one settings navigation timing failure, two solar withdrawals and the
1280 publication retry after restoration of its permission. Evidence:
w4/ui-1280-recovery.log, w4/ui-1280-recovery-attempt1/; earlier 24-failure evidence
remains in w4/ui-1280-attempt1/. No skipped/quarantined assertions or harness
configuration-loader changes were made.

The ordinary solar route reproduced the database failure: its older immutable
scenario guard rejected a changed decision_reason, although the reviewed figures
were unchanged. Uncommitted migration 0084 now excludes only decision_reason
and self_approval from that existing decision-metadata comparison. The approved
payload/figures stay immutable. A direct-route regression retains its approved
snapshot and the complete amenity API file passes 27 tests (zero skips/failures),
including normal teardown: w4/solar-route-fixed.log. Canonical/executed hashes
were refreshed only for uncommitted 0084/0085. Prior DB/H1 receipts predate this
fix, so required DB/permission/H1 checks must run again before the full gate.

Root also completed the open-editor freeze edge identified by bounded sub-agents: an already
open native section/point editor preserves typed text while disabling its fields
and save button if its loaded source becomes submitted. Navigation reveal now
waits for the authorized group and asserts it opened, rather than silently
skipping before it mounts. The explicit root lease is 145 paths, including
docs47 decision text and the previously clean hub-navigation component/test.

A temporary boolean-only console trace in PublicationWorkspace is active for
the focused browser diagnostic (w4/run-ui-diagnostic.ps1). It records only busy,
sourceBusy, publisher, canPublish, state and confirmed; no payload/config/identity
is logged. Remove W4_PUBLICATION_GUARD before final build/gate/commit. The exact
pre-trace source is w4/publication-before-guard-trace.tsx. No W4 full gate or
commit/push is claimed.

Bounded sub-agents' W3.2 read-only inventory confirmed additional dependencies: the primary
project inner join and readiness in migration0021, primary-project locking in
0025, immutable frozen scope/public eligibility and banner predicates in0070,
publication certification/rollback/queue in0085, and promotion-linked starting
price validation in0067/0070. Legacy sources are website promotion_terms and
staging knowledge_promotion_annotations, retaining likely_expired/date_unknown
and non-promotion classifications. The existing editor and commercial-fields
component both assume a primary project. Root tightened the docs47 permission
card's planned routes to the existing content/workspace namespace and named the
affected functions and existing FORCE RLS policies. No W3.2 code started.

6 November continuation: DB quick attempt 18 passes on the solar decision-metadata
fix: 95 Node tests, 41 SQL suites and 23 concurrency scenarios across 10 scripts,
zero failures/skips; ordinary disposable teardown completed. Exact migration and
log hashes are in w4/db-solar-quick-receipt.json. Admin typecheck and the offline
webpack build also pass (w4/typecheck-native-events.log and
w4/build-native-events.log). The required permission/amenity API selection runs
next under the same lead-owned serial lock. The application console guard trace
has been removed. A temporary browser-test-only, in-memory pointer/scroll recorder
is prepared to distinguish a missed native click from a request or permission
failure; it must be removed before the clean browser and final full gates.
The last clean failure produced no second publish request. Diagnostic timing
changes that happen to pass are not accepted as a repair. W4 remains uncommitted.

The corresponding API quick selection passes: 438 passed, 1,909 deselected by
the focused permission/amenity selection, zero failed/skipped, 429.27 seconds
(w4/api-solar-quick.log). This includes the added negative assertion that a
reviewed solar figure remains immutable while the withdrawal decision reason
can change. The serial lock has transferred to the native browser diagnostic;
no other port-bound runner is active.

The native-event diagnostic reproduced one missed publish click in six cases,
including a failure before the expected denied-request alert. Its retained
trace records the confirmation checkbox's pointer events followed by 40 scroll
events, but no publish-button event. Evidence: w4/ui-native-events-attempt1/ and
w4/publication-native-evidence.json. The browser helper now explicitly scrolls
the publish control into view and asserts full viewport visibility before its
ordinary, unforced click. Both denial and successful publication use this helper;
all existing assertions remain, with no fixed delay or retry of the command.
No application permission or publishing behavior was changed for this repair.

With all temporary diagnostics removed, the clean publishing regression passes
6/6 cases across three repetitions (42.1 seconds, zero failures/skips;
w4/ui-publication-scroll-recovery.log). The affected 15-spec UI selection plus
navigation is now running at 1280, then 390, under the lead's serial lock. The
previous recovery log is preserved as w4/ui-1280-recovery-before-scroll.log.
W4's final full gate, explicit commit and push still remain.

During the serial UI gate, root refreshed only ignored W5 review artifacts:
w5/merge-preview-current/ now contains 31 hash-checked paths against current
main source, including the frozen transport, permission inventory and assistant
additions. All 13 Python files and 15 TypeScript files parse. Two form merge
resolutions retain the W4 submitted-state and pending-command guards. This is
preparation, not integration or a runtime gate; W5 API/DB registration still
waits for W4's commit. The older preview based on w4-lead-integration remains
superseded and must not be copied over main.

The clean affected UI quick gate passes 141/141 at 1280 (6.5 minutes), zero
failures/skips, including the prior FAQ, navigation, solar withdrawal and
publication retry failures. Normal disposable teardown completed. The serial
390 run has started. Root inspected review-light-1280.png and
result-dark-1280.png for queue/review/result layout; the automated navigation
checks also pass both semantic contrast palettes. Evidence remains a quick
gate; the final full suite has not run yet.

The 390 recovery finished 140 passed, 1 failed, zero skipped (7.5 minutes).
All publication cases passed. The remaining wizard media-lock test installed
its held-read fixture before the initial unit-types request finished, leaving
the wizard in its initial loading state. Root added an explicit enabled-control
precondition before holding the post-command reload; the existing lock, reload
and single-command assertions are unchanged. Evidence is preserved in
w4/ui-390-recovery-attempt1.log and w4/ui-390-wizard-initial-read-failure/.
The complete mobile workflow-lock spec is rerunning as the failure quick gate.
Root also inspected review-dark-390.png and result-light-390.png: queue, review,
result and history content stack within the viewport; no page-width overflow
was reported by the automated checks.

The first mobile lock-spec retry passed the repaired media wizard case, but
finished 20 passed/1 failed: the price-wizard case had the same initial-read
fixture race. Root applied the same enabled-control precondition consistently
before held reloads in question/glossary, English retry, unit/price wizard and
article/FAQ/progress cases. The asset case already fills its loaded caption
before installing its gate. No application code, timeout or existing assertion
was loosened. Failure evidence remains in w4/ui-390-price-initial-read-failure/
and w4/ui-390-locks-recovery-attempt1.log. The 21-case mobile spec is rerunning.

The mobile workflow-lock recovery passes 21/21, zero failures/skips, including
both wizard cases (w4/ui-390-locks-recovery.log). This completes the documented
quick failure loop: 141/141 affected desktop cases; the mobile run's 140 passes
plus its repaired full 21-case lock spec; 438 permission/amenity API passes;
95 Node/41 SQL/23 concurrency DB passes; clean typecheck/build; and zero scan
matches. Lead now starts the first W4 final full gate through w4/run-full.ps1.
All port-bound suites remain serial and disposable; no hosted operation is
authorized. Final results, commit and push remain pending.

Final-gate infrastructure interruption, 6 November: typecheck, offline webpack
build and all four production checks completed successfully. The daemon restart
terminated the runner during API execution, after partial progress to 64%; that
partial run is not accepted as a suite result. Its log is preserved as
w4/api-full-interrupted.log. Read-only process metadata and port inspection
confirmed no full-gate/disposable/pytest runner and no listeners on
55432/8000/3000 remained. All 145 pre-gate source hashes still matched exactly.
Lead resumes the same final gate from the full API suite, followed by DB, local
H1, both complete UI widths and scans (w4/run-full-resume.ps1). Completed
typecheck/build/production evidence is retained; no process was stopped.

W4 final API gate recovery, 6 November: the resumed full suite completed with
2,324 passed, 11 existing skips and 12 failures. All failures were positive
media/content workflows whose old fixture SQL selected the first arbitrary
project UUID. W4's committed concurrency/history fixtures retain soft-deleted
synthetic projects; migration 0083 correctly rejects those content scopes.
Lead claims the previously clean apps/api/tests/test_project_media.py, extending
the explicit W4 lease to 146 paths, and replaces 13 arbitrary selectors across
that file, test_project_content_core.py and test_media_worker.py with the named
active DEMO-001 fixture. Production guards and all negative/staleness assertions
remain unchanged. Full-attempt evidence is preserved under w4/full-attempt1/.
The failure quick gate runs the tombstone-producing workflow tests before all
three affected test files. A new complete full gate is required after recovery;
W4 remains uncommitted and unpushed.

The live-fixture recovery gate passed 44/44 tests, zero skips or failures,
including both retained-history producers followed by all three affected files
(w4/api-live-fixture-quick.log, 31.11 seconds). Lead starts a new complete W4
full gate from typecheck on the 146-path source set. No product guard was relaxed.

## W4 browser recovery and W9 addition, 6 November 2026

Full attempt 2 completed typecheck, offline webpack build, production (4 passed),
API (2,336 passed, 11 existing skips, zero failures), DB (95 Node tests, 41 SQL
suites, 23 concurrency scenarios across 10 scripts), and local disposable H1
(69 Node, 10 smoke, 66 browser checks), including clean migration replay through
0085. UI at 1280 px finished with 394 passed, 36 failed, zero skips in 30.2 minutes.
The runner stopped on that failure; full UI 390 and final scans were not run in
this attempt. No W4 commit or push exists. The 146 source hashes stayed unchanged
through the run. Logs, hashes and all 36 failure traces are retained in
`artifacts/unified-workspace/w4/full-attempt2/`.

Thirty failures had the same legacy mock omission: a catch-all empty array was
returned for the new workflow snapshot, causing the page to fail before the
original test interaction. Four other failures were ambiguous selectors after
workflow statuses, source names and reload controls became visible. Media retry
trace inspection confirmed that the third metadata write succeeded at revision
1, the retry recovered it without a second metadata write, and its missing link
was saved; the broad status locator had failed immediately during that recovery.
The remaining two failures were old N1/N6 expectations: Projects Approve must now
be selectable but still unchecked for the unchanged account, and the old FAQ
publication route must redirect to the single queue.

Lead reviewed and integrated twelve explicit test paths into the W4 working
lease (158 paths total), preserving mutation handlers, ownership checks, stale
drafts, original write/upload counts and rights assertions. Source-selection
checks now address the native snapshot and stale-save error summary; media checks
address the file status rather than nested workflow notices. The group fixture
also checks the N6 queue link and retains the single rights-review write.
All twelve candidate specs passed syntax parsing and the complete diff check.
The serial recovery gate covers all twelve specs plus hub-navigation at 1280 and
390 px from main. A new full gate is mandatory after this recovery passes.

### Bounded sub-agents assignments for browser recovery

All worktrees were cut from current main `9c6beb7`; no agent ran ports, copied
configuration, committed or pushed. Lead kept all product, permission, migration,
integration and runtime work. Written briefs are in the W4 artifact directory.

- Bounded sub-agents in the separate fixture worktree own only
  `tests/ui/brand-logo-upload.spec.ts`, `commercial-types.spec.ts`,
  `project-media-draft.spec.ts`, `project-multi-media.spec.ts` and
  `project-facilities.spec.ts` plus its ignored review report. Delivered finite
  GET-only workflow snapshots/inventories; original test bodies preserved.
- Bounded sub-agents in the separate fixture worktree own only
  `tests/ui/project-form.spec.ts`, `pilot-provenance.spec.ts`,
  `project-groups.spec.ts` and ignored reports. Delivered finite read fixtures,
  native identities, syntax and unchanged-body checks; reported the old group
  publication assertion for lead's separate N6 update.
- Lead owns the N1 assertion, media/source selector updates and legacy redirect
  expectation. Exact before/after hashes and review receipts are in
  `w4/ui-fixture-recovery/` and `w4/ui-recovery-integration.json`.

Bounded sub-agents completed the Promotions amendment in
`D:/Personal/workspace/sena_hub_wt/w8-promotion-uat` (branch
`ws/w8-promotion-uat`). Only docs/49 and an ignored report were owned. Lead
reviewed U31–U40 and the eight fixture sets; all forty UAT cases remain NOT RUN.
Final draft SHA256: `f28ea21263ab06e46e68b086dec431868aa3b7adbc63279356bbe386a6387dee`.
Receipt: `artifacts/unified-workspace/w8/promotion-uat-lead-receipt.json`.
This draft remains outside main and needs the W9 amendment before final UAT.

### W9 owner decision and bounded preparation

The 6 November owner decision and metadata addendum are recorded verbatim in
docs/47 section 8.6; new Thai upload/suggestion labels are in section 8.5. W9
must merge before W8. The addendum requires metadata removal and a safe rewrite
for every non-legal PDF even below the 20% compression-gain threshold; legal and
unknown-category files remain byte-exact under existing limits and private.
Only future uploads are processed. No existing asset, object or public identity
will be rewritten, reprocessed or deleted.

Bounded sub-agents own only `artifacts/w9-upload-inventory.md` in
`D:/Personal/workspace/sena_hub_wt/w9-upload-inventory`, branch
`ws/w9-upload-inventory`, cut from `9c6beb7`. Its written brief is retained in W4 artifacts. This is a read-only
source/call-path/test inventory, with no ports, main edits, providers, credential
files, commits or pushes. Lead owns the hard processing, privacy, deduplication,
legal-context and permission design. Shared main.py, project-assets.tsx,
commercial-types.tsx and project-media-workspace.tsx remain leased to W4 until
that workstream is committed. W9 implementation has not started and no W9
migration number is allocated yet.

Later hosted rollout will need coordinated web-server and proxy request-body
ceilings supporting 50 MiB PDFs and 30 MiB images (plus transport overhead where
applicable), matching API validation and sufficient memory for a bounded
100-million-pixel decode, orientation/color conversion and encoding. A decoded
RGBA image alone can consume about 400 MB; actual peak headroom and worker count
must be measured with the serialized fixture workload before setting a limit.
The documented one-image lock must cover decode through encode; request-body
buffering also needs bounded admission. No hosted configuration is changed.

Storage summary: pending W9 fixtures; average stored image and PDF sizes have
not been measured. W9 quick/full gates, screenshots, commit and push are pending.

Bounded sub-agents' completed static inventory was reviewed by lead:
`D:/Personal/workspace/sena_hub_wt/w9-upload-inventory/artifacts/w9-upload-inventory.md`,
SHA256 `9c4528cfc13c95649157b17094c209a6752fd10713f83268d0bc8868348d79f4`.
It confirms 10 MiB / 40-million-pixel / 200-page intake, SVG-only transformation,
no pre-upload context, and whole-row internal asset projections. Existing
knowledge thumbnails and bulk-rights evidence require the original checksum;
historical package verification also compares exact validation metadata.
Future intake must use the new pipeline while those historical validation-only
paths retain their existing identity checks. Stored PDF limits must cover SQL,
local readers, H1 and R2 adapters, not only the incoming proxy/API request.
No storage or network action was performed by this inventory.

### W9 permission card — design before implementation

No permission catalog, account, grant, template or role change is expected.
The following card defines the intended boundary; the lead will register its
concrete additive migration and exact runtime inventory before executing it.

| Field | Decision |
|---|---|
| Feature / owner | W9 future-upload optimization and file metadata suggestions; lead owns processing, privacy, dedup, storage and integration. Staff upload in the existing project, brand, commercial-type, promotion-banner and media workflows. |
| Tab | Existing `projects`, `brands`, `promotions` and `knowledge` boundaries; no new checkbox, tab, special action or automatic grant. |
| View (V) | Existing authorized asset lists/details, project media, private thumbnails/downloads and audit history. Processing results and allowlisted suggestions are private staff projections subject to the same asset and object visibility; never infer access from a known checksum or a cached context. Legal/unknown-category uploads remain private. |
| Edit (E) | Existing authorized upload and normal draft metadata actions. Validate category and owning project/brand context before processing; a disclosure context always forces legal handling. A suggestion's Use action changes only an ordinary editable draft field and requires the existing E permission at save. It never confirms metadata, rights, English review or publication. |
| Approve (A) | Existing individual rights-review and content-review actions remain unchanged. Show bounded file credit/stock evidence to authorized rights approvers. Stock evidence makes a file ineligible for bulk rights approval in both API and SQL, without blocking the existing individual evidence-based review workflow. |
| Special actions | None added. Existing publishing special and N2/N6 controls still apply after ordinary approval. |
| Separation | Existing asset-rights and content revision-author rules remain. N1 applies only to project/brand content; Promotions retains DATA/LEGAL separation. File suggestions grant no authority and are never approval evidence by themselves. |
| Templates | All existing versions/defaults unchanged; no account copying, template propagation or backfill. |
| Agency | Existing external boundary retained. No new agency access to internal upload/suggestion/rights surfaces; use existing canonical identity and object predicates wherever agency access is already explicitly permitted. |
| Sensitivity | Internal/restricted source evidence. Extract a bounded plain-text allowlist only. Store original checksum/size/MIME/dimensions, processing version/result and sanitized suggestions; retain no original bytes for optimized uploads. Never store/log raw GPS, distance, serials, contacts, face regions, paths/usernames, edit histories or thumbnails. GPS is computed transiently against authorized project coordinates and persisted only as near/far/unknown. Legal bytes/metadata remain the expressly required private exception. Audit through audit.change_log, not a second log system. |
| Other tabs | Enforce current binding source/destination V/E conjunctions. Promotions banner attachment still requires Projects E and the existing Promotions action. Category/context cannot authorize a hidden project/brand or promote an optimized marketing file into byte-exact legal evidence. BUD/object checks follow W6 on upload, dedup result, binding, suggestion read/use and review. |
| Shared surfaces | No file suggestions in public payloads, JSON-LD, exports/DW, RAG, assistant tools/citations/history or provider contexts. Private previews, thumbnails and image jobs consume the stored file. Preserve original evidence validation for historical packages/knowledge. Sentinel fixtures must prove all exclusion paths, including reused files and cached payloads. |
| Endpoints / SQL | Keep POST/GET `/v1/admin/assets`, GET `/v1/admin/assets/{asset_id}`, POST `/v1/admin/assets/{asset_id}/review`, GET `/v1/admin/assets/{asset_id}/file` and `/thumbnail`, GET `/v1/assets/{asset_id}/file`; GET `/v1/admin/projects/{public_id}/media`, PUT `/media/assets/{asset_id}` and `/media/links/{link_id}`, POST/GET `/media/jobs`; POST `/v1/admin/knowledge/rights/approve`; existing project/model/brand asset-binding routes. No new HTTP route is planned. Existing SQL inventory includes hub.register_uploaded_asset, list_assets, asset_detail, asset_file, public_asset_file, review_asset, project_media, media_save_asset, media_link_save, media_job_request, media_jobs_read, claim_media_image_job, public_content_payload and the knowledge-rights dispatcher. Add FORCE-RLS `hub.asset_upload_sources` for immutable upload provenance and context-scoped suggestions, with bounded `hub.asset_upload_context(jsonb)`, `hub.find_uploaded_asset_source(text,jsonb)` and `hub.record_asset_upload_source(uuid,jsonb,jsonb)` entry points. Fix search paths, close PUBLIC EXECUTE, forbid direct app DML and enumerate each new helper/policy in the permission inventory. No credential/harness changes. |
| Rollout / verification | Additive migration only, number not allocated yet. No changes to existing asset rows, stored bytes, versions, rights or published identity. New source associations require existing upload/object authority; original-checksum reuse must check access before returning any existing asset. Keep legal/unknown and marketing processing classes distinct so dedup can never substitute optimized bytes for legal originals. Test deny and positive neighbors under real runtime, next-request revocation, concurrent original/stored dedup, serialized decode, safe suggestion use, unchanged historical assets/packages, public/AI/export exclusions, all owner fixtures and per-file UI at 1280/390 in both themes. Use the existing fixture/stub-only gate and final scan; no live provider or hosted write. |

Design choice: file metadata suggestions live in the new immutable upload-source
association object, with explicit `source: file_metadata`, pipeline version and
validated context, separate from both confirmed asset fields and `ai_suggestion`.
This avoids automatic inclusion by existing `to_jsonb(asset)` projections and
allows GPS proximity to remain scoped to the project where it was computed.
Only bounded staff-media and rights-review projections opt in. Original-first
dedup returns an authorized matching processing class before any re-encoding;
stored-checksum dedup remains the second stage. New source associations do not
rewrite a reused asset or its rights. A full privacy/locking review is required
before W9 code; this is a design record, not implementation or runtime evidence.

### W9 UAT amendment prepared in parallel

Lead assigned the bounded W9 amendment to the bounded sub-agents preparing UAT and
`ws/w8-promotion-uat` worktree; owned files were only docs/49 and the ignored
`artifacts/w9-uat-review.md`. Written brief:
`artifacts/unified-workspace/w9/uat-brief.md`. Lead reviewed all U41–U54 and
requested the explicit small-image quality exception in U43. The original
forty-case, 158,687-byte prefix remains byte-exact. Strict UTF-8, 54 unique case
IDs, fourteen new NOT RUN rows, 21 quoted labels matching docs/47 and whitespace
checks passed. No runtime tests, implementation, fixture rehearsal, commits or
pushes occurred in this task.

Final draft SHA256:
`c6baf6664fdcb7457f5d3fd3f255c40beb65c408fbc72d54cf376b4d7b05ff8e`.
Review SHA256:
`74205a18dc9d9a3e6dd2afb10e3ec765f91e15a01f4214bfe7d144d2b3fd99e0`.
Lead receipt: `artifacts/unified-workspace/w9/uat-lead-receipt.json`.
All 54 cases remain NOT RUN. The nine W9 fixture packs, byte/privacy/concurrency
evidence, storage averages and final owner-ready links remain implementation
work; the draft is still outside main pending W8 integration.

W4 quick recovery attempt 1 finished 84 passed / 8 failed / 0 skipped at 1280 px
(5.1 minutes); 390 px was not started. Archived under `w4/ui-recovery-attempt1/`.
Five logo failures identified omitted saved brand-binding DTOs; bounded sub-agents supplied a
finite current-binding/current-asset extension, reviewed by lead (new logo spec
SHA256 `2cfd0c0397b9776d5358538a3f7da2bebfec79cf1b86e9b3affee7536c9b9b5e`).
Three native success-notice selectors were narrowed to exclude workflow status
messages, keeping expected text unchanged. The targeted three-spec rerun passed
19/19 with zero skips/failures (`w4/ui-recovery-targeted.log`). The broader
92-case recovery set is rerunning at both widths. A screenshot-only refinement
also scrolls the sandboxed publication preview into view before capture; it will
receive its own affected-spec quick gate and visual inspection before full gate.

W9 library feasibility inspection used only installed source, without importing
configuration or invoking processing: pypdf supports a fresh writer, removal of
the document Info dictionary and replacement of writer-owned embedded images
through Pillow. Inline-image replacement is not supported by that API, so W9
must retain a safe metadata-only result when recompression is unsupported and
reject any case where mandatory stripping cannot be verified. Metadata cleanup
must include reachable page/resource metadata and remove orphan/history objects;
matching page count and extracted text alone is not a privacy proof. No system
binary or new dependency has been introduced. This note is a design constraint,
not a claim that PDF processing has been implemented or tested.

W4 browser recovery is complete: targeted 19/19, affected suite 92/92 at 1280 px
(5.1 minutes) and 92/92 at 390 px (5.3 minutes), all zero failures/skips with clean
disposable teardown. Receipt: `w4/ui-recovery-receipt.json`. Its source comparison
confirms all 119 non-UI/document paths from full attempt 2 remained unchanged.
The publication capture follow-up passed all 14 cases (18.5 seconds), including
all four theme/width reviews. The initial child-frame scroll timed out; moving
the parent iframe into view and using the existing viewport-settled native click
helper preserved the original publish-result assertions. The two intermediate
capture attempts (10 passed / 4 failed each) remain as `ui-preview-attempt1.log`
and `ui-preview-attempt2.log`; final evidence is `ui-preview-quick.log`.
Lead visually inspected `review-light-1280.png` and `review-dark-390.png`: the
sandboxed approved preview is now rendered, with readable controls and no page
overflow. No product click handler, approval guard or test timeout was changed.

Lead now freezes the 158-path W4 lease and starts a complete new full gate from
typecheck, offline webpack and production through API, DB/replay, local H1,
both full UI widths and credential scans. The full start hashes are recorded
again after these documentation changes. No W4 commit or push yet; pending
questions and requirement deviations are unchanged. W9 requirement/design
records are included, without claiming W9 implementation or verification.

For independent W9 preparation, lead assigned bounded sub-agents to
`D:/Personal/workspace/sena_hub_wt/w9-upload-fixtures`, branch
`ws/w9-upload-fixtures`, cut from `9c6beb7`. Owns only the new
`apps/api/tests/upload_optimization_fixtures.py` and ignored
`artifacts/w9-fixture-review.md`. The written brief is
`artifacts/unified-workspace/w9/fixture-brief.md`. Scope: deterministic small
synthetic image/PDF metadata containers and fixture-validity smoke checks;
no product logic, security assertions, main changes, large decodes, ports,
configuration, credentials, providers, commits or pushes. Lead retains the
processing/privacy/dedup implementation and all final test assertions. This
work does not alter the frozen W4 source or hold its test lock.

### W4 full attempt 3 and final fixture repair (6 November 2026)

The complete 158-path source set stayed unchanged throughout full attempt 3.
Typecheck and offline webpack passed; production 4 passed / 0 skipped / 0 failed;
API 2,336 passed / 11 existing skipped / 0 failed; DB 95 Node tests, 41 SQL suites
and 23 concurrency scenarios passed with zero skips/failures and migration replay
through 0085; local H1 69 Node, 10 smoke and 66 browser checks passed with zero
skips/failures. Desktop UI finished 429 passed / 0 skipped / 1 failed in 20.0
minutes. The runner stopped before mobile UI and final scans. Evidence and the
unchanged-source receipt are archived under `w4/full-attempt3/`. This is a failed
full gate, not delivery evidence. No W4 commit or push has occurred.

The sole failure was the assistant frozen-version citation fixture: its
synthetic PROJECT-DEMO had no workflow inventory response, so a real 404 from
the new shell produced a second alert. The broad citation assertion raced that
unrelated alert. Lead added a finite GET-only inventory for that exact identity
and audited other synthetic workspace fixtures. The same missing read contract
was repaired for CAPABILITY-UI in `permission-navigation.spec.ts` and A in
`project-dashboard.spec.ts`. The three specs gained only 20 fixture lines;
all original assertions and writes remain unchanged. No production code,
permission, timeout or retry policy changed. The explicit W4 lease is now 161
paths. Quick gates cover these three specs plus hub-navigation at both widths;
after they pass, the whole full gate restarts as docs/11 requires.

### W9 isolated processor draft and synthetic measurements (6 November 2026)

Lead owns `ws/w9-upload-processing`, cut from main `9c6beb7`, in
`D:/Personal/workspace/sena_hub_wt/w9-upload-processing`. The written brief is
`w9/processing-brief.md`. Owned product/test files are
`apps/api/sena_hub_api/upload_optimization.py` and
`apps/api/tests/test_upload_optimization.py`; no API/UI/SQL adapter is integrated.
Lead retained all optimization/privacy logic and assertions. Bounded sub-agents supplied only
the synthetic helper in its separate fixture worktree. Its extensions now
include a different EXIF IFD1 thumbnail, actual PDF incremental history,
page/resource XMP, and direct/nested/reused/inline metadata-bearing JPEGs.
Lead reviewed source and helper validity before copying. Final helper SHA256:
`835e59cb5cc2764cf40f2d611205aadd0b6feee8a0eea1ddf655c24eb7a26c5c`.

The pure draft handles image orientation, sRGB profiles, bounded resize/encoding,
metadata-free pixels, private unconfirmed allowlisted suggestions, stock evidence
even when credit text is discarded for contact details, and transient GPS
proximity. C2PA detection is an unconfirmed presence signal, never signature or
authenticity verification. PDF processing uses pypdf, strips Info/XMP/old revisions
and embedded JPEG metadata, and checks page count and extracted text. Legal,
unknown-category and disclosure PDFs retain exact bytes. A context-local
diagnostic redactor strips third-party decoder message arguments before the
existing log handlers format them; it adds no logging store. No dependency,
system binary, provider, credential, hosted object or existing asset was used.

Preparation checks: 25 small standalone checks passed, then 4 real-size checks
passed under the lead's serial lane after W4 teardown, all zero skipped/failed.
Evidence: `w9/processing-small-quick-8.log`, `w9/processing-large-quick.log`.
Cases include 6000x4000 oriented JPEG, lossless PNG/transparent color keys,
photographic PNG conversion, WebP, ICC/XMP/IPTC/EXIF/C2PA, GPS near/far/unknown,
excluded metadata and thumbnail removal, output/input limits, serialized encodes,
legal preservation, active PDF rejection, compression gain and no-gain metadata
rewrites. Metadata-only direct/nested/inline PDFs also rendered pixel-for-pixel
identically through the existing renderer. These are configuration-free pure
checks, not the required API/runtime/full W9 gate.

Draft processor SHA256:
`59e9a335d31e77b6871dfaa367b0efe6e9c5803b65e1e95cbf83b57d2bb524c1`.
Draft test SHA256:
`e1e26a7d530dfe485400785d55041f4410e0fed290d54623377e55b8938daaf6`.

The first storage measurement used nine synthetic fixtures; no originals or
optimized objects were installed. It is a fixture measurement, not a production
storage forecast, and must be repeated on final W9 code.

| Fixture group | Count | Average input bytes | Average stored bytes |
|---|---:|---:|---:|
| Images: oriented/small JPEG, line-art/opaque-noise/transparent-noise PNG, WebP | 6 | 2,421,261.33 | 1,677,711.17 |
| PDFs: image brochure, text-only metadata, byte-exact legal history | 3 | 160,540.00 | 25,173.33 |

Per-file dimensions, MIME, processing decisions and stored hashes are in
`w9/storage-summary.json`; execution log: `w9/storage-measurement.log`.

Draft interpretation/deviation: optional PDF image recompression must save 20%
against both the input and the metadata-only rewrite, so mandatory metadata
removal does not justify marginal lossy recompression. Opaque embedded metadata
that cannot be stripped safely (currently JPX) uses the re-export rejection.
Review these choices against the final corpus before integration. Outstanding:
high-bit-depth PNG and non-ICC color handling, cross-process admission before
buffering, all authorized context/immutable provenance/dedup/permission adapters,
historical validator/operator compatibility, legal/private/public boundaries,
UI limits/results/suggestions/rights evidence, end-to-end public/export/AI
exclusion tests, full gate and screenshots. No migration number, commit or push
is claimed for W9. The W3.1 prerequisite was subsequently resolved by the owner decision recorded below;
no new pending owner question is introduced by this preparation.

W4 final fixture quick gate: the first 1280 run had 51 passed / 6 failed /
0 skipped because lead's new exact-query fixtures omitted the existing
`limit=100` parameter; the 390 run did not start. Evidence remains under
`w4/ui-final-fixtures-attempt1/`. Adding that bounded query parameter fixed the
fixture assertion without changing any original test assertion. The same set
then passed 57/57 at 1280 px (1.3 minutes) and 57/57 at 390 px (1.4 minutes),
zero skips/failures, with clean disposable teardown. Receipt:
`w4/final-fixture-quick-receipt.json`. All 158 prior source hashes except this
log stayed unchanged, and the three new spec changes contain only 20 insertions
and no deleted assertions. Lead now records the 161-path baseline and starts
the entire full gate again. No W4 commit or push yet.

Subsequent isolated W9 refinement preserves the compressed image stream of a
small JPEG/WebP when neither orientation nor profile conversion is required,
stripping only metadata instead of re-encoding or expanding it. The small
preparation set now passes 26/26 (`w9/processing-small-quick-9.log`), zero skips
or failures. The earlier 25+4 checks and storage table remain evidence for their
recorded processor hash; final large checks/averages will be repeated after the
remaining W9 work. No main source adapter or new permission has been introduced.


## Owner review W3.1 — received 6 November 2026

The owner confirmed that the separate 5 November W3.1 message had not been
delivered earlier. Finish the current W4 full gate and W4 commit first; then
W3.1, W3.2, W5, W6 and W7, with bounded W9 preparation continuing independently
and W8 last. Record the verbatim exposure decision in docs/47 section 4.5.
Remove all AI model/vendor model names from docs/47 and docs/48 in the W4
commit without rewriting history. Future documentation, logs, commits and code
comments describe delegation only as bounded sub-agents.

### Design and unchanged boundaries

The existing guarded website suggestion decision is the only acceptance entry
point. It resolves its exact registry field in the transaction and uses that
field's current default exposure for both use and edit_use. Missing, inactive
or invalid registry state cannot grant broader exposure. Explicit forged broader
input cannot bypass the server rule. Existing draft/version/import rows are
unchanged by the migration; only a later authorized user save creates a new
draft. Preserve numeric/manual-entry guards, source URLs, stale-decision and
revision locks, ordinary Manager approval and independent Online publication.

Expose stored item exposure through existing bounded DTOs. A compact shared
chip uses existing exposure labels. Internal notices are informational and link
to the exact authorized editor; they do not block submit/approval/publication
or change any payload's existing eligibility. Items without a stored exposure
must resolve their existing field policy explicitly, never guess that approval
makes them public. Final source/component mapping precedes implementation.

Overview is a summary: required and recommended counts grouped by destination
tab and section, with native expandable group controls. A group displays at
most five contextual exact-field links before its separate view-all expansion.
Use collapsed group summaries to keep the initial many-gap page around two
desktop screens; user-requested expansion may make it longer. Label repeated
items with their actual visible context, never hidden object names. Keep only
the latest five changes and link to History. Display user-facing version numbers
with their meaning; omit bare internal revision counters. Preserve existing
deep-link navigation, dirty-form protection, keyboard focus and reduced motion.
Use the same summary on project/brand/group/business levels where applicable.

### W3.1 permission card (docs/36)

| Field | Decision |
|---|---|
| Feature / owner | W3.1 owner-review corrections; lead owns SQL, exposure, permission decisions and integration; bounded sub-agents may inventory/test confined files. |
| Tab | Existing Projects, Brands and Knowledge source tabs; existing Releases/publication entry. No new tab, checkbox, catalog grant or special. |
| View (V) | Only currently visible entity fields, readiness gaps, source metadata, exposure chips and history. Exact context labels inherit the source object's existing View; no hidden names or widened cached projections. |
| Edit (E) | Existing Projects E is required to use/edit_use a project website suggestion. The field registry's default_ai_exposure is applied server-side for that exact field. Internal defaults remain internal; no broader exposure, implicit confirmation, imported-row rewrite or permission bypass. Ordinary source edits retain their existing authority. |
| Approve (A) | Existing per-item Manager approvals, self-approval reason rules and source snapshots remain; internal notice does not grant or revoke approval. No automatic approval. |
| Special actions | Existing independent Online publication special plus source View. No new special; notice is non-blocking and never publishes a draft. |
| Separation | W4 N1/N2 unchanged; Promotions retains DATA/LEGAL and edit/approve separation. Editors, English reviewers and self-approvers cannot publish their included version. |
| Templates | No template/account/grant/default changes. |
| Agency | Existing external boundary; no new agency access. Canonical identity, row scope and runtime denials remain. |
| Sensitivity | Owner explicitly authorizes a newly accepted website suggestion to use its registry default. Draft remains private until the ordinary approval/publication gates; internal exposure excludes website and AI content. Existing audit.change_log and version history only. |
| Other tabs | Maintain all existing source/destination View/Edit/Approve conjunctions. Readiness and notice links do not authorize destination data; inaccessible sources remain hidden. |
| Shared surfaces | Existing public/JSON-LD/export/RAG/assistant filtering is preserved. Test approved/unapproved and internal/default cases against public output, not only chips. No provider calls. |
| Endpoints / SQL | Existing POST /v1/admin/projects/{public_id}/content/website/{candidate_id}/decision and hub.website_text_decide; GET /v1/admin/content/workspace/{kind}/{ref} and hub.workspace_page; existing history routes/functions and hub.workspace_field_target. Existing workflow reads/items/submit/review/save-approve and publication queue DTOs may gain bounded exposure presentation, retaining guards. Inventory any helper added during final design; no unclassified route or app-callable private helper. |
| Rollout / verification | Additive function/projection migration only. No data/version/review/history/account/grant/template rewrite. Test per-field defaults, internal stays internal, forged broadening denial plus positive neighbor, no migration row changes, notices with exact editor links, contextual readiness and expanded groups, latest-five history, many-gap default page height, 1280/390 light/dark screenshots and all mandatory quick/full gates before explicit-path commit/push. |

### Migration lane and cleanup

Committed migrations through 0085 remain unchanged. New uncommitted reservation
order: W3.1 0086; W3.2 0087; W5 0088; W6 0089/0090; W7 0091. W9's number is
allocated when its additive design is ready. Earlier prepared W5-W7 files are
not integrated or committed; rename their reservations and dependent manifests
when rebasing them after W3.2, then review/gate the final files normally.

After a merged slice, inspect its worktrees and remove finished clean worktrees
with git worktree remove, then merged branches with git branch -d. Never force
or delete unmerged work. Preserve unfinished work and report its reason. Record
remaining programme worktrees in docs/48; the unrelated phase7 checkout is not
programme-owned and must remain untouched.

### Current evidence

Design/read-only preparation only while W4 runs. No W3.1 code, migration,
runtime test, screenshot, commit or push yet. The bounded inventory owns only
its separate report. That inventory was read-only while the fourth W4 gate ran; the final W4 rerun includes the new owner documentation.

Bounded sub-agents delivered a read-only W3.1 UI inventory at
`D:/Personal/workspace/sena_hub_wt/w3.1-review-inventory/artifacts/w3.1-ui-inventory.md`.
Lead reviewed its exact component/route mapping and test gaps. No W3.1 implementation or runtime pass is claimed.


## W4 fourth full attempt and owner review checkpoint request

The owner requested a summary and a commit/push of finished work for review.
W1-W3 are already pushed. W4 remains uncommitted until its mandatory full gate
passes. The fourth full attempt had typecheck/build/production pass; API 2,336
passed / 11 existing skipped / 0 failed; DB 95 Node checks, 41 SQL suites and 23
concurrency scenarios passed; local H1 69 Node / 10 smoke / 66 browser checks
passed. Desktop UI passed 430/430. Mobile UI passed 429 with one failure in the
archive memo-search test. Final scans did not run because the runner stopped.
All 161 source hashes remained unchanged. Evidence and failure trace are kept
under `artifacts/unified-workspace/w4/full-attempt4/`; this is failed evidence.

The trace shows the browser automation filling the search field while the
closing native dialog was still modal. The fill did not enter the new query,
so no new search request was made. The test now waits for dialog removal and
the restored URL, asserts the entered value and verifies that the new query
was requested. Every previous search-result, evidence and isolation assertion
remains. No application code, timeout or retry policy changed. The explicit
commit manifest now contains 162 paths. Archive and navigation quick checks
run at both widths, followed by the full gate again if they pass.

The owner-requested documentation cleanup and the separate W3.1 decision/card
are applied before this final rerun. No git history is rewritten. W3.1/W3.2
implementation and W9 integration are excluded from this W4 checkpoint.

Archive/navigation quick gate passed 29/29 at 1280 px and 29/29 at 390 px,
zero skipped/failed, with clean disposable teardown. Both widths exercised the
repaired memo search. Logs: `w4/archive-quick-1280.log` and
`w4/archive-quick-390.log`. Broad source/browser scan found zero credential
matches. The fifth full gate now runs against the frozen 162-path manifest.

## W4 final full gate — review checkpoint, 6 November 2026

W4's fifth full attempt passed on the frozen 162-path source manifest,
including the owner's documentation cleanup and verbatim W3.1 decision/card.
No application, API, SQL, fixture or test source changed during the run. This
post-gate edit records the result only. No git history was rewritten. Delivery
commit/push confirmation follows below.

Built: per-item submit/approve/return and FAQ withdrawal; N1 project/brand
catalog separation change; approved-version and independent-publisher N2
guards; the N6 unified publication queue with individual stale-item outcomes;
source-value reapproval and old/new local staging values in history. Promotions
keep DATA/LEGAL review. Existing drafts, versions, reviews, publication history,
accounts, grants and templates were not rewritten by migrations.

Migrations: `202611040084_content_workflow.sql` and
`202611040085_unified_publication.sql`. Both replayed on disposable databases;
no working-database or hosted migration was applied.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Admin typecheck | pass | 0 | 0 |
| Documented offline webpack build | pass | 0 | 0 |
| Production install/import checks | 4 | 0 | 0 |
| API | 2,336 | 11 existing | 0 |
| DB Node checks | 95 | 0 | 0 |
| DB SQL suites | 41 | 0 | 0 |
| DB concurrency scenarios | 23 | 0 | 0 |
| Local H1 Node checks | 69 | 0 | 0 |
| Local H1 smoke checks | 10 | 0 | 0 |
| Local H1 browser checks | 66 | 0 | 0 |
| UI at 1280 px | 430 | 0 | 0 |
| UI at 390 px | 430 | 0 | 0 |

The 11 API skips are pre-existing opt-in checks; no test was newly skipped,
quarantined or weakened. Six dependency deprecation warnings remain. Provider
and broad source/browser credential scans passed with zero matches and no
credential files read. `git diff --check` passed. Exact log/migration/source
hashes are in `artifacts/unified-workspace/w4/full-gate-receipt.json`.

Screenshots: `artifacts/unified-workspace/w4/review-light-1280.png`,
`review-light-390.png`, `review-dark-1280.png`, `review-dark-390.png`,
`result-light-1280.png`, `result-light-390.png`, `result-dark-1280.png`,
`result-dark-390.png`, `h1-queue-1280.png`, `h1-queue-390.png` and the publication
navigation/history captures in that directory. Lead visually reviewed the
desktop queue and mobile dark review; automated viewport/theme/focus checks
ran in the complete suites.

Bounded sub-agents supplied finite browser/SQL fixtures, source inventories and
UAT documentation. Lead reviewed their diffs and quick checks and retained all
governance, permissions, migrations, concurrency, integration and runtime gates.
No new W4 requirement deviation or pending question. The W3.1 prerequisite is
now resolved by the owner's newly delivered scope. Next: W3.1, then W3.2.

W9 remains an isolated uncommitted prototype: 34 small pure processing/privacy
checks pass, including SDR colour handling, raw embedded PDF JPEG metadata and
real preview-thumbnail removal. Four large checks and the older storage sample
were run on an earlier draft and must be repeated on final code. Multichannel
16-bit transforms/remaining HDR descriptions, authorization, dedup, DB/API/UI,
operator adapters and public/provider privacy tests remain unfinished. No W9
delivery, full-gate pass or integration is claimed at this checkpoint.


## W4 commit, push and review handoff

Primary W4 commit: `16b38cd6effede7f11693e9fcd6128c68258cf3b` — `Unify content review and publication governance`.
Push to `origin/main` succeeded and the remote head was verified at that exact
commit. The checkpoint contains the 162 explicit W4 paths, migrations 0084/0085,
the owner decision/design records and the verified full-gate result above.
Credential paths passed git check-ignore immediately before the commit. No
hosted migration, deployment, storage write or live provider call occurred.

The owner requested this checkpoint to inspect work in progress. Delivered:
W1 shell, W2 home/search/assistant, W3 entity workspace and W4 governance/queue.
Remaining: W3.1 exposure/overview corrections, W3.2 contextual Promotions,
W5 business, W6 BUD scoping/sync, W7 stub writing aid, W9 upload optimization,
and W8 UAT/final programme gate. Prepared drafts are not delivered features.
Next implementation slice is W3.1. Hosted rollout still requires separate
authorization.

### Finished worktree cleanup and remaining inventory

Removed finished worktrees and their merged branches with normal git worktree
remove and git branch -d: `w1-service-shell`, `w3-review`, `w4-review`. Before removal, every changed W1 source
blob was verified as already preserved in main history. No force option or
unmerged unique file was discarded. The unrelated phase7 checkout remains
untouched.

53 programme worktrees remain. The following are task descriptions, not
replacement filesystem paths; the stable inventory ID identifies each reviewed
checkout. Older prepared variants with distinct/unreviewed source are retained
until their work is reconciled. Actual checkout paths remain available through
git worktree list. Main is additional to this table.

| Task description | Inventory ID | Changed paths | Reason retained |
|---|---|---:|---|
| w2-home-projection | `a1f2b3a19e2a52f1` | 2 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3-browser-recovery | `d98a162853687e11` | 115 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3-entity-ui | `2f98f59956480279` | 63 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3-lead-integration | `8e767ff8114199c6` | 124 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3-legacy-tests | `d345eb3986cab117` | 117 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3-navigation-tests | `cb2cc7a7d3004bf2` | 116 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3-workspace-api | `b1c0224bfb87b084` | 5 | Distinct or unreviewed earlier source; preserve until reconciled |
| w3.1-review-inventory | `89468956fc56f267` | 0 | Unfinished preparation or review handoff |
| w4-browser-regressions | `943d470f04b2a4dc` | 151 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-disclosure-evidence | `493dc8fae1cf22fa` | 51 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-governance | `bc2914174aa0c342` | 14 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-http-gates | `7c5658a93955fbe4` | 199 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-lead-integration | `f71e812d12cc3faf` | 224 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-lifecycle-tests | `6c53420fd6aa19ad` | 171 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-primary-forms | `ee236f74a4ab3dd7` | 140 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-publication-navigation | `93335edb2cc730a0` | 212 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-publication-recheck | `a212cfc1173e31fa` | 51 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-record-forms | `4cd93f23cf44e0e7` | 145 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-bounded-fixture-confirmation | `27e9bf86b94699c8` | 7 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-bounded-form-fixtures | `6fb1bb2ce0600915` | 3 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-bounded-logo-fixture | `1f6dd40d5be64f7a` | 5 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-bounded-ui-fixtures | `a677c878760d5cff` | 9 | Distinct or unreviewed earlier source; preserve until reconciled |
| w4-workflow-ui | `2858e71bd69f5350` | 8 | Distinct or unreviewed earlier source; preserve until reconciled |
| w5-business-design | `aedbe2ce15d80561` | 0 | Unfinished preparation or review handoff |
| w5-business-level | `8757011dae7792f4` | 152 | Unfinished preparation or review handoff |
| w5-business-transport | `38d284f0389abec6` | 10 | Unfinished preparation or review handoff |
| w5-business-ui | `0316398b31805e4c` | 199 | Unfinished preparation or review handoff |
| w6-account-ui | `f89e0573e898bf91` | 204 | Unfinished preparation or review handoff |
| w6-asset-delivery | `57eef06a894aa1be` | 243 | Unfinished preparation or review handoff |
| w6-assistant-scope | `1309d8b53a9fc874` | 240 | Unfinished preparation or review handoff |
| w6-bu-import | `5d9b8d66f1165abd` | 183 | Unfinished preparation or review handoff |
| w6-client-boundaries | `2e66db65d8a5f0bc` | 244 | Unfinished preparation or review handoff |
| w6-client-callers | `63db680bf2c24bc6` | 219 | Unfinished preparation or review handoff |
| w6-notice-ui | `34300adf55f1fa5e` | 239 | Unfinished preparation or review handoff |
| w6-permission-inventory | `8ef7a4bec5dbc472` | 2 | Unfinished preparation or review handoff |
| w6-read-boundaries | `a4f65e8fee71f0ee` | 238 | Unfinished preparation or review handoff |
| w6-review | `1543199d0e4c4177` | 0 | Unfinished preparation or review handoff |
| w6-route-transport | `8caab7f1f6181272` | 2 | Unfinished preparation or review handoff |
| w6-scope-audit-fixes | `50637b37d8fb4a38` | 241 | Unfinished preparation or review handoff |
| w6-scope-design | `75430df53139a796` | 2 | Unfinished preparation or review handoff |
| w6-scopes | `833cdfa8123490a6` | 145 | Unfinished preparation or review handoff |
| w7-admission-order | `4db641ceb50bc08c` | 115 | Unfinished preparation or review handoff |
| w7-field-bindings | `adc4435ada31b96d` | 232 | Unfinished preparation or review handoff |
| w7-h1-catalog-fixture | `b346267139a88b8f` | 4 | Unfinished preparation or review handoff |
| w7-proxy-transport | `b2562b41fda0b018` | 2 | Unfinished preparation or review handoff |
| w7-writing-aid | `6716bf39d83fb963` | 4 | Unfinished preparation or review handoff |
| w7-writing-ui | `7a94b0d716f577ef` | 5 | Unfinished preparation or review handoff |
| w8-promotion-uat | `04f6f1b56b538c47` | 1 | Unfinished preparation or review handoff |
| w8-bounded-doc-checks | `d744787658596fa6` | 0 | Unfinished preparation or review handoff |
| w8-uat-draft | `d344cd90fb140a01` | 1 | Unfinished preparation or review handoff |
| w9-upload-fixtures | `001534655654cb3a` | 1 | Unfinished preparation or review handoff |
| w9-upload-inventory | `0cfeaad33bbdc2db` | 0 | Unfinished preparation or review handoff |
| w9-upload-processing | `d694d210dd5a112a` | 3 | Unfinished preparation or review handoff |

## Continuation after the review checkpoint — 6 November 2026

Owner repeated the W9 file-metadata addendum. It is already recorded verbatim
in docs/47 section 8.6; do not duplicate or weaken it. Private unconfirmed
file_metadata suggestions, mandatory non-legal PDF metadata/history removal,
legal byte preservation and all exclusion tests remain W9 acceptance criteria.
The separate private provenance/suggestion table remains the recorded design;
no suggestion may enter public payloads, exports, retrieval or provider inputs.

Main starts clean at `5a59e13`; fast-forward pull reports already up to date.
Continue in the agreed order: W3.1, W3.2, W5, W6, W7, W9, W8. W3.1's permission
card above applies before code. Lead owns its exposure policy, migration 0086,
overview implementation, integration and all runtime gates. No W3.1 runtime
pass is claimed yet.

Bounded sub-agents perform a static W9 metadata fixture-coverage review in
`D:/Personal/workspace/sena_hub_wt/w9-metadata-verification`, branch
`ws/w9-metadata-verification`, cut from current main `5a59e13`. Exclusive write
ownership: `artifacts/w9-metadata-verification.md` in that worktree. The brief is
`artifacts/unified-workspace/w9/metadata-verification-brief.md` in main. Read-only
inspection of the isolated processor, its tests and synthetic helper is allowed;
no product edits, ports, configuration reads, commits or pushes. Lead retains
privacy/authorization design and implementation. This adds one unfinished
review worktree to the inventory above.

### W3.1 implementation map before code

Lead exclusively owns migration 202611060086_workspace_summary_exposure.sql,
the existing content_workspace/content_workflow API adapters where presentation
is needed, entity-workspace, content-history, website-content-sources,
content-workflow and publication-workspace components, their existing libraries
and styles, and a small shared content-exposure presentation component. Existing
FAQ/media read projections receive chips where they do not render the shared
workflow component. Lead owns affected API/SQL/browser tests and permission
inventories. No other workstream edits these paths concurrently.

The migration replaces functions, not stored rows: website_content_sources and
website_text_decide resolve active registry defaults; workspace_page adds safe
context and section exposure; content_workflow_read/items and publication
descriptors add bounded exposure metadata. New private helpers, if needed, are
revoked from runtime/public roles and enumerated in tests. Exact editor targets
reuse the existing guarded descriptor and URL encoder, with historical version
selection removed for an exposure edit. Composite entities without one stored
exposure show the existing per-field registry policy rather than an invented
open/internal value. Publication descriptors must describe the included source
version; a stale version cannot borrow the current draft's exposure.

The overview uses native details/summary and existing semantic colours. Local
UI guidance searches did not find a relevant summary pattern; the explicit
owner design and existing native controls are the implementation basis. Counts
remain visible while groups are collapsed. Expanded groups show five links,
then an in-place view-all control. The full History tab retains its pagination
and permitted diff inspection.

### W9 bounded metadata review receipt

Bounded sub-agents delivered the static report at
`D:/Personal/workspace/sena_hub_wt/w9-metadata-verification/artifacts/w9-metadata-verification.md`
(SHA256 `6b2e94fc71c706575eead504673de757a7c6914d03b14ffe5efde2e02ae76ce3`).
It inventories 38 test methods; runtime tests were NOT RUN. Remaining fixture
gaps include dedicated user/computer-name inputs, full-image CreateDate and
stock-identifier cases, independent PDF incremental/nested-metadata input
preconditions, unsafe-rewrite rejection, and broader negative log checks.
Database/API/public/export/RAG/assistant/provider/UI exclusions still require
integration tests. The three prototype source hashes were unchanged; no product
files were edited by this review. W9 remains unfinished.

### W3.1 implementation and quick-gate checkpoint

The implementation uses one readiness panel grouped by destination tab/section,
showing separate required/recommended counts in each collapsed summary. Expanding
shows five contextual links, then an in-place view-all control. The first browser
height regression correctly failed at 2,644 px; combining duplicated groups and
compacting the five-entry timeline fixes the layout without raising its 2.2-screen
limit. Full History keeps pagination and permitted diffs. New section labels and
all exposure/overview copy are copied from docs/47 section 8.5.

Migration 0086 changes function definitions only. Newly accepted suggestions use
the active exact-field registry default under a row lock; broader forged input
is rejected. Existing drafts are not rewritten. Private helpers
`hub.workspace_item_context(uuid,jsonb)` and `hub.content_exposure(jsonb,jsonb)`
are explicitly denied to all runtime roles. The existing permission baseline
lists them. Workflow, FAQ, section and publication DTOs expose only bounded
exposure metadata and existing guarded editor targets. Publication descriptors
derive exposure from the included version rather than a newer draft or a
different dependency. Publication eligibility and public filtering stay intact.

Chips appear in the shared item workflow, section navigation, inherited FAQ and
media cards. Composite records explicitly show the existing per-field registry
policy. Internal notices appear before single/batch submission, in approval
dialogs and publication items; they do not disable an otherwise authorized
action. Existing writers and source guards still control exposure changes.

Additional owned files are content-common, faq-workspace,
project-media-workspace, content-exposure.tsx/css, the local migration checksum
profile, its inventory test and tests/content-upgrade.test.mjs. The latter now
compares the row count and complete-row digest of every existing Hub, staging
and audit table across 0086, with populated version/assets/account/grant fixtures.
No harness configuration loading was changed and no hosted operation was run.

Quick evidence so far (not a completed full gate):

- Typecheck and documented offline webpack build pass through attempt 3.
- API workspace/default tests: 51 passed; permission-baseline/exposure/context
  selection: 31 passed. Additional included-version/public/context assertions
  are being checked before the final source freeze.
- Disposable DB gates pass through attempt 3, including populated row
  preservation. Later presentation-only SQL refinements will receive the final
  replay and complete gate. An initial unregistered-checksum stop and one SQL
  expression parser error were fixed; neither touched a working database.
- Browser quick gate at 1280 px: 70 passed, zero skipped/failed on the latest
  rebuilt UI. The earlier 68-pass/one-height-failure result is retained. The
  focused corrected height test also passes. The 390 px quick run and full
  gate remain outstanding.
- Screenshots are under `artifacts/unified-workspace/w3.1/`; regenerate all
  four on the final full gate and review them before delivery.

No W3.1 commit/push yet, no new pending owner question and no scope deviation.
The bounded W9 report is preparation only. Next after W3.1 delivery: W3.2.

Bounded W9 fixture follow-up: `ws/w9-metadata-fixture-cases` at
`D:/Personal/workspace/sena_hub_wt/w9-metadata-fixture-cases`, cut from current
main `5a59e13`. Exclusive writes are its upload optimization test file, synthetic
fixture helper and `artifacts/metadata-cases.md`. Only the three explicit
prototype source/test files were copied; no configuration was copied. The
processor is read-only. Brief: `artifacts/unified-workspace/w9/metadata-fixture-cases-brief.md`.
Scope is missing metadata test cases and independent input preconditions; only
small pure tests without ports or environment loading are allowed. Lead retains
all processing/privacy decisions. This adds one unfinished worktree (55 programme
worktrees plus main; the unrelated phase7 checkout remains untouched).

### W3.1 final quick checks and full-gate start

Final focused API selection: 52 passed, zero failed/skipped, one existing
deprecation warning (`api-context-public-quick-4.log`). It verifies contextual
selling-point/building/unit/price labels, exact targets, public denial of accepted
drafts, immutable earlier rows and exposure from the actual included version.
Final affected browser/navigation selection: 70 passed at 1280 and 70 passed
at 390, zero failed/skipped (`ui-1280-quick-4.log`, `ui-390-quick-4.log`).
The strengthened settled-header height/screenshot check separately passes once
at each width (`ui-ready-1280-quick-6.log`, `ui-ready-390-quick-6.log`).
The height limit is unchanged. Lead reviewed the desktop light and mobile dark
screenshots; all four themes/widths will be regenerated by the full gate.

Freeze the explicit current source set in `full-start-source-hashes.json` and
run the complete local gate serially. The full API suite also supplies the
required wider shared-helper/permission coverage. No completion or commit is
claimed until every suite, final source verification and both credential scans
pass. Migration 0086 final candidate SHA256:
`08a6eddcc395ebc6f1bc27d7dd14807474b30d5a6f98b3953580d611a67b4dd9`.

The bounded W9 fixture follow-up reports 39 small tests passed, zero failed or
skipped, and two files parsed for syntax. Its processor remained unchanged.
Lead diff review and integration are pending; this is not a W9 full-gate pass.

### W3.1 first full-gate failure and continuing review

The first frozen candidate had 27 paths and all hashes were unchanged at the
end of the API run. Typecheck, offline webpack build and production (4 tests)
passed. Full API: 2,335 passed, 13 failed, 11 existing skips, 6 warnings.
Twelve failures expose a JSON null target incorrectly treated as an object
by the new exposure-link projection. One strict inventory DTO allowlist needs
the four intentional exposure metadata keys added, while retaining exact-key
equality. DB, H1, both complete browser suites and final scans were NOT RUN
because the runner stopped on API failure. Logs retain the failed result;
there is no W3.1 commit/push or completed full gate.

The bounded inventory review also confirms that canonical asset bindings and
clip targets inherit exposure from their parent asset/clip. A universal
null-to-field-registry label is misleading. Lead will correct these projections
and their source editor links before the next final freeze. Existing source
guards, private Legal evidence, version snapshots and publication eligibility
remain authoritative; no change may infer extra edit permission.

W9 lead diff review is now complete. The processor and the two fixture files
were hash-verified, and the lead reran all 43 pure tests (39 small and 4 large):
43 passed, zero failed/skipped. Receipt:
`artifacts/unified-workspace/w9/metadata-cases-lead-receipt.json`.
The current six-image synthetic corpus averages 1,582,908.83 stored bytes per
image; three PDFs average 25,173.33 bytes, including one byte-exact legal PDF.
These are fixture measurements, not a production forecast. Originals were not
written. Persistence, deduplication, UI, public/export/RAG/provider exclusions
and the complete W9 gate remain outstanding. No W9 commit/push is claimed.

### W3.1 exposure-editor completion design (before code)

The existing media metadata writer requires Projects E plus every shared source
E, even for a brand asset. Keep this rule. A binding has no exposure field of its
own; display the parent asset/clip's stored setting. An asset-context link does
have its own setting, so keep its setting distinct from the asset's setting.
Composite records without one stored setting use a neutral source-policy label,
not a fabricated public/internal value. Included publication items continue to
read their frozen dependency value rather than the current draft.

The ordinary project media and clip editors already cover their fields, but
brand-only asset and existing asset-context forms lack an exposure control.
Complete the owner-requested change link with one bounded exposure editor reused
by the shared workflow/notice surface. It changes only exposure; existing review,
rights, Legal restrictions and publication are unaffected. It is an explicit
normal draft save, never save-and-approve or a public write.

Permission-card supplement: proposed POST
`/v1/admin/content-workflow/exposure` accepts only asset, asset_context or
media_link identities, exact current expected_hash and the three existing
exposure values. SQL `hub.content_workflow_exposure_save` takes the existing
workflow source lock and Edit guard. Asset writes also use
`hub.media_require_asset_edit` (Projects E and all shared source E), forbid
non-internal legal documents and preserve metadata/category/rights. Context and
clip writes delegate to their existing media writers and revision checks.
The submission-freeze trigger and audit.change_log remain in effect. No account,
grant, template, tab bit or special changes. Inventory the route and function;
deny viewer, missing shared-source E, illegal exposure, stale hash and pending
review edits, with positive neighbors. No direct runtime table DML is granted.

Lead owns the existing W3.1 files plus
`tests/permissions/content-workflow-routes.json` and the exact API/UI regression
files needed for this control. The exact transport allowlists also need the new
POST path: lead exclusively owns content_permissions.py and
apps/admin/lib/content-workflow-routes.ts for this slice, plus its proxy spec.
The first HTTP positive-neighbor test correctly hit the default unmapped-route
denial, identifying these required mappings; do not loosen the default denial.
Main.py and W9 upload files need no changes. Final source freeze and full gate
are still required after these changes.

### W3.1 exposure completion and failure-loop receipts

The original full-gate failure is fixed: its affected API/permission/disclosure
selection passed 82 tests. The bounded editor now changes only asset, context-link
or clip exposure through an exact hash, with Legal and all existing Edit guards.
It never approves or publishes. Canonical bindings read their parent's setting;
context links retain their independent setting. Pinned publication descriptors
retain the included parent value after a newer draft changes. Composite records
use neutral source-policy copy from docs/47. The private helper now has signature
`hub.content_exposure(text,jsonb,jsonb,boolean)`; the single new app entry is
`hub.content_workflow_exposure_save(text,jsonb,text,text)`.

The expanded API quick selection passed 83 tests and found one incorrect HTTP
fixture assumption: an unbound private upload is correctly hidden from the
viewer with 404. The fixture now binds its synthetic asset, explicitly verifies
viewer GET succeeds, then verifies viewer POST is 403 and an editor POST saves
the draft. Corrected HTTP quick result: 1 passed, 13 deselected, zero skipped or
failed. The DB quick gate passed, including migration replay, populated row
preservation and all existing concurrency suites. New inheritance, pinned-value,
Legal, shared-source Edit, stale hash and submitted-freeze checks passed.

Typecheck and the offline build passed through exposure build 6. Both initial
brand-asset browser regressions passed, including conflict value preservation
and focus restoration. The affected 1280 px selection passed all 75 tests.
The 390 px selection completed 42 passing tests before its process terminated
with exit 1073807364; it has no complete suite result and is not credited as a
pass. No assertion failure is reported in that interrupted log.

The bounded final inventory report is archived under
`artifacts/unified-workspace/w3.1/w3.1-final-editor-check.md`; runtime checks were
NOT RUN by that agent. Lead verified and fixed its batch callback finding by
adding a separate exposure-save refresh callback (no false submission outcome),
and added a separate publication exposure-edit lock. Two focused browser
regressions now exercise the refreshed hash and blocked publication command.
The source guard, permission inventory and transport default denial are retained.
The latest callback quick gate and the complete final gate remain outstanding.

The failed first full-run logs and its exact 27-path source manifest are retained
under `artifacts/unified-workspace/w3.1/full-1/`. Current ownership is 32 changed
paths; no unrelated file has been staged or edited. No new pending owner question,
hosted activity, live provider call, W3.1 commit or push is claimed.

### W3.1 second final freeze

The two callback regressions passed (2/2), then the complete affected browser,
navigation and proxy selection passed 77 tests at 1280 px and 77 at 390 px, with
zero skipped/failed. Logs: `ui-exposure-callbacks-quick-9.log`,
`ui-exposure-1280-quick-10.log`, `ui-exposure-390-quick-10.log` under the W3.1
artifact directory. Typecheck and documented offline build pass through build 7.
The interrupted earlier mobile run remains recorded; it is superseded by this
complete run, not counted as a pass itself.

The bounded report's appended read-only recheck confirms both wiring fixes;
archived report SHA256:
`5e6469102bbaad41d5faa2595d22fa87e17f44def512af070e88e757fd92c69c`.
No runtime result is attributed to that agent. Lead owns the runtime results.
Migration 0086 current SHA256:
`8b3af3e6f6f19baa84e2b476e80dd2ec7e87606a0951756e0c3fc7cd47af8e9b`.

Freeze all 32 owned paths in `full-start-source-hashes.json` and run the second
complete gate serially. The first run remains in `full-1/`. Do not change source
during the gate or infer completion from quick results. Commit/push and finished
worktree cleanup remain pending the full result, source verification, four
overview screenshot reviews and credential scans.

### W3.1 second full-gate result and exact inventory correction

The second full gate verified the same frozen 32 paths throughout. Typecheck,
offline webpack build and production tests (4 passed) passed. API completed
with 2 failed, 2,348 passed, 11 existing skipped and 6 warnings. The two failures
are exact inventory assertions: test_permission_baseline.py still expects nine
workflow routes, and test_permission_shared.py omits the new exposure POST from
its explicit expected set. The route, permission mapping and runtime positive/
denial tests were already present. Update the count to ten and add only that
exact route; retain equality, unmapped-route denial and every permission test.
Lead ownership expands to those two test files, for 34 candidate paths.

The failed attempt and unchanged-source receipt are archived in
`artifacts/unified-workspace/w3.1/full-2/`. Its runner stopped at API, so DB,
local H1, both full UI suites and credential scans were NOT RUN in that attempt.
No commit/push is claimed. The focused API failure loop and a new complete gate
remain required. Four quick-run overview screenshots were visually reviewed at
1280/390 in light/dark; their final gate regeneration/review remains pending.

### W9 isolated privacy and PNG follow-up

While main stayed frozen, lead integrated the reviewed fixture pair into the
existing W9 processor worktree and fixed three demonstrated cases: non-legal
PDF page thumbnails are removed by the existing full rewrite; GPS IFD decoding
requires project coordinates; and opaque 8-bit PNGs with an all-255 alpha channel
follow the over-4-MiB quality-90 JPEG exception. Legal/disclosure/unknown PDF
bytes remain exact. Failed focused checks and passing follow-ups are retained.

Latest isolated quick result: 42 small checks passed, zero skipped/failed.
The four large checks require a rerun after the image change; no W9 full-gate
or integration result is claimed. The exact hashes and evidence are in
`artifacts/unified-workspace/w9/pdf-thumbnail-receipt.md`. Processing adapters,
provenance/deduplication, remaining color formats, privacy projections, UI and
operator paths remain unfinished. No new pending owner question, hosted action,
provider call, worktree removal, W9 commit or push occurred in this follow-up.

### W3.1 third final freeze and W9 verification receipt

The focused API failure loop passed 71 tests, zero skipped/failed, with one
existing dependency warning. It includes the two corrected exact-route
inventories, the full shared-permission file, W3.1 regressions and content
workflow tests. Log: `artifacts/unified-workspace/w3.1/api-inventory-quick-11.log`.
No product code changed after the second freeze; only the two explicit test
expectations and this log changed. Whitespace checks pass. Freeze the 34 owned
paths and run the complete gate again, serially. The freeze script now rejects
any unexpected path rather than collecting an unrelated change. Commit/push
and finished-worktree cleanup still require the complete passing result.

In the free lead lane, W9's current pure processor passed all 46 checks
(42 small and 4 large), zero skipped/failed. Fixtures now use the existing
exterior category rather than a made-up category; legal/disclosure handling
still has explicit overrides. This is isolated preparation, not an API or W9
full gate. Source hashes and result: `artifacts/unified-workspace/w9/current-processor-receipt.json`.

The refreshed seven-image synthetic corpus averages 1,526,350.14 stored bytes
per image (2,792,034.57 input bytes). Three PDFs average 25,173.33 stored bytes
(160,540 input bytes), including one byte-exact legal PDF. The corpus now
includes the opaque-alpha PNG regression. These are fixture measurements, not
a production forecast. Originals were not written and no objects were installed.
Full measurement: `artifacts/unified-workspace/w9/storage-summary-current.json`.
W9 integration and remaining color-format work remain unfinished.

### W3.1 final full gate and visual review — 6 November 2026

The third full gate passed on all 34 frozen paths at base
`5a59e13f05fce582a7307b33f3033f7428549afc`. Lead verified every source hash after
completion; no product or test changed during the gate. Evidence is under
`artifacts/unified-workspace/w3.1/`, including `full-gate-receipt.json`,
`full-start-source-hashes.json` and the individual `*-full.log` files.

| Full suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Admin typecheck | pass | 0 | 0 |
| Documented offline webpack build | pass | 0 | 0 |
| Production | 4 | 0 | 0 |
| API | 2,350 | 11 existing | 0 |
| DB | 95 Node tests; 41 SQL suites; 23 concurrency scenarios | 0 | 0 |
| Local H1 simulation | 69 Node tests; 10 smoke tests; 66 browser tests | 0 | 0 |
| UI, 1280 px | 437 | 0 | 0 |
| UI, 390 px | 437 | 0 | 0 |

API reports six existing dependency warnings. No test was skipped, quarantined
or weakened for this workstream. Fresh disposable migration replay and populated
upgrade preservation checks passed. Both provider and broad source/browser
credential scans found zero matches; the broad scan covered 792 source files
and 72 browser files. Credential files were not opened by the scans. The
documented harnesses used only their authorized local configuration internally.

Migration added: `202611060086_workspace_summary_exposure.sql`, SHA256
`8b3af3e6f6f19baa84e2b476e80dd2ec7e87606a0951756e0c3fc7cd47af8e9b`.
It changes guarded functions and adds the bounded exposure-save entry; it does
not rewrite existing content, versions, reviews, grants or templates. Website
suggestions take exactly the active field default. Internal notices and chips
retain the normal approval/publication workflow. The overview groups contextual
links, expands five at a time and shows only five recent changes.

Lead visually reviewed all four regenerated screenshots:
`overview-light-1280.png`, `overview-dark-1280.png`, `overview-light-390.png` and
`overview-dark-390.png` in that artifact directory. The 240-gap fixture measures
1280 x 2088 px and 390 x 3436 px in both themes. The desktop height regression,
keyboard expansion and no-horizontal-overflow checks passed. Exact image hashes
are in `screenshot-review.json`.

The bounded W3.1 inventory agent supplied the three archived static reports;
lead integrated its callback findings and ran every runtime gate. No new pending
question or requirement deviation. Commit, push verification and normal removal
of the finished review worktree follow this receipt. Next slice: W3.2.

### W3.2 bounded preparation receipt

A bounded sub-agent used `ws/w3.2-editor-inventory`, cut from current main in
`D:/Personal/workspace/sena_hub_wt/w3.2-editor-inventory`. Its sole owned file was
the ignored `artifacts/w3.2-editor-inventory.md`; all source was read-only and
runtime checks were NOT RUN. Lead reviewed the report and archived it under
`artifacts/unified-workspace/w3.2/` (SHA256
`235bcca4a84b8b73d33ef4e4f6e0c2916d7a609f5b62260c11968603c033b1e8`).
It maps reusable editor forms, exact routes, evidence and test gaps. Lead source
review corrected the draft design: promotion codes are globally unique, and
W3.2 will preserve that constraint. Contextual actions can open the existing
standalone editor through ordinary links. No W3.2 code, migration or runtime
result is claimed; its final lease follows the W3.1 commit.

### W9 metadata follow-up and isolated verification

Lead fixed 16-bit grayscale intensity clipping on the PNG-to-JPEG exception,
and corrected PDF processing records: a metadata-only rewrite never claims that
original bytes were kept. It records unchanged image encoding separately.
Legal documents remain byte-exact. These decisions and their failed/passing
focused checks are retained in the W9 artifact directory.

A bounded sub-agent reused `ws/w9-metadata-verification` and owned only the new
ignored `artifacts/w9-allowlist-review.md`. It found file-path text surviving
the shared suggestion filter and nested XMP history supplying caption values.
Lead reproduced both, fixed the shared filter/top-level parser, then reproduced
and closed the excluded-root fallback found on recheck. Synthetic generic XML
wrappers were corrected to real RDF Description roots without changing expected
values. The final static recheck has no open finding within that bounded scope;
the agent ran no runtime checks. Archived report SHA256:
`3643e017b18808445709575547ff6fb937731d62432bdd162e77cce2dd725bc8`.

After W3.1 released the test lane, the current pure processor passed all 49
checks (45 small and four large), zero skipped/failed. Exact hashes and evidence:
`artifacts/unified-workspace/w9/current-processor-receipt.json` and
`processor-all-current.log`. Earlier failures remain recorded and are not
counted as passes. The refreshed seven-image corpus averages 1,526,350.14 stored
bytes per image; three PDFs average 25,173.33 stored bytes, including one
byte-exact legal PDF. See `storage-summary-current.json` for each fixture.

W9 remains isolated and uncommitted. API/SQL/UI/operator integration, original
checksum deduplication, downstream privacy checks, remaining color-format work
and its own full gate remain required. No hosted action, live provider call or
new pending owner question occurred. Its preparation does not delay W3.2.

The final staged whitespace check identified CRLF endings in migration 0086.
`.gitattributes` explicitly marks migrations `-text` to preserve exact checksum
bytes. The CRLF-aware check retains blank-at-EOL, blank-at-EOF and space-before-tab
checks and passes. No SQL bytes or profile checksum changed after the full gate.

### W3.1 delivery and worktree cleanup

Committed all 34 explicit paths as
`375d7c955d722093275fd1c686f7d5a0f9561fa3` (Refine content exposure and workspace
summaries), and pushed to origin/main. The remote hash matched that commit;
main was clean afterward. All five protected configuration paths passed
`git check-ignore` before the commit. The full-gate and screenshot receipts
above apply to this delivery; only this log's evidence was added after the
verified source freeze.

Removed the clean, finished `w3.1-review-inventory` worktree with normal
`git worktree remove` and its merged branch with `git branch -d`. All three
reports were hash-verified against their archived copies first. No force
removal or unmerged branch deletion occurred.

Remaining: main, the unrelated facilities worktree, and 55 programme worktrees:
W2: 1; W3: 6; W3.2: 1; W4: 15; W5: 4; W6: 14; W7: 6; W8: 3; W9: 5.
The 22 older W2/W3/W4 variants remain preserved under the earlier reconciliation
record; they are not claimed merged. The remaining workstreams retain their
prepared source/reports. Neutral worktree identities and bases are recorded in
`artifacts/unified-workspace/w3.1/worktrees-after-delivery.txt`; Git retains the
exact current checkout inventory. Next: finalize the W3.2 lease and implement
contextual Promotions. Hosted rollout remains separately authorized work.

### W3.2 implementation lease — before code, 6 November 2026

Prerequisite delivered: W3.1 product `375d7c9`; delivery receipt `5dcdbae`, both
pushed and remote-verified. Lead allocates
`202611060087_contextual_promotions.sql`. The docs/36 permission card in docs/47
section 4.7 applies, with the implementation refinement recorded there. No new
catalog bit, special, default, account, grant or template change is planned.

Lead owns the schema, permissions, API, UI integration and tests. The bounded
editor inventory agent owns its report only; no concurrent source-file owner.
W9 remains isolated. The lead's explicit W3.2 file lease is:

- `docs/47-unified-content-workspace.md`, this log and the allocated migration;
  `supabase/hosted-test/profile.json` for the local replay checksum registry.
- API: `sena_hub_api/promotions.py`, `content_workspace.py`,
  `content_permissions.py` under `apps/api/`; main.py is not needed.
- Admin: `components/promotions-workspace.tsx`, `promotion-commercial-fields.tsx`,
  new `contextual-promotions.tsx`, `entity-workspace.tsx`, `unified-workspace.css`;
  `lib/unified-workspace.ts`, `workspace-copy.ts`, `workspace-api-routes.ts`,
  `content-routes.ts`; `app/api/hub/[...path]/route.ts`.
- Checks: new `apps/api/tests/test_contextual_promotions.py`, existing
  `test_promotions.py`, `test_real_promotions.py`, `test_content_workspace.py`,
  `test_permission_baseline.py`, `test_permission_shared.py`,
  `test_permission_db_baseline.py`, `content_workflow_fixture.py`, and the
  affected review-call fixtures in API tests (enumerate any added exact file
  before editing). New `tests/permissions/contextual-promotion-routes.json`,
  existing permission README; historical legacy manifests stay unchanged.
- Browser: new `tests/ui/unified-promotions.spec.ts`, existing
  `unified-workspace.spec.ts`, `unified-workspace-helpers.ts`,
  `residential-operations.spec.ts`, `project-content-phase9.spec.ts` and affected
  proxy specs after exact inventory. Migration preservation/replay registration:
  `tests/content-upgrade.test.mjs`, `tests/supabase-test-migrations.test.mjs`.

New exact API entries are POST `/v1/admin/promotions/resolve` (read-only,
Promotions V), GET `/v1/admin/content/workspace/{kind}/{ref}/promotions`, and GET
the same path plus `/suggestions` (Promotions V and exact project/brand source V;
Knowledge V additionally gates KM text). Project phase selection uses the
existing exact workspace phase resolver. Queries use bounded limit/offset,
explicit filters and optional exact item selection; no arbitrary query pass-through.
Every new entry is registered in API, proxy, H1 simulation and permission tests
before runtime. Existing create/update/review/queue paths remain their only
mutation routes.

New SQL application entries, all SECURITY DEFINER with fixed safe search path,
closed PUBLIC execution and only hub_app EXECUTE:
`promotion_resolve(jsonb)`,
`workspace_promotions(text,text,text,text,integer,integer,uuid)`, and
`workspace_promotion_suggestions(text,text,text,integer,integer,uuid,text)`.
New private helpers, with no runtime execution grant:
`promotion_scope_projects(uuid,uuid,jsonb,uuid[])`,
`validate_promotion_scope(uuid,uuid,jsonb,uuid[])`, `promotion_owner_guard()`,
`promotion_scope_snapshot(uuid)`, `promotion_scope_access(uuid,text)`, and
`workspace_promotion_rows(text,text,text)`.

Existing replacements/dispatcher branches: promotion_target_projects,
promotion_payload, promotion_read, promotion_command, promotion_readiness,
promotion_approvals_ok, publication_promotion_check, workspace_page,
workspace_context, workspace_native_rows, workspace_history_contexts,
track_promotion_translation and the promotion translation-review branch.
Review all primary-project assumptions in workflow/publication descriptors,
release candidates and banner bindings; extend this lease before introducing
another helper or entry. Preserve current FORCE RLS policies and public readers;
the latter already expand frozen project IDs and sanitize outgoing payloads.

New brand-owned rows have no primary project; exactly one owning project/brand
is required and ownership cannot be reassigned. Exclusions are at most 100
distinct non-null project UUIDs, validated like existing targets. New review
approval commands require the displayed scope hash and capture the resolved
public project IDs in the existing immutable review table. Current readiness
and publication compare that evidence with current scope. Historical null
scope evidence remains historical; no backfill or published-scope reinterpretation.

The project list includes the union of current draft scope and the current
published version's frozen scope. A pending exclusion never erases the live
row. Status groups retain exact scheduled/withdrawn details. Overview counts
use the same server clock/eligibility and deep-link to the relevant filter and
price field. Suggestions contain only title, benefit/summary and public
conditions text; structured numeric/date fields stay empty. Validated suggestion
identity is appended to the normal audit reason on create. The source text is
never put in URLs or browser storage. New Thai copy is added to docs/47 first.

Quick gate after each code change; SQL/permission changes include the documented
DB and permission selections. Final W3.2 gate is the full programme gate, both
widths, local H1, fresh/populated replay and source/browser credential scans.
Screenshot destination: `artifacts/unified-workspace/w3.2/`. All tests and the
W3.2 implementation are currently NOT RUN/not started; no commit is claimed.

W3.2 foundation checkpoint: the disposable baseline inspection passed one
diagnostic check (one existing warning); its runner disposed the database.
The first invocation used an invalid test path and was refused before startup.
Evidence: `artifacts/unified-workspace/w3.2/baseline-inspection-2.log`.
Migration 0087 is now being implemented, not delivered. Extend the replacement
lease to `lock_release_members(jsonb)` so promotion commands and releases lock
owning/target brands, resolved projects and then promotions in the existing
parent-first order. `promotion_approvals_ok` remains unchanged because public
readers use it for frozen historical versions; current-scope evidence checks
belong in draft readiness and new publication checks only.

Review-call compatibility lease extension: `apps/api/tests/test_promotions_db.py`,
`apps/api/tests/test_permission_publication.py`, `supabase/tests/residential_demo.sql`
and `scripts/seed-residential-demo.py`. Existing positive approval fixtures now
supply the displayed resolution hash. Revocation and negative authorization
checks retain their intent. No harness configuration loading changes.

Private helper lease refinement: `promotion_scope_visible(uuid)` centralizes the
Promotions/Projects/Brands View conjunction for lists and shared projections.
It has no runtime execution grant. Mutation validation remains separate, so an
editor can remove a stale target instead of being locked out of its draft.

Foundation quick gate: 95 API tests passed, zero skipped/failed, one existing
warning (`foundation-quick-3.log`). Earlier attempts found a missing second
synthetic project in the test and an empty resolved scope serialized as null;
both were corrected without weakening assertions. The first DB gate stopped
in the new populated-upgrade fixture because its inserted historical promotion
omitted required author fields. That fixture is corrected and its focused
preservation rerun is in progress. No W3.2 full gate or commit is claimed.

The focused populated preservation/migration registry rerun passed 16 checks.
The next full DB quick run reached the residential concurrency fixture, which
also needs its explicit displayed hash on approval. Extend the fixture lease to
`supabase/tests/concurrent_residential_release.mjs` and
`apps/api/tests/test_assistant_tools_db.py`; their scenario assertions remain.
Extend the SQL replacement lease to `save_project_price` so a price reference can
select an applicable brand/shared promotion through the same resolved project
set, with Promotions V, instead of requiring its primary project to match.

Further inspection confirms migration 0070 already changed the price reference,
unit-type choices and media bindings to `promotion_target_projects`. Its new
implementation therefore supplies brand ownership/exclusions automatically;
no separate `save_project_price` replacement is needed. Removed the draft
replacement after its migration contract assertion stopped replay before tests.

W3.2 browser-check delegation: one bounded sub-agent owns only the new
`tests/ui/unified-promotions.spec.ts` in the isolated
`D:/Personal/workspace/sena_hub_wt/w3.2-browser-checks` worktree,
branch `ws/w3.2-browser-checks`, based on main `5dcdbae`. It may read the lead's
in-progress components to match their contracts, but may not edit main, other
files, migrations, credentials, existing fixtures or shared files. It runs no
port-bound command and does not commit or push. Lead retains source, security,
integration and all runtime verification. Done criteria: meaningful mocked
browser checks of contextual lists, editor prefill/exclusion, permissions,
overview links, responsive/theme screenshots; no weakening existing tests.
The lead additionally leases `tests/ui/unified-workspace-proxy.spec.ts` for
exact new local/H1 route and query-boundary assertions.

Quick-gate checkpoint: the full permission selection returned 409 passed and
11 failed (one existing warning). Two route-count assertions omitted the new
entries; nine cases exposed one ambiguous `kind` reference in the overview SQL.
The focused correction run passed all 42 cases, zero skipped/failed. An earlier
invalid test path was refused before startup; restricted execution then failed
embedded-database account lookup, so the documented harness ran with the local
process permission it requires. No configuration loader changed.

Admin typecheck and the offline webpack build passed. Browser quick gate:
48 passed, two failed, zero skipped. The brand assertion checked before data
loaded; it now waits for the tab. The new H1 resolver-prefix negative check
exposed its generic legacy transport fallback. Extend the lead's lease to
`apps/admin/lib/hosted-config.ts` for an exact resolver-prefix guard only.
No hosted setting changes. Four provisional screenshots were captured; visual
review and final gates remain. New browser spec was reviewed and integrated
from the bounded sub-agent; runtime is owned by the lead.

The second browser quick gate passed 50 checks, zero skipped/failed. Its native
runner reported PASS and disposed its own stack; the shell's redirected stderr
status is not used as a test count. Subsequent orchestration explicitly checks
the native exit code. Lead reviewed all four provisional screenshots after
fixing the synthetic workflow-read fixture and resetting scroll before capture.
They show valid thumbnails and readable wrapping in both themes, without page
overflow. Existing palette/focus/reduced-motion navigation checks passed.

The publication quick gate passed 28 cases, zero skipped/failed, one existing
warning. It covers brand ownership without a primary project, new-version
exclusion after both reviews, frozen historical versions, displayed scope hashes,
review history, exact function grants, tab order/denial, seven-day and banner
counts, and withdrawn-promotion price links. An unpublished draft is explicitly
not counted as a withdrawn promotion. Website suggestions use the verified
importer's heading/text object, retaining compatibility with earlier text values.

Final review keeps active-row thumbnails on their readable frozen published
banner instead of a later draft binding. The source chip also keeps the frozen
shared count while an exclusion is pending. Added a regression for a draft
banner unlink and assertions that internal ownership/exclusion/review IDs never
reach the public projection. The wider permission quick rerun and focused
banner regression are still running/pending. No new question or requirement
deviation; no W3.2 full-gate pass, commit or push is claimed yet.

### W3.2 final quick checks and full-gate start — 7 November 2026

Final quick evidence: admin typecheck (`typecheck-5.log`) and offline webpack
build (`build-quick-3.log`) passed; browser selection (`ui-quick-3.log`) passed
50, skipped 0, failed 0; complete DB quick gate (`db-quick-2.log`) passed 95
Node checks, 41 SQL suites and 23 concurrency scenarios, skipped/failed 0;
the wider permission selection (`permission-quick-final.log`) passed 421,
skipped/failed 0, one existing warning. Final contextual publication checks
(`publication-quick-3.log`) passed 28, skipped/failed 0, one existing warning,
including expired grouping, the frozen banner and public ID redaction.

Origin/main is still `5dcdbae8954f9249cb84d0c0f830b4b2946a5fb3`, verified by
`git ls-remote`. Lead freezes the 34 explicit W3.2 paths at that base in
`artifacts/unified-workspace/w3.2/full-start-source-hashes.json`. The serial
full gate now runs typecheck, offline webpack, production, API, DB, local H1,
all UI at 1280 and 390, then credential scans and whitespace checks. Every
port-bound suite uses its own disposable database and owns only its processes.
No product/test change is planned during this gate. Full-gate result and delivery
remain pending; the previous section's screenshot review is provisional until
the final screenshots are checked. No requirement deviation or new question.

### W3.2 resumed full gate and correction — 8 November 2026

The previous run had no completion result after production installation. No
earlier test process or occupied working port remained, and all 34 frozen source
hashes matched. Its evidence is preserved in `w3.2/interrupted-full-20261107/`.
Lead restarted the unchanged serial gate from main; no harness configuration
loading changed and no owner's process was stopped.

Full attempt 1: typecheck and offline webpack passed; production passed 4,
skipped/failed 0. API finished with 2,368 passed, 11 existing skips, one failure
and six existing warnings. The single failure was the existing workspace-page
test's old tab-list expectation, which omitted the required Promotions tab.
The runner exited 1 before DB, local H1 and browser suites; those stages were
not run in this attempt. Evidence and the unchanged source manifest are in
`artifacts/unified-workspace/w3.2/failed-full-1/`.

Within the existing `test_content_workspace.py` lease, update the exact expected
tab order and extend its no-audit-write GET checks to both contextual Promotions
read endpoints. No application or SQL correction is required by this failure.
The complete affected file's 40 cases form the correction quick gate; the full
gate follows after it passes. No tests are skipped, quarantined or weakened.
Collection-only diagnosis confirmed 2,380 API cases; an initial overly broad
collection also discovered ignored review copies and reported import errors,
so it was corrected to the harness's exact `apps/api/tests` selection. That
diagnostic ran no tests and is not a gate result.

During the frozen gate, lead prepared only ignored review artifacts for W5:
43 paths reconciled with W3.1/W3.2, five exact route registrations and migration
`202611080088_business_level.sql` in the reserved 0088 lane. No W5 source is
integrated or runtime-tested. Assistant business retrieval and populated replay
remain explicit integration checks. W9's original-checksum/context/privacy
design notes are also preparation only; its processor remains isolated.

The completed bounded browser draft is archived with its hash and reviewed
delta under `w3.2/completed-browser-*`. Its worktree and the clean editor-inventory
worktree remain until W3.2 delivery, then receive normal removal and branch -d.
No new pending question or requirement deviation. W3.2 commit/push and final
screenshots remain pending; W5 follows delivery.

Correction quick gate passed all 40 workspace cases, skipped/failed 0, one
existing warning, exit 0. The disposable runner confirmed its working-database
and file-store isolation. Evidence: `w3.2/workspace-correction-quick.log`.
The application/SQL bytes remain those reviewed before attempt 1; only the
workspace regression and this log changed. Lead now freezes 35 explicit paths
and starts full attempt 2 with the same complete serial gate. No full pass,
commit or push is claimed until that run and screenshot review finish.

### W3.2 local H1 fixture correction — 8 November 2026

Full attempt 2 passed typecheck, offline webpack and production (4 passed,
zero skipped/failed). API passed 2,369, skipped 11 existing cases, failed 0,
with six existing warnings. DB passed 95 Node checks, 41 SQL suites and 23
concurrency scenarios, skipped/failed 0. Both disposable runners confirmed
isolation and teardown. Local H1 then failed during synthetic seeding with
SQLSTATE 40001, after successful migration attestation/replay. The runner exited
1 before either full browser width. Evidence and the unchanged 35-path manifest
are preserved in `artifacts/unified-workspace/w3.2/failed-full-2/`.

The H1 promotion seed still omitted the newly required reviewed-scope hash.
Extend the lead's fixture lease to `supabase/hosted-test/h1-seed.sql` and supply
the hash from the normal guarded promotion reader for both DATA and LEGAL lanes.
Do not bypass the review guard or change harness configuration loading. This
changes only synthetic fixture input; application and migration bytes remain
unchanged. The H1 correction quick gate precedes a new complete serial gate.
No hosted seed, migration, deployment or credential access is performed.

Independent preparation while attempt 2 ran: the bounded assistant-context
sub-agent delivered its read-only report from `ws/w5-assistant-context`, owning
only `artifacts/w5-assistant-context-review.md` in its separate worktree. Lead
archived it under `artifacts/unified-workspace/w5/assistant-context-review.md`.
It identified missing business context/pinning/retrieval; lead retains design,
security and implementation. No sub-agent runtime check or product edit ran.
The W5 preview now contains 44 paths, including a syntax-checked populated
preservation regression; database verification is pending. Lead's W6 contract
review identifies dated membership intervals as a remaining integration check.
W9's metadata decision is already recorded verbatim in docs/47; its application
integration remains pending. These preparations are not delivered workstreams.

No new pending question or requirement deviation. W3.2 delivery and cleanup
remain next after a successful full gate; W5 follows its commit.

H1 correction quick gate completed with exit 0: 69 Node checks, 10 smoke tests
and 66 browser checks passed, skipped/failed 0. Evidence is
`w3.2/h1-correction-quick.log` and its parsed receipt. The one-line synthetic
fixture change preserves the normal DATA/LEGAL review checks and its replay.
Origin/main was reverified at `5dcdbae8954f9249cb84d0c0f830b4b2946a5fb3`.
Lead now freezes 36 explicit paths for full attempt 3. Migration 0087 retains
SHA-256 `cbdc3cd60d9cf9660d0b4ebc34ddb60db883120473fad89cb1253322da91bb4c`.
No workstream commit or final full-gate pass is claimed yet.

### W3.2 final gate and delivery preparation — 9 November 2026

Full attempt 3 completed successfully with native exit 0. All 36 frozen source
hashes matched before this evidence-only log update. The receipt is
`artifacts/unified-workspace/w3.2/full-gate-receipt.json`; individual logs and
their hashes are retained beside it. Lead released the serial test lock after
the disposable runners completed their isolation and teardown checks.

| Suite | Passed | Skipped | Failed |
|---|---|---|---|
| Admin typecheck | pass | 0 | 0 |
| Documented offline webpack build | pass | 0 | 0 |
| Production | 4 | 0 | 0 |
| API | 2,369 | 11 existing | 0 |
| DB | 95 Node checks, 41 SQL suites, 23 concurrency scenarios | 0 | 0 |
| Local H1 | 69 Node checks, 10 smoke tests, 66 browser checks | 0 | 0 |
| Browser at 1280 px | 449 | 0 | 0 |
| Browser at 390 px | 449 | 0 | 0 |

API reported six existing warnings. Fresh migration replay and the populated
preservation check passed within the DB gate. Source/browser credential scans
reported zero matches and read no credential files. Whitespace checks passed.
No test was skipped additionally, quarantined or weakened.

Delivered implementation: contextual Promotions tabs on project and brand
pages; additive brand ownership and reviewed exclusions; resolved-scope review
evidence; source chips and frozen publication scope; reuse of the existing
editor; text-only legacy suggestion prefill; and expiry, banner-rights and
invalid price-reference overview links. DATA/LEGAL separation and the single
publication queue remain enforced. Migration added:
`202611060087_contextual_promotions.sql`, SHA-256
`cbdc3cd60d9cf9660d0b4ebc34ddb60db883120473fad89cb1253322da91bb4c`.
Existing promotions, versions, grants and publication history are not rewritten.

All four final screenshots are byte-identical to the images already visually
reviewed by the lead. The final hash receipt is `w3.2/screenshot-review-final.json`.
Paths under `artifacts/unified-workspace/w3.2/`:

- `promotions-light-1280.png` and `promotions-dark-1280.png` (1280 x 3206).
- `promotions-light-390.png` and `promotions-dark-390.png` (390 x 4819).

The reviewed images show readable Thai, valid thumbnails, wrapped details and
no horizontal page overflow in either theme. Existing keyboard-focus,
reduced-motion and palette checks passed. Requirement deviations: none. New
pending questions: none. Bounded sub-agents delivered the editor inventory and
browser-check draft; the lead reviewed their diffs, integrated the changes and
ran every runtime gate. No hosted action or live provider call occurred.

Two finished bounded W4 fixture worktrees were removed with normal worktree
removal and branch deletion after archiving all eight owned draft files and
their review notes. Byte hashes, reviewed differences and the removal receipt
are under `artifacts/unified-workspace/completed-fixture-archives/`. No force
operation was used. There are currently 57 worktrees, including the two W3.2
worktrees awaiting this delivery, 20 older programme variants retained for
review, future programme work, main and one unrelated worktree. Remaining paths
will be inventoried again after the W3.2 cleanup.

Next: commit and push the explicit 36 W3.2 paths, record the delivery hash,
remove its two finished worktrees normally, then integrate W5. Its 44-path
preview and assistant design remain preparation, not a passed implementation.

### W3.2 delivered — 9 November 2026

Product commit `7ceed6f6e649b35304908660c011a9782a147a25` was pushed to
`origin/main`; `git ls-remote origin refs/heads/main` returned that exact hash.
It contains the 36 explicit reviewed paths and the final-gate evidence above.
All five credential/config paths passed `git check-ignore` before commit.
The final product source is unchanged from the successful frozen gate; only
the evidence log was updated afterwards. Source/browser scans again found zero
credential matches. This receipt is a documentation-only follow-up.

Both completed W3.2 worktrees and branches were removed normally after exact
path, branch-ancestry, status and archive-hash checks. No force operation was
used; the draft browser file and editor inventory remain archived under
`artifacts/unified-workspace/w3.2/`. Removal receipt: `w3.2/cleanup-result.json`.

Remaining worktrees (55 total): main; one unrelated facilities worktree;
20 earlier programme variants awaiting reconciliation (W2: 1, W3: 6, W4: 13);
and prepared future work (W5: 5, W6: 14, W7: 6, W8: 3, W9: 5). Earlier variant
details remain in `artifacts/unified-workspace/finished-worktree-inventory.json`
and `delivered-worktree-reconciliation.json`; the two completed fixture trees
and both W3.2 trees have now been removed. Unreconciled work was preserved.

Next workstream: W5 business level, including its assistant retrieval and
permission checks. W6, W7 and W9 follow; W8 and the final main gate remain last.

### W5 lead integration lease — 9 November 2026, before code

Integrate the reviewed 44-path `w5/merge-preview-w32/registered-receipt.json`
candidate onto delivered main after verifying every predecessor and incoming
hash. The exact paths are recorded below before transfer. The migration lane is
`202611080088_business_level.sql`; obsolete prepared numbers remain isolated.
Keep W3.1 summaries/exposure and W3.2 Promotions behavior unchanged. The fixed
business catalog and brand associations are additive; no old content, versions,
reviews, publications, accounts, grants or templates are rewritten.

W5 permission-card refinement: extend the existing `search_content` tool with
one optional `business_id`, mutually exclusive with project/brand. Require
Knowledge V and exact business scope access before retrieval; this grants no
descendant access. Existing assistant entry and source permissions still apply.
Add only `internal.assistant_business_search(code text, visibility text)` as a
bounded read entry point for `hub_app`, fixed search path and no PUBLIC execute.
Existing private saved-source helpers stay closed. Register its exact inventory
before runtime checks. No additional tool, endpoint, permission bit or write
authority is introduced.

Business retrieval returns only authorized narrative sections and text FAQs;
contacts, automatic/fact answers and volatile numeric content are excluded.
Require AI-eligible source and registry/question exposure. Draft mode pins the
current version. Published mode uses the current frozen business-page snapshot
and existing AI eligibility without a draft fallback. Saved published citations
pin publication and source version together in the existing version string.
Recheck exact source access, exposure, validity and current page publication at
recording, citation-open and saved-run reads. Keep permitted neighbours readable.

Lead additionally owns `apps/api/sena_hub_api/{assistant_tools,assistant_model}.py`,
`apps/admin/components/hub-assistant.tsx`, the existing assistant tool/context/UI
tests and new retrieval checks within `test_business_assistant.py`. The prepared
`assistant.py`, migration and business permission inventory are reopened only
for these reviewed read surfaces. Business context must reject conflicting
project/brand/finance/document tool requests before domain queries. Keep thirteen
tools, stub-only execution and the pending production retrieval decision Q42.

Quick checks include typecheck, focused business/assistant/browser tests, the
full API suite for shared registration changes, DB/permission inventory and
populated preservation replay. The complete serial programme gate follows on
final W5 code, including both widths, local H1 and credential scans. Current W5
runtime status: NOT RUN. Lead retains all security decisions and port commands.

Explicit prepared W5 integration paths:

- supabase/tests/business_level.sql
- apps/api/sena_hub_api/business_content.py
- apps/api/tests/test_business_content.py
- apps/api/sena_hub_api/content_workspace.py
- apps/api/sena_hub_api/content_workflow.py
- apps/api/sena_hub_api/faq_coverage.py
- apps/api/sena_hub_api/faq_intake.py
- apps/api/sena_hub_api/faq_clusters.py
- apps/api/sena_hub_api/web_publication.py
- apps/api/sena_hub_api/publication_queue.py
- apps/api/sena_hub_api/workspace_home.py
- apps/admin/components/business-workspace.tsx
- apps/admin/components/content-narrative.tsx
- apps/admin/components/entity-workspace.tsx
- apps/admin/components/faq-applicability.tsx
- apps/admin/components/faq-bank.tsx
- apps/admin/components/faq-intake.tsx
- apps/admin/components/faq-workspace.tsx
- apps/admin/lib/business-workspace-text.ts
- apps/admin/lib/content-workflow.ts
- tests/ui/business-workspace-h1.spec.ts
- tests/ui/business-workspace.spec.ts
- apps/admin/lib/hub-permissions.ts
- apps/admin/lib/workspace-api-routes.ts
- apps/admin/lib/business-api-routes.ts
- tests/ui/business-proxy.spec.ts
- tests/permissions/content-business-db.json
- apps/api/tests/test_content_business_inventory.py
- apps/api/sena_hub_api/assistant.py
- apps/api/tests/test_business_assistant.py
- supabase/migrations/202611080088_business_level.sql
- apps/admin/lib/content-routes.ts
- apps/admin/lib/hosted-config.ts
- apps/api/sena_hub_api/content_permissions.py
- apps/api/sena_hub_api/main.py
- apps/api/tests/test_permission_baseline.py
- apps/api/tests/test_permission_db_baseline.py
- apps/api/tests/test_permission_shared.py
- scripts/run-hosted-h1.mjs
- scripts/test-db.mjs
- supabase/hosted-test/profile.json
- tests/permissions/business-content-routes.json
- tests/supabase-test-migrations.test.mjs
- tests/content-upgrade.test.mjs

Bounded W5 UI assignment: `ws/w5-context-browser` in its matching external
worktree, cut from delivered main `cdfeb42`. It owns only
`apps/admin/components/hub-assistant.tsx` and new
`tests/ui/business-assistant-context.spec.ts`. Written brief:
`artifacts/unified-workspace/w5/context-browser-brief.md`. It adds the business
context parser, label, permission-based picker and focused browser regressions;
all other files are read-only. It may run only non-port checks, never commits
or pushes. Lead retains API/SQL security, integration and runtime gates.

### W5 integration and foundation checks — 9 November 2026

The 44 prepared paths were verified against delivered main and integrated.
Lead completed business assistant Context/SearchContent validation, exact scope
pinning before domain reads, bounded Knowledge-owned retrieval and saved-source
checks. Published evidence retains the page/source version pair and reads the
frozen eligible snapshot; new drafts do not replace it. Non-AI exposure, expired
answers and overdue reviews are excluded from retrieval and citation recording.
The inventory now has two owner-only FORCE RLS tables, ten new functions and
three guarded runtime reads. Seven helpers remain private. No tool was added.

The bounded UI sub-agent delivered its two owned files. Lead reviewed the diff
and ten collected browser cases, archived them under `w5/context-browser-reviewed/`
and integrated them. Its checks used shared dependencies without credential
copies or ports; lead admin typecheck passed after integration. Lead added a
business-form permission-recovery regression using the existing recovery panel.

Quick-gate failure loop: the first invocation refused an outdated checksum for
uncommitted 0088 before startup. Attempts 2/3 stopped during replay at exact
multiline anchors. Older stored function bodies preserve CRLF; the new migration
now normalizes those replacement inputs and keeps its own anchors LF, retaining
every exact-match assertion. No committed migration or harness loader changed.
Attempt 4 reached tests: 20 passed, 15 failed, 11 fixture errors. Corrections
keep synthetic actor context in its transaction, provide the existing synthetic
demo settings, and align the normal page-configuration link. Attempt 5 returned
40 passed and six failures; lead corrected the remaining synthetic update,
removed a nonexistent FAQ start-date field from the new reader, and supplied
canonical evidence in the HTTP double. Attempt 6 returned 46 passed and one
failure: the new publication fixture lacked its required explicit applicability.
That fixture now supplies its synthetic project; the submission guard stays.

Foundation quick attempt 7 passed all 53 cases, skipped 0, failed 0, one existing
warning, native exit 0. It includes business composition/publication, runtime
inventory, mixed-context denial, question-to-citation stub flow, source exposure,
expiry, positive neighbours, frozen publication and withdrawal. Migration 0088
replayed successfully; the disposable runner confirmed working DB/file-store
isolation and teardown. Evidence: `w5/foundation-quick-7.log` and earlier logs.
Admin typecheck also passed (`w5/typecheck-2.log`).

Next quick checks: full DB and populated preservation, full API for shared
registration changes, affected browser suites at both widths and local H1.
The W5 final full gate, screenshots, commit and push remain pending. No new
question or requirement deviation; no live provider/hosted operation occurred.

### W5 integration quick failure and bounded correction — 9 November 2026

The integration quick chain passed admin typecheck and the offline webpack
build. DB checks reached the brand concurrency case and its assertions passed,
then fixture cleanup failed because the new `hub.brand_business` row still
referenced the synthetic brand. The runner stopped; API/browser/H1 stages did
not run. Native exit was 1 and the serial port lock was released. Evidence:
`w5/db-integration-quick.log`.

Lead adds ownership of `supabase/tests/concurrent_brand.mjs` and
`supabase/tests/concurrent_residential_release.mjs` solely to remove each
fixture's new business membership before its existing synthetic-brand cleanup.
Production foreign keys and test assertions remain intact. The bounded UI
sub-agent retains its same two-file lease to require Knowledge View for the
business context picker even when another domain enables `search_content`.
Backend source checks remain authoritative; browser denial and allowed-neighbour
cases will verify this narrower display rule before the next quick run.

The DB retry passed, including replay, preservation, all SQL suites and
concurrency scenarios. The subsequent full API quick run completed with 2,410
passed, 12 failed, 11 existing skips and six existing warnings (1,581.92 seconds).
Evidence: `w5/db-integration-quick-2.log`, `w5/api-integration-quick-2.log`.
The native runner exited 1 and released the port lock. No browser or H1 result
is claimed yet.

Lead correction scope adds `apps/api/tests/test_assistant_model.py` and
`apps/api/tests/test_content_workspace.py`. The golden tool fixture supplies
both project and brand to a now single-scope search DTO; use a valid project
context for that case while retaining every typed-tool and citation assertion.
Three existing minimal-reference cases must expect the readable fixed business
parent for brands, preserving zero descendant counts and every denial check.
The business HTTP fixture also creates an unapproved corporate contact for its
foreign-object check; later corporate publication tests correctly reject it.
Use a unique synthetic brand contact as the foreign object and assert that the
corporate contact collection stays unchanged. Publication guards are not relaxed.
The failure report did not support the earlier tentative section-revision
diagnosis; no revision assertion is being changed for that hypothesis.

Lead reviewed the bounded UI follow-up: Knowledge View plus search permission
is required for the business choice, while an unavailable explicit context is
preserved until the user changes it. The existing placeholder wording is now
registered in docs/47. Eleven cases were collected and non-port typechecking
reported zero diagnostics; runtime verification remains with the lead.
Existing `.gitattributes` already disables migration newline conversion, so
the successful LF 0088 replay needs no additional portability change.

Correction quick 3 passed typecheck/build and 183 API cases, with one existing
skip and one failure in the rich project-publication regression. The new
committed inheritance fixture used a global corporate FAQ although it only
needed its synthetic project; that answer could enter later project fixtures.
Scope its corporate fallback explicitly to the same synthetic project, retaining
the business/brand/corporate preview and frozen approved-graph assertions.
The runner stopped before browsers/H1, native exit 1. Evidence:
`w5/api-integration-quick-3.log`. The next check runs the business and website
publication files together before continuing browsers and local H1.

### W5 browser correction quick 4 — 9 November 2026

Business and website-publication API checks passed together: 31 passed, zero
skipped or failed, one existing warning; disposable isolation and teardown passed.
Desktop browser checks returned 138 passed and four failed, with no skips. The
chain stopped before 390px/H1 and released the serial port lock. Evidence:
`w5/api-integration-quick-4.log`, `w5/ui-1280-integration-quick-4.log`.

Lead fixes two product issues: business editing/approval now carries its busy
state to the outer tab guard; FAQ creation waits for its question bank instead
of requesting the reserved `new` route as a saved FAQ and redirecting during
initial load. The new browser regression explicitly checks that `faq/new` is
never read. The source-conflict test now checks both visible language copies
instead of using an ambiguous single-element locator. All original assertions
remain. Quick 5 reruns typecheck/build, the affected shared browser selection at
both widths and local H1; no API rerun is needed for these browser-only changes.

A bounded sub-agent audited six W5 worktrees read-only. All committed heads are
ancestors of main; only business-design is immediately clean. Assistant-context
has an ignored review note already preserved in the main artifacts directory.
Business-level (152 changed/untracked paths), transport (10) and UI (199) contain
older snapshots or future W6 preparation and require reconciliation. Context
browser's two owned files match current main exactly but remain uncommitted in
that worktree. No worktree or branch was removed during the audit; the pending
W5 delivery must preserve unresolved preparation before normal cleanup.

### W5 visual review and transport correction lease — 9 November 2026

Quick 5 passed typecheck, offline build, all 142 selected browser cases at each
width, and local H1 (69 Node checks, ten smoke checks and 69 browser checks).
No suite skipped or failed; the native chain exited zero and released the port
lock. Evidence is in `w5/*-integration-quick-5.log`.

Visual review nevertheless found an unsupported-filter banner in the real H1
business header. The workflow inventory proxy still omits `business` from its
level allowlist. Lead adds `apps/admin/lib/content-workflow-routes.ts` to the
explicit W5 lease and corrects that finite list. The already-owned intake
transport filter needs the same supported business level. Add positive and
malformed-neighbour transport assertions and real H1 requests/header checks;
passing old assertions alone did not establish a clean page.

Local 390px preview screenshots also omitted the iframe content below the
viewport. The screenshot test will scroll that content into view and assert
viewport visibility before capture, and explicitly focus the history summary.
No UI is hidden or image edited. Quick 6 reruns typecheck/build, the affected
shared browser selection at both widths and local H1 before the full gate.

The same bounded sub-agent completed a read-only W9 fixture inventory. Required
metadata kinds have processor assertions; downstream database, public/provider
and rights/UI integration remain unverified. The lead preserved its report at
`w9/metadata-coverage-review.md`. No W9 source was integrated or declared done.

Quick 6 passed typecheck/build and all 143 desktop browser cases. Mobile returned
141 passed and two failures, both new screenshot checks timing out while waiting
for the off-screen iframe's text to stabilize. The chain stopped before H1 and
released the port lock. Scroll the outer iframe into view before its inner text,
then capture the actual viewport; this avoids relying on an off-screen subframe
paint in a full-page screenshot. Preserve the sandbox, exact content and
no-horizontal-overflow assertions. Quick 7 repeats the business/browser proxy
and shared navigation cases at both widths, followed by local H1. Product source
is unchanged since the passing quick-6 typecheck/build and transport cases.

Quick 7 passed all 47 business, proxy and navigation cases at each width, plus
local H1 (69 Node, ten smoke, 69 browser), with zero skips/failures and native
exit zero. The actual H1 business inventory and intake requests now return 200;
the malformed level remains denied. The unsupported-filter banner is gone.
Mobile preview captures now show the sandboxed content. Full-page history/H1
captures normalize scroll to the top so fixed elements outside the viewport are
not included at a misleading document offset. A final screenshot-only quick
check precedes source freezing; the full gate also repeats H1 on these captures.

During the serial run, the bounded reviewer inventoried W6 overlaps read-only.
Lead checked the current promotion and business-assistant call chains and
recorded pending integration work in `w6/current-integration-deltas.md`.
No W6 source was integrated, no new migration was applied and no source system
was contacted. All security/design decisions remain with the lead.

### W5 final source and gate preparation — 9 November 2026

Screenshot quick 8 passed both theme cases at both widths (two tests per run,
zero skipped/failed). Lead visually verified the mobile preview text and the
history capture without the off-screen fixed-link artifact. Product code is
unchanged from quick 7. H1 full-page capture scroll normalization is also in the
final test source and will run again in the full gate.

Freeze 55 explicitly owned paths at delivered main `cdfeb42`. The complete
serial gate runs typecheck, offline webpack build, production import checks,
full API, full DB/replay/preservation/concurrency, local H1, all local browser
specs separately at 1280 and 390, and changed-source/browser credential scans.
No source changes are allowed during that run. No final result, commit or push
is claimed in this pre-run entry; the delivery receipt will record exact totals.


## W5 delivered — 9 November 2026

Product commit `9ac800c7b22318be3fbec6a3a408eab6650076c3` was pushed to origin/main and the remote
head was verified. The product commit contains 55 explicitly owned paths. This
receipt-only documentation update records the completed results; source stayed
frozen throughout the full run. No hosted action, live provider call, source
connection or credential-file inspection occurred.

Built the fixed Residential business level, existing/future brand associations,
Knowledge-owned narrative/contacts/FAQ, explicit applicability and composition
order, the reused page/preview/history interface, exact proxy/API boundaries,
and business context/retrieval in the existing assistant tools. Business scope
adds no proposal/write tool. Saved citations retain exact approved/published
evidence and enforce current visibility. Existing content, versions, reviews,
publications, accounts, grants and templates were preserved.

Migration: `supabase/migrations/202611080088_business_level.sql`.
SHA-256: `f9dcb86198f599a917819976af62f2c0635fbd18b7f322f20c106990bdcbae94`. Fresh and populated disposable replay,
runtime ACL classification, preservation and concurrency checks passed. No
existing migration was edited or renumbered.

| Final suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Admin typecheck | pass | 0 | 0 |
| Documented offline webpack build | pass | 0 | 0 |
| Production import/install/isolation | 4 | 0 | 0 |
| API | 2422 | 11 existing | 0 |
| DB | 95 Node; 42 SQL suites; 23 concurrency scenarios | 0 | 0 |
| Local H1 | 69 Node; 10 smoke; 69 browser | 0 | 0 |
| UI 1280px | 490 | 0 | 0 |
| UI 390px | 490 | 0 | 0 |
| Changed-source/browser credential scans | zero matches; no credential files read | 0 | 0 |
| Diff/source-freeze verification | pass | 0 | 0 |

API reported 6 existing dependency deprecations. No skips were added
and no existing test was quarantined or weakened. Earlier failing quick runs
and their fixes remain recorded above. Evidence:
`artifacts/unified-workspace/w5/full-gate-receipt.json`,
`full-start-source-hashes.json`, `*-full.log`, `credential-scan-broad.json` and
`visual-review-receipt.json` in the same directory.

Screenshots under `artifacts/unified-workspace/w5/`:

- `local-{light,dark}-{1280,390}-{preview,history}.png` (eight).
- `h1-{data,faq,history}-{1280,390}.png` (six; desktop light/mobile dark).
- `h1-{faq,history}-settled-{light,dark}-{1280,390}.png` (eight).

Lead reviewed final visual evidence. The ordinary H1 FAQ/history captures can precede
their loaded body; the supplemental eight captures wait for the real successful
response and settled DOM. They came from a separately owned loopback
H1 review session after the serial full gate, with no source changes. No UI was
hidden and no screenshot was edited.

The first supplemental capture attempt counted lazy loading placeholders inside
closed history detail elements. Its artifact-only selector was corrected to
check visible loading/error states; all eight supplemental captures then passed.
No product source or full-gate test was changed by that capture correction.

Bounded sub-agents supplied the fixed business foundation, API/proxy and
permission inventory, reused business UI, and assistant context browser cases.
The lead reviewed their diffs, reconciled W3.2 and later fixes, implemented the
saved-evidence/assistant safeguards, and ran every port-bound gate. Read-only
bounded reviews also inventoried cleanup, W6 compatibility and W9 fixture gaps.

Removed completed worktrees/branches normally, with delivered/archive hashes
checked: `ws/w5-business-design, ws/w5-assistant-context, ws/w5-context-browser`.
No force removal or unmerged branch deletion was used. Remaining registered
worktrees: 53, including main. The older W5 business-level, transport
and UI preparation trees remain pending full provenance reconciliation; the UI
tree includes future W6 work. Their uncommitted files were not cleared.

Requirement deviations: none. Supplemental settled screenshots add visual
evidence without changing the frozen gate. No new pending owner question.
Next: W6 integration on the reserved 0089/0090 lane. Its prepared source overlap
review, dated membership addition, owner-rule replacement, scope/job regression
cases and zero-diagnostic UI compiler overlay are preparation only; no W6
migration or runtime gate has yet run. W7, W9 and W8/final UAT remain pending.


### Remaining worktrees after W5 delivery

Recorded by work purpose and branch base. Bounded-task labels identify their
retained preparation trees. Older trees remain until their uncommitted files
have complete delivery/archive provenance; future slices remain in progress.

| Worktree / work purpose | Base commit |
|---|---|
| `main` | `9ac800c` |
| `parallel/c4-facilities-places` | `47d912b` |
| `ws/w2-home-projection` | `2387dd3` |
| `ws/w3-browser-recovery` | `d3ec1d6` |
| `ws/w3-entity-ui` | `2387dd3` |
| `ws/w3-lead-integration` | `2387dd3` |
| `ws/w3-legacy-tests` | `2387dd3` |
| `ws/w3-navigation-tests` | `2387dd3` |
| `ws/w3-workspace-api` | `2387dd3` |
| `ws/w4-browser-regressions` | `d3ec1d6` |
| `ws/w4-disclosure-evidence` | `d3ec1d6` |
| `ws/w4-governance` | `5a087ea` |
| `ws/w4-http-gates` | `d3ec1d6` |
| `ws/w4-lead-integration` | `2387dd3` |
| `ws/w4-lifecycle-tests` | `d3ec1d6` |
| `ws/w4-primary-forms` | `2387dd3` |
| `ws/w4-publication-navigation` | `d3ec1d6` |
| `ws/w4-publication-recheck` | `d3ec1d6` |
| `ws/w4-record-forms` | `2387dd3` |
| `ws/w4-bounded-fixture-confirmation` | `9c6beb7` |
| `ws/w4-bounded-ui-fixtures` | `9c6beb7` |
| `ws/w4-workflow-ui` | `2387dd3` |
| `ws/w5-business-level` | `2387dd3` |
| `ws/w5-business-transport` | `d3ec1d6` |
| `ws/w5-business-ui` | `d3ec1d6` |
| `ws/w6-account-ui` | `d3ec1d6` |
| `ws/w6-asset-delivery` | `d3ec1d6` |
| `ws/w6-assistant-scope` | `d3ec1d6` |
| `ws/w6-bu-import` | `d3ec1d6` |
| `ws/w6-client-boundaries` | `d3ec1d6` |
| `ws/w6-client-callers` | `d3ec1d6` |
| `ws/w6-notice-ui` | `d3ec1d6` |
| `ws/w6-permission-inventory` | `d3ec1d6` |
| `ws/w6-read-boundaries` | `d3ec1d6` |
| `ws/w6-review` | `2387dd3` |
| `ws/w6-route-transport` | `d3ec1d6` |
| `ws/w6-scope-audit-fixes` | `d3ec1d6` |
| `ws/w6-scope-design` | `2387dd3` |
| `ws/w6-scopes` | `d3ec1d6` |
| `ws/w7-admission-order` | `d3ec1d6` |
| `ws/w7-field-bindings` | `d3ec1d6` |
| `ws/w7-h1-catalog-fixture` | `d3ec1d6` |
| `ws/w7-proxy-transport` | `d3ec1d6` |
| `ws/w7-writing-aid` | `5a087ea` |
| `ws/w7-writing-ui` | `2387dd3` |
| `ws/w8-promotion-uat` | `9c6beb7` |
| `ws/w8-bounded-doc-checks` | `d3ec1d6` |
| `ws/w8-uat-draft` | `2387dd3` |
| `ws/w9-metadata-fixture-cases` | `5a59e13` |
| `ws/w9-metadata-verification` | `5a59e13` |
| `ws/w9-upload-fixtures` | `9c6beb7` |
| `ws/w9-upload-inventory` | `9c6beb7` |
| `ws/w9-upload-processing` | `9c6beb7` |


## W6 lead integration started — 9 November 2026

Predecessor product W5 is delivered at 9ac800c; its verification receipt is
4b00099, both pushed. The serial test lock is free after full-gate teardown and
the supplementary loopback review's owned ports were verified released.

Updated docs/47 section 7.1 and this docs/36 card before product changes. Read the
DW contract locally, read-only, at the owner's named path; no source connection,
credential read, staging write or DW repository modification. Prepared dated
intervals, fixture job/maintenance, shared promotion compatibility and regression
cases are not a completed runtime gate. New migration lane: 0089 scopes and 0090
membership; W7 retains 0091. W9 has no allocated migration yet.

The lead owns all integration changes in main. Bounded agents' prepared branches
are reviewed as finite diffs; none runs a port-bound command or changes main.
The existing W5 context browser review tree has been removed after its delivery;
its read-only W6 contract findings are retained in ignored review artifacts.

Initial prepared ownership inputs (55 paths; older migration filenames are
renamed only before their first integration, never after a commit):

| Prepared path | Bounded worktree |
|---|---|
| `apps/admin/app/api/hub/[...path]/route.ts` | `w6-client-boundaries` |
| `apps/admin/components/accounts.tsx` | `w6-client-boundaries` |
| `apps/admin/components/admin-accounts.tsx` | `w6-account-ui` |
| `apps/admin/components/commercial-types.tsx` | `w6-client-callers` |
| `apps/admin/components/content-bu-notices.css` | `w6-notice-ui` |
| `apps/admin/components/content-bu-notices.tsx` | `w6-notice-ui` |
| `apps/admin/components/content-scope-editor.tsx` | `w6-account-ui` |
| `apps/admin/components/content-scope-settings.tsx` | `w6-account-ui` |
| `apps/admin/components/content-scope.css` | `w6-account-ui` |
| `apps/admin/components/entity-workspace.tsx` | `w6-notice-ui` |
| `apps/admin/components/hub-assistant.tsx` | `w6-assistant-scope` |
| `apps/admin/components/hub-request.ts` | `w6-client-boundaries` |
| `apps/admin/components/knowledge-review.tsx` | `w6-client-callers` |
| `apps/admin/components/project-assets.tsx` | `w6-client-callers` |
| `apps/admin/components/workspace-home.tsx` | `w6-client-callers` |
| `apps/admin/components/workspace-search.tsx` | `w6-client-boundaries` |
| `apps/admin/lib/content-scope-routes.ts` | `w6-route-transport` |
| `apps/admin/lib/content-scope-text.ts` | `w6-account-ui` |
| `apps/admin/lib/hub-permissions.ts` | `w6-client-boundaries` |
| `apps/api/sena_hub_api/accounts.py` | `w6-scopes` |
| `apps/api/sena_hub_api/assistant.py` | `w6-assistant-scope` |
| `apps/api/sena_hub_api/brand_completeness.py` | `w6-read-boundaries` |
| `apps/api/sena_hub_api/bu_membership.py` | `w6-bu-import` |
| `apps/api/sena_hub_api/content_asset_delivery.py` | `w6-asset-delivery` |
| `apps/api/sena_hub_api/content_scopes.py` | `w6-scopes` |
| `apps/api/sena_hub_api/knowledge.py` | `w6-read-boundaries` |
| `apps/api/sena_hub_api/staff_media.py` | `w6-read-boundaries` |
| `apps/api/tests/test_assistant_scope_stream.py` | `w6-assistant-scope` |
| `apps/api/tests/test_bu_membership.py` | `w6-bu-import` |
| `apps/api/tests/test_content_asset_delivery.py` | `w6-asset-delivery` |
| `apps/api/tests/test_content_scope_history.py` | `w6-scope-audit-fixes` |
| `apps/api/tests/test_content_scope_inventory.py` | `w6-permission-inventory` |
| `apps/api/tests/test_content_scope_read_boundaries.py` | `w6-read-boundaries` |
| `apps/api/tests/test_content_scopes.py` | `w6-scopes` |
| `scripts/sync-content-bu.py` | `w6-bu-import` |
| `supabase/migrations/202611040087_content_scopes.sql` | `w6-scope-audit-fixes` |
| `supabase/migrations/202611040088_bu_membership.sql` | `w6-scope-audit-fixes` |
| `supabase/tests/bu_membership.sql` | `w6-bu-import` |
| `supabase/tests/concurrent_content_scopes.mjs` | `w6-scopes` |
| `supabase/tests/content_scopes.sql` | `w6-scopes` |
| `supabase/tests/fixtures/bu_membership/invalid.json` | `w6-bu-import` |
| `supabase/tests/fixtures/bu_membership/move.json` | `w6-bu-import` |
| `supabase/tests/fixtures/bu_membership/no-bu.json` | `w6-bu-import` |
| `supabase/tests/fixtures/bu_membership/valid.json` | `w6-bu-import` |
| `tests/permissions/content-scope-db.json` | `w6-permission-inventory` |
| `tests/ui/assistant-scope-races.spec.ts` | `w6-assistant-scope` |
| `tests/ui/content-bu-account-notices.spec.ts` | `w6-account-ui` |
| `tests/ui/content-bu-notices-h1.spec.ts` | `w6-notice-ui` |
| `tests/ui/content-bu-notices.spec.ts` | `w6-notice-ui` |
| `tests/ui/content-scope-expiry.spec.ts` | `w6-client-boundaries` |
| `tests/ui/content-scope-proxy.spec.ts` | `w6-client-boundaries` |
| `tests/ui/content-scope-raw-callers.spec.ts` | `w6-client-callers` |
| `tests/ui/content-scope-transport.spec.ts` | `w6-route-transport` |
| `tests/ui/content-scopes-h1.spec.ts` | `w6-account-ui` |
| `tests/ui/content-scopes.spec.ts` | `w6-account-ui` |

Lead also owns docs/47, docs/48, main.py, content_permissions.py, final permission
inventories/baselines, proxy allowlist registration, replay/H1 suite registration,
profile hashes, promotion transport/UI, and new membership-job/interval and
promotion-scope tests. Keep W3.1 overview/exposure, W3.2 Promotions and W5 business
context safeguards in every merge. Update file/hash ownership before the full
gate. Current preparation is unverified until the serial runtime checks pass.

### W6 current-main integration checks, 9 November 2026

A bounded sub-agent reviews only the prepared client deltas in isolated worktree
`D:/Personal/workspace/sena_hub_wt/w6-client-review`, branch `ws/w6-client-review`,
cut from `4b00099`. Its only writable deliverable is
`artifacts/unified-workspace/w6-client-review.md` in that worktree. It may inspect
types and source without binding ports; it must not edit product files, shared
docs, migrations, permission inventories or configuration, commit, push or run
test harnesses. Done means concrete client findings against the delivered
W3.1/W3.2/W5 predecessor. The lead owns integration and all security decisions.

The lead integrated 61 explicitly inventoried paths and the six finite API routes,
preserving existing registrations. The admin typecheck passed. The first selected
API run stopped during fresh migration replay: the confirmed-group query used an
ambiguous `id` alias. It reached no test cases. The lead qualified that reference;
the rerun is pending. A reviewed notice-fetch issue also now propagates current
access invalidation and ignores stale/aborted responses before rendering.
No full gate or W6 delivery is claimed.

#### W6 integration corrections and selected checks

The lead corrected qualified parameters in copied SQL delegates, ambiguous row
aliases, and the settings-preview state reference. Test fixtures now call the
ordinary public account permission preview/apply commands; private scope helpers
remain closed. Existing FAQ fallback and no-store response contracts are retained.

Selected API run 7: 121 passed, 2 failed, no skips, one existing dependency
deprecation warning. The remaining failures were direct calls to the private
scope-apply helper; the tests now exercise `apply_account_permissions`. Earlier
run 6 was 93 passed / 11 failed; it is diagnostic evidence, not a delivery gate.
Artifacts: `artifacts/unified-workspace/w6/api-integration-6.log` and
`api-integration-7.log`. Admin typecheck passed again after the client changes.

The lead also extended promotion projection checks to contextual lists, home
tasks, frozen published applicability and brand-owned drafts. Shared editors keep
inaccessible existing targets without receiving their identities; review still
requires every resolved project. Promotion suggestions require the matching
Projects and Promotions scopes, plus Knowledge scope for KM suggestions. The
permission inventory records 213 new functions, 217 changed existing functions,
seven private tables and 92 additional restrictive policies. Runtime catalogue
checks remain part of the gate.

Run 8 could not start inside the restricted process token (`uv_os_get_passwd`
failed before database startup). The unchanged documented disposable harness was
retried with the authorized local execution permission. No credentials were
opened or copied and no harness configuration-loading behavior was changed.
Results and the full W6 gate are still pending; no W6 commit or push yet.

Selected rerun 8 completed: 84 passed, zero failed or skipped, one existing
dependency warning (`api-integration-8-retry.log`). The full API quick gate is
running because shared API functions changed. The lead additionally owns
`apps/admin/components/hub-shell.tsx`, `apps/admin/app/layout.tsx` and
`tests/content-upgrade.test.mjs`: preserve same-account authored assistant text
while its own scope guard clears retrieved data; include the bounded role/scope
projection at initial hosted hydration; prove exact preservation of all existing
Hub, staging and audit rows through both W6 migrations. No other workstream owns
these files concurrently. These changes are pending their gates.

The first full API quick run was interrupted after progress stopped: older tests
held a content transaction and synchronously changed a grant through another
connection, which now correctly waits for W6's shared transaction lock. Ports were
released before the next run. The lead is adapting the affected test calls to
the existing same-connection permission helper, retaining authorization and
assertions; no harness configuration loading or production locks are weakened.
The reviewed fixture-call scope is articles, business assistant/content, content
workflow/workspace, FAQ coverage, project amenities/commercial/content core,
publication queue, real promotions and unit-type workflow tests. The bounded
sub-agent inventories call sites read-only; the lead makes every edit.

The article quick rerun passed 32 tests, with no failures/skips and one existing
warning (`api-articles-2.log`). Hidden article references retain the existing
unavailable-content placeholder with empty identifiers; the private reference
dictionary omits the inaccessible keys entirely.

The first database quick gate passed its 90 Node tests, including the populated
W6 migration-preservation regression, then stopped in the older workspace-home
SQL fixture. That fixture supplied BUD only in DW staging; W6 intentionally uses
the accepted membership tables. The lead added its synthetic membership through
the private fixture importer and retained the exact whitespace/key assertion.
The remaining database and concurrency suites have not yet passed. Additional
lead-owned paths are `supabase/tests/workspace_home.sql`,
`tests/permissions/README.md`, `tests/ui/unified-promotions.spec.ts` and the
permission assistant/publication/content fixture helpers. Fixture adaptations
do not change how configuration is loaded.

The broader selected fixture run was interrupted after a 90-second diagnostic
timeout in the Knowledge-only FAQ workspace request. Its log is
`api-fixtures-1.log`; no complete suite result is claimed. The isolated
regression run then completed with 11 failures and one existing warning
(`api-regressions-1.log`). The lead corrected three causes: translation source
dependencies now use the exact translation-owner scope guard; saved assistant
evidence preserves its canonical stale-versus-forbidden error; save-and-approve
retains the existing revision check before its mandatory approval guard. The
ordinary command still checks both Edit and Approve before writing.

The bounded browser review identified an incorrectly rooted checkbox selector,
an invalid public-ID value for a UUID promotion filter, and a race that asserted
a transient warning instead of the final revoked-access screen. The lead fixed
these test cases and retained the no-preview/no-confirm assertions. The promotion
browser test checks safe transport; real database tests separately prove that
hidden existing targets survive a shared edit. The private-table SQL check now
also explicitly includes dated membership intervals. All these changes await
their selected reruns and the full gate. No W6 commit or push yet.

Isolated rerun 2 passed all 14 cases, with no failures/skips and one existing
warning (`api-regressions-2.log`, 202.77 seconds). The three Knowledge-only FAQ
cases completed in 40.27, 52.75 and 66.35 seconds; this established a query-cost
problem rather than a persistent transaction deadlock in those cases. The lead
replaced the per-lookup all-FAQ materialization in the workspace reader with an
inline relation using the identical source-scope predicate, so question and ID
filters can retain their indexed lookups. The complete workspace and scope
regressions are running against that change; the earlier 14-case pass predates
this performance change and is not final-source full-gate evidence.

Workspace/scope run 1 completed with 71 passed, 2 failed, no skips and one
existing warning (`api-workspace-1.log`, 352.31 seconds). The remaining failures
were a private history predicate hiding an otherwise visible publication-batch
event, and an ambiguous cluster alias in the intake guard. History now reuses
the existing authorized context projection for batch/release/pointer events;
raw batch rows remain closed and the history field allowlist still excludes
hidden members. The intake alias is explicitly qualified.

For ordinary unrestricted project checks, the lead also reuses the existing
base-permission predicate before constructing a full account projection for
each row. Selected scopes still use the exact project/BUD and grace checks.
A regression verifies inactive/external accounts and a disabled permission tab
remain denied. The focused rerun includes both history/intake failures, the
Knowledge-only FAQ cases, scope intersections and the live inventory checks.

Workspace/scope rerun 2 passed all 11 selected cases, with no failures/skips and
one existing warning (`api-workspace-2.log`, 48.22 seconds). Knowledge-only FAQ
cases took 6.84, 10.33 and 15.60 seconds. The source guards, excluded actors,
disabled tab, history and intake regressions all passed.

Database quick run 2 passed 90 Node tests, including populated migration replay,
then found that the BU preservation assertion compared two empty staging
aggregates with SQL `=`. It now uses `IS NOT DISTINCT FROM` for exact null-safe
equality. Run 3 again passed 90 Node tests and passed all new scope/membership SQL
checks, then found an existing brand rollback regression: the new asset guard
denied an older logo with an exact immutable dependency but no current binding.
Neither run is a complete database pass (`db-quick-2.log`, `db-quick-3.log`).

The lead additionally owns `supabase/tests/brands.sql` for that regression. The
proposed correction reuses the existing retained-media certificate and checks
the owning version's project set against the dependency's source tab. Only that
exact retained asset can use this rollback path; ordinary file/library access
to an unbound historical asset remains denied. Added checks deny a selected-empty
Brands scope, altered certificate and absent source View, and restore the
positive case when source scope is restored. The current inventory is 213 new
functions, 218 changed existing functions, seven private tables and 92 additional
restrictive policies. Database quick run 4 is pending; no W6 full-gate pass,
commit or push is claimed.


Database quick run 4 passed 90 Node tests, the retained-brand rollback and scope
regressions, then stopped in the existing assistant SQL fixture. It used a
nonexistent `prj_synthetic` as a positive scoped run/citation source. The lead
additionally owns `supabase/tests/assistant.sql`: the positive case now uses
the synthetic project the fixture already creates, and a separate negative
case proves that a missing project is rejected. Existing ownership, raw-text,
namespace, proposal and audit assertions remain. Run 5 is pending. Admin
typecheck passed again (`typecheck-4.log`).

Database quick run 5 passed completely: 95 Node tests, 44 SQL suites and 24
concurrency scenarios, with zero failures/skips. The populated upgrade preserves
existing Hub/staging/audit rows; the brand retained-source, assistant fixture,
scope confirmation and waiting-read checks passed. Teardown confirmed that the
working database and file stores were never used (`db-quick-5.log`). The full
API quick rerun is now pending (`api-quick-full-2.log`); it stops on the first
failure for diagnosis and will not be reported as a full gate.

The bounded read-only housekeeping review checked all 15 `ws/w6-*` worktrees.
All branch tips are ancestors of current main. Only `ws/w6-client-review` and
`ws/w6-review` are clean candidates for ordinary removal after delivery. The
other 13 contain uncommitted preparation/inherited work, so non-force removal
would fail; they remain preserved. No ignored files or credential contents were
inspected. Lead-owned removal and the final remaining-tree inventory are still
pending the W6 delivery.

Full API quick run 2 stopped at the first failure: 556 passed, four existing
skips, one failed and one existing warning (222.13 seconds). The new stream
fixture supplied no synthetic demo tokens and therefore failed existing
settings validation before exercising delivery. It now reuses the existing
assistant test-token fixture. The focused stream/assistant/catalogue rerun
passed all 42 cases, zero failures/skips and one existing warning
(`api-stream-1.log`, 15.63 seconds). Complete API quick run 3 is pending.

The lead corrected stray question-mark display separators/fallbacks in the
scope editor/settings panels; their Thai labels were unchanged. Admin typecheck
passed (`typecheck-5.log`). A UTF-8 copy check verified all 77 scope catalogue
labels occur exactly in docs/47 (`copy-check.json`). Browser collection lists
147 focused cases in ten files and 609 total local cases in 76 files; collection
is not runtime evidence. The browser quick gate and final full gate are pending.

The updated offline production build passed (`build-quick-2.log`). W9 integration
must also update the W6 private delivery helper's byte bounds in
`apps/api/sena_hub_api/content_asset_delivery.py`: the current 10 MB asset bound
must accommodate the authorized 20 MB stored non-legal PDF limit while retaining
checksum/length validation and the final current-authority check. This is a W9
follow-up, not a change to W6 upload behavior.

Complete API quick run 3 was interrupted at an older publication fixture that
held a content transaction while synchronously changing a permission through
another connection. It had recorded 2,006 passes, 32 failures and nine existing
skips; this is an incomplete run, not full-gate evidence. The lead interrupted
only that owned run and confirmed all test ports were released. The two remaining
permission updates in that fixture now use the existing same-connection helper.
No production lock or configuration-loading behavior changed.

A bounded read-only fixture review identified missing cleanup of dated BU
intervals: their non-cascading run references prevent deleting the test runs and
can contaminate later invitation fixtures. The lead is confirming the short
failure traces before fixing this and the promotion read/permission regressions.
The selected diagnostic rerun and subsequent quick gates are pending. No W6
commit or push is claimed.

The short diagnostic run completed with 31 failed, one passed, zero skips and
one existing warning (`api-diagnostic-1.log`, 33.55 seconds). The formerly
blocked publication fixture passed. Confirmed corrections are: restore only
test-created/closed membership intervals during fixture cleanup; retain null
results for absent assistant versions while filtering actual owner scope;
check base project permissions before lookup; retain the original promotion
list alias; reject missing promotion ownership as invalid input after base
permission checks; and retain the reviewed restrictive-only source-offer policy
in the exhaustive database boundary assertion.

The brand dashboard now resolves an existing brand's visibility from its Hub
project assignments. Staged brand assignments are used only for not-yet-created
brands, so an inaccessible existing brand cannot appear as a new suggestion.
The fake-clock regression includes a conflicting staged assignment and still
checks immediate expiry, explicit-project and unrestricted neighbours. The
lead additionally owns `apps/api/tests/test_hosted_h1.py` to assert both exact
file-authority reads around storage retrieval; headers and agency denial remain
asserted. These changes are pending focused rerun 2 and updated database/full
gates. Only the two uncommitted W6 migration receipts were refreshed.

Focused rerun 2 passed 77 cases and failed two invitation assertions solely on
grant-array order, with no skips and one existing warning (69.23 seconds).
The assertion now compares the complete sorted grant arrays to the normalized
template, retaining every tab and duplicate check. The whole history file then
passed all ten cases, zero failures/skips, one existing warning
(`api-history-3.log`, 12.32 seconds).

Database quick run 6 passed on the corrected migration source: 95 Node tests,
44 SQL suites and 24 concurrency scenarios, zero failures/skips
(`db-quick-6.log`). Existing-row preservation and disposable teardown passed.
An added assistant-version scope regression initially hit the existing version
insertion guard while constructing its fixture (`api-assistant-scope-1.log`);
the fixture now uses the ordinary reviewed publication helpers. Its rerun and
the browser quick gate remain pending. No W6 final full gate or commit yet.

The added published-version scope regression passed using real reviewed project
and brand publications (one test, zero failures/skips, one existing warning,
7.34 seconds; `api-assistant-scope-2.log`). It denies the excluded owner while
keeping the unrestricted positive neighbour.

Browser quick run 1 completed with 140 passed, seven failed and zero skipped
in four minutes (`ui-quick-1.log`). Two paging failures exposed a regression
from the lead's earlier punctuation cleanup: it had changed the URL query
separator as well as display fallbacks. The URL separator is restored and the
remaining display separator is corrected by an exact display-only match. The
other failures concerned an ambiguous framework alert, a cross-context promise
assertion, exact label-text matching for selects and a fixture attempting Edit
before View. Assertions retain the current-authority denial, paged projects and
history, unsaved selections and explicit grace confirmation. Typecheck, offline
rebuild and the same 147-case browser selection are pending rerun.

Admin typecheck and the documented offline build passed (`typecheck-6.log`,
`build-quick-3.log`). Browser quick run 2 passed all 147 cases with zero
failures/skips in 1.9 minutes (`ui-quick-2.log`). The full-page scope screenshots
included the long underlying account table, obscuring the fixed native dialog;
the screenshot cases now capture the viewport and additionally assert the
dialog's bounds and absence of horizontal overflow. This four-case visual rerun
is pending, followed by the complete API quick rerun and final full gate.

The four viewport screenshot cases passed (zero failures/skips, 7.2 seconds;
`ui-visual-1.log`). The lead reviewed the four scope-editor images at 1280/390
in light/dark and both 390px notice images under `artifacts/unified-workspace/w6/`.
The complete API quick run 4 is pending. No final full-gate result is claimed.

Read-only preparation during this run verified all 25 files covered by the five
W7 handoff manifests still match their frozen hashes; this is not integration
or runtime evidence. A bounded sub-agent checked the prepared W8 pack and
identified four additions to U20/U22-U25: large scope paging, content-free
account-manager notices, notice refresh/phase races with unsaved input, and
preserved approvals/publications across membership changes. The lead retained
the checklist in `artifacts/unified-workspace/w8/w6-coverage-followup.md` for W8.

While the complete API quick run remains in progress, a preliminary broad
credential scan passed across 852 source and 71 browser files with zero matches
and no credential-file reads; whitespace validation also passed. These are
preflight results, not the final full-gate receipt. All five protected credential
paths remain ignored, as checked without opening them.

Additional read-only preparation recorded in
`w7/preintegration-review-followup.md` identifies acceptance after field
unmount, a trailing-newline UUID mismatch, and a membership-fixture cleanup gap.
The bounded review made no source edits or runtime calls. A W9 follow-up initially
compared an archived processor copy. The current `ws/w9-upload-processing`
processor already guards GPS-directory extraction on available authorized
project coordinates and distinguishes metadata-only PDF rewriting from keeping
original bytes. All three current source hashes still match the earlier
49-case receipt in `w9/current-processor-receipt.json`; no new runtime result is
claimed. Both workstreams remain unintegrated.

Complete API quick run 4 finished 2,622 passed / 17 failed / 11 existing skips
with six warnings in 1h24m53s (`api-quick-full-4.log`). The owned runner exited
and the working-stack ports were free. Most failures share a retained-media
validation cycle through history and web source checks; the authority-wait
cases failed during fixture publication, not at the account-lock barrier.
Other traces show hidden legacy section versions, an old one-read assertion
in the hosted knowledge-file fixture, and a home query timeout. No stack,
timeout, harness-configuration or existing denial assertion is being relaxed.

Lead additionally owns `apps/api/tests/test_r2_assets.py` for the precise
two-read delivery expectation, bringing the explicit W6 path set to 101.
The SQL correction retains exact immutable owning-version authority, all source
tabs and non-media object checks without re-entering retained-media lookup from
its history proof. Legacy candidate sections retain their stored REM identity
and use their exact applicability for scope checks; raw shared rows still hide
excluded identifiers. Two regression cases cover legacy version visibility
and retained media's scoped deny/unrestricted neighbour. Focused verification
and the final full gate remain pending.

Focused recovery passed all 19 cases, zero failures/skips and one existing
warning (`api-recovery-1.log`, 91.17 seconds): the 17 previous failures and
both new regression cases. The eight account-lock publication checks passed
without changes to their lock barriers. Disposable teardown confirmed that
the working database and file stores were never used.

Database quick run 7 passed on this corrected source (`db-quick-7.log`),
including migration replay, existing-row preservation and concurrency checks.
The permission-focused API quick run is now active under the sole port-test
lock (`api-permission-quick-5.log`). These remain quick-gate results; the W6
final full gate, commit and push are pending.

The permission-focused quick run passed 433 cases with zero failures/skips,
2,219 deselected and one existing warning in 666.21 seconds
(`api-permission-quick-5.log`). Database quick run 7 totals are 95 Node tests,
44 SQL suites and 24 concurrency scenarios, all passing with zero skips.
Both disposable runs completed their working-database/file-store preservation
and teardown checks. The lead now freezes the 101 explicit W6 paths for the
serial final full gate; results, commit and push are not yet claimed.

### W6 detached final gate recovery — 11 November 2026

The detached serial runner ended at 11:14 Bangkok with exit code 1 in the API
stage. Exact result: 2,640 passed, one failed, 11 existing skips and six warnings
in 4,509.08 seconds. The failure is
`test_workspace_home.py::test_home_reads_do_not_record_gaps_or_audit_and_project_revocation_clears_counts`:
the initial home projection exceeded the database command timeout. Database,
H1, both browser widths and final scans were not reached. No delivery, commit
or push is claimed.

The succeeding lead verified all 101 frozen file hashes, their exact changed
path set, an empty staging area and unchanged base `4b00099` before recovery.
The original runner was not stopped or altered; its state file records the
failure and its processes/test ports have exited. Evidence is retained in
`artifacts/unified-workspace/w6/api-full-failed-20261111-1114.log`,
`durable-gate-state.json` and `durable-gate-output.log`. Recovery stays inside
the W6 lease, preserves the existing timeouts and denial assertions, and starts
with the isolated home regression. A permission or migration correction will
be reported before rerunning its gates. P1 still waits for W6 delivery.

The isolated original home case passed (one case, one existing warning,
4.26 seconds), so recovery exercised accumulated project data. A 300-project
fixture reproduced the timeout. Migration 0089 now avoids resolving project
sets for a currently unrestricted caller after taking the scope lock, computes
the detailed home media checklist once, and retains readiness item arrays only
for the requested project page. All projects still receive their readiness and
scope checks; aggregate counts and returned page fields are unchanged. Both
changed scope/readiness helpers use fresh statement snapshots after lock waits.
No timeout, grant, denial assertion or API contract was relaxed. Migration 0090
is unchanged. The reviewed existing-function inventory is now 219; its README
and migration provenance hashes were updated within the original lease.

The intermediate recovery run passed 65 cases before concurrency review added
six real lock-wait cases. The next run passed 70 but still timed out on the
300-project fixture. After the page-array correction, focused recovery run 5
passed **71 cases**, zero failures/skips and one existing warning in **88.52
seconds**. It covers selected-empty and revoked access after a real account lock
wait, unchanged-access neighbours, identical readiness summaries, both the
first and last 25 rows of 300 projects within the existing 15-second query
budget, and no audit writes. Evidence: `api-home-recovery-1.log`,
`api-home-scale-{1,2}.log` and `api-home-scope-recovery-{2,3,4,5}.log` under
`artifacts/unified-workspace/w6/`. Read-only review approved the final guards,
readiness composition and pagination bounds. Database and permission quick
checks are running serially before a newly frozen complete full gate.

Database recovery runs 8 and 9 stopped in the existing scope-confirmation
concurrency scenario with `permission_preview_stale`; each had completed 90
Node checks and 17 earlier concurrency scenarios without failure. No completed
database gate or permission API rerun is claimed for either attempt. The focused
diagnostic reproduced the conflict: custom and generic query plans returned the
same lost project set in different array orders, changing its digest. A fresh
connection matched the original preview exactly, confirming that the unrelated
draft edit was not an intended digest input.

Migration 0089 now sorts both complete gained/lost set results before digesting
them. Existing digest inputs, stale-review refusal and expiry checks remain.
A permanent regression compares complete previews under both query plan modes
and applies the reviewed result for both loss and gain transitions. Temporary
diagnostic code was removed. Evidence: `db-recovery-{8,9}.log` and
`api-scope-concurrency-diagnostic.log`. The correction was reported before the
serial focused API, database and permission quick checks restarted.

The corrected recovery quick gate passed: focused API **72 passed**, zero
failures/skips, one existing warning in **86.53 seconds**
(`api-home-scope-recovery-6.log`); database **95 Node tests, 44 SQL suites and
24 concurrency scenarios**, zero failures/skips (`db-recovery-10.log`);
permission API **433 passed**, zero failures/skips, **2,227 deselected**, one
existing warning in **581.76 seconds** (`api-permission-recovery-6.log`). All
three runs passed disposable teardown and working-store preservation checks.

The lead reverified origin/main and local base `4b00099`, the empty index and
the exact original 101-path lease. Seven leased paths differ from the failed
freeze. The original manifest, failed runner state/output and prior full-stage
logs were archived with matching hashes under `w6/failed-run-20261111-1114/`.
The 101 current paths are being frozen again for a complete serial full gate
from typecheck through both browser widths and final scans; no earlier passed
stage is reused in this recovery run. Runner:
`artifacts/unified-workspace/w6/full-recovery-20261111.ps1`; live state:
`durable-gate-state.json`. The lead retains the sole port-bound test lease.
W6 delivery and P1 remain pending this gate.

The complete recovery runner exited naturally at **13:04 Bangkok** in the API
stage: **2,647 passed, two failed, 11 existing skips and six warnings in 3,510.60
seconds**. Both failures are home-query timeouts: the added 300-project case and
the original read-only/revocation home case. Typecheck, offline build and four
production checks passed again; later full stages were not reached. All 101
frozen hashes, the exact path set, empty index and base still matched after the
failure. The runner and test listeners exited. Evidence is preserved under
`w6/failed-run-20261111-1304/`; no commit or push occurred.

Read-only review found that each generic task attempted a complete native-row
lookup even when its kind could never match a native record. Migration 0089 now
performs that fallback only for the complete existing native-kind set. Current
source, approval, publication and expiry checks remain per item; no authorization
or readiness result is cached. A transaction-local function-call regression
checks that four submitted contacts and two submitted selling points retain all
six approval tasks without adding native-row scans. This correction was reported
before its focused quick check. Recovery will also exercise accumulated fixtures
before another complete full gate, rather than relying only on the small fixture.

Focused recovery run 7 passed **73 cases**, zero failures/skips and one existing
warning in **95.19 seconds** (`api-home-scope-recovery-7.log`). The native-scan
regression passed and disposable teardown completed. Read-only review approved
the exact kind guard and the non-timing regression.

The next quick run uses the 34 API files in ordinal filename order through
`test_content_scopes.py`, followed by `test_workspace_home.py`, in one disposable
database invocation. Its exact selection is
`w6/api-accumulated-prefix-files.json`; output is
`w6/api-accumulated-recovery-1.log`. This reproduces the fixture population before
the 300-project failure and then exercises home again. It does not replace the
complete API gate or claim coverage of all later full-suite accumulation. The
same serial runner proceeds to database and permission quick checks only if
this reproduction passes. W6 still owns the sole test lease.

The accumulated-fixture run stopped with **1,010 passed, one failed, five existing
skips and one existing warning in 613.04 seconds**. The remaining failure is the
300-project home timeout; the original home/revocation case passed in 7.90 seconds.
Database and permission follow-up checks were not started. No commit or push
occurred. The lead is profiling the remaining home work within the W6 lease before
another full gate.

The isolated profile (`api-home-profile-3.log`, one passed, one existing warning,
32.53 seconds) measured all 300 project summaries and exposed repeated context
lookups plus 15,652 candidate scope checks. Migration 0089 now builds detailed
checklist contexts only for the visible page, keeps canonical summary calculations
for all projects, and reuses one project-context lookup within each detailed
checklist. The 300-project regression asserts exactly 25 detailed projections per
page while preserving totals, distinct first/last pages, brand aggregates and
read-only behavior. The two-file focused check passed **70 cases**, one existing
warning and no failures/skips in **113.95 seconds** (`api-home-scope-recovery-8.log`).

The remaining repeated task-filter scope checks are narrowed using the existing
association, BUD and brand predicates before invoking current authority for each
matching project. Both helper variants retain their original fast paths and
matching-candidate scope checks. A regression verifies zero checks for a
nonmatching brand, one for a matching project, selected-empty denial and explicit
selection acceptance. These migration changes were reported before rerunning
checks. No new grants, signatures or cached authority were introduced.

Read-only review approved both optimizations and their exact regressions. Focused
recovery 9 passed **80 cases**, one existing warning and zero failures/skips in
**118.26 seconds**, including publication lock-wait cases. The 300-project test
took 14.01 seconds across fixture setup and both page queries; each query retains
its 15-second limit. Evidence: `api-home-scope-recovery-9.log`. The lead now repeats
the same accumulated API prefix (`api-accumulated-recovery-2.log`), then database
(`db-recovery-11.log`) and permission API (`api-permission-recovery-7.log`) checks
serially, stopping on any failure. The sole test lease remains with W6.

Accumulated recovery 2 still failed the 300-project timeout: **1,012 passed, one
failed, five existing skips and one existing warning in 657.07 seconds**. The
database and permission follow-ups were not started. The isolated improvement is
insufficient evidence for accumulated fixtures, so the next diagnostic profiles
that exact preceding file population and the failing case. The 15-second limit
remains unchanged; no product commit or full-gate restart occurred.

Accumulated profile 4 reproduced the failure after the same 33 preceding files:
**941 passed, one failed, five existing skips, one existing warning, 518.77
seconds** (`api-home-profile-4.log`). All 300 readiness summaries completed, with
only 25 detailed projections. The remaining measured cost was FAQ rule resolution:
612 rule resolutions triggered 216,924 business-membership lookups and 193,692
property-form lookups; FAQ composition consumed 7.48 seconds before cancellation.

Migration 0089 now evaluates cheap project/brand/group/rule predicates before
the expensive form and business-membership lookups inside `faq_rule_projects`.
Validation, empty-rule behavior, full applicability, sorted result, signatures,
ACLs and caller-scope independence remain unchanged. The changed-existing-function
inventory is **220**. A non-timing regression checks unrelated brands cause no
expensive lookups while positive membership, missing form and lost membership
retain their results. This migration correction was reported before rerunning;
the next focused run includes the business cases that seed the expensive rules.

The exact resolver patch and inventory passed read-only review. Focused recovery
10 passed **91 cases**, zero failures/skips and one existing warning in **201.11
seconds**, including accumulated business fixtures, applicability drift cases,
the 300-project first/last pages and the closed function inventory. Evidence:
`api-home-scope-recovery-10.log`. Temporary profile output was removed before this
check. The lead repeats the complete selected prefix in
`api-accumulated-recovery-3.log`, then runs database and permission checks serially
only on success. The full gate and product commit remain pending.

The final recovery quick chain passed on the current candidate:

| Check | Exact result | Evidence under `artifacts/unified-workspace/w6/` |
|---|---|---|
| Accumulated API prefix and home | 1,014 passed, zero failed, five existing skips, one existing warning; 574.86 seconds | `api-accumulated-recovery-3.log` |
| Database | 95 Node checks, 44 SQL suites, 24 concurrency scenarios; zero failures/skips | `db-recovery-11.log` |
| Permission API | 433 passed, zero failures/skips, 2,231 deselected, one existing warning; 609.79 seconds | `api-permission-recovery-7.log` |

All three disposable runs completed teardown. The accumulated 300-project case
passed in 17.51 seconds across setup and both page queries; the original home
read/revocation case passed in 7.04 seconds. Each query retains its 15-second limit.
Migration 0089 SHA-256 is
`13bb3232ef76383df1a69379ba76338f1c78c3d694c81a2148094b14ecc276ad`;
0090 remains `5a3143b717dde6ed9c76e79dfb702126b3de76c40489cd29e8518b8f56a273a4`.

Local and remote main remain `4b00099`, the index is empty, and the lease is still
exactly 101 paths; seven differ from the original failed freeze. The lead is
freezing this candidate again for the complete serial full gate, starting with
typecheck and reusing no earlier stages. The existing recovery runner writes
`durable-gate-state.json`; the source is read-only while it runs. W6 retains the
sole port-bound lease. Delivery, cleanup and P1 remain pending the complete gate.


### W6 full API passed; operator-copy inventory stop — 11 November 2026

The 14:28 serial full run passed typecheck, offline webpack build, production
installation/import/isolation (4), and the complete API suite: **2,653 passed,
11 existing skips, 6 existing warnings, 0 failures, 3,957.80 seconds**. API
teardown passed. All 101 frozen paths and base `4b00099` still matched after
the runner naturally stopped at 15:36 in its DB stage.

The failing test was `tests/hosted-write-paths.test.mjs`: the operator inventory
recursively scans ignored `.local/hosted-content-rollout/`. During the separately
authorized W1-W5 TEST staging, the lead had materialized the approved 4b00099
source tree there. Its ordinary application/test transactions were consequently
classified as additional hosted operators. This was an artifact-placement
mistake by the lead, not a W6 source failure. The DB stage reported 66 Node
passes in its first group, then 22 passes and one failure in its second group;
later SQL/concurrency stages were not reached. No product path was edited to
silence the inventory.

The committed-tree copy was moved to the verified temporary source directory
outside the repository scan. The three inventory tests then passed with zero
skips/failures. No test process or listener remained on the owned ports. The
failed state, original manifest and all completed stage logs are preserved in
`w6/failed-run-20261111-1536/`.

Resume the complete serial gate at DB, then H1, both complete browser widths
and final scans. Reuse the four completed stages only with their archived log
hashes and exact unchanged product/test source. The only frozen-path change
before resuming is this appended log entry; the 100 other path hashes must
match the archived manifest. No migration, permission, API or UI fix is made.

The separately authorized TEST candidate `4b00099-media-00f0f23e0fe3` passed
Linux build and isolated self-checks but remains **staged only**, by owner
decision. Prefix 81 and the live 0240315 release are unchanged. Migration 88
needs a populated rehearsal covering `hub.brand_business`; the saved rehearsal
does not include that write for the 33 active hosted brands. No hosted database
write, new backup, migration, promotion, account/grant change or signed-in
browser session occurred. The docs/46 entry and immutable staged handoff are
held under `.local/hosted-content-rollout/` until the W6 commit boundary.


## W6 H1 failure recovery and hosted demo handover - 11 November 2026

The resumed serial gate naturally stopped at H1 at 15:47 local; no runner was
interrupted. Retained full API: **2,653 passed, 11 existing skips, six warnings,
3,957.80 seconds**. Resumed DB: **95 Node tests, 44 SQL suites and 24 concurrency
scenarios**, zero failures/skips. H1: **69 Node tests and 10 smoke tests passed;
64 browser checks passed and six failed**. Configuration-off/outage phases,
full browser widths and final scans did not run. This is not a completed gate.
Immutable failure evidence is `artifacts/unified-workspace/w6/failed-run-20261111-1547/`.

Four legacy account checks lost a dialog/success message after successful account
writes. The global authorization epoch changes the content-scope fingerprint,
which unnecessarily remounted account management. Its remount/recovery key now
excludes only content scope while retaining the current manager's identity,
status, role, agency and management authority. Content pages retain the full scope key;
server authorization and expiry enforcement are unchanged. Two new W6 H1 checks
raced a second navigation against login's redirect; they now await that redirect.
Only leased account/shell components and the new W6 spec changed. No migration,
SQL, API contract or permission grant changed. Quick checks and a fresh full gate are
required before delivery; no W6 product commit has been made.

Hosted TEST is now exact W1-W5 release `4b00099-media-00f0f23e0fe3`, prefix 88,
under the owner's post-migration timeout decision. Full details and backups are
in docs/46, section "W1-W5 hosted TEST demo release - 11 November 2026". Heavy
requests cancel at the production time limit with no remaining transactions,
lock waits or health degradation. Residential is the clean demo route; project
content works but its header inventory times out. Home, brands, publishing,
approvals and history also time out. No performance hotfix was applied. W6 stays
local pending its gates and the DW BUD feed. The independent docs/46 receipt is
outside W6's 101 product paths and must be preserved separately during freezing
and explicit-path commits.

The first recovery quick H1 run passed 69 Node and 10 smoke checks, then 64
browser checks with six failures. It exposed a second remount key in HubShell,
which now uses the same account-management key only on the accounts screen.
The scope checks reached the editor successfully; their last assertion now
uses the grace selector's actual combobox accessible name, as the existing
local scope spec does. This changes no UI label or assertion of authority.
The failed quick log is `h1-recovery-quick.log`; the revised quick run follows.

Recovery quick H1 run 2 passed all 70 main browser checks and three configuration
checks, then five outage checks passed and two failed. Network/timeout content
read invalidation temporarily masks content tabs; including those tab flags in
the account manager's key still remounted its input. The account-only key now
uses identity, status, role, agency and `can_manage_users`, the authority actually
required for account management. Scope editors/settings keep their independent
full fingerprints and fresh-authority checks. Manager revocation and 401/403
closure are unchanged. The failed log is `h1-recovery-quick-2.log`; subsequent
quick coverage includes outage preservation, manager revocation, identity switch,
scope expiry and navigation. No hosted action or migration change followed.

### W6 final selector lease and browser recovery - 11 November 2026

Recovery quick run 3 passed typecheck, the offline webpack build and complete
local H1: **69 Node tests, 10 smoke tests and 80 browser checks**, zero failures
or skips. Evidence: `typecheck-h1-recovery-3.log`, `build-h1-recovery-3.log` and
`h1-recovery-quick-3.log` under `artifacts/unified-workspace/w6/`.
The selected 1280 browser run then reported 45 passes and four failures: three
legacy account assertions matched additional W6 status/alert elements, and one
scope fixture forwarded a request after its page had cancelled it. The latter
fixture now captures the real caller projection once before mocking, preserving
all authority mutations and assertions, and waits for route cleanup.

The owner's two explicit approvals expand the product lease **101 -> 102 -> 105
paths**. Apply exactly `phasec-assertion-scope.proposed.patch` and
`legacy-project-alert-scope.proposed.patch`, adding these legacy specs:
`tests/ui/phasec-accounts.spec.ts`, `tests/ui/assistant.spec.ts`,
`tests/ui/project-form.spec.ts` and `tests/ui/project-media-draft.spec.ts`.
Only selectors change in these four files; expected messages, payload assertions
and permission checks are unchanged. The complete read-only sweep covered 90
specs, including multiline and CSS selectors (`legacy-status-alert-sweep.json`).
This is the final selector lease expansion. Any further selector conflict is a
reportable stop, not another lease request.

The next quick selection runs all four approved specs plus scope, scope-expiry
and navigation at both widths, in serial disposable harnesses. Then resume the
full gate with both complete browser widths and final scans. Reuse only passed
stages whose actual inputs remain unchanged, with exact source differences and
archived log hashes in the resumption receipt. Refresh the 105-path frozen
manifest before starting. The independent hosted docs/46 receipt stays outside
the product lease. W6 delivery and P1 remain pending; no hosted change follows.

Read-only answer on BUD errors: the legacy fixtures produce unmocked or malformed
notice responses, but the behavior is real. `ContentBuNotices` mounts on home,
project entity pages and account scope settings. Any eligible active staff role
can see its `role=alert` when that request fails, even without a BUD-scoped grant.
It is not mounted on every brand/business page. Section 7.1 of docs/47 requires
targeted stale, failure and handover notifications; it does not require this
generic request-failure alert. No notice behavior changes in W6. Proposed P1
follow-up: a retryable, non-assertive message shown once only for callers with a
BUD-scoped grant, while retaining the required targeted operational notices.
The current caller projection exposes only a scope fingerprint and expiry, not
a BUD-grant flag; do not infer grant type from either. If reliable targeting
needs a new API field, report that separately under P1's no-contract-change rule.

### W6 final selector stop - 11 November 2026

The exact approved patches are applied. The seven-spec quick selection finished
at both widths with **81 passed, one failed, zero skips per width** (2.4 minutes
of browser execution each). All 105 frozen source paths and base `4b00099`
matched during both runs. No runner was interrupted; both disposable harnesses
completed their teardown.

| Spec | 1280 | 390 |
|---|---|---|
| assistant | 23 passed | 23 passed |
| phasec-accounts | 10 passed, 1 failed | 10 passed, 1 failed |
| project-form | 7 passed | 7 passed |
| project-media-draft | 3 passed | 3 passed |
| content-scopes | 13 passed | 13 passed |
| content-scope-expiry | 8 passed | 8 passed |
| hub-navigation | 17 passed | 17 passed |

The sole failure is `tests/ui/phasec-accounts.spec.ts:120`, in the existing
stale-save check. Its dialog-wide refresh-button lookup now resolves to three
buttons: the original account conflict action, scope refresh and scope history
refresh. The approved status/alert changes pass; this separate button selector
was outside the requested status/alert sweep. In accordance with the owner's
final-selector instruction, it remains unchanged. No further lease expansion is
requested, and the full-gate restart, product commit and P1 start are held.

Evidence under `artifacts/unified-workspace/w6/`:
`ui-1280-final-selectors-quick.log`, `ui-390-final-selectors-quick.log`,
`final-selector-stop-1280/` and `final-selector-stop-390/` (screenshot, trace,
error context), plus `final-selector-stop-receipt.json`. Refresh the frozen
manifest only for this log entry; retain its preceding quick-run manifest as
`final-selectors-quick-source-hashes.json`.

No new full-gate stages ran after these selector approvals. The reviewed reuse
plan retains the successful full API (2,653 passed, 11 existing skips, six
warnings) and production (4 passed), whose inputs are unchanged, and the latest
complete recovery typecheck, offline build and H1 (69 Node, 10 smoke, 80 browser).
The later changes affect only local browser specs and documentation. A future
resumption must rerun DB because ignored hosted operator inputs changed after
its earlier 95 Node / 44 SQL / 24 concurrency pass, followed by both complete
browser widths and final scans. A fresh, port-free hosted operator inventory
check passed all three tests under the runner's authorized access; no backup or
credential contents were opened. Prepared reuse verification refuses to resume
while either quick browser selection is failing. This is not a completed full
gate and no W6 delivery/receipt commit exists yet.

### W6 continuation after reported selector stop - 12 November 2026

The owner instructed the lead to continue after receiving the complete stop and
handoff. This authorizes the reported refresh-button correction within the
existing 105-path lease: the stale-save test now finds its refresh button inside
the original `.account-action-error` container. No new path, expected text,
payload assertion, permission check or application behavior changes. The seven
affected specs run again at both widths before resuming the remaining gate.
Earlier failing logs and evidence are retained unchanged; new quick logs use
the `20261112` suffix. Verify the sole test lease before each serial run.

The 1280 quick selection passed all 82 checks in 2.2 minutes. A chat service
restart interrupted the 390 selection after 18 passes, before a final result;
the runner and all owned listeners were gone on recovery. Its partial log/state
are preserved with the `-interrupted` suffix. No application or test source
changed. Rerun only the 390 selection in a detached hidden runner, retaining the
completed 1280 evidence. This interruption is not a passed browser stage.

The detached 390 rerun passed all 82 checks in 2.5 minutes; both widths now have
zero failures or skips. The test lease is released. Final resumption freezes
the same 105 product paths, verifies base/origin `4b00099`, and retains the
successful API, production, recovery-3 typecheck/build and complete recovery-3
H1 results. Exact source differences, input ordering and retained log hashes
are recorded in `resume-final-ui-20261111.json`. The new detached serial runner
`resume-final-full-20261112.ps1` runs DB, the complete 1280 and 390 suites, then
credential scans and diff/source verification. No source edits are permitted
during this final run. No additional migration or permission change was needed.

### W6 complete desktop browser failure and read profiling - 12 November 2026

The detached gate ended naturally at 08:43 Bangkok with exit code 1 in
`ui-1280`: **603 passed, six failed, zero skipped, 24.0 minutes**. DB passed
again; the 390 suite and final scans did not run. All 105 frozen product paths,
base `4b00099`, the independent docs/46 receipt and retained stage hashes still
matched after the runner exited. No test listener remained on 55432, 8000 or
3000. Evidence, six traces and source hashes are preserved in
`artifacts/unified-workspace/w6/failed-run-20261112-0843/`.

Two asset lifecycle checks and three brand checks failed during slow workspace
loading or publication preparation. Trace reads returned 200 after roughly
12-13 seconds; uploads, duplicate reuse and binding requests passed. The
publication preparation request returned 200 after 11 seconds, beyond its
five-second assertion. Cleanup permission writes waited for outstanding reads
before restoring fixtures. The final failure is the many-gap overview's
height: 2,212 pixels against its 2,200-pixel ceiling after adding the BUD notice
panel. It is not another selector conflict. No assertion or timeout is relaxed.

Recovery begins with the existing disposable UI fixtures and transaction-local
function statistics for workspace/history reads. Empty new brand pages are
also slow despite having no project FAQ/readiness work, making history the
first profiling target. Keep scope locks and authorization checks intact.
Any SQL fix stays inside the W6 lease and is reported before rerunning the
required DB/permission quick checks. Delivery, P1 and subsequent integration
remain pending; the hosted W1-W5 release is unchanged.

The 57-test prefix replay passed. Read-only profiling measured project
workspace/history at 11,470/11,070 ms and brand workspace/history at
12,166/11,691 ms. Each history scan called `article_read` 158 times, rebuilding
an editor payload that history discarded; its recursive projection ran 202,082
times. Evidence: `workspace-profile-before-20261112.json` and
`workspace-profile-prefix-before-20261112.log`. Audit rows were unchanged.

Migration 0089 now keeps Knowledge View, article existence, and current-source
scope checks before and after the exact historical-reference work without
constructing that discarded payload. Historical-version/reference checks,
redaction, shared locks and private ACLs remain. The changed-existing-function
inventory is 221. Its new SHA-256 is
`523522f6dc0cb89b6d77e70480637aad2022429f0b7f6aab6949b8ef205d5e2e`;
0090 is unchanged. The lead reported this SQL change before running checks.
The new non-timing regression verifies four audit-event classes, zero editor
payload reads, no audit writes, current-versus-historical denial, a permitted
neighbour, empty scope and BUD expiry. Its first fixture selected a pointer-only
audit update, correctly hidden by existing history rules; selecting the original
content event fixed the fixture. The focused rerun passed one test, 45
deselected, one existing warning, in 3.72 seconds (`api-history-focused-2.log`).

The BUD panel's outer vertical margin is reduced from 16 to 8 pixels to keep
the existing compact-overview limit. Padding, controls and notices are unchanged.
All changes remain within the 105 leased paths; no test timeout or assertion
limit changed. Next are DB, the permission and affected API selection, affected
browser workflows at both widths, and H1. A fresh full gate follows only after
these quick checks pass; the prior API/H1 passes cannot cover this SQL change.

The history-recovery quick chain passed DB (95 Node checks, 44 SQL suites, 24
concurrency scenarios) and the selected API run (**614 passed, 2,051 deselected,
one existing warning, 1,147.31 seconds**) on the corrected migration. The 1280
selection then reported **121 passed, one failed**: the five slow
workspace/history failures are gone (profiled brand workspace/history reads now
about 2.2 seconds each, from 11-12 seconds), and the only remaining failure is
the W3.1 many-gap overview height, **2,204 pixels against the 2,200 ceiling**
(`ui-1280-history-recovery-20261112.log`, state
`quick-history-recovery-state-20261112.json`). The 390 selection and H1 stages
were not run.

Reported before rerunning: the project-page notice variant only
(`.content-bu-notices.content-bu-project-notices`) now uses `margin-block:
.25rem` and `padding-block: .5rem`. Home and account-settings panels, copy,
controls, 44-pixel targets and every notice behavior are unchanged, and the
overview ceiling assertion is untouched. This stays inside the 105-path lease.
The remaining quick stages (both width selections plus H1) rerun after this
correction; the fresh full gate still follows.

The recovery DB gate passed **95 Node, 44 SQL and 24 concurrency checks**. The
affected API/permission selection passed **614 tests, zero failures/skips,
2,051 deselected and one existing warning**. The desktop selection passed 121
of 122 checks: all five previously slow asset/brand checks now pass. Read-only
profiling after the selection measured project workspace/history at 292/60 ms
and brand workspace/history at 2,208/2,154 ms, with unchanged audit rows. These
figures use the selection's final fixtures and are diagnostic, not a timing
assertion or a claim that every dataset has the same cost.

The remaining overview height was 2,204 pixels against the unchanged 2,200
limit. Collapsed margins saved only eight pixels; the notice panel now uses
12-pixel vertical padding, matching its existing mobile padding. Controls keep
their 44-pixel target, text and internal gaps. All 105 quick-frozen hashes
matched before this CSS-only correction. The failure log, trace, screenshot,
profile and source manifest are preserved in
`artifacts/unified-workspace/w6/quick-history-failure-20261112-0926/`.

The follow-up quick run retains only the completed DB and API selection, whose
sources are unchanged, and reruns typecheck, offline build, the same 122-browser
selection at both widths and full local H1. Its evidence uses the suffix
`history-recovery-2-20261112`. No test selector, assertion, timeout, permission
or migration changes in this correction. A new full gate will then rerun every
stage without reuse before delivery. P1, W7 and W9 have bounded preparation
reports; W8 is preparing six additional cases, with UAT execution still last.

### W6 single-lead reconciliation - 12 November 2026

The follow-up runtime checks passed: typecheck, offline build, **122 browser
checks at each width**, and local H1 **69 Node, 10 smoke, 80 browser checks**,
with no failures or skips. Its final source postcheck failed: another session
added the project-only notice-spacing rule at 09:30 and its log entry at 09:31,
after the 105-path freeze. The other session's attempted runner at 09:32 refused
to start because the test lease was occupied. No simultaneous port-bound test
run occurred. Only the notice CSS and this log changed; all other source hashes,
retained DB/API logs and the independent hosted receipt matched. Preserve this
as a failed source attestation, not a completed quick gate. Evidence:
`artifacts/unified-workspace/w6/quick-history-source-drift-20261112-0946/`.

The owner selected this chat as sole lead and said the other session would be
paused. Reconciliation keeps the narrower project-only rule (`margin-block:
.25rem; padding-block: .5rem`) and removes the overlapping global 12-pixel
padding change. Home/account panels retain their original 16-pixel padding;
mobile padding remains 12 pixels. No assertion or behavior changes. The next
quick run freezes 105 paths again and reruns typecheck, offline build, the four
affected notice/overview/navigation specs at both widths, and H1. DB/API results
are retained only for this CSS-only quick correction with unchanged input
hashes. The final full gate reruns every stage without reuse. No commit or push
is authorized by the failed source attestation.

Bounded preparation is reviewed separately: W7's 43 candidate hashes match,
with 41 current baselines matching and two manual merges required (hosted
profile and permission README). P1's lead review corrects queue-card scope and
completes the empty-state inventory. The W8 draft now preserves U01-U54 exactly
and appends U55-U60, all NOT RUN; receipt and prepared pack are under
`artifacts/unified-workspace/w8/`. W9's route inventory remains preparation with
explicit unresolved command boundaries. None of this preparation is integrated
or runtime-verified, and no hosted change follows.

The reconciled quick run completed at 10:04 Bangkok: typecheck and offline
build passed; the four affected browser specs passed **58 checks at 1280 and
58 at 390**, zero failures/skips; H1 passed **69 Node, 10 smoke and 80 browser
checks**, zero failures/skips. All 105 source hashes matched at the final
postcheck. DB **95 Node / 44 SQL / 24 concurrency** and API **614 passed / 2,051
deselected / one warning** are retained quick results with verified unchanged
inputs. Evidence: `quick-history-final-receipt-20261112.json`,
`quick-history-source-hashes-3.json`, `quick-history-retained-stages-3.json` and
`*-history-recovery-3-20261112.log` under `artifacts/unified-workspace/w6/`.

Fresh full gate: freeze the same 105 explicit paths on base/origin `4b00099`
and run `run-history-full-20261112.ps1` serially through typecheck, offline build,
production imports, complete API, DB/replay, H1, both complete browser widths,
credential/diff/broad scans and source postcheck. **No stage is reused.** Prior
full evidence is preserved in `before-fresh-history-full-20261112/`. No product
source edits are permitted until the runner ends. W6 delivery is still pending
this result. A separate isolated W9 processor-log privacy check owns only its
new worktree's processor/test files; it has no test-port lease or main writes.

### W6 final mobile failures - 12 November 2026

The fresh serial gate ended naturally at 12:08 Bangkok with exit code 1 in
`ui-390`: **607 passed, two failed, zero skipped, 25.9 minutes**. Desktop
passed all 609 checks. Earlier fresh stages passed: typecheck, offline build,
production 4, API 2,654 with 11 existing skips and six warnings, DB 95 Node /
44 SQL / 24 concurrency, and local H1 69 Node / 10 smoke / 80 browser. No stage
was reused. Final credential/diff/broad scans and source postcheck did not run.
An independent post-run check verified all 105 frozen paths, base `4b00099`,
the unchanged independent hosted receipt, exact dirty paths and empty index.
The runner ended and no local test listeners remained; no process was stopped.

`knowledge-followup.spec.ts:36` reads `calls[0].body` immediately after the
save click and finds no recorded request yet. `web-publication.spec.ts:59`
waits for version 1 after the history-button click until the 120-second test
timeout. Its trace shows successful publication and quick 200 responses, but
no subsequent page-history request. These are initial diagnostic observations,
not a completed root-cause finding. Neither expected text nor test timeout is
changed. Source and traces are preserved in
`artifacts/unified-workspace/w6/failed-run-20261112-1208/`, including the exact
stage logs, source manifest and `archive-receipt.json`. W6 remains uncommitted;
P1 implementation and subsequent integration remain pending. Hosted TEST is
unchanged.

Trace review identifies two synchronization gaps. The knowledge save click
returns at 589790 ms; the existing route fixture receives and fulfills the
intended POST at 589797 ms, after the synchronous payload assertion has already
failed. The publication click reports the target's final bounding box while
the compositor still shows the sandboxed preview at that position. Original
trace frames at 1404064 and 1404091 ms show the preview followed by the settled
history button; the failed page snapshot has focus inside the iframe. No
history request or permission denial follows the missed click.

Prepared, not applied: `mobile-async-scroll.proposed.patch` adds a polling
assertion for exactly one recorded save before the unchanged payload assertion,
and explicitly scrolls the unchanged history-button locator into the viewport
before its ordinary click. The latter follows the existing publication-click
helper. No forced click, sleep, timeout increase, selector replacement,
application change or weakened assertion is proposed. Both test files are
outside the 105-path lease, so a single grouped 105-to-107 lease request is
pending. This is a request for synchronization fixes, not another status/alert
selector amendment. Proposed file hashes are in
`mobile-async-scroll.proposal.json`. No patched test run or gate restart occurs
before the owner's decision.

### W6 mobile synchronization lease applied; final browser reruns - 12 November 2026

The owner approved the grouped 105-to-107 test lease request with the paused
session's 12:13 report, and the sole lead session (the owner paused the other)
verified both ui-390 failures, the patch scope and the fresh-gate evidence
before applying. `mobile-async-scroll.proposed.patch` (SHA-256
`b2ddead3dbcf9cde17c5e5bc52dd1a62e9006d67ceee9d35e1e620da21134e90`) was
applied with `git apply --ignore-whitespace`; the resulting diff contains
exactly the polling capture wait in `tests/ui/knowledge-followup.spec.ts` and
the scroll-into-view plus viewport settle before the unchanged history-button
click in `tests/ui/web-publication.spec.ts`. Selectors, expected payloads,
permission checks and timeouts are unchanged; the final-selector boundary is
untouched. Receipt: `lease-amendment-20261112.json`.

Plan: focused rerun of both amended specs at both widths, then the complete
browser suites at 1280 and 390 and the final credential/diff/broad scans. The
fresh full gate's typecheck, offline build, production (4), API (2,654 passed,
11 existing skips, six warnings), DB (95 Node, 44 SQL suites, 24 concurrency)
and H1 (69 Node, 10 smoke, 80 browser) stages are retained; their inputs do not
include the two amended browser specs. Both complete browser suites rerun on
the amended specs, including desktop; the prepared supplemental H1
scope-preview captures run after the complete gate passes.
