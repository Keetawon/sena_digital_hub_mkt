# Supabase test project — P1 registry

The owner authorized applying Hub migrations to a **dedicated test project** on
29 September 2026 (Asia/Bangkok): `eqlrtevwpyboplljgowo`,
`https://eqlrtevwpyboplljgowo.supabase.co`.

## Local configuration

The ignored repository-root `.env.supabase-test` contains the supplied project URL
and reference. It is a separate operator profile, not an environment file loaded
automatically by Next.js or the API. The existing `apps/api/.env` and
`apps/admin/.env.local` continue to run the local demo.

| Variable | Purpose / current setup |
|---|---|
| `HUB_SUPABASE_TEST_PROJECT_REF` | `eqlrtevwpyboplljgowo`; guards the migration target |
| `HUB_SUPABASE_URL` | Supplied HTTPS project URL; later used by API JWT verification |
| `HUB_SUPABASE_TEST_ADMIN_DATABASE_URL` | Operator fills the actual administrative PostgreSQL URI locally; initially blank |
| `HUB_SUPABASE_TEST_RUNTIME_PASSWORD` | A separate randomly generated base64url secret (at least 32 characters) for the restricted `hub_runtime` database login |
| `HUB_SUPABASE_TEST_SSL_CA_FILE` | Optional path to the project's CA certificate, if needed for verified TLS |
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL, reserved for browser authentication wiring |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Operator supplies the public/publishable key from the dashboard; initially blank |

Copy the PostgreSQL URI from **Supabase Dashboard → Connect**, using Direct
connection or Session pooler on port 5432. Direct connections need IPv6 availability;
Session pooler supports IPv4 and prepared statements. Copy the actual pooler host
and project-qualified username from the dashboard; do not invent its region.
See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Replace the URI's password placeholder and percent-encode URI-reserved password
characters. Keep credentials in the ignored file, never in chat, command arguments,
logs or a `NEXT_PUBLIC_` variable. A publishable key cannot apply SQL migrations.
The setup uses verified TLS; an invalid certificate must be resolved with the
correct certificate/host rather than disabling verification.

The Session pooler required Supabase's CA. The ignored profile now points to
`.local/certs/supabase-prod-ca-2021.crt`, downloaded over verified HTTPS from the
[production certificate URL](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)
used by Supabase's [official dashboard configuration](https://github.com/supabase/supabase/blob/529e4a536670c363d8fcb2a0d983b8658af3ef13/apps/studio/hooks/custom-content/custom-content.json).
Its SHA-256 fingerprint is
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
The client keeps certificate/hostname verification enabled and checks the
authenticated TLS socket. `pg_stat_ssl` describes the pooler's PostgreSQL backend
connection, so it cannot establish whether the client-to-pooler connection uses
TLS ([PostgreSQL reference](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW)).

## Migration scope

Only migrations `001` through `014` belong to this P1 setup. Existing migration
files remain immutable. The hosted runner must not load the local sample fixtures,
copy local pilot data, create authentication users or enable SENA-H issuance.

Run from the repository root, after filling the connection string:

```powershell
# Read-only preflight; this is the default.
node --env-file=.env.supabase-test scripts/supabase-test-migrations.mjs --project-ref eqlrtevwpyboplljgowo

# Apply to the already authorized dedicated test project.
node --env-file=.env.supabase-test scripts/supabase-test-migrations.mjs --project-ref eqlrtevwpyboplljgowo --apply
```

The named reference must match both the environment and the direct hostname or
session-pooler username. The runner rejects unrecognized existing Hub schemas,
roles or migration history. It records each migration and its checksum in private
`hub_deployment` tables in the same transaction as that migration. A deployment
lock prevents two runner processes from applying migrations concurrently. Replays
verify recorded checksums rather than reapplying SQL.

Migration `0014` transfers functions/views to dedicated owner roles. The runner
temporarily grants the migration login the membership and schema CREATE rights
needed by managed PostgreSQL for those transfers, then restores/revokes those
grants before committing. It does not edit the migration file. The runtime login
has `NOINHERIT`, `NOBYPASSRLS` and membership only in the seven API actor roles;
it has no writer/export-owner membership. An existing runtime password is not
rotated by a replay.

