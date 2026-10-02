# 27. Hosted TEST environment — Step 1 plan

Date: **2 October 2026 (Asia/Bangkok)**. Status: **approved for H1 local implementation and simulation; hosted execution awaits IT readiness confirmation**.
Repository baseline: `931b67c`, including brand logo uploads and migration `0024`.
Target: **only** Supabase project `eqlrtevwpyboplljgowo`
(`https://eqlrtevwpyboplljgowo.supabase.co`), with synthetic data.

The owner approved this document with the production and milestone additions below.
Build and test H1 locally first. No hosted connection (including preflight),
migration, bucket, Auth user, seed, deployment, purchase or credential change is
authorized until the owner confirms that IT inputs and credentials are ready.
Earlier permission to try the P1 test setup does not bypass this new gate.

This plan extends the historical [P1 setup](ads/SUPABASE_TEST_SETUP.md).
It preserves the [naming contract](19-campaign-naming-registry.md),
[asset and logo rules](12-brand-project-mapping.md),
[document boundary](21-ememo-archive-and-search.md) and
[open decisions](ads/OPEN_QUESTIONS.md). REM, DW, E-memo and all source sheets
remain read-only. **RAG is out of scope: no indexing, embeddings or ingestion work.**

## 1. Owner evidence: parameter grant denied

The owner reported that Supabase SQL Editor rejected this statement:

```sql
GRANT SET ON PARAMETER app.ads_test_issuing TO postgres;
```

Actual owner-supplied result:

```text
ERROR 42501 permission denied for parameter app.ads_test_issuing
```

This is owner-reported evidence, not a command rerun during this planning task.
The original preflight **could not pass as written**. Migration `0014` creates
`ads.require_issuance()` with function-local `SET app.ads_test_issuing='off'`;
creating that configuration requires the unavailable parameter privilege.
The historical attempt stopped before applying Hub migrations. Recheck actual
remote history after approval; do not assume the project remains unchanged.

A forward migration alone cannot repair an error that prevents `0014` from
finishing. Removing its function-local setting while still trusting a caller's
session GUC would allow a forged setting to enable issuance and is unacceptable.
The plan does not seek superuser access or give runtime users owner privileges.

## 2. Smallest compatibility change and replay contract

### 2.1 Decision: a hosted-only bootstrap variant

**Keep canonical `supabase/migrations/202609290014_ads_registry.sql` unchanged.**
H1 adds a separately reviewed, versioned SQL deployment input under
`supabase/hosted-test/`, outside the normal migration scan. It replaces `0014`
only for this allowlisted TEST project. This avoids changing an already-applied
local migration or weakening the existing local issuance guard.

The variant changes only the issuance-setting mechanism:

- Extend the `ads.setting` key constraint to include `hosted_test_issuing_enabled`
  alongside `sena_h_approved`; both values are JSON booleans and start **false**.
- Replace the function-local custom GUC with a database setting read in
  `ads.require_issuance()`. Update `ads.test_issuing_enabled()` consistently.
  Ignore session-supplied `app.ads_test_issuing` entirely in this variant.
- Make the hosted `ads.test_issuing_enabled()` a narrowly scoped SECURITY DEFINER
  boolean helper owned by the non-login registry owner, with fixed `search_path`
  and the required narrow SELECT grants. It is currently SECURITY INVOKER;
  preserve existing EXECUTE grants without granting agencies raw setting or
  deployment-table reads.
- Require both the private deployment identity (`environment=hosted-test`, exact
  project reference and approved compatibility profile) and the TEST flag for
  the override. A missing or mismatched identity/setting fails closed. The
  function owner receives only the narrow read access needed for this check;
  application roles cannot change deployment identity.
- Keep fixed function `search_path`, forced RLS, existing name grammar, server
  generation, sequence/concurrency controls, frozen names and audit triggers.
  The existing SQL function `ads.set_approval()` continues to address only
  `sena_h_approved`.
