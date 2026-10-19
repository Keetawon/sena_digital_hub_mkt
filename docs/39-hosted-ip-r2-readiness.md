# 39. Temporary IP hosting and R2 readiness

Date: **16 October 2026**. Reviewed repository baseline: **`794d9cd`** plus the locally tested R2/security changes recorded below.
Status: **TEST app live on trusted IP HTTPS; first administrator active; 82 public-website project drafts and 5,762 Knowledge records imported; 3,300 private R2 files verified**. The owner
said **“credentials ready”** on 15 October and supplied SSH access for the
approved VPS. The preflight below now includes real TEST infrastructure reads
and the backed-up database bootstrap. Real emails, production changes and
unrelated website changes remain outside the authorization.

## Owner decisions and scope

- Target the existing Singapore Hostinger VPS at **`72.62.253.205`** directly.
  IT has not set up `hub-test.sena.co.th`; defer that hostname.
- R2 may also store the crawled public SENA website assets and Knowledge files.
  The configured content bucket exists and accepted the saved S3 credentials.
  Its name and credentials remain in the protected operator handoff file.
- Keep Supabase DB/Auth on the existing allowlisted TEST project. R2 permission
  does not approve publication, media rights, RAG/embeddings, real E-memo or
  statement uploads, or transfer of the whole working database. REM, DW and
  source sheets remain read-only; account/permission data never enters content
  exports or assistant tools.

## Current readiness

| Piece | Evidence / remaining work |
|---|---|
| HTTPS IP configuration | `apps/admin/lib/hosted-config.ts` and API `auth.py::Settings` already accept `https://72.62.253.205`. Ten offline checks passed: each accepts this origin and rejects HTTP, a path, query and fragment. No app change needed. |
| VPS and certificate | Trusted IP HTTPS and renewal rehearsal passed. The IP serves the deployed application; login and API health pass external checks. Six existing named-site certificates and vhost files are unchanged. See execution receipt below. |
| Google / email accounts | Public Auth settings successfully read with the saved publishable key: Google/email enabled, signup allowed, anonymous sign-in off, email auto-confirm off. Owner confirmed the Site URL and Hub callback allowlist. A confirmed-email account has signed in and been bootstrapped as the first admin; authenticated content reads passed. SMTP/OTP and identity linking remain separate acceptance work. |
| R2 content delivery | Owner confirmed both public access options disabled. All 3,300 public-source files passed conditional signed writes followed by full read/size/SHA-256 verification. Authorized BNA7 original and safe-thumbnail reads passed. The protected four-field credential file remains outside Git and Next. No Supabase service key is used. |
| Hosted Knowledge | Review/file routes implemented and verified in the local H1 simulation. DB permissions precede private file reads; originals are attachments and safe image previews are revalidated/transcoded. Chatbot preview/release, RAG and indexing remain blocked. |
| Public content transfer | Completed with the separate `scripts/transfer-sena-public.py` operator path, a pinned public-only manifest and a fresh protected backup. The original local importer remains local-only; no working database restore or REM/DW snapshot transfer occurred. See the execution record below. |
| Deferred features | Hosted finance/actuals/documents/archive/exceptions, assistant, RAG and document worker remain outside this content-storage extension. |

## HTTPS and sign-in settings

These **non-secret** values are configured for the deployed TEST app; the owner confirmed the Supabase Hub URLs on 16 October:

| Setting / dashboard field | Value |
|---|---|
| Next and API `HUB_ADMIN_ORIGIN` | `https://72.62.253.205` |
| Next `HUB_API_URL` | `https://72.62.253.205` |
| API `HUB_SUPABASE_URL`; Next `NEXT_PUBLIC_SUPABASE_URL` | `https://eqlrtevwpyboplljgowo.supabase.co` |
| Supabase Auth Site URL | `https://72.62.253.205` |
| Supabase return URL | `https://72.62.253.205/auth/callback`, with tested handling of the app's `?next=...` query |
| Google web OAuth client's authorized redirect URI | `https://eqlrtevwpyboplljgowo.supabase.co/auth/v1/callback` |

Google redirects to Supabase; Supabase returns to the Hub, where the PKCE code
is exchanged. Google's redirect URI rules reject a raw public IP, so do not
replace its Supabase callback with the Hub IP or add the IP as a Google
JavaScript origin. This app uses the redirect flow, not Google's embedded
button SDK. Actual provider acceptance remains unproven until the hosted check.
[Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server).

