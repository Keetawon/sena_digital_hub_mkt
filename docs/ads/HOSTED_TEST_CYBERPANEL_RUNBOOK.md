# Hosted TEST: CyberPanel / OpenLiteSpeed runbook

Date: **2 October 2026 (Asia/Bangkok)**. Decision source: [doc 27](../27-hosted-test-environment.md). Application baseline: H1 commit `6bf9489`.

**Historical runbook; use the current execution receipt in [doc 39](../39-hosted-ip-r2-readiness.md). The owner opened the TEST gate on 15 October with “credentials ready”.** That instruction opens the approved TEST setup, not production, H2 features, purchases or unrelated website changes. Do not paste credentials, invite links, exports or environment files into chat/Git.

**15 October 2026 superseding notes:** the temporary origin is
`https://72.62.253.205`; IT has not configured `hub-test.sena.co.th`. R2 is
approved for crawled website assets and Knowledge files. The owner has now
said **“credentials ready”**; the approved TEST gate is open. Start with
[doc 39](../39-hosted-ip-r2-readiness.md). The domain commands in §§3/6/8 and
invite-only instructions in §9 are historical and must not be executed as-is.
Accounts now use [doc 33](../33-login-and-accounts.md)'s self-signup/verified
email/approval flows. The permissions programme completed after H1: runtime
uses `hub_app` and Hub-table capabilities, not the legacy role memberships in
this runbook. **16 October:** R2 privacy and the Hub Auth URLs are confirmed;
the TEST app is live with trusted IP HTTPS. First sign-in/admin bootstrap and
selected public-content transfer remain pending. This older runbook is not an executable release checklist for current main.

## 1. Confirm the inventory and remaining prerequisites

| Item | Fixed decision |
|---|---|
| Public origin | `https://72.62.253.205`; IP certificate/renewal verified, now serving the TEST app. Hostname deferred. |
| Database/Auth | Existing Supabase **Free** project `eqlrtevwpyboplljgowo`, **ap-south-1 (Mumbai)**. |
| Content files | R2 adapter and hosted Knowledge review passed local gates. Owner confirmed private settings; app and synthetic storage smoke passed. Selected-data transfer remains pending. Do not supply a Supabase service key. |
| Host | Existing **Singapore Hostinger VPS**, CyberPanel + OpenLiteSpeed; other websites share it. Owner observed 4 shared cores, 16 GB RAM and about 59% CPU at one check. |
| Front door | Existing OpenLiteSpeed listeners on **80/443**. No nginx, Caddy, replacement listener or Vercel project. |
| App listeners | Next.js `127.0.0.1:13000`; FastAPI `127.0.0.1:18000`. Port 3000 belongs to another app. Historical service/proxy examples below need these overrides before use. |
| Processes | Separate systemd admin/API services under dedicated non-root `sena-hub-admin` / `sena-hub-api`. Document worker also uses a separate restricted service when H2 is implemented; **disabled for H1**. |
| Data/recovery | Synthetic only. Hub owner makes a protected manual export before every hosted change; normal demo recovery is re-seeding. |
| Identities | Google or confirmed email/password self-signup, followed by Hub admin approval; see doc 33. Anonymous sign-in remains off. No real emails during local preparation. |
| Production | A **new Singapore Supabase project**, separate profile/secrets/data. Revisit Supabase Pro and optional Vercel Pro there only. |

After the gate, IT/operator records OS, CyberPanel/OLS/systemd versions, available
capacity, SSH access, DNS owner, the selected release SHA and rollback contact.
Access CyberPanel/OLS through IT's existing private access or approved SSH tunnel;
do not open their management ports publicly for this task. Do not upgrade the
shared web stack or change its existing website owners, listeners or packages.

Three application prerequisites are **not solved by adding credentials**:

1. **Current Auth and content acceptance:** local Google PKCE callback,
   email OTP, account approval and email-bound invitations are implemented
   (doc 33). The gate is open but real provider acceptance is still untested.
   R2 and hosted Knowledge passed the local implementation/tests in doc 39;
   supplying a key alone does not prove bucket privacy or completed deployment.
2. **Hosted seed/storage wrapper:** `scripts/hosted-test-seed.mjs` exports
   `applyH1Seed(client)`; running the file alone does not seed anything. The local
   simulator preloads generated images into its Storage double. A reviewed hosted
   operator wrapper still must verify target/TLS, upload and hash-check those
   bytes, and call the transactional seed. Never repoint the local simulator.
