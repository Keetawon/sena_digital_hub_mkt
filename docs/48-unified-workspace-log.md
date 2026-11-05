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
| W2 | Global search, floating assistant, home greeting and read-only personal tasks | W1 merged | Lead; implementation started from `2387dd3` |
| W3 | Entity tree/pages, reused sections, readiness deep links, FAQ, inline suggestions/N7, media, history, Admin activity, redirects | W1 merged | A UI / C backend; new worktrees at `2387dd3` |
| W4 | N1 governance, per-item approve/return, FAQ withdraw, N2 publisher boundary, N6 single queue | Backend independent; UI after W3 | Agent B `w4_governance` backend; lead UI integration |
| W5 | Fixed business level and composition order | W4 merged | Agent B after W4; planned |
| W6 | BUD scopes, dated daily BU sync and account scope controls | W4 merged; migration lane after W5 | Lead with Agent B after W5; planned |
| W7 | Stub-only writing aid, registry flag, budget and diff UI | Backend independent; UI after W3 | Agent C `w7_writing`; backend prepared, runtime gate after W6 |
| W8 | Thai UAT pack covering all docs/47 flows; final full gate | W1–W7 | Lead; planned |

Wave 1 uses three agent slots (A/B/C), with the lead doing W3 mapping, question
registration and integration preparation instead of a fourth agent. Wave 2:
W2 and W3 after W1; W4 UI after the W3 shell. Wave 3: W5, W6, then W7 integration.
Wave 4: W8 and the final gate. Merge order is W1 → W2 → W3 → W4 → W5 → W6 → W7
→ W8. Backend work can finish early but cannot bypass that merge order.

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
| 0086 | W5 | Fixed business list, new associations and composition support |
| 0087 | W6 | Object-aware content grant scopes and account preview/confirm |
| 0088 | W6 | Dated BU membership, guarded sync and notices |
| 0089 | W7 | Default-off writing eligibility and bounded budget/usage state |

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
| Endpoints / SQL | Existing account preview/confirm endpoints gain bounded scope input/diff/digest. Proposed GET `/v1/admin/accounts/content-scopes` and `/v1/admin/accounts/bu-sync-runs`; typed object-scope helpers, dated membership and sync run relations, account-manager-only notice projection. Exact discovered route/function/policy inventory required before W6 code |
| Rollout / verification | Fixture-only default-deny new scope operations; unchanged existing accounts. Exact `rem_bu_id` keys and unmodified code/name. Blank BUID projects unrestricted-only. Dynamic BU moves, project exceptions, mixed/shared scope, revoked caches, preview drift, every runtime deny/neighbour, replay and concurrency |

Daily sync: after DW 16:00 Asia/Bangkok relay; narrow project ID/BU fields/source
snapshot read only. Idempotent dated membership (`valid_from`, `valid_to`, source
snapshot, run). Failed/empty/>48-hour stale input preserves prior membership and
records a warning. Local fixtures plus reviewed 5 October package; no REM read,
DW repository change or business-sheet mapping. Hosted enablement remains STOP
until separately authorized and the dedicated credential is installed by owner.

W6 integration contract for W7: migration 0087 defines private
`hub.require_content_translation_scope(translation_id uuid, required_level text)`
returning void, with closed runtime EXECUTE. It resolves the tracked source,
current affected projects, owning tab and grant scope. W7 calls it for read,
request and completion in addition to its existing source/eligibility checks;
there is no fallback if the helper is missing.

Read-only preparation verified the staged 5 October manifest SHA-256 and
`gold_projects.json` payload hash/length/count: 278 rows, each with all six BU
fields in `gold`, keyed by outer `project_id`. Its exact BU-code counts match
docs/47, including 39 blank codes. The source snapshot is
`2026-10-05T02:50:00.717680+00:00`. Raw `projects.json` carries REM identity;
BU membership comes from `gold_projects.json`, not that raw identity file.
No database, source package or credential was changed.

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

Lock owner: lead only. State: **released — W2 final suites passed; W3 is next**.
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
