# 27. Hosted TEST environment — Step 1 plan

Date: **2 October 2026 (Asia/Bangkok)**. Status: **proposed; awaiting `docs/27 approved`**.
Repository baseline: `931b67c`, including brand logo uploads and migration `0024`.
Target: **only** Supabase project `eqlrtevwpyboplljgowo`
(`https://eqlrtevwpyboplljgowo.supabase.co`), with synthetic data.

This step writes a plan only. No hosted connection, preflight, migration, bucket,
Auth user, seed, deployment or credential change has been performed for this step.
The owner's latest instruction requires approval before implementation. Earlier
permission to try the P1 test setup does not bypass this gate.

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
The existing preflight **cannot pass as written**. Migration `0014` creates
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
After approval, add a separately reviewed, versioned SQL deployment input under
`supabase/hosted-test/`, outside the normal migration scan. It replaces `0014`
only for this allowlisted TEST project. This avoids changing an already-applied
local migration or weakening the existing local issuance guard.

The proposed variant changes only the issuance-setting mechanism:

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
provisioning. A later, explicit operator action may enable the TEST flag for a
synthetic registration exercise once the target and seed are verified, then
disable it again. That is not P'Note's approval. Keep `sena_h_approved=false` and
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
| Fresh local database | Apply original migrations through `0024` and existing local fixtures through the existing local tools. The hosted variant is never scanned or loaded. |

No local history rewrite, database rebuild or reapplication of `0014` is needed.
Shared hosting adapters introduced later use new global migration numbers after
`0024` (next currently `0025`), preserve local behavior, and replay normally on
local databases. They do not retroactively solve the bootstrap failure. The
profile difference must be documented and covered by the same issuance tests.

## 3. Migration runner, storage and DW provisioning

### 3.1 Expand the reviewed migration inventory

The current `scripts/supabase-test-migrations.mjs` is pinned to exactly fourteen
files. Updating only its file count would leave incorrect history, schema, role,
ownership and completion checks. Replace those assumptions with a reviewed,
ordered manifest of all **24 current migrations**:

| Counters | Contents |
|---|---|
| `0001–0006` | Residential core, edit locks, source selection, publication availability, asset library and brands. |
| `0007–0013` | Intake/staging, project prefill, model media, marketing unit types, facilities, preview and media collections. |
| `0014` | Ads registry; explicit hosted TEST compatibility variant above. |
| `0015` | Media lines, memos, card costs and recurring commitments. |
| `0016–0020` | Actuals/read-back, permissions, recurrence, boundaries and evaluation history. |
| `0021–0023` | Residential releases, private document archive and staff assistant schema. |
| `0024` | Safe brand-logo SVG registration. |

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

No current migration provisions hosted buckets. Asset metadata currently permits
`local-originals`/`hub-local`; the API stores bytes in `.local/assets`. Plan a
forward migration plus storage adapter, retaining local support and all rights,
eligibility, deduplication, history and audit rules.

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