There is also a managed PostgreSQL prerequisite: immutable migration `0014`
stores `SET app.ads_test_issuing='off'` on `ads.require_issuance()`. PostgreSQL
requires the migration login to have `SET` permission for that custom parameter
(or be a true superuser). An ordinary `CREATEROLE` login cannot grant itself this
permission. The hosted preflight checks it before applying any migration; a
platform administrator with the required authority must grant it if absent.
The grant permits creating the function configuration; it does not approve
SENA-H or enable test issuance. Do not remove the function-local `off` setting or
give the runtime login owner privileges as a workaround. See PostgreSQL's
[parameter privileges](https://www.postgresql.org/docs/16/sql-grant.html) and
[custom-parameter validation](https://doxygen.postgresql.org/guc_8c_source.html).

**Confirmed hosted blocker:** the supplied project's `postgres` login on
PostgreSQL 17.6 has neither SET nor its grant option for this parameter. A
temporary function probe also failed with SQLSTATE `42501`; its transaction was
rolled back. A database administrator with the required grant authority must run:

```sql
GRANT SET ON PARAMETER app.ads_test_issuing TO postgres;
```

The ordinary project `postgres` login cannot grant itself this permission.
Supabase's [privileged-role implementation](https://github.com/supabase/supautils/blob/master/src/privileged_role.c)
does not supply a special path for `CREATE FUNCTION ... SET` or parameter ACL
grants. If the managed platform cannot provide this narrow grant, a reviewed
migration design change is required. A later migration cannot fix a failure
before `0014` completes; do not silently rewrite its SQL or mark it applied.

Do not repoint `dev:db`, `dev:migrate`, `test:db`, API integration tests or the
existing UI tests at this project. Those commands belong to the local development
cluster and its fixtures. The local migration runner also loads sample data and
enables a local-only naming test override.

## Browser login remains a separate integration step

Saving the project URL and applying the schema do not sign users in. The current
admin session and proxy accept explicit local demo mode only. The API already
verifies Supabase ES256/RS256 JWTs and reads trusted `app_metadata.hub_role`, plus
`app_metadata.hub_agency` for agencies; the browser session flow is still required.

The next integration must use the dedicated runtime database login, verified
Supabase sessions and explicitly provisioned Online/agency test identities.
Agencies retain access to their own names and may return native IDs only.
Client-selected role headers or editable `user_metadata` cannot grant access.
See the [Supabase server authentication guide](https://supabase.com/docs/guides/auth/server-side).

Keep `sena_h_approved=false`. Hosted test issuance needs a separate explicit test
policy before it can be exercised while approval is pending. Do not use the
production approval setting to make a test pass. Real scope activation and
production use remain gated by the [P1 handoff](P1_IMPLEMENTATION_20260929.md).

## Verification on 29 September 2026

- `node --check scripts/supabase-test-migrations.mjs`: exit 0.
- `node --test tests/supabase-test-migrations.test.mjs`: 7 passed, 0 failed
  (including the added pooler-aware TLS check).
- `tests/supabase-test-migrations.integration.test.mjs`, explicitly enabled with
  `HUB_RUN_MIGRATION_INTEGRATION=1` against an isolated PostgreSQL 17 cluster on
  port 55434: 1 passed, 0 failed. The test refuses a different data-directory
  suffix. It requires a fresh disposable cluster and is skipped by default.
- That integration used a non-superuser migration login, first proved that
  missing parameter permission stops before any schema changes, then tested
  with only that permission supplied by the disposable cluster administrator.
  All fourteen migrations, exact replay, changed-checksum refusal, atomic
  rollback/history, restored temporary permissions, export-reader permissions,
  runtime isolation and pending approval were checked. Test database/roles were
  removed and the separate server stopped. The regular local database was not
  used for this integration.
- Hosted connection and credentials are **verified** through the supplied
  Session pooler with certificate/hostname validation. URI password characters
  were encoded locally without display. The earlier Direct endpoint was IPv6-only
  and returned `ENOTFOUND`; the initial pooler connection needed the official CA.
- Hosted migration preflight **stopped before any migration** on the confirmed
  parameter permission above. Actual output:

  ```text
  Migration 0014 requires SET ON PARAMETER app.ads_test_issuing for the migration login. Ask the managed database administrator to grant that narrow privilege; this runner cannot self-elevate. No migration applied.
  ```

  A separate temporary-function permission probe returned SQLSTATE `42501` and
  was rolled back. No Hub migrations or persistent remote changes were applied.

These checks validate migration tooling locally and the hosted database
connection, not hosted application authentication, browser login or cloud acceptance. App build/API/UI suites
were not rerun for this tooling-only change; their prior results remain in the
P1 handoff and access-fix notes.