- Restrict TEST-flag changes to the deployment operator. No browser/API role,
  including application `admin`, can toggle it, call an operator toggle, assume
  its owner role or modify it through a generic setting endpoint. Narrow writer
  policies/grants so existing registry functions cannot write this key.
  Record operator identity, reason, timestamp and evidence using the existing
  setting fields and `audit.record_change`; retaining a false value must not
  clear that history.

The runner must **not enable either flag** during migration, replay or user
provisioning. A later milestone may propose an explicit operator action to enable
the TEST flag for a synthetic registration exercise. **H1 never enables it**,
including while seeding. That would not be P'Note's approval. Keep `sena_h_approved=false` and
the Thai pending-approval banner throughout; hosted UI also identifies TEST
data. Production issuing remains blocked. Seeded names never become production
registrations and must never be copied into production.

### 2.2 Checksums, provenance and local databases

The deployment history must record the canonical migration name and SHA-256,
the **executed variant's separate SHA-256**, compatibility-profile version,
project/environment identity and application timestamp. Do not pretend the
canonical bytes were executed, replace SQL strings silently, bypass a checksum
mismatch, or mark a failed migration applied. Validate the variant against its
canonical baseline and review its narrow diff in tests.

| Database state | Planned replay behavior |
|---|---|
| Fresh allowlisted hosted TEST | Verify all source/profile checksums; execute the explicit `0014` variant in its migration transaction; record both hashes atomically. |
| Exact hosted TEST replay | Verify canonical and executed hashes plus target/profile; no SQL reapplied and no flag/password reset. |
| Unknown history, changed hash or other project | Refuse before mutation; require an explicit reconciliation plan. An already-applied canonical hosted `0014` is not silently relabelled as the variant. |
| Existing local database | Original `0014` remains byte-identical, so `public.local_migrations` still matches; ordinary `dev:migrate` skips it. The local-only function GUC override remains as implemented. |
| Fresh local database | Apply canonical migrations through `0025` and existing local fixtures through the existing local tools. Canonical `0014` remains unchanged; the hosted variant is never scanned or loaded. |

No local history rewrite, database rebuild or reapplication of `0014` is needed.
Shared hosting adapters use new global migration numbers after
`0024` (H1 adds `0025`), preserve local behavior, and replay normally on
local databases. They do not retroactively solve the bootstrap failure. The
profile difference must be documented and covered by the same issuance tests.

## 3. Migration runner, storage and DW provisioning

### Production path (design only)

A future production Supabase project will use the same reviewed settings-table
bootstrap mechanism for `0014`, avoiding the denied custom-parameter privilege.
Use one explicitly versioned settings-based SQL baseline and narrowly reviewed
profile overlays: the production profile contains only `sena_h_approved=false`,
no TEST-setting row/key, no TEST override and no synthetic seed. Its issuance
guard checks actual pattern approval only; `ads.test_issuing_enabled()` returns
false. Production target identity must be separately allowlisted and approved.
Record canonical and executed profile checksums exactly as for TEST. Do not
implement production provisioning in H1, copy the TEST profile to production,
or modify canonical local `0014`. A future local convergence migration can reuse
the same settings implementation without rewriting applied history.

### H1 and H2+ milestones (owner decision)

| Milestone | Included | Explicit boundary |
|---|---|---|
| H1, implement and test locally now | Managed-permission migration profile; private residential/brand asset storage; real Supabase session integration with seven role identities simulated locally; synthetic brands, projects, promotions and atomic releases; registry browsing and agency ID-return inbox. | Issuance stays off, `sena_h_approved=false`. No real REM identifiers. No hosted requests, resources, users or seed until owner confirms IT readiness. |
| H1, later hosted execution | Run the locally verified H1 package on the named TEST project after that confirmation; provision the seven real TEST Auth identities then. | Not authorized by document approval alone. Supabase Free and the existing VPS only; no TEST plan purchase or Vercel project. |
| H2+ | Hosted financial operations/actuals, document tracking/archive/worker, assistant and any separately approved DW provisioning. | No implementation of their hosted adapters in H1; show unavailable Thai remarks and reject direct API access. R2/document processing and all RAG/indexing/embeddings/ingestion stay deferred. |