Supabase's return allowlist must cover the callback's intended query handling
on this exact HTTPS IP, without broad host/path wildcards. Verify safe deep
links and external-`next` rejection. Keep Confirm email on, anonymous sign-in
off, Secure cookies and the existing origin checks. SMTP/OAuth secrets belong
only in the Supabase dashboard; Next receives only its public publishable key.
[Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

Let's Encrypt supports IP certificates with roughly six-day validity. Certbot
5.4+ supports the IP webroot flow. This run rehearsed issuance with staging,
then installed a trusted certificate and automatic renewal with an OpenLiteSpeed
deploy hook. Staging certificates were never installed on the live listener.
Use the existing port-80 webroot; do not stop the shared listener for standalone
ACME. Keep the challenge route out of the app proxy.
[Certificate procedure](https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

**Shared-host prerequisite:** inspect the existing 443 listener's default
certificate and vhost mapping before changing either. An IP visit may use the
listener certificate rather than a named site's override, so merely adding a
named vhost is not evidence that IP TLS works. This is an operational risk
confirmed by the read-only VPS inspection: the shared listener certificate has
only server-hostname SANs, while all six existing sites have their own certificates.
Prove the IP certificate and routing work and existing sites remain unchanged.
If that requires an incompatible shared-listener change, record the conflict
for the owner/IT; do not silently replace listeners or expose new app ports.
[OpenLiteSpeed SSL configuration](https://docs.openlitespeed.org/security/ssl/).

## R2 preparation and implementation order

1. **Prepare locally first.** Implement private R2 delivery for the approved
   content, with explicit TEST target checks and a forward metadata migration
   where needed. Remove the Supabase privileged-storage-key requirement for
   that path. Preserve validation, bounded sizes, content hashes, immutable
   originals and safe errors; never expose keys or storage response bodies.
2. **Keep authorization on every read.** Serve bytes through the authenticated
   Hub API, preserving tab/binding checks and the uploader's unbound-file rule.
   Keep the bucket private with no `r2.dev` or public custom domain. Do not issue
   long-lived download URLs that bypass suspension or permission changes.
3. **Adapt Knowledge and transfer narrowly.** Support approved hosted review/file
   operations without enabling assistant, preview generation or indexing.
   Transfer only a reviewed source manifest with hashes/provenance, idempotent
   writes and a dry-run report. Preserve human edits/approvals and the source
   remark **ดึงจากเว็บไซต์สาธารณะ SENA**. Held/invalid assets remain held.
4. **Prove it offline.** Extend local storage/Auth simulation; test private reads,
   wrong bucket/target, hash mismatch, denied tab/binding, immediate suspension,
   upload/replay, no secrets in bundles/errors, and unchanged local imports.
   Run typecheck, offline build, DB/API/UI and local H1 suites before deployment.
5. **After the gate**, create/check the private TEST content bucket and use
   bucket-scoped Object Read & Write S3 credentials for the API/operator as
   needed. Keep them outside the checkout in protected server-side service
   configuration, never Next/browser config or chat. Provisioning permissions
   do not belong to the runtime. Verify bucket jurisdiction/endpoint in the
   dashboard; Singapore VPS location does not prove R2 residency.
   [R2 token scope and endpoints](https://developers.cloudflare.com/r2/api/tokens/).

### Implemented content-storage contract

- `r2_assets.py` uses boto3 with SigV4, region `auto`, exact endpoint/bucket
  validation, verified HTTPS and a destination guard against signed redirects.
  A protected server-side JSON file supplies four fields; it is never sent to Next.
- Runtime configuration: `HUB_R2_CREDENTIALS_FILE` points to that file;
  `HUB_R2_PRIVATE_BUCKET_CONFIRMED=1` is set **only after** an operator checks both
  public-access settings. `HeadBucket` is a connectivity check, not privacy proof.
  The owner's current answer is **“Not sure yet”**; the real flag remains unset.
- Database metadata uses the logical alias `r2-test-content`, not the physical
  bucket. Migration `202610150055_r2_test_content.sql` adds that alias and the
  `(r2-test-content, r2)` provider pair while preserving upload/binding guards.
  Local metadata cannot claim hosted storage. Legacy Supabase storage runs only
  in the old offline simulation path; real hosted settings reject its key.
- Originals use `originals/<sha256>.<ext>`; held Knowledge files use
  `knowledge/<sha256>`. Conditional create (`If-None-Match: *`) cannot overwrite
  an existing object. Every read/replay checks bounded length and SHA-256.
  There is no list/delete API, public URL or presigned URL.
- Reads always check current Hub permissions and bindings before storage/cache
  access, including immediate suspension and the uploader's own unbound files.
  Knowledge originals use attachment, sandbox, `nosniff` and `no-store` headers.
  Only revalidated PNG/JPEG/WebP can produce a 320-pixel WebP preview.
- A local SigV4 R2 double supplies synthetic bytes to the existing H1 runner.
  It loads no real credential file and makes no hosted calls.

The separate proposed `sena-hub-test-documents` bucket and real document
processing remain subject to their existing H2/Q7 decisions. Q69's production
storage/capacity decision is not resolved by this TEST choice.

## Hosted execution sequence — after readiness

1. Record the release SHA and protected pre-change backups. Inspect VPS/TLS
   isolation read-only; review current migration and runtime-role manifests.
2. Establish trusted IP HTTPS and renewal. Keep Next on `127.0.0.1:13000`, API on
   `127.0.0.1:18000`; proxy `/v1/*` and `/health` to API and everything else to
   Next, including `/api/hub/*`. Keep private responses uncached.
3. Apply reviewed TEST migrations with the operator connection; runtime uses
   `hub_app`, per-request Hub capabilities and forced RLS. Set up private R2
   through the tested adapter, then transfer only the reviewed content set.
4. Configure Auth using doc 33 and the values above. Keep Google/password
   feature flags off until the relevant provider/sender is ready. Real mail
   tests require their own explicit authorization; none are part of local prep.
5. Verify login, identity linking, OTP enforcement, approval and suspension,
   private content access and agency isolation through the IP origin. Check
   other hosted sites, certificate renewal and rollback before owner UAT.

## Execution receipt — 15 October 2026

The owner opened the TEST gate and supplied root SSH access on port 22 using
a local key. SSH used `BatchMode`, the explicit identity and strict existing
host-key verification. No private key contents or credential values were
printed. Database access used the saved operator connection with verified TLS.

- Initial DB preflight: PostgreSQL **17.6**, **0 applied / 54 pending** Hub
  migrations. All **54 applied / 0 pending**; the runner finished successfully.
  A second read-only preflight verified canonical/executed checksums, deployment
  provenance, schema owners and role memberships. The separate runtime login
  connected with verified TLS, has only `hub_app` membership and no privileged
  role attributes. `SET LOCAL ROLE admin` was denied with SQLSTATE `42501`;
  an identity without an ACTIVE account was denied Projects view/edit/approve.
  Hosted profile proof and disabled registry issuance checks passed. The private
  `postbootstrap-receipt.json` contains only counts and safe check results.
- After all local gates passed, migration **55** added the reviewed R2 metadata
  pair. Fresh protected backup:
  `.local/backups/hosted-test-r2-20261015T160500Z/supabase-before-r2.dump`
  (**1,797,125 bytes**, SHA-256
  `6e8aaab496f6cfa5ec079f93125d9fc7cd1c448dc75ad01586c8a0d4809b748d`,
  inventory verified). Final read-only preflight confirms
  **55 applied / 0 pending**, unchanged Auth/account/project counts, verified
  runtime TLS, denial of legacy admin role and denial for a non-ACTIVE actor.
  The first postflight probe mistakenly called the startup-profile function as
  `hub_app`, which correctly denied it. The corrected probe uses `hub_runtime`
  for startup and `hub_app` for request permissions; it passed without changing
  any grants. The migration had already completed successfully before that probe.
- Protected pre-change backup directory:
  `.local/backups/hosted-test-prebootstrap-20261015T144625Z/`.
  `supabase-before.dump` is **365,120 bytes**, SHA-256
  `05dfb81918a619cf83e07f0bb781b3b9368f13ae906fdb3e427d537c4fbcf20a`.
  `pg_restore --list` passed. Schema/role/membership inventory excludes role
  passwords; the dump is private and is not a content export or Git artifact.
- `vps-web-config-before.tar.gz` captures the main OLS configuration and six
  existing vhost configurations, **3,634 bytes**, SHA-256
  `a0e6c39c2b35bc26451023ae6967e79ca4ea0a40240e5eeb8c7bbc01ca71a1e3`.
  Its seven-file inventory passed. The backup is outside the VPS/web root;
  Windows access is restricted to the owner and SYSTEM. This was the initial
  pre-change state; the later isolated tools/IP setup is recorded below.
- Port **3000** belongs to an existing application. Leave it running. Proposed
  Hub listeners are **`127.0.0.1:13000`** (Next) and **`127.0.0.1:18000`** (API),
  both unused at inspection; these replace the earlier 3000/8000 plan without
  opening any public application ports.
- All six existing sites configure their own TLS certificate. Before this run,
  the default certificate covered the server hostname, not the IP. The new IPv4
  default certificate covers the IP; the IPv6 listener and all named-site vhost
  files were left unchanged. Fingerprints for all six named sites matched before
  and after graceful reloads. The existing port-3000 app was not stopped.
- Isolated tools under `/opt/sena-hub-test/tools/`: uv **0.13.1**, managed Python
  **3.13.16**, Certbot **5.4.0**. System Node **22.23.2**, Python **3.9.25**,
  Certbot **3.1.0**, OLS **1.9.1** and other applications were not upgraded.
- Protected IP-change backup:
  `.local/backups/hosted-test-ip-20261015T155831Z/`. The initial web-config archive
  is **3,625 bytes**, SHA-256
  `b1f5390bec84f0ca2f394642135490a16764538b047081503c23f6cd4912b683`;
  `vps-before-ip-tls.tar.gz` separately captures the state immediately before TLS.
  Both inventories passed. An explicit IP-only HTTP/IPv4 HTTPS mapping serves
  `/opt/sena-hub-test/www/`, including the static ACME challenge path.
- Staging issuance, trusted issuance, external HTTPS chain/IP-SAN validation,
  and `renew --dry-run --run-deploy-hooks` all passed. Current certificate expires
  **22 October 2026 07:01:28 UTC**. The isolated
  `sena-hub-test-cert-renew.timer` checks four times daily with a randomized delay;
  its deploy hook validates configuration and gracefully reloads OLS.
  This timer renews only this IP certificate, not other sites' certificates.
- The unchanged OLS configuration has five existing warnings. OLS 1.9.1 returns
  exit 1 for warnings as well as errors; changes were accepted only when normalized
  warnings matched the baseline and no errors appeared. Existing warnings were
  not “fixed” as part of Hub setup.
  [OLS configuration-test behavior](https://raw.githubusercontent.com/litespeedtech/openlitespeed/v1.9.1/src/main/lshttpdmain.cpp).
- R2 credentials were supplied through the protected handoff file at
  `%USERPROFILE%\.sena-hub\credentials\r2-test.json`, outside the repository
  and restricted to the owner and SYSTEM. A signed `HeadBucket` request returned
  **HTTP 200**. No filenames were listed and no objects were read or written.
  This proves credential/bucket access, not that public bucket access is disabled.
  The adapter passed local gates; selected-content transfer has not started.
- The initial Node Auth-settings request failed; the Python request subsequently
  succeeded with HTTP 200 and the bounded settings shown above. A VPS Node
  request also succeeded. The VPS completed a verified TLS 1.3 handshake to the
  database endpoint; no operator password was placed on the VPS. This is evidence
  of configuration/API access, not proof of SMTP or a completed login.
- No hosted Auth user, account approval, content import, RAG job or real email
  was created. Local DB/API/admin
  ports were already offline when checked; this run did not stop them or alter
  the working database. BNA7/accounts cannot be freshly queried until that local
  DB is running again. Previous local data/test evidence is in
  [doc 38](38-sena-public-website-import.md).

## Local gate results and remaining work

All application tests used disposable databases and synthetic identities/files.
The working database was not used or migrated.

| Gate | Before (doc 38) | This change |
|---|---:|---:|
| Typecheck / offline webpack build | Passed | Passed |
| DB | 51 SQL/concurrency + 8 Node | 52 SQL/concurrency + 8 Node passed |
| API | 1,844 passed, 8 opt-in skips | 1,864 passed, 11 opt-in skips; the 3 assistant fixture tests then passed separately, giving 1,867 passed and the same 8 remaining skips |
| Local H1 simulation | 11 Node + 39 browser | 11 Node + 40 browser passed |
| UI | 255 | 255 passed |

The three additional skips in the standard API invocation were
`test_assistant_http_citations_generated_proposal_and_explicit_save`,
`test_all_thirteen_readers_real_rls_exact_evidence_and_domain_boundaries`, and
`test_sdk_reads_fictional_project_through_real_caller_rls_without_egress`.
They passed under `--assistant-fixtures`, using synthetic data and no provider
calls. The remaining opt-in skips are `test_actuals_import.py:219`,
`test_archive_db.py:22`, `test_demo_finance.py:50`, `test_document_worker.py:121`,
`test_hosted_h1.py:335`, `test_hub_demo.py:285`, `test_promotions_db.py:17`, and
`test_residential_seed.py:39`. H1 has its separate passing simulation.

The first H1 run caught an obsolete hosted Knowledge block in the Next proxy
and sidebar; both now permit the reviewed routes. The next run caught an
overstrict test expecting exactly `no-store` when the proxy correctly returned
`private, no-store`; the assertion now requires the directive. The final H1/UI
runs passed without retries. Existing AnyIO/Pillow deprecation warnings remain.
Screenshot: `artifacts/hosted-r2-knowledge-desktop.png`.
An exact-value scan of **678** tracked/unignored source and built browser files
found **zero** matches for the saved private R2 credentials or DB passwords.
No credential values were emitted. `git diff --check` passed. These adapter,
migration, test and documentation changes are still local and uncommitted;
repository HEAD remains `794d9cd`. This was the pre-deployment gate receipt; the Linux deployment followed on 16 October, below.

## Deployment receipt — 16 October 2026

The owner confirmed **both R2 public-access options disabled** and **both Hub
Auth URLs set**. These are owner dashboard confirmations, not S3 API proofs.
Google's OAuth redirect remains the Supabase callback. Google sign-in is enabled;
password sign-in remains available, while password signup/reset stay hidden
(`HUB_AUTH_PASSWORD=0`) until SMTP acceptance is separately authorized.

- Application: **https://72.62.253.205/login**. Next listens only on
  `127.0.0.1:13000`, FastAPI only on `127.0.0.1:18000`. Separate non-root
  `sena-hub-admin` and `sena-hub-api` systemd services are enabled for boot.
  A separate `sena-hub-build` account built the release. None can modify source
  or service configuration. Resource limits bound builds and running services.
- Initial release directory:
  `/srv/sena-hub-test/releases/794d9cd-r2-f3fcfe74eb24`, initially selected by
  `/srv/sena-hub-test/current`. The later auth refresh below replaces the Next
  service and that pointer; the API still uses this initial directory.
  The 151-file reviewed source manifest has SHA-256
  `f3fcfe74eb242e1e8e8d33ee54b3d245432515ed18baacea27060b00d70bb67f`;
  the input archive has SHA-256
  `eb636952a3831d3eff16369a841b95f1059636a844b935e4bccf578ed702d703`.
  Inputs were checked again after the Linux build. No local environment,
  credentials, database, generated content or Git metadata was included.
- Isolated Node **24.19.0** joins Python **3.13.16** under the Hub tool directory.
  Existing system runtimes and applications remain unchanged. An initial build
  omitted development dependencies because `NODE_ENV=production`; the final
  clean candidate explicitly used `npm ci --include=dev` and the reviewed lock.
- Deployment audit identified vulnerable frontend dependencies. Next was patched
  **16.3.5 → 16.3.8**, with **sharp 0.35.5** and **source-map-js 1.2.2** in the
  lock. Production `npm audit` reports **0 vulnerabilities** on Windows and Linux.
  Both platforms passed typecheck/offline build. The full UI rerun passed
  **255/255**, and the H1 rerun passed **11 Node + 40 browser** tests without
  retries. API/DB source was unchanged after its passing gates above.
  [Next advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4),
  [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w),
  [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- Protected pre-routing backup:
  `.local/backups/hosted-app-20261016T023521Z/web-before-app.tar.gz`, SHA-256
  `e097289f786c2003657d0856ac481d309741420845fcf4942cab4e18573fef6e`.
  This directory also holds the source manifest, storage/routing receipts and
  non-secret vhost configuration. It is ignored by Git and Windows access is
  limited to the owner and SYSTEM.
- Root-owned service environment files are `0600`. The API alone can read the
  `0640` R2 credential file through its dedicated group; a read attempt as the
  Next service user was denied. The API receives only the restricted runtime DB
  connection with `verify-full` and the CA file. No operator DB credential or
  service key was copied to the VPS. Next receives only public Auth settings.
- First API startup exposed two Linux service-home issues: PyThaiNLP tried to
  create its data folder in an unwritable home, and asyncpg's optional
  `~/.postgresql/root.crl` lookup raised `PermissionError` under `ProtectHome`.
  The API system user's home is now `/var/lib/sena-hub-test/api`; PyThaiNLP uses
  its private directory with read-only/offline flags. The hardened service then
  passed startup without relaxing TLS, RLS or home-directory protection.
- Private R2 signed HEAD, create, read/hash verification and duplicate replay
  passed with a **57-byte synthetic text object**. Object SHA-256:
  `6214e8373dfbb32377bc1e71f2193ba3c79e1c661d2692b856a004da183c3c34`.
  It remains as private test evidence under `knowledge/<hash>`; it has no DB
  candidate or retrieval entry. No real document or website file was uploaded.
- Only the IP vhost routes `/v1/*` and `/health` to API, other paths to Next.
  ACME remains a static exception. HTTP and trailing-slash API redirects retain
  the constant HTTPS origin. App responses retain `no-store`; LSCache is disabled
  for this vhost and `X-Robots-Tag` prevents indexing. No global listener, named
  site configuration or firewall rule changed during this routing step.
  All six named-site certificate fingerprints and vhost hashes matched afterward.
  [OLS reverse proxy](https://docs.openlitespeed.org/config/reverseproxy/),
  [OLS cache settings](https://docs.openlitespeed.org/config/lscache/).
- The IP access log records only IP, time, method, path, status and byte count.
  A synthetic marker in a query, Cookie and Authorization header appeared in
  neither the Hub nor shared web logs. API access logging is disabled. Browser
  screenshots and test receipts contain no session/token values.
  [OLS log formatting](https://docs.openlitespeed.org/config/logs/).
- External smoke: login/health **200**; unauthenticated or invalid-token account
  and project APIs **401**; password signup/reset redirect to login; an external
  `next` on the OAuth callback stays at the configured origin. Desktop and
  400-pixel browser checks passed with no script error or horizontal overflow.
  Screenshots: `artifacts/hosted-ip-login-desktop.png` and
  `artifacts/hosted-ip-login-mobile.png` (generated, ignored).

A read-only readiness query after routing found **0 Auth users, 0 Hub accounts,
0 active administrators, 0 projects and 0 Knowledge candidates**. No synthetic
identity was silently promoted. The owner has been asked to sign in once using
the intended administrator account before the operator bootstrap.

The offline transfer inventory revalidated both original package manifests and
all **3,300 unique files / 1,081,854,339 bytes**. It covers **82 project drafts**
and **5,762 candidates**, including BNA7; **64 asset rows retain validation holds**.
No file exceeds the 50 MiB private Knowledge storage bound. Inventory evidence is
`.local/hosted-content-transfer-inventory.json`; this is **not** a hosted dry run
or an executed transfer. The future hosted package must remove local filesystem
locations and exclude the local REM-derived fact-card payloads. Draft identity
and summary fields must use an explicit public-source projection, preserving
original IDs/provenance without copying REM source records, accounts or permissions.

Remaining acceptance work at the initial deployment: the owner's first Google
sign-in and audited first-admin bootstrap (completed below on 16 October); a
narrow, target-checked public-content transfer manifest/dry run and
its execution; authenticated content/storage/suspension checks; provider identity
linking and separately authorized SMTP/OTP checks. The local working database has
not been copied or changed. A real mail test is not implied by this deployment.

Rollback of application routing uses the saved IP-vhost configuration and a
validated **graceful reload**; never stop the shared web server. Leave the IP
certificate, renewal timer and ACME path intact. The new app services can be
stopped independently if a rollback is needed; existing port-3000 services remain
untouched. Database rollback is not an automatic restore: migrations are forward
changes with the protected pre-change dumps retained for operator review.

## Auth visual refresh — 16 October 2026

The owner's sign-in/register redesign uses one responsive Emerald & Champagne
layout for login, signup, OTP, recovery and access requests. It adds a quiet
architectural illustration, clear registration steps, accessible password
visibility controls and improved mobile spacing. Design and contrast evidence
are in [doc 33](33-login-and-accounts.md#sign-in-and-registration-visual-refresh--16-october-2026).
No animation, schema, authorization or email-sending change accompanies it.

The deployed auth release is
`/srv/sena-hub-test/releases/794d9cd-auth-e423f97fa09c` (154 source files).
Source manifest SHA-256:
`e423f97fa09c565eefff8ce1546791288b547d5fdf2d2dca5504cdb67c0a4a70`.
Source archive SHA-256:
`35dae027bc7bc132d6a8cce00a5f97ad73dafd67139a3e6b9c53096d53b6d171`.
Protected pre-change routing backup:
`.local/backups/hosted-app-20261016T070652Z/web-before-app.tar.gz`, SHA-256
`def8f9d54e1f2b69d8c53c3543370a683763c6c72a040a03d6570761f8869ede`.

Windows and Linux typecheck/offline builds passed; the Linux production dependency
audit found zero vulnerabilities. The candidate passed a temporary loopback-only
preview, then that preview stopped. All API source hashes match the prior release;
promotion changes only the Next service. The existing API release must remain on
disk while its unit uses that directory.

The final local H1 run passed **11 Node + 43 browser tests** (35 account/storage
and visual tests, 3 feature-flag tests, 5 outage tests). The initial H1 run exposed
test selectors made ambiguous by the new labelled password buttons; selectors
now identify their exact field. The storage-denied test also confirms that an
unavailable browser sessionStorage does not break signup. No real emails or
provider sign-ins were used.

The first full UI run reported **254 passed / 1 failed**:
`brand-logo-upload.spec.ts:88`, desktop slot upload/replacement. Its five-second
assertion expired while the synthetic SVG was still uploading/being checked;
the captured page showed the processing state, not a server rejection. Windows
then reported `EBUSY` while removing that run's disposable PostgreSQL directory.
The failed trace is retained in `.local/auth-redesign-upload-timeout-trace.zip`.
The deployment guard refused promotion before any SSH call. The separate full UI
rerun passed **255/255**, with exit code 0 and clean disposable-service shutdown.
The previously failing desktop case passed unchanged in 4.2 seconds, and its
mobile counterpart also passed. This was one timing-sensitive failure in the
initial run; no timeout or upload assertion was weakened and the final run used
no retries. The working database and file stores were never used by the suite.

The new Next release is live at **https://72.62.253.205/login** and is selected
by `/srv/sena-hub-test/current`. The API's unit, process and release were verified
unchanged; no migration or data write was part of the UI deployment. The web-server
configuration and environment flags are unchanged. An initial promotion attempt
stopped before service changes because the private rollback directory did not
exist; creating that directory allowed the guarded promotion to complete.

The previous admin unit is retained at
`/srv/sena-hub-test/backups/794d9cd-auth-e423f97fa09c-admin-unit/sena-hub-test-admin.service`.
New unit SHA-256:
`d65276b0c816eb304143ab3bfe720c0726214f13dc127942d1fd6b53348d6f35`.
Rollback restores that saved unit, reloads systemd, restarts only the admin service,
and points `current` back to `794d9cd-r2-f3fcfe74eb24`; it requires no shared web
server restart or database restore. The private local promotion receipt is
`.local/backups/hosted-app-20261016T070652Z/auth-promotion.json`.

External smoke passed: login and API health 200; unauthenticated account/project
routes 401; disabled signup/reset redirect to login; an external callback `next`
stays on the configured origin. Desktop and 400px browsers displayed the new
design and local Google icon, password visibility worked, and no browser error
or horizontal page scroll occurred. Updated screenshots are
`artifacts/hosted-ip-login-desktop.png` and `artifacts/hosted-ip-login-mobile.png`.
Local signup/OTP/recovery screenshots remain listed in doc 33. Password signup/reset
remain hidden on hosted TEST pending sender acceptance. This refresh does not
change the remaining public-content acceptance work above. First-admin activation
is recorded below.

For this UI change, API and DB tests were not rerun because their source is
identical to the already verified deployed release; their earlier gate counts
remain those recorded above. The auth redesign adds no dependency. The exact-value
credential scan over 684 source/browser files found zero matches, and
`git diff --check` passed. Changes remain uncommitted at repository HEAD `794d9cd`.

## First administrator activation — 16 October 2026

After the owner identified the intended registered account, the existing
`scripts/hub-accounts.py` bootstrap function activated that account with the latest
admin template and `can_manage_users=true`. The operator wrapper used the approved
TEST connection allowlist and verified TLS through the session pooler. It required
the hosted target confirmation, matching Auth and Hub identities, a confirmed
Auth email, an un-anonymised PENDING row and no existing active administrator.
The operation held the account-decision advisory lock and committed atomically.

Both the account and permission audit tables contain the BOOTSTRAP event. The
template is an uncustomised admin copy. Post-commit checks using the restricted
runtime login and `hub_app` role confirmed account-directory and permission-catalog
access, Projects view/edit allowed, and Projects approve denied as required by
the separation rule. Auth user count was unchanged; no metadata role, service key,
password reset, email or new session was involved. Final counts were one Auth user,
one Hub account and one active administrator.

The non-personal receipt is `.local/first-admin-receipt.json` (ignored by Git).
No account email, profile fields, Auth token or credential was written into these
docs. The owner can now refresh the app and open `/admin/accounts`. Public-content
transfer and authenticated content/storage/provider acceptance remain outstanding.

## Public website content transfer — 16 October 2026

The owner confirmed transfer of the prepared public SENA website content into
hosted TEST. This supersedes the earlier content-pending notes above. It does
not authorize a whole working-database restore, REM/DW business snapshot import,
publication, rights approval, real email or assistant/RAG execution.

The dedicated operator path is `scripts/transfer-sena-public.py`; the original
`scripts/import-sena-public.py` retains its working-loopback-only guard.
Preparation verified both original manifests, their capture inventories and all
referenced file bytes. The hosted manifest removes local filesystem locations
and excludes the local REM-derived fact-card payloads. It retains source URLs,
capture timestamps, original manifest hashes, exact project IDs and every hold.

Hosted manifest SHA-256:
`d48557a3b21771afe0e462a1e390cf306e7002d7ede9c108c86273c4f7422c33`.
Private package and receipts: `.local/hosted-public-transfer-20261016/`.
The local file-location sidecar is used only to read the approved source bytes;
it is never uploaded or inserted into the database.

Before writes, the guarded wrapper verified all **55 applied migrations / zero
pending**, the exact TEST target, certificate-verified client TLS through the
session pooler, the verified first-admin identity, its table-backed Projects edit
and Knowledge view permissions, and the real restricted runtime connection.
The pooler's private backend connection is not the client TLS proof. No role
membership, grant or policy was changed: Supabase's operator cannot SET ROLE
`hub_app`, so source inserts use the operator transaction and draft mutations
call the existing `hub.create_project_from_rem` / `hub.patch_project` functions.
Those functions still require the actor's Hub permissions and enforce stale
write checks. The restricted `hub_runtime` / `hub_app` path was checked separately.

Fresh protected backup, taken before R2/content writes:
`.local/backups/hosted-test-public-content-20261016T102235Z/supabase-before-content.dump`.
The custom-format archive is **1,799,959 bytes**, with its inventory verified by
`pg_restore --list`; directory access is restricted to the workstation owner and
SYSTEM. SHA-256:
`0b0837f225c611a472270d0d7cf01d4dc1061872f598c01e9e329db271dde396`.
The backup contains the hosted database's protected records and must remain local,
ignored by Git; it is a recovery artifact, never an import source or content export.

All **3,300 unique files / 1,081,854,339 bytes** were conditionally installed in
private R2 under immutable content-hash keys and fully read back for size/SHA-256
verification. Database rows committed in one transaction at
**16 October 2026 10:31:12 UTC**. Replays retain existing human edits and immutable
evidence. A failed DB transaction may leave private hash-addressed originals;
the tool never guesses whether to overwrite or delete them.

| Item | Before | Verified after |
|---|---:|---:|
| Project drafts | 0 | 82 |
| Knowledge evidence records | 0 | 5,762 |
| Public-source display cards for the Knowledge project list | 0 | 82 |
| Human Knowledge reviews | 0 | 0 |
| Approved Knowledge asset links | 0 | 0 |
| Published project versions | 0 | 0 |
| Retrieval/embedding chunks | 0 | 0 |
| Auth users / Hub accounts / active administrators | 1 / 1 / 1 | 1 / 1 / 1 |

The evidence records comprise **1,110 sections, 647 FAQs, 203 video-link facts,
3,312 asset references and 490 gap records**. Shared files account for the
difference between asset-reference and unique-file counts. **64 asset rows retain
their file-validation holds**; imports confer neither ownership nor media rights.
Missing/unavailable source content remains an explicit gap, not fabricated text.
No video host was contacted by this transfer.

Only public-sheet IDs/names and website provenance populate the minimal project
identity rows required by the existing Hub FK. These rows are explicitly marked
`source_kind=sena_public_website` and `rem_status_unverified=true`; they are not
REM source snapshots. LADKB has two public-sheet entries (SH/TH) under the same
exact ID: both names and source-row references are retained, without inventing
a split or choosing one silently. The Knowledge list's `rag.project_fact_cards`
rows contain minimal public-source display metadata with unknown status and no
publication version; no retrieval chunks, embeddings or assistant indexing ran.

REM status, models, canonical brands and DW marketing groups were not inferred.
Consequently all 82 projects are initially outside the default active-REM-status
filter. Open **`https://72.62.253.205/?pother=1`** or enable
“แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ”. Knowledge review is at
**`https://72.62.253.205/knowledge`**; BNA7 is selectable directly with
`?project=BNA7`. Brands and Project Groups still require their separately reviewed
reference data. The existing H1 shell banner still says “ข้อมูลสมมติ”; that is
legacy UI wording, not the classification of this imported public-source batch.
The existing source-reference panel also uses “จาก REM”/local-fixture wording for
the identity-stub columns; those labels must not be interpreted as verified REM
provenance for this batch. The explicit public-source record and website source
remark are authoritative. Correcting those legacy labels belongs in the next UI
release. No application redeployment or banner change was part of this operation.

Post-commit verification compared **every candidate field and all draft text**
against the pinned package. BNA7 is present; each project's source remark is
“ดึงจากเว็บไซต์สาธารณะ SENA”, separate from human approval. Protected account,
permission, review, publication and existing-reference fingerprints were checked
inside the transaction. The real runtime login can read the intended content,
cannot SET ROLE admin, and an unknown/non-active actor is denied project and
Knowledge access. A BNA7 original passed a fresh private R2 read and safe-image
thumbnail generation. Non-personal evidence is in `verification-receipt.json`.

The focused disposable API/DB/storage run passed **48 tests**, with **1,838
unrelated tests deselected**, zero failures/skips and one existing Starlette
deprecation warning. It covers public-only projection, shared IDs, local-path
removal, hold preservation, wrong-target refusal, client TLS, file deduplication
and integrity, atomic rollback, replay, protected-state preservation, real SQL
permission/stale guards and R2 behavior. Early attempts caught a JSON-newline
path-detector false positive and an unnecessary direct row lock; both were fixed
before hosted writes. No production app code changed, so the prior full build,
UI and H1 results above were not rerun for this operator-only transfer. The exact
private-credential scan across **686 source/browser files found zero matches**.

Authenticated browser acceptance confirmed the hosted project count of 82,
BNA7's imported row and its “อนุมัติโดย / แหล่งข้อมูล” remark. Screenshot:
`artifacts/hosted-public-bna7.jpg`. BNA7's Knowledge view shows 101 unreviewed
records (27 sections, 23 FAQs, 3 video-link facts, 33 asset references and 15 gaps).
Six lazy-loaded private image previews rendered through the authenticated Next
proxy and hosted API with no page alerts. Held originals remain download-only
with their review warning. Further screenshots:
`artifacts/hosted-public-bna7-knowledge.jpg` and
`artifacts/hosted-public-bna7-files.jpg`. No review, publication or rights-approval
button was submitted during acceptance. The authenticated browser check used the
existing Hub session through the computer-use skill; no token was extracted or
new session minted by an operator script. BNA7 also opened successfully in the
draft editor: its website-text field contains **14,599 characters**, the form
remained clean with Save disabled, and there were no nonempty page alerts.
Editor screenshot: `artifacts/hosted-public-bna7-draft.jpg`.
