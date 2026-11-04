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
| W1 | Service shell, logo, theme, collapse, overflow fix; assistant leaves sidebar | None | Agent A `w1_shell`; full gate passed, lead commit/push next |
| W2 | Global search, floating assistant, home greeting and read-only personal tasks | W1 merged | Lead; planned |
| W3 | Entity tree/pages, reused sections, readiness deep links, FAQ, inline suggestions/N7, media, history, Admin activity, redirects | W1 merged | Agent A after W1; lead does initial route map |
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

### Wave 2 briefs — activate only after W1 is committed

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

Lock owner: lead only. State: **free — W1 full gate completed and runners cleaned up**.
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

- Commit/push: full gate passed; the implementation commit is made immediately
  after this entry. Its exact hash and push receipt follow in the delivery log.
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