The complete migration history still applies so schema provenance remains
consistent, but deferred schema objects stay empty/inactive. Existing local demo
behavior is unchanged. H1 screens use the current theme and motion tokens;
deferred pages show `ยังไม่เปิดใช้งานใน H1` with their later milestone. Campaign
registration controls remain disabled with the approval/issuance explanation.
The seven identities in section 4 are local mock Auth identities for tests now,
not accounts created in Supabase. Local simulation uses an isolated loopback
database and Auth/storage doubles; it must never load `.env.supabase-test`.

### 3.1 Expand the reviewed migration inventory

The baseline `scripts/supabase-test-migrations.mjs` was pinned to exactly fourteen
files. H1 replaces the file-count, history, schema, role and ownership assumptions
with a reviewed ordered manifest of **25 migrations**, including the new adapter:

| Counters | Contents |
|---|---|
| `0001–0006` | Residential core, edit locks, source selection, publication availability, asset library and brands. |
| `0007–0013` | Intake/staging, project prefill, model media, marketing unit types, facilities, preview and media collections. |
| `0014` | Ads registry; explicit hosted TEST compatibility variant above. |
| `0015` | Media lines, memos, card costs and recurring commitments. |
| `0016–0020` | Actuals/read-back, permissions, recurrence, boundaries and evaluation history. |
| `0021–0023` | Residential releases, private document archive and staff assistant schema. |
| `0024` | Safe brand-logo SVG registration. |
| `0025` | H1 private asset metadata and narrow residential environment adapters; original archive/assistant guards remain unchanged. |

Discover files, but reject unreviewed additions instead of automatically applying
whatever appears in the directory. Expand the manifest explicitly for later
hosting migrations. Preflight remains read-only and default; apply stays an
explicit, named-project operation after approval. Use verified TLS and the actual
Direct or Session pooler connection from Supabase Connect. Never disable
certificate/hostname verification, infer the project's region, or print a URI.

Keep the deployment lock, per-migration transaction and atomic history write.
Generalize temporary owner memberships/schema CREATE rights beyond `0014`:
`0015` uses `ads_finance_writer` and existing export owners; `0016–0020` create
or replace functions owned by `ads_actuals_writer` in `ads`/`staging`. Inventory
`ads_document_worker` from `0022` too. Capture prior grants, restore them before
commit, and roll back both DDL/history and temporary privileges on failure.
Do not grant these owner/worker roles to the ordinary API login.

The API `hub_runtime` remains LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, with only the seven actor-role
memberships required for transaction-local role selection. Preserve passwords on
replay. Operator, API, document worker and DW credentials are separate.

### 3.2 Private storage is an additional deployment resource

No current migration provisions hosted buckets. Migration `0025` retains
`local-originals`/`hub-local` and permits `hub-test-assets`/`hub-hosted-test` only
through the exact hosted TEST profile. The private Supabase asset adapter is
implemented and verified against the local Storage protocol double, retaining
all rights, eligibility, deduplication, history and audit rules. Local assets
still use `.local/assets`; actual cloud bucket provisioning remains pending.

- Residential/brand assets: a private Supabase TEST bucket, proposed name
  `hub-test-assets`, with no anonymous read/write/list policy. Authenticate and
  authorize every Hub upload and read; keep original bytes private. The API
  validates and sanitizes SVG **before** storage. Retain safe MIME, CSP and
  `nosniff` on delivery. Do not let a browser upload unvalidated SVG directly
  into an eligible registry object or bypass the existing rights gate.
- Memos/statements: a separate private R2 TEST bucket, proposed name
  `sena-hub-test-documents`, following doc 21. No public bucket URL, public
  `r2.dev`, public index or statement search index. Only synthetic fixtures;
  Q7 still gates any real document. Every authorized view/download is audited.
- Record bucket identifiers, privacy settings and policy/version checksums in a
  deployment resource manifest. Existing matching resources are reused; a
  conflicting/public resource causes refusal. Provisioning R2 is a separate
  infrastructure step, not PostgreSQL SQL, and requires scoped credentials.