Large uploads cannot simply keep using the current Next.js proxy: Vercel limits
function request/response payloads to **4.5 MB**, below the Hub's 10 MiB image
limit. Plan authenticated direct-to-API upload/file delivery on the VPS with
strict TEST-origin CORS and existing validation, RLS and audit. The browser uses
its user JWT, never a storage service key; normal small JSON calls can retain
the same-origin proxy. Image/link elements cannot attach bearer headers: plan
authenticated fetch-to-Blob previews/downloads or an equivalent reviewed private
delivery flow, never JWTs in query strings. Verify downloads as well as uploads.
[Vercel function limits](https://vercel.com/docs/functions/limitations#request-body-size).

### 3.3 Hosted DW reader

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

The API already verifies Supabase ES256/RS256 JWT signatures, issuer/audience
and trusted `app_metadata.hub_role`, plus `hub_agency` for agencies. The browser
login and server proxy are still local-demo implementations. Adding URLs alone
will not enable hosted login.

After approval, implement Supabase browser/SSR sessions, refresh, sign-out and
allowlisted redirect URLs using the supported server-side session flow. The
server must verify the user/session; the API independently verifies the forwarded
access token. Do not authorize from an unverified cookie/session payload or
client-selected headers. Use secure session-cookie settings appropriate to the
SSR flow and protect cookie-authenticated mutations against cross-site requests.
[Supabase server-side authentication](https://supabase.com/docs/guides/auth/server-side).

Add an explicit `hosted-test` configuration with exact project/HTTPS API-origin
checks: `auth.py` currently recognizes only `local` and `production`. Preserve
the local selector behind its loopback/local-mode guard. A hosted request must
reject demo tokens, role-selector cookies and forged role headers. Do not label
hosted TEST as local or use production mode to evade a guard. Confirm the project's
signing algorithm is supported; do not add an HS256 fallback casually.

Create the following separate, invite-only identities after approval. Names here
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

Vercel receives only the public Supabase URL/publishable key and necessary
server-side API configuration. The browser never receives migration, database,
storage or service-role secrets. The VPS API uses the restricted runtime login.
Auth-admin provisioning and storage-service credentials stay in separate scoped
operator/server configuration. Leave local `.env` files and credentials local;
copy no environment file wholesale to hosting or Git.

## 5. Hosting topology and remaining application work

| Piece | Proposed location | Required work before hosted use |
|---|---|---|
| Admin | Dedicated Vercel TEST project | Real login, trusted API proxy, separate environment/redirect URLs and visible TEST/synthetic labels. No production-domain reuse. |
| Database/Auth/assets | Existing Supabase TEST project | Versioned migration profile, private asset storage, role setup and synthetic seed; verify actual region with IT. |
| FastAPI | Hostinger VPS | Dedicated service user, HTTPS reverse proxy, secrets, bounded DB pool, logs without tokens/bodies, health checks and restart policy. |
| Document worker | Separate process on the VPS | Narrow `ads_document_worker` credentials, durable leases, private temporary storage, local parsing/OCR only. No web-request OCR or external model calls. |
| Document bytes | Private R2 TEST bucket | Scoped storage adapter and separate object backup; no real upload before Q7. |
| Assistant | Future approved VPS TEST path | Existing guard is fixed-local. Leave disabled with a Thai remark until reviewed; no key transfer or retrieval/indexing work in this step. |

Migration success is not hosted-demo readiness. These existing safeguards need
explicit target-aware adapters and tests, rather than deletion:

- `0016` actuals and `0021` residential demo guards require the local database;
  the residential seed helper also requires a true superuser. Archive and draft
  assistant operations reuse local guards. Managed `postgres` cannot simply run
  the current demo seeder.
- `actuals.py`, `archive.py`, `assistant.py`, asset routes and the document worker
  enforce local execution. New hosted TEST paths must verify the allowlisted
  environment and synthetic provenance, while preserving current local behavior.
- `ads.py` reports TEST issuance only in the local environment and blocks issue
  requests through that result. Adapt registry settings, preview and issuance
  checks explicitly for the approved hosted TEST profile; the SQL flag alone
  will not enable the API. Test exact-target refusal, both flag states and the
  unchanged pending-approval banner with `sena_h_approved=false`.
- Statement OCR uses Windows OCR today. A Linux Hostinger worker needs a tested
  local OCR adapter before image-only synthetic statements can run there. Until
  ready, show the feature as unavailable; use the existing local demo for it.
- `0022` defines existing search tables, and memo confirmation currently writes
  `ads.archive_memo_chunk`. Applying its schema must not activate or populate an
  index. Keep those tables empty and indexing jobs disabled. Do not run the
  existing confirmation/seed path unchanged on hosted TEST. A later approved
  non-indexing confirmation path is needed before enabling that action; no RAG
  implementation is included in this plan.

IT must provide the actual Supabase/VPS/storage and backup regions (Q7/Q37),
approved account access with MFA, a restricted SSH/service account, OS/resources,
firewall rules, outbound Supabase/storage access, domain ownership/DNS/TLS,
secret custody, monitoring/backup owners and a billing owner. Proposed domain
roles are separate `hub-test` and `hub-api-test` subdomains under an IT-controlled
domain; no domain is assumed or registered here.

**Temporary option:** IT may provide a time-limited dedicated TEST VM with
persistent storage behind its approved HTTPS gateway, running the same API and
worker processes until the Hostinger VPS is ready. It must be reachable from
Vercel over the approved route; Vercel cannot reach workstation `localhost`.
Apply the same secrets, access and regional review. If IT cannot provide that
route, keep the complete presentation local; do not expose a developer machine
through an ad-hoc public tunnel or claim that a static Vercel deployment is a
working hosted app. No VM, tunnel or gateway is provisioned in this step.

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

Planned order after approval:

1. Implement and test the bootstrap variant, full runner and profile locally in
   a disposable managed-permission simulation with no custom-parameter grant.
   Verify canonical local replay as well as hosted-profile replay.
2. Implement hosted authentication/storage and the specifically enabled module
   adapters. Keep unavailable modules explicit. Rerun typecheck, build, DB/API
   suites and Edge UI tests, including logo rights/SVG and agency isolation.
3. Reconcile actual hosted state with a read-only preflight; print target and
   safe counts/checksums only. On a clean accepted target, apply the reviewed
   manifest. Confirm both issuance flags are false before proceeding.
4. Provision private storage, separate operator/runtime/worker/DW credentials
   and the seven Auth test identities. Validate permissions and exact replay.
5. Apply only the approved synthetic seed. If exercising server issuance needs
   the TEST flag, record the explicit operator enable/disable actions; approval
   stays false. Freeze source hashes/counts for DW TEST readers.
6. Deploy isolated TEST services and run authenticated smoke/role checks. Test
   expired/forged JWTs, metadata tampering, missing role, agency boundaries,
   private downloads, sanitized SVG, per-file rights/audit, failed-migration
   rollback, checksum refusal, denied flag changes and blocked issuance while
   off. Check desktop/mobile layouts, backups and a restore rehearsal.

No existing `dev:migrate`, `test:db`, API integration test or UI suite is to be
repointed at hosted TEST. Hosted smoke checks need separate explicit targets and
synthetic-only fixtures; do not let a routine local command mutate the cloud.

## 7. Cost, backups and teardown

Public list prices checked **2 October 2026**; USD, before taxes, exchange costs
or excess usage. The existing project's plan and IT's contracts are not known.
These are planning figures, not a purchase or a claim about the current bill.

| Service | Planning choice and cost |
|---|---|
| Supabase Free | $0/month, 500 MB database and 1 GB storage; no automatic backups and may pause after a week of inactivity. Suitable for disposable small TEST with manual exports. |
| Supabase Pro | From $25/month; one Micro project covered by included compute credit, 8 GB disk and seven days of daily backups. Extra projects/usage can add cost. Prefer for a repeatedly presented shared demo if owner accepts the bill. |
| Vercel | Pro lists $20/month plus extra usage/seats; check existing organization entitlement. Hobby is restricted to personal, non-commercial use, so it is not the proposed SENA business-demo plan. |
| Hostinger | Reuse IT's existing VPS if capacity permits; incremental charge is unknown. A new KVM 2 is advertised at $8.99/month equivalent, renewing at $14.99/month for two years, paid upfront; IT must confirm checkout term, region and total before buying. |
| R2 Standard | Includes 10 GB-month, 1 million Class A and 10 million Class B operations monthly; above allowance, storage is $0.015/GB-month plus operations. Small synthetic fixtures may fit the allowance; verify account-wide use. |

Sources: [Supabase pricing](https://supabase.com/pricing),
[Vercel pricing](https://vercel.com/pricing),
[Vercel Hobby restrictions](https://vercel.com/docs/plans/hobby),
[Hostinger VPS pricing](https://www.hostinger.com/vps-hosting),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/).

A new one-project Supabase Pro plus one-developer Vercel Pro setup therefore
starts at approximately **$45/month**, before VPS, storage overages, domains,
taxes and additional seats/usage. Supabase Free reduces that subtotal to $20.
This arithmetic is an estimate, not a price cap. Retain available spend controls,
add billing alerts and seed/storage limits; do not buy PITR or an extra platform
plan for a disposable demo without an identified need. No OpenAI/OCR API spending
is included; external model execution remains disabled for this hosting step.

Backups are an operator responsibility even for TEST. Before a migration and
after a presentation worth retaining, capture a protected logical database export,
deployment manifest and separate private object backup with content hashes.
Do not put backups in Git. On Free, schedule exports only after an operator owns
the job; on Pro, daily backups complement an independent restore rehearsal.
Supabase database backups omit Storage object bytes and custom-role passwords;
reprovision secrets after restore and verify object hashes and permissions.
Project deletion also deletes its hosted backups.
[Supabase backup limits](https://supabase.com/docs/guides/platform/backups).

Proposed TEST retention: seven rotating daily copies plus a pre-change copy,
reviewed by IT; synthetic artifacts are reproducible. This does not establish a
real-document retention policy or override a legal hold. Record backup location
with Q7/Q37 and confirm who can restore it.

Teardown is a later explicit owner action against this exact TEST inventory:
disable issuance and logins, stop worker/API and DW access, export anything the
owner wishes to retain, remove TEST Auth identities, revoke/rotate dedicated
credentials, remove TEST deployments/DNS and private buckets/objects after
checking holds, then delete the dedicated Supabase project if authorized.
Delete only TEST VM resources, not a shared VPS or another app. Cancel the
relevant subscriptions separately and verify billing; resource removal does not
prove subscription cancellation. Record destruction and backup-expiry receipts.
Nothing is torn down now.

## 8. Approval scope and outstanding inputs

`docs/27 approved` accepts this design for the next implementation step; it does
not record P'Note approval, a real-data/DPO decision, or a paid-plan purchase.
The next work must report local checks first and identify each hosted apply,
resource provisioning or deployment step before it runs under the approved plan.

| Input | Owner | Default until answered |
|---|---|---|
| Accept explicit hosted `0014` profile and TEST-flag controls | Hub owner | No implementation or hosted preflight until document approval; flags stay false. |
| Regions, access, domain/TLS, backup custody and temporary VM | IT; DPO for Q7/Q37 | Local presentation continues; no guessed infrastructure or real-data transfer. |
| Plan/seat/VM budget and bill owner | Hub owner + IT/Finance | No purchase, upgrade or subscription change. |
| Test mailboxes and authorized testers | IT + Hub owner | No users or invitations created. |
| Copy of real HYABC REM identity | IT/data owner | No; use new fictional identities. |
| Real documents/internal-data processing | DPO/data owner, Q7/Q36 | Synthetic only; no external OCR/LLM, RAG, indexing, embeddings or ingestion work. |

Planning validation consists of repository inspection and official public
documentation. Hosted preflight, migrations, Auth, storage and smoke tests are
**not run** in this step. The owner-supplied `42501` denial is the current result;
the proposed variant must prove its behavior locally before any later cloud use.