3. **Worker:** the current document runner requires local PostgreSQL and its OCR
   path is Windows-specific. There is no working hosted Linux worker yet. Leave
   it disabled; do not remove its guards. H2 needs its own adapter and tests.

These are follow-up implementation/acceptance items, not permission to write code
or start H2 in this documentation task. Review the dependency advisory recorded
in the [H1 report](H1_IMPLEMENTATION_20261002.md) before public exposure.

## 2. Take the owner's manual pre-change export

The **Hub owner** records a successful export before each hosted change set,
including the first one. IT may execute it on the owner's behalf. Name the
change, target, time, selected commit and rollback reference. Repeat before a
later independent migration, seed/reset, Auth/storage or site/service change.

Capture the applicable database schema/data and deployment history, role/ACL
inventory, bucket/Auth configuration, and the existing website/systemd settings.
The first export records the pre-Hub baseline even if Hub schemas are absent.
Use the provider-supported export method with credentials loaded privately;
check the exit code and archive inventory. Do not accept a partial/erroring dump.

For an existing Hub schema, an operator may use this **example** after installing
a private libpq service definition `hub_test_export` for the exact TEST project,
port 5432, verified TLS and an authorized export login. Its password file stays
mode 0600; neither file is shown or supplied as an inline connection URI:

```bash
umask 077
export PGSERVICEFILE=/etc/sena-hub-test/pg_service.conf
export PGPASSFILE=/etc/sena-hub-test/pgpass
pg_dump --dbname=service=hub_test_export --format=custom \
  --schema=hub --schema=public_api --schema=staging --schema=audit \
  --schema=internal --schema=rag --schema=ads --schema=ads_export \
  --schema=hub_deployment \
  --file=/protected-owner-export/CHANGE-ID/hub-before.dump
pg_restore --list /protected-owner-export/CHANGE-ID/hub-before.dump \
  > /protected-owner-export/CHANGE-ID/archive-inventory.txt
sha256sum /protected-owner-export/CHANGE-ID/hub-before.dump
```

IT replaces the illustrative protected directory with an owner-controlled path
outside Git and every web root, creates a new private directory per change, and
uses a compatible PostgreSQL client. Select only schemas that actually exist
on first bootstrap; separately cover any existing owner data outside that list.
This dump does not include Auth users, Storage object bytes or global roles.
Record those configuration/ACL inventories separately without exposing secrets;
generated H1 images are reproducible. Reconcile function ownership/RLS with the
reviewed migration profile before any restore; do not blindly restore this dump.
The owner keeps a protected copy outside the VPS and verifies it is readable.
No automatic backup schedule or paid backup product is introduced.

## 3. DNS, CyberPanel website and SSL

1. DNS owner adds `hub-test.sena.co.th A <IT-confirmed VPS IPv4>`. Check resolution
   from the operator's network. Do not add an AAAA record unless IPv6 is configured
   and verified. Do not alter the apex or other website records.
2. In CyberPanel, **Websites → Create Website**, select the dedicated website
   owner/package and exact hostname. Do not enable a mail domain or install
   WordPress/PHP application content. If a PHP selection is required by the panel,
   keep its approved default; Hub requests will be proxied.
3. Preserve the generated document root and `/.well-known/acme-challenge/` static
   handling. Keep application checkout, secrets and exports outside this root.
4. In **SSL → Manage SSL**, select this website and issue **Let's Encrypt** through
   CyberPanel. Verify the certificate hostname/chain and the panel's renewal
   mechanism. Do not install another ACME client or replace shared SSL listeners.