H1 implements authenticated direct-to-API upload/file delivery with strict
TEST-origin checks and existing validation, RLS and audit. Under the VPS decision
in section 5, those API paths share the admin's HTTPS origin and go directly
through the reverse proxy to FastAPI. Keep transport limits compatible with the
Hub's existing 10 MiB file limit; Vercel function limits do not apply to TEST.
The browser uses its user JWT, never a storage service key; normal small JSON
calls retain the Next.js proxy. Image/link elements cannot attach bearer headers, so H1
uses authenticated fetch-to-Blob previews/downloads, never JWTs in query strings.
Uploads and downloads are verified locally; VPS delivery and managed Storage
policies await the approved cloud acceptance run.

### 3.3 Hosted DW reader (H2+, deferred)

Keep `scripts/provision-dw-reader.mjs` strictly local, including its
`127.0.0.1:55432/sena_hub_local` refusal guard. Add a separate approved hosted
provisioning path, scoped to this project and verified TLS, for `dw_hub_reader`:

- LOGIN INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
  NOBYPASSRLS, CONNECTION LIMIT 2; membership **only** in `ads_export_reader`.
- `default_transaction_read_only=on`; no base-table, private-schema, write or
  actor/owner-role grants. Read-only defaults supplement ACLs, not replace them.
- Generate a separate random password of at least 32 base64url characters;
  retain it unless explicitly rotated. Deliver through IT's secret store;
  never reuse or commit `.local/dw-reader.json`, show a password or put it in
  shell arguments. Validate ownership, memberships and unexpected grants.
- Verify SELECT on all 15 `ads_export` views in one read-only transaction;
  deny `ads`, `staging`, `audit`, `hub` and other private base-table access;
  prove writes fail even after attempting to disable the read-only default.
  Check role-switch denial and connection settings. No DW writes or schedules.

## 4. Real login and TEST identities

The API verifies Supabase ES256/RS256 JWT signatures, issuer/audience and trusted
`app_metadata.hub_role`, plus `hub_agency` for agencies. H1 implements browser/SSR
login, refresh, sign-out and the verified server proxy; these are tested with the
local Auth protocol double. Actual cloud Auth configuration and signing keys
remain unverified until the approved hosted acceptance run.

The implementation uses Supabase browser/SSR sessions and allowlisted redirect
URLs through the supported server-side session flow. The server verifies the
user/session; the API independently verifies the forwarded
access token. Do not authorize from an unverified cookie/session payload or
client-selected headers. Use secure session-cookie settings appropriate to the
SSR flow and protect cookie-authenticated mutations against cross-site requests.
[Supabase server-side authentication](https://supabase.com/docs/guides/auth/server-side).

H1 adds explicit `hosted-test` configuration with exact project/HTTPS API-origin
checks, plus tightly bounded loopback targets for the local simulation. The
local selector remains behind its loopback/local-mode guard. Hosted requests
reject demo tokens, role-selector cookies and forged role headers. Do not label
hosted TEST as local or use production mode to evade a guard. Confirm the project's
signing algorithm is supported; do not add an HS256 fallback casually.

Create the following separate, invite-only identities only after IT readiness
confirmation. H1 currently simulates them locally. Names here
are account labels, not real email addresses; IT supplies controlled test mailboxes
and sends credentials privately. Disable public self-sign-up for this TEST app.

| Account label | Trusted `hub_role` | Additional metadata | Acceptance focus |
|---|---|---|---|
| `hub-test-editor` | `editor` | None | Draft editing/upload; cannot publish or grant rights. |
| `hub-test-publisher` | `publisher` | None | Publish/review and per-file rights records; existing permission matrix. |
| `hub-test-viewer` | `viewer` | None | Read-only staff review; cannot edit/publish. |
| `hub-test-admin` | `admin` | None | Existing steward/admin operations; cannot enable TEST issuance. |
| `hub-test-online` | `online_staff` | None | Registry and marketing-ops operations; no memo approval authority. |
| `hub-test-agency-kin` | `agency` | `hub_agency=KIN` | Own campaign names and permitted ID returns; no assistant/budgets/memos. |
| `hub-test-agency-combay` | `agency` | `hub_agency=COMBAY` | Cross-agency isolation against KIN. |

Provision `service_consumer` separately if needed for API-only published-data
checks; it gets no staff browser session. The DW login is PostgreSQL-only, not
an Auth user. Test identities with missing/invalid metadata must fail closed.
Only an authorized Auth administrator/server assigns `app_metadata`; editable
`user_metadata` is never authority. Use the Auth UUID as audit actor and canonical
agency vocabulary codes, not local selector aliases such as `agency_kin`.

The Next.js admin service on the VPS receives only the public Supabase
URL/publishable key and necessary server-side API configuration. The browser
never receives migration, database,
storage or service-role secrets. The VPS API uses the restricted runtime login.
Auth-admin provisioning and storage-service credentials stay in separate scoped
operator/server configuration. Leave local `.env` files and credentials local;
copy no environment file wholesale to hosting or Git.

## 5. Hosting topology and remaining application work

**Owner cost decision, 2 October 2026:** use Supabase Free and the existing
Hostinger VPS for both admin and API. No Vercel TEST project or paid plan is
requested. This changes the hosting plan only; the IT-readiness gate still
applies before any hosted connection or provisioning.

| Piece | Selected TEST location | Required work before hosted use |
|---|---|---|
| Admin | Same Hostinger VPS as FastAPI | Build Next.js and run `next start` as a supervised service bound to loopback, behind the HTTPS reverse proxy. Real login, trusted API proxy and visible TEST/synthetic labels; no Vercel project. |
| Database/Auth/assets | Existing Supabase TEST project on Free | Versioned migration profile, private asset storage, role setup and synthetic seed; verify region and capacity with IT. Manually resume if paused before a demo. |
| FastAPI | Same Hostinger VPS as admin | Separate restricted service, loopback listener, shared HTTPS origin, secrets, bounded DB pool, logs without tokens/bodies, health checks and restart policy. |
| Document worker — H2+ | Separate process on the VPS | Deferred beyond H1: narrow `ads_document_worker` credentials, durable leases, private temporary storage, local parsing/OCR only. No web-request OCR or external model calls. |
| Document bytes — H2+ | Private R2 TEST bucket | Deferred beyond H1: scoped storage adapter and reproducible synthetic fixtures; no real upload before Q7. |
| Assistant | Future approved VPS TEST path | Existing guard is fixed-local. Leave disabled with a Thai remark until reviewed; no key transfer or retrieval/indexing work in this step. |

Use one IT-controlled TEST hostname and HTTPS origin for the admin and Hub API:

| Public path | Reverse-proxy destination |
|---|---|
| `/v1/*` and `/health` | FastAPI on its private loopback port; preserve the path and bearer authorization. |
| All other paths, including `/api/hub/*`, `/login` and `/_next/*` | Next.js `next start` on its private loopback port. `/api/hub/*` retains its existing session verification and API forwarding. |

Do not route all `/api/*` paths to FastAPI: the existing Next.js API routes must
continue to verify browser sessions. Set `HUB_ADMIN_ORIGIN` and `HUB_API_URL` to
the same public HTTPS origin (no path prefix), with matching Supabase Auth
redirect URLs. Direct asset requests use `/v1/...` on that origin and still
require a verified user JWT. Supabase Auth/Storage retain their own service
URLs; this same-origin decision covers admin-to-Hub-API traffic.

Only the reverse proxy exposes HTTPS publicly. Keep Node and FastAPI ports
private, preserve host/protocol and authorization headers through trusted proxy
configuration, and do not cache authenticated pages or private API/file responses.
Use separate service environments and restart policies. Verify login refresh,
JSON calls, uploads and private downloads through this routing during the later
hosted acceptance run. Next.js documents `next start` self-hosting behind a
reverse proxy. [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

Migration success is not hosted-demo readiness. These existing safeguards need
explicit target-aware adapters and tests, rather than deletion:

- `0025` adds narrow residential environment adapters for the exact hosted TEST
  profile, and H1 supplies its own synthetic seed. The original local seeder
  still requires a true superuser and must not be run against managed Supabase.
  The `0016` actuals, archive and draft-assistant local guards remain unchanged.
- H1 asset routes support the exact hosted TEST profile through the private
  adapter. `actuals.py`, `archive.py`, `assistant.py` and the document worker
  retain their local boundaries; their hosted paths are unavailable in H1.
  Any later adapters must preserve target checks and synthetic provenance.
- `ads.py` preserves local TEST issuance behavior but reports `can_issue=false`
  for hosted H1. H1 API startup requires both flags to remain false; preview and
  issue controls are unavailable. Any later TEST issuance exercise needs an
  explicitly approved API/UI change as well as operator controls. The Thai
  pending-approval banner remains visible with `sena_h_approved=false`.
- Statement OCR uses Windows OCR today. A Linux Hostinger worker needs a tested
  local OCR adapter before image-only synthetic statements can run there. Until
  ready, show the feature as unavailable; use the existing local demo for it.
- `0022` defines existing search tables, and memo confirmation currently writes
  `ads.archive_memo_chunk`. Applying its schema must not activate or populate an
  index. Keep those tables empty and indexing jobs disabled. Do not run the
  existing confirmation/seed path unchanged on hosted TEST. A later approved
  non-indexing confirmation path is needed before enabling that action; no RAG
  implementation is included in this plan.

IT must provide the actual Supabase/VPS/storage regions (Q7/Q37),
approved account access with MFA, a restricted SSH/service account, OS/resources,
firewall rules, outbound Supabase/storage access, domain ownership/DNS/TLS,
secret custody, monitoring and demo-recovery owners, and the existing VPS billing
owner. Use one `hub-test` hostname under an IT-controlled domain for both admin
and API; no separate `hub-api-test` hostname is required. No domain is assumed
or registered here. Confirm capacity for both services without buying an upgrade.

**Temporary option:** IT may provide a time-limited dedicated TEST VM with
persistent storage behind its approved HTTPS gateway, running both the Next.js
admin and H1 API with the same routing until Hostinger is ready. This option
requires existing approved capacity, not a new purchase. Document workers remain
H2+. Apply the same secrets, access and regional review. If IT cannot provide
that environment, keep the presentation local. No VM, tunnel, gateway or Vercel
project is provisioned in this step.

## 6. Synthetic seed and acceptance sequence

**Default: do not copy staged HYABC REM identities.** Those are real source
identities even when surrounding text is synthetic. IT/data-owner confirmation
is required before any such copy. Until then use new, clearly fictional project,
brand, model, scope, account and document identifiers with valid schema shapes;
label all content `ข้อมูลตัวอย่าง`. Preserve IDs as text and business months as
first-day dates in Asia/Bangkok. Never relabel a real import as synthetic.

Build a dedicated reviewed seed package with a manifest of generated fixture
hashes, counts, relationships and snapshot time. Do not dump the local database,
copy `.local`, or run the current local seeder against Supabase. Include coherent
residential, campaign, budget, memo, cost and TEST read-back examples only when
their hosted adapters exist. LINE OA stays in its unattributed CHANNEL bucket;
Q18/Q20 remain deferred, with no matching-review screen. No real ledger, card,
DW, E-memo, publication target or email-recipient data is copied. Use demo months
for presentation rather than far-future DW contract-coverage months.

Phased order: steps 1–2 are authorized locally now. Steps 3–6 await the owner's
separate IT-readiness confirmation and cover H1 only; deferred modules need H2+.

1. Implement and test the bootstrap variant, full runner and profile locally in
   a disposable managed-permission simulation with no custom-parameter grant.
   Verify canonical local replay as well as hosted-profile replay.
2. Implement hosted authentication/storage and the specifically enabled module
   adapters. Keep unavailable modules explicit. Rerun typecheck, build, DB/API
   suites and Edge UI tests, including logo rights/SVG and agency isolation.
3. Reconcile actual hosted state with a read-only preflight; print target and
   safe counts/checksums only. On a clean accepted target, apply the reviewed
   manifest. Confirm both issuance flags are false before proceeding.
4. Provision private asset storage and separate operator/runtime credentials
   and the seven Auth test identities. Validate permissions and exact replay.
   Document-worker/R2 and DW provisioning remain H2+.
5. Apply only the approved H1 synthetic seed, with SQL-generated fixture codes
   and names inserted by the deployment operator. No issuance function is called,
   and neither flag is enabled. The seed has explicit synthetic provenance and
   is not a registration or approval workflow. Record source hashes/counts.
6. Deploy isolated TEST services and run authenticated smoke/role checks. Test
   expired/forged JWTs, metadata tampering, missing role, agency boundaries,
   private downloads, sanitized SVG, per-file rights/audit, failed-migration
   rollback, checksum refusal, denied flag changes and blocked issuance while
   off. Check desktop/mobile layouts, manual paused-project resume and a
   synthetic rebuild/re-seed rehearsal under section 7.

No existing `dev:migrate`, `test:db`, API integration test or UI suite is to be
repointed at hosted TEST. Hosted smoke checks need separate explicit targets and
synthetic-only fixtures; do not let a routine local command mutate the cloud.

## 7. Cost, demo recovery and teardown

**Owner decision: Supabase Free, existing Hostinger VPS, no purchase.** The
earlier Pro/Vercel TEST estimate and TEST backup proposal are superseded. The
decision does not claim the current account configuration has been inspected
or changed; that check remains behind the IT-readiness gate.

| Service | TEST decision and cost |
|---|---|
| Supabase Free | Selected: $0/month within Free limits. Keep synthetic fixtures within its 500 MB database and 1 GB file-storage allowance; accept inactivity pausing. No Pro upgrade or paid add-on. |
| Hostinger VPS | Reuse the existing VPS for admin and API after IT confirms capacity. Existing VPS/domain costs still apply; this decision authorizes no new server or upgrade. |
| Vercel | No TEST project, deployment, subscription or seat purchase. |
| R2, document worker and assistant | H2+ remains deferred; no resource purchase or external model/OCR spending in H1. |

Free limits and pausing were checked on **2 October 2026**.
[Supabase pricing](https://supabase.com/pricing). No new Supabase or Vercel
subscription cost is planned; this does not make the existing VPS or domain free.
Revisit **Supabase Pro and, optionally, Vercel Pro only for production**, with a
separate architecture, availability, backup/retention and budget decision.

### Before each demo: manually resume if paused

The demo operator checks the Supabase Dashboard ahead of the presentation. If
the Free project is paused, manually choose **Resume project**, wait until it is
ready, and check API health, login, private assets and registry browsing. Do not
wait until the presentation starts or add a paid upgrade/keep-alive schedule.
A normal resume retains data/configuration; it is not a reason to reset or
re-seed healthy data. [Supabase project pausing and resume](https://supabase.com/docs/guides/platform/free-project-pausing).

### Recovery: re-seed synthetic data instead of backing it up

TEST data and demo edits are disposable. Do not schedule database dumps, object
backups, pre-change exports or rotating backup retention for this environment.
Keep the reviewed migrations, seed generators and non-secret manifests in Git;
keep access credentials separately in IT's secret custody. Recover lost/reset
TEST data from those versioned inputs, not from a saved database or bucket dump.

For an explicitly authorized empty/rebuilt TEST target, replay the reviewed
profile, provision the private bucket and required role identities, regenerate
the synthetic asset bytes, and apply the H1 seed. Verify fixture hashes/counts,
the seven roles and both false issuance flags. Exact seed replay on an intact
database stays a no-op; it does not erase edits or reset migration history.
If the project cannot be resumed, agree the rebuild/target with the owner first;
the allowlisted project guard must never be bypassed to seed a replacement.
No destructive reset or hosted operation is authorized by this documentation
change. Real data is still excluded; production retention and backups need
their own decision.

Teardown is a later explicit owner action against this exact TEST inventory:
disable issuance and logins, stop the TEST admin/API and any later worker/DW
access, discard disposable synthetic data, remove TEST Auth identities, revoke/rotate dedicated
credentials, remove TEST deployments/DNS and private buckets/objects after
checking holds, then delete the dedicated Supabase project if authorized.
Delete only TEST VM resources, not a shared VPS or another app. Cancel
any separately approved later subscriptions and verify billing; resource removal
does not prove subscription cancellation. No paid TEST subscription is selected
by this plan. Record the removal inventory.
Nothing is torn down now.

## 8. Approval scope and outstanding inputs

`docs/27 approved` accepts H1 local implementation and verification; it does not
record P'Note approval, IT readiness, a real-data/DPO decision or a paid purchase.
Even hosted read-only preflight waits for the owner's IT-readiness confirmation.

| Input | Owner | Default until answered |
|---|---|---|
| Accept explicit hosted `0014` profile and TEST-flag controls | Hub owner | Approved for H1 local implementation; both flags stay false. Hosted preflight still waits for IT readiness. |
| Regions, access, shared-origin domain/TLS, secret custody and demo recovery | IT; DPO for Q7/Q37 | Local presentation continues; no guessed infrastructure or real-data transfer. Synthetic TEST data is re-seeded, not backed up. |
| TEST cost and existing VPS capacity | Hub owner + IT/Finance | Decided: Supabase Free and admin/API on the existing Hostinger VPS; no Vercel TEST project or purchase. IT capacity/access confirmation is still pending. Paid plans are revisited only for production. |
| Test mailboxes and authorized testers | IT + Hub owner | No users or invitations created. |
| Copy of real HYABC REM identity | IT/data owner | No; use new fictional identities. |
| Real documents/internal-data processing | DPO/data owner, Q7/Q36 | Synthetic only; no external OCR/LLM, RAG, indexing, embeddings or ingestion work. |

Hosted preflight, migrations, Auth provisioning, storage provisioning and cloud
smoke tests are **not run**. Local H1 validation uses a disposable non-superuser
PostgreSQL simulation plus loopback Auth/Storage protocol doubles. It does not
claim a real Supabase Auth service or managed Storage policy has been tested.

## 9. Local H1 package

Implementation details and actual local check results are recorded in the
[H1 implementation report](ads/H1_IMPLEMENTATION_20261002.md). Cloud
provisioning remains pending; local simulation results do not establish that
the hosted project's Auth, Storage policies or infrastructure are ready.

Build the admin first, then run `npm.cmd run test:hosted-h1`. This creates a fresh
disposable cluster on `127.0.0.1:55434`, reproduces the denied parameter grant,
applies the profile, verifies replay/rollback/permissions, seeds synthetic data,
and runs Edge against local Auth/Storage (`54329`), API (`8001`) and admin (`3001`).
The harness refuses occupied ports and never reads `.env.supabase-test`. Private
connection metadata stays in ignored `.local/hosted-test-simulation/current.json`.
The normal local demo remains on ports `55432`, `8000` and `3000`.

`npm.cmd run dev:hosted-h1` starts the same disposable package for a local demo;
stop an existing H1 run before starting another. Ctrl+C stops owned processes.
Use one of the seven `hub-test-…@example.test` accounts from
`scripts/hosted-test-fixtures.mjs` with its clearly synthetic fixture password.
These accounts and public fixture values cannot authenticate to any hosted project.
The local mock models the documented SSR refresh-token reuse interval;
it is a protocol test double, not an Auth implementation for deployment.
[Supabase refresh behavior](https://supabase.com/docs/guides/auth/sessions).

The seed creates one fictional brand, project, model and promotion, three private
generated images, one atomic release and two campaign examples (KIN/COMBAY).
It uses no real REM identities. An exact replay leaves existing demo edits alone;
a changed seed checksum refuses to apply. Temporary operator policies and role
grants are restored within the transaction. The profile and seed SQL files use
stable bytes via `.gitattributes` so checkout line-ending conversion cannot alter
their recorded checksums.