Panel labels can vary by installed version; IT verifies the selected domain
before saving. [CyberPanel website creation](https://cyberpanel.net/KnowledgeBase/home/2-creating-website/),
[CyberPanel SSL](https://cyberpanel.net/blog/how-to-install-an-ssl-certificate-on-your-website).

## 4. Firewall and outbound connectivity

Use **CyberPanel → Server/Security → Firewall** on the installed version. Keep
only the existing approved public HTTP 80, HTTPS 443 and SSH port for inbound
access. Do not open 3000, 8000, database 5432, worker ports, 7080 or 8090 publicly.
Preserve IT's management access and other sites; do not reset the firewall or
introduce parallel UFW/firewalld rules. [CyberPanel firewall](https://cyberpanel.net/KnowledgeBase/home/1-firewall/).

Allow outbound Supabase HTTPS **443** and PostgreSQL **5432**, plus existing DNS,
ACME and approved build-package access. SMTP sending is configured in Supabase
against IT's existing mail service; do not turn the shared VPS into a mail server.
Use the project's actual **Connect → Direct or Session pooler** address; prefer
the supplied Session pooler if the VPS cannot reach the Direct endpoint over
IPv6. Do not guess the pooler index/hostname and do not use transaction port 6543.
Keep certificate/hostname verification enabled. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

Mumbai↔Singapore network delay is accepted for TEST and **not measured yet**.
Record cold/warm login, list and detail timings, plus a small authenticated DB
round-trip sample after authorization. Do not invent an RTT or performance SLA.
Keep one API process with its current pool of 1–5 connections; don't compensate
for latency by spawning workers on the shared host.

## 5. Install a release and separate configuration

IT creates non-root system user `sena-hub` (no interactive/password login) and a
private service state directory. Use versioned releases under
`/srv/sena-hub/releases/<commit>/` and a controlled `/srv/sena-hub/current` link.
Keep code/dependency installation under a deployment identity; the runtime user
needs read access and only its specific cache/state write paths. Do not give it
sudo or share another website's runtime account.

Use the repository-supported Node 24 and Python ≥3.12 with a compatible `uv`.
Do not replace CyberPanel's system Python or globally upgrade other sites' Node.
Build a matching Linux release off-peak or on an approved Linux build host; never
copy Windows `node_modules`/`.venv`. From the selected release directory:

```bash
npm ci
npm ci --prefix apps/admin
uv sync --frozen --project apps/api --no-dev
npm run typecheck --prefix apps/admin
npm run build --prefix apps/admin
```

Builds need a separate reviewed memory/CPU budget and approved package/font
network access. Do not run them inside the runtime limits below or increase
shared-host resources without IT review. Test dependency fixes before deployment.

Create `/etc/sena-hub-test/` outside the checkout; systemd reads root-owned mode
0600 environment files. The admin file has only its public configuration:

```dotenv
NODE_ENV=production
HUB_ENV=hosted-test
HUB_AUTH_MODE=supabase
HUB_ADMIN_ORIGIN=https://hub-test.sena.co.th
HUB_API_URL=https://hub-test.sena.co.th
NEXT_PUBLIC_SUPABASE_URL=https://eqlrtevwpyboplljgowo.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<IT-supplied sb_publishable_ key>
```

The API file contains `HUB_ENV=hosted-test`, `HUB_AUTH_MODE=supabase`,
`HUB_ADMIN_ORIGIN=https://hub-test.sena.co.th`,
`HUB_SUPABASE_URL=https://eqlrtevwpyboplljgowo.supabase.co`, plus privately supplied
`HUB_DATABASE_URL` (restricted `hub_runtime`, `/postgres`, 5432,
`sslmode=verify-full`, optional `sslrootcert`), `HUB_R2_CREDENTIALS_FILE` and
`HUB_R2_PRIVATE_BUCKET_CONFIRMED=1` **only after** the dashboard privacy check.
Do not configure `HUB_SUPABASE_STORAGE_KEY`; real hosted settings now reject it.
The Session-pooler runtime username is `hub_runtime.eqlrtevwpyboplljgowo`.
Only the API can read the protected R2 JSON file; Next receives neither its path
nor its contents. The actual origin is the IP shown above, not the historical
hostname in the example environment.

The separate operator-only `migrations.env` contains
`HUB_SUPABASE_TEST_PROJECT_REF=eqlrtevwpyboplljgowo`,
`HUB_SUPABASE_TEST_ADMIN_DATABASE_URL`, a separate random base64url
`HUB_SUPABASE_TEST_RUNTIME_PASSWORD` of at least 32 characters, and optionally
`HUB_SUPABASE_TEST_SSL_CA_FILE`. Never give migration/Auth-admin credentials to
the admin/API service. Do not copy workstation `.env` files wholesale. Omit all
`HUB_DEMO_*`, `HUB_HOSTED_TEST_SIMULATION` and OpenAI keys from hosted H1 services.
Do not print environment files or use shell tracing while handling them.

## 6. Supabase preflight, private bucket and synthetic seed

After the gate and owner's export, use the operator environment for a **read-only
preflight first**. From the release root, with file access limited to the operator:

```bash
node --env-file=/etc/sena-hub-test/migrations.env \
  scripts/supabase-test-migrations.mjs --project-ref eqlrtevwpyboplljgowo
```

Record safe pending/applied counts and profile hashes. Refuse foreign history,
changed checksums, unexpected owners or an enabled issuance flag. Do not repeat
the denied `GRANT SET ON PARAMETER`, rewrite canonical `0014`, or relabel history.
If the preflight matches the reviewed plan and the export is valid:

```bash
node --env-file=/etc/sena-hub-test/migrations.env \
  scripts/supabase-test-migrations.mjs --project-ref eqlrtevwpyboplljgowo --apply
```

Verify all 25 canonical/executed hashes and exact replay; both
`sena_h_approved=false` and `hosted_test_issuing_enabled=false` must remain false.
The runner applies no Auth users or fixture data. Provision only the private
`hub-test-assets` bucket: no public read/write/list policy; preserve SVG
sanitization, rights gates, per-file RLS and audit in the API.

Complete the hosted seed/storage wrapper from step 1 before using it. It must
upload immutable, checksum-addressed bytes from `syntheticAssets()`, check remote
hashes, then call `applyH1Seed(client)` with the verified operator connection.
Record one brand/project/model/promotion/release, three assets and two agency
campaign examples. Exact replay is a no-op; changed seed input refuses. Do not
use local `dev:migrate`, `dev:demo`, document/assistant seeders or simulation
metadata against Supabase. H2 finance/actuals/document/assistant tables stay
inactive; hosted DW reader provisioning stays deferred.

## 7. Systemd services and resource ceilings

Initial **proposed limits**, to verify with IT on the actual systemd/cgroup
version. They are caps, not capacity reservations or benchmark results:

| Service | Processes/jobs | CPUQuota | MemoryHigh / MemoryMax | TasksMax |
|---|---|---|---|---|
| `sena-hub-test-admin` | One Next server; no PM2/cluster duplication | 50% | 768M / 1536M | 128 |
| `sena-hub-test-api` | One Uvicorn worker; DB pool 1–5 | 50% | 384M / 768M | 64 |
| `sena-hub-test-worker` — H2 only | One job at a time; disabled now | 25% | 512M / 1G | 64 |

CPU percentages use one CPU as 100%; they are not percentages of all four cores.
Use `MemoryHigh` for pressure control and `MemoryMax` as a last limit. Check
support and actual enforcement before startup. [systemd resource controls](https://github.com/systemd/systemd/blob/main/man/systemd.resource-control.xml).

Example `/etc/systemd/system/sena-hub-test-admin.service`:

```ini
[Unit]
Description=SENA Hub TEST admin
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=sena-hub
Group=sena-hub
WorkingDirectory=/srv/sena-hub/current/apps/admin
EnvironmentFile=/etc/sena-hub-test/admin.env
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/bin/node /srv/sena-hub/current/apps/admin/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/srv/sena-hub/current/apps/admin/.next/cache /var/lib/sena-hub
CPUQuota=50%
MemoryHigh=768M
MemoryMax=1536M
TasksMax=128

[Install]
WantedBy=multi-user.target
```

Example `/etc/systemd/system/sena-hub-test-api.service`:

```ini
[Unit]
Description=SENA Hub TEST API
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=sena-hub
Group=sena-hub
WorkingDirectory=/srv/sena-hub/current
EnvironmentFile=/etc/sena-hub-test/api.env
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/srv/sena-hub/current/apps/api/.venv/bin/uvicorn sena_hub_api.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 1 --limit-concurrency 32 --no-proxy-headers --no-access-log
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/sena-hub
CPUQuota=50%
MemoryHigh=384M
MemoryMax=768M
TasksMax=64

[Install]
WantedBy=multi-user.target
```

Resolve the actual Node path instead of assuming `/usr/bin/node`; create the
cache/state directories and grant only those write permissions first. Check
units with `systemd-analyze verify`, then `systemctl daemon-reload`. Start API,
verify its loopback `/health`, then start admin and verify `/login`. Enable the
two services at boot only after acceptance. Check their `User`, memory use,
restart count and CPU consumption; inspect restricted journald logs without
dumping environment values. These units have not been executed on the VPS.
[systemd execution settings](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml).

Do **not** create an enabled worker unit pointing at the existing local runner.
Reserve its service name/limits above; H2 will add the tested Linux/hosted
`ExecStart`, restricted worker credentials and job state paths. No worker,
assistant or external model/OCR process runs during H1.

## 8. Configure only this OpenLiteSpeed virtual host

After exporting the current site configuration, use CyberPanel's website manager
and its vhost configuration/rewrites facility for **hub-test.sena.co.th only**.
If the installed panel does not expose a field, IT uses the existing private OLS
WebAdmin route to that same vhost; do not overwrite the global configuration.

Define two **Web Server** external applications at vhost scope:

| Name | Address | Max connections | Initial timeout | Retry timeout | Response buffering |
|---|---|---|---|---|---|
| `hub_test_admin` | `127.0.0.1:3000` | 16 | 60 seconds | 0 | No |
| `hub_test_api` | `127.0.0.1:8000` | 8 | 60 seconds | 0 | No |

These names are OLS external-app names, not public DNS hosts. Enable rewrites
and use one authoritative website rule set, not competing vhost and `.htaccess`
copies. Keep CyberPanel's ACME static context and necessary generated settings.
Proposed rewrite body (validate against the installed OLS version):

```apache
RewriteCond %{REQUEST_URI} ^/\.well-known/acme-challenge/
RewriteRule .* - [L]

RewriteCond %{HTTPS} !=on
RewriteRule ^ https://hub-test.sena.co.th%{REQUEST_URI} [R=301,L]

RewriteRule ^/?(v1(?:/.*)?|health)$ http://hub_test_api/$1 [P,L,E=PROXY-HOST:hub-test.sena.co.th]
RewriteRule ^/?(.*)$ http://hub_test_admin/$1 [P,L,E=PROXY-HOST:hub-test.sena.co.th]
```

The optional initial slash covers vhost/context rewrite conventions. Keep query
strings and original `/v1/...` paths; do not strip `/v1` or add a FastAPI root
prefix. `/api/hub/*` belongs to **Next**, whose session-verified JSON proxy then
calls the public same-origin `/v1/...` route. Direct asset fetches also use `/v1`
with bearer authorization. Ensure the VPS can resolve/reach its own public HTTPS
origin; do not work around routing problems with a hosted loopback `HUB_API_URL`,
which the current configuration guard rejects.
[OLS reverse proxy](https://docs.openlitespeed.org/config/reverseproxy/),
[OLS rewrite semantics](https://docs.openlitespeed.org/config/rewriterules/).

Preserve Host, Authorization, Cookie/Set-Cookie and the browser's original Origin.
Never manufacture or overwrite Origin with the Hub origin: that would undermine
the Next.js proxy's cross-origin write check. API uses `--no-proxy-headers`;
authorization does not trust forwarded identity headers. Verify the installed
OLS version's proxy-derived HTTPS/host headers and rejection/normalization of
client-supplied forwarding headers; do not assume they are stripped automatically.
Every Location header must stay on the HTTPS Hub origin, including API slash
redirects; use canonical routes and investigate any HTTP redirect before acceptance.
Allow at least a 10 MiB **raw request body** and appropriate header limits for
`Content-Type`/`X-Filename`; Hub uploads are not multipart. Keep the API's existing
size validation. Disable LSCache for this Hub vhost;
do not cache authenticated pages, JSON or private files. Keep logs private and
exclude bearer/cookie values and invite/token query strings.

Retain the app's `noindex, nofollow` robots metadata and add the site-specific
response header `X-Robots-Tag: noindex, nofollow, noarchive` through the installed
OLS vhost/context Header Operations UI (`set X-Robots-Tag noindex, nofollow, noarchive`).
Verify it reaches proxied HTML/API/error responses, not only static files. Do not
replace a proxy context with a static one just to add the header, and do not
override the API's SVG CSP or `nosniff`. [OLS custom headers](https://docs.openlitespeed.org/config/headers/).

Run `sudo /usr/local/lsws/bin/openlitespeed -t` before applying the configuration.
IT then uses the existing panel/OLS **graceful restart** action. This reload is
shared across websites; it is not a guaranteed per-site restart. Do not stop the
server, replace its listeners or restart nginx/Caddy. Check existing websites
before and after, plus a harmless ACME challenge test path and SSL renewal setup.
[OLS configuration test/restart commands](https://docs.openlitespeed.org/commands/).

## 9. Invite-only users on one owner mailbox

The owner privately supplies a mailbox that accepts plus-addressing. Use the
seven aliases/roles in doc 27 §4; give each a distinct Auth UUID and password.
They are owner-controlled demo personas, not seven independently owned inboxes.
Keep `hub_role` and agency `hub_agency` in **app_metadata**, assigned only by an
authorized Auth administrator. Do not grant roles from the email suffix or
user-editable metadata.

1. Verify one alias is delivered to the owner using IT's approved mail procedure.
2. Configure only existing approved SMTP if needed. Supabase's default sender
   restricts recipient addresses; plus-addresses are not automatically team
   members. Do not add these personas to the Supabase project team to make email
   work, purchase a sender, or expose SMTP credentials to Next.
3. Disable public sign-up/anonymous users; set the Site URL to
   `https://hub-test.sena.co.th` and use exact allowed redirects for the **tested**
   invitation flow. Verify ES256/RS256 JWT signing/JWKS; H1 rejects HS256.
4. Complete step 1's onboarding implementation, test one invite and password
   setup end to end, then provision the remaining approved aliases. Never print
   one-time links or passwords. Refresh/sign in again after trusted role changes.
5. Validate all seven roles separately, including KIN/COMBAY isolation. Missing
   metadata must deny access; no hosted local-role selector.

[Supabase email restrictions](https://supabase.com/docs/guides/auth/auth-smtp),
[Supabase admin invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).

## 10. Accept the hosted demo before enabling it for presentations

- Confirm correct TLS, single origin and `noindex`; keep visible Thai
  TEST/`ข้อมูลตัวอย่าง` labels. Confirm no other website was changed.
- Verify only loopback listens on 3000/8000 (for example, `ss -ltnp` on the VPS),
  and IT's external port check sees no application port. Check CyberPanel rules.
- Through the public hostname, test login/refresh/logout, all seven roles,
  residential edits/review/release, private SVG/file delivery and agency inbox.
  Anonymous/forged JWTs must fail; one agency must not read another's rows.
  Cross-origin writes through `/api/hub` must return 403, and forged forwarding
  headers must not change the redirect host/scheme or grant access.
- Check `sena_h_approved=false`, TEST issuing false, disabled creation controls,
  pending-approval banner, and unavailable Thai H2 pages/direct-API rejection.
- Check fixture counts and object hashes. Re-run the approved seed to prove no-op
  replay; do not run the normal local integration suite against the cloud.
- Record representative Mumbai↔Singapore latency and service CPU/RAM/restarts
  during a short synthetic walkthrough; no hosted performance claim until then.
  Reduce load/stop Hub if other sites degrade; do not raise limits blindly.
- Record release/profile hashes, export receipt and test outcomes without PII,
  tokens, connection strings or secret files. Enable admin/API boot startup only
  after the owner accepts this result. Worker remains disabled.

## 11. Demo-day resume, later changes, rollback and teardown

Before each demo, the Hub owner checks Supabase and **manually resumes** the Free
project in its Dashboard if paused; wait for readiness, then check login, health,
assets and registry. A normal resume preserves data; don't reset it merely for
being paused. Respect step 2 before any hosted change and retain the latest
pre-pause export receipt; if exports are impossible while paused, record that
and perform only the non-destructive resume, then export before the next change.
No keep-alive schedule or paid upgrade. [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

For every later hosted mutation, the owner first exports the current state/config.
Deploy to a new release directory and retain the previous release reference.
On an app/proxy regression, restore only this website's prior config and release,
restart only Hub admin/API services, then use the shared OLS graceful action only
if proxy config changed. Recheck other websites. Do not automatically reverse a
DB migration; review schema compatibility before running old code against it.

For lost disposable TEST data, use the approved exact-target rebuild/re-seed
procedure and regenerate image bytes; do not bypass target/hash guards or treat
ordinary seed replay as a reset. If a new project is needed, obtain an explicit
target change first. No TEST rows or synthetic Auth identities go to production.

Teardown needs a separate owner instruction. Export the pre-change state, disable
only Hub services/users, remove only this site's DNS/vhost and private TEST
resources, and preserve CyberPanel, shared 80/443 listeners and other websites.
No teardown, DNS change, invitation, migration, deployment or remote connection
has occurred while writing this runbook. **STOP until “credentials ready”.**
