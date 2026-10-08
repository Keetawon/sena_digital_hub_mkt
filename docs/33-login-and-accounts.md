# Login and accounts MVP

Owner decisions: **7 October 2026**. Implementation and verification are local
only, synthetic identities only, no hosted requests and no real emails. Hosted
execution remains blocked until the owner says **“credentials ready”**. This
supersedes the invite-only and JWT-metadata-role rules in doc 27 §4 and Q12.

## Identity and access

### Owner decisions — 8 October 2026

1. Admins may invite by email for **14 days**. Invitations cannot grant `admin`
   or `service_consumer`; promote to admin through account management after first
   sign-in. The existing single `hub_role` remains; per-tab permissions are later.
2. Only **REJECT** and **SUSPEND** reasons are user-visible. `decision_note` on
   the account row holds that reason; approve, role change, reactivate and reopen
   clear it. Every action note remains in admin-only `user_account_event` history.
   `/v1/me` never returns admin-only notes. Migration 44 clears legacy visible notes
   on other statuses without deleting audit history.
3. New/edited requests and invitation acceptance require company and position.
   Existing accounts keep NULL fields, displayed as **ยังไม่ระบุ**.
4. Company types: `SENA` = **เสนาดีเวลลอปเมนท์**;
   `SENA_SUBSIDIARY` = **บริษัทในเครือเสนา** (name required);
   `AGENCY` = **เอเจนซี** (name required for a self-request);
   `CONTRACTOR` = **ผู้รับจ้างภายนอก** (name required).
   Position is **1–100 characters**, as clarified by the owner. The existing team
   field is now **ทีม / ฝ่าย**. Names/team remain capped at 200 characters.

### Email invitations and confirmation proof

`hub.account_invite` stores normalized lower/trimmed email, display hint,
company/team, one allowed role and optional agency code, creator, creation/expiry,
acceptance and cancellation. A partial unique index allows one INVITED row per
email. EXPIRED is derived at read time; a new invitation retires an expired row.
Admins can extend an INVITED row to 14 days from now or cancel it. Both use the
expected `expires_at` as a stale-write guard. All changes are audited with an
`invite_id`; there are no direct app grants on the table.

Creating an invitation for an existing Hub email returns `account_exists` and the
account UUID, with **เปิดบัญชีเดิม** in the UI. A live duplicate, admin/service role,
or invalid agency is refused. Agency invitations lock company to the canonical
agency code; validity is checked again when accepting. The UI displays the
configured admin origin plus `/login`, a copy button and **สิทธิ์ผูกกับอีเมล
ไม่ได้ผูกกับลิงก์**. No invitation email is sent. The link is public navigation,
not a bearer credential, and has no token or email query parameter.

After verified sign-in, a matching live invitation offers **ตอบรับคำเชิญ**:
Thai full name, phone, position, prefilled company/team, privacy acknowledgement.
Acceptance runs under the same advisory lock as account decisions and invite
creation, then locks the account/invitation. It rechecks status, expiry, agency
and confirmation; sets ACTIVE with the invitation’s role/agency and
`decided_by = created_by`; marks ACCEPTED; appends `INVITE_ACCEPT`. Acceptance is
explicit and single-use. Expired/cancelled invitations show the normal request
with an explanatory Thai message.

Email proof is **the protected `auth.users` row**: a SECURITY DEFINER helper reads
the row by the JWT-verified `sub`, requires non-null `email_confirmed_at`, and
compares the current Auth email case-insensitively with the invitation and Hub
row. Neither `user_metadata`, `app_metadata`, a browser field, nor a role-bearing
JWT is accepted as proof. Auth `created_at` and Hub `created_at` must not predate
the invitation. Thus an older identity cannot gain an invitation’s role; use the
queue/account panel instead. Missing Auth storage/confirmation fails closed.
The runtime has no direct Auth-table grant; the function is the only reader.
Before hosted acceptance, verify that the migration/function owner can SELECT
`auth.users(id,email,email_confirmed_at,created_at)` without a service key.

The loopback simulation has a protected synthetic `auth.users` table written by
the mock Auth operator callback on signup/confirmation/Google sign-in. API tests
also prove that metadata claiming admin or an unconfirmed email cannot match.
No hosted call is needed for matching: the lookup stays inside PostgreSQL.

Endpoints: `GET/POST /v1/admin/account-invites`,
`POST /v1/admin/account-invites/{id}/decision`, `POST /v1/me/invite-accept`.
Both Next proxy and H1 route allowlists include these paths. Account/request data
has no assistant, export, RAG or embedding route.

### Local redesign evidence

Baseline reproduction on `34a6c36` returned HTTP 200 / ACTIVE, removed the pending
`details` row, and rendered zero success-status messages. Evidence is in ignored
`artifacts/accounts-baseline-feedback.json` and `.png`. The requester page also
had a one-shot fetch, confirmed by source inspection. This was a feedback gap,
not a failed approval; the existing stale/agency/server checks remain intact.

New screenshots (local generated evidence; never committed):

- `artifacts/accounts-queue.png`
- `artifacts/accounts-users.png`
- `artifacts/accounts-manage.png`
- `artifacts/accounts-manage-self.png`
- `artifacts/accounts-manage-last-admin.png`
- `artifacts/accounts-invite-create.png`
- `artifacts/accounts-invite-accept.png`
- `artifacts/accounts-mobile.png`

The self/last-admin screenshots use the same sole synthetic admin, because a
real authenticated active admin viewing the sole active admin is necessarily
viewing their own account. Server checks independently guard both rules.

The redesign reuses existing tokens, with no new palette. Measured text contrast:

| Foreground / background | Ratio |
|---|---:|
| ink / surface | 15.23:1 |
| muted / surface | 6.23:1 |
| muted / surface-warm | 5.15:1 |
| success-strong / success-soft | 6.81:1 |
| danger / danger-soft | 5.94:1 |
| action / surface | 9.00:1 |

Sign in with Google or email/password. Self sign-up is allowed. Every new identity
has a PENDING Hub account. Self-registered users submit an access request; an eligible email invitation allows explicit acceptance after completing the short profile form. Supabase JWTs
prove identity only; neither app_metadata nor user_metadata authorizes access.
Provider data set by Supabase supplies the display-only sign-in method; editable
profile names are only initial suggestions on the request form.

`hub.user_account`, keyed by Auth UUID, stores the verified email, display name,
work phone, company type/name, position, team/department, requested tasks, reason, privacy acknowledgement, status,
role, agency code and decision fields. `hub.user_account_event` records decisions
and request edits without copying personal request text into immutable history.
API responses and evidence retain UUIDs; staff screens resolve display names.
Requests never enter assistant tools, exports, RAG, embeddings or indexing.

Super user = `admin`. Only ACTIVE admins approve accounts/change roles. Manager =
existing `publisher`, labelled **Manager · อนุมัติและเผยแพร่**; its existing approve
and publish permissions remain unchanged. Agency approvals require an ACTIVE,
canonical, date-valid code from `ads.vocab`; existing agency RLS is unchanged.

FastAPI verifies the JWT then performs one primary-key account lookup per request,
with no role cache. ACTIVE accounts keep that single indexed lookup; only an unsubmitted PENDING account needs the extra invitation/Auth proof lookup. Only ACTIVE accounts receive a role. PENDING, REJECTED and
SUSPENDED accounts can call `GET /v1/me`, `POST/PATCH /v1/me/access-request` (edits
are accepted only while pending), `POST /v1/me/invite-accept` (eligible pending identities only), and Auth sign-out. Other data routes reject
them. `/health` remains public. Next.js uses `/v1/me` for redirects and navigation.
The local persona picker remains, with matching synthetic ACTIVE table rows.

## Flows

- `/login`: **เข้าสู่ระบบด้วย Google**, email/password, **สมัครด้วยอีเมล** and
  **ลืมรหัสผ่าน**. Environment label comes from `HUB_ENV_LABEL` (fallback `HUB_ENV`).
- Google uses `signInWithOAuth` through `@supabase/ssr` PKCE cookies;
  `/auth/callback` exchanges the code and routes inactive accounts to the request.
  Both login and callback sanitize `next` using the shared navigation route list,
  including `/knowledge`. Redirects stay on the configured admin origin.
- `/signup`: password at least 12 characters plus confirmation. With Confirm email
  enabled, Supabase sends a six-digit code. `/signup/verify` calls
  `verifyOtp({type: 'email'})`, then opens `/account/request`.
- `/login/forgot`: a generic Thai response regardless of account existence,
  recovery OTP verification, new password/confirmation, then global sign-out.
  Supabase invalidates refresh sessions; already issued access JWTs follow
  Supabase's configured expiry. Configure a short access-token lifetime for this
  reason. The Hub never treats an old JWT's role as current authority.
- OTP resend cooldown is 60 seconds; UI permits at most five verification attempts
  per code. Supabase's server rate limits are the authoritative abuse boundary;
  configure those before hosted acceptance. The mock enforces five attempts,
  ten-minute expiry, one-use codes, and resend throttling independently of UI.
- `/account/request`: prefilled name/email, Thai full name, work phone, team or
  company type/name, team/department, position, task checkboxes, reason/projects and privacy acknowledgement.
  Suggested roles: read→viewer, edit→editor, publish→publisher,
  online→online_staff, agency→agency. Suggestions never grant access.
- After submission: **รออนุมัติ**, request summary/status, optional configured admin
  contact, edit while pending. Rejected users see the decision reason; suspended
  users see the suspension reason. ACTIVE users can enter their workspace.
- An API 401 shows a Thai banner linking to sign-in in a new tab and the same
  page. It does not navigate, reload or reset the current form. Users return to
  their original tab and retry saving; existing dirty guards remain active.

## ผู้ใช้และสิทธิ์

`/admin/accounts` is admin-only. The header action **+ เพิ่มผู้ใช้** creates an email
invitation. Tabs are **คำขอรออนุมัติ (n)** / **ผู้ใช้ทั้งหมด** / **คำเชิญ (n)**.
The sidebar and queue count submitted PENDING requests only. Signed-in accounts
without a submission remain in **ยังไม่ส่งคำขอ**, with no approval action.

Queue cards show the full request and preselect the task-based suggested role;
admin is excluded from queue approval. The approval button follows the role label.
Agency approval requires a canonical/date-valid agency code. Reject opens an
inline required reason. A durable `role="status"` message confirms every decision.
**ตัดสินใจแล้ววันนี้** uses account events from every admin and Bangkok dates;
**เปิดบัญชี** opens the managed account. Today’s decided users show **ใหม่**.

The users table searches name/email/company/team and filters status/role. It
scrolls within its own container at 400 px. **จัดการ** opens a native right-side
modal dialog: focus enters, stays inside, Escape closes, and focus returns to the
opener. Role cards include one-line descriptions, a before/after diff, and an
inline checkbox before granting admin. Save requires a change. Suspend has a
separate required user-visible reason. Self is read-only; last-admin removal is
disabled with an explanation. Database checks remain authoritative. No new UI
animations or transitions and no `window.confirm` in account flows.

Errors stay beside the action. A stale 409 offers **โหลดข้อมูลล่าสุด** and keeps
typed notes and selections. `/account/request` reads `/v1/me` every 30 seconds
while visible, and on focus/visibility changes. Status changes in place without
navigation; dirty form values remain and an ACTIVE account gets a workspace link.
Google names without Thai are placeholders. Thai per-field validation preserves
input; phone patterns match the API.

Admins can **เปิดรับคำขออีกครั้ง** (`reopen`) on a rejected account that has not been
anonymised. The prior rejection note is preserved in private audit history. The
row becomes PENDING with its request text intact, but must acknowledge privacy
and submit again before approval. Retention also scrubs audit note text.

Security-definer decisions recheck the actor in the table, forbid self decisions,
require an unchanged `updated_at`, and serialize concurrent decisions under a
transaction lock. At least one active admin remains. App roles cannot directly
update status/roles or mutate audit events. Users read only their own full row;
admins read all; staff directory access returns only UUID/display name.

Rejected personal fields, including company name and position, are removed after 90 days by the operator maintenance
command below. Audit account/actor references for those requests are anonymised;
the anonymous transition record remains. The purge is the sole operator-only
exception to append-only events and cannot be invoked by app roles. Later sign-in
does not restore scrubbed fields. Schedule this command daily when hosting is
authorized; the local MVP has no hosted scheduler.
**Purge scheduling owner: TBD at hosting time.**

Operations must maintain **at least two ACTIVE admins**. `promote-admin` works
only when no active admin exists. A single admin locked out of their Auth account
has no in-app administrative recovery path; the bootstrap command does not
override that existing admin.

```powershell
uv run --project apps/api python scripts/hub-accounts.py promote-admin --email synthetic@example.test
uv run --project apps/api python scripts/hub-accounts.py purge-rejected
```

Local is the default. The first admin must already have signed in once, creating
a verified account row. Bootstrap refuses when any active admin already exists.
For the allowlisted hosted TEST, add `--hosted`, provide the operator PostgreSQL
connection privately via `HUB_SUPABASE_TEST_ADMIN_DATABASE_URL`, and type the
displayed confirmation. Never execute it until “credentials ready”. No Supabase
service key is used for account creation, decisions, bootstrap or retention.

## Owner setup checklist — perform later

The owner configures their Workspace mailbox and Google Cloud project. SMTP
passwords and OAuth client secrets go **only into the Supabase dashboard**, never
the repo, chat, Next environment or API environment.

1. Google Cloud: External OAuth consent screen; request only `openid`, `email`,
   `profile`. Publish the consent screen (not Testing). Create a web OAuth client
   with authorized redirect `https://<project>.supabase.co/auth/v1/callback`.
2. Supabase Auth: enable Google and enter the client ID/secret in the dashboard.
   Enable self-signup and **Confirm email**; disable anonymous sign-in. Set minimum
   password length 12, email OTP length six and expiry 600 seconds. Review Auth
   rate limits, including verification attempts and email resend cooldown.
3. Configure custom SMTP using the owner's Workspace mailbox. Verify sender and
   delivery prerequisites in that Workspace account. Paste the Thai templates
   from `docs/auth-templates/confirm-email.html` and `recovery.html`. They use
   `{{ .Token }}` only, with no confirmation/recovery link.
4. Set Site URL to the actual admin HTTPS origin. Allowlist the exact admin
   `/auth/callback` URL (including the intended query handling), with no wildcard
   domains. Local simulation is independently fixed to loopback; never copy
   simulation keys or URLs into hosted settings.
5. Public Next configuration: `HUB_AUTH_GOOGLE=1` when Google is configured;
   `HUB_AUTH_PASSWORD=1` only when SMTP/OTP is ready. Both default off. The latter
   hides and redirects signup/reset pages; existing password sign-in remains.
   These presentation flags do not replace Supabase provider settings. Set
   `HUB_ENV_LABEL`; optionally set `HUB_ADMIN_CONTACT` (empty by default).
6. After “credentials ready”: self-register the seven TEST accounts from doc 27,
   bootstrap the first admin, submit and approve requests, verify agency isolation
   and immediate suspension. Verify actual SMTP throttling, expiry and recovery.
7. **Hosted acceptance must prove identity linking:** password signup and Google
   sign-in with the same verified email resolve to one Auth UUID and one Hub row.
   The protocol mock simulates linking; it cannot establish hosted provider behavior.
8. Confirm-email enforcement: sign up with a password but never enter the OTP;
   password sign-in must fail and no session may be issued.
9. Confirm **Site URL equals the admin origin**. Google OAuth must return through
   `/auth/callback?next=...` successfully, including a valid internal deep link.
   An external `next` must still fall back to a safe internal route.

API outages are separate from an expired session. `/v1/me` has a ten-second
timeout. Network failures, 5xx and invalid responses show **ระบบขัดข้องชั่วคราว
กรุณาลองใหม่**; the browser URL/session remain intact. The Hub proxy returns 503,
so it does not show the 401 session-expired banner. Only authentication/access
responses and account status trigger sign-in/access-request redirects. If an
outage follows OAuth code exchange, Retry uses the saved session and the safe
internal destination, without exchanging the one-time code again.

## Verification and follow-up

The loopback mock includes signup, email/recovery OTP, password changes, OAuth
authorize/code exchange with PKCE, and an ignored local outbox at
`.local/hosted-test-simulation/auth-outbox.json`. It accepts only `example.test`
synthetic registrations and never connects to Google, SMTP or Supabase hosting.
Run typecheck/build, `test:api`, `test:db`, `test:hosted-h1`, and `test:ui`.

For an entirely offline acceptance build on Windows (including fonts):

```powershell
$env:NEXT_FONT_GOOGLE_MOCKED_RESPONSES = (Resolve-Path scripts/offline-fonts.cjs).Path
npm.cmd run typecheck --prefix apps/admin
npm.cmd run build --prefix apps/admin -- --webpack
```

This test hook uses the checked-in Noto Sans Thai fallback for Google Sans and
performs no font download. The application keeps its existing font configuration.

Local verification on 7 October 2026:

- Typecheck and the offline Webpack production build passed.
- API suite: 1,403 passed, 11 skipped. Inactive-account tests enumerate every
  other API route and verify denial for pending, rejected and suspended users.
- DB suite passed, including RLS, audit/retention, operator bootstrap, concurrent
  admin decisions and existing agency-isolation regressions.
- H1 simulation: 11 protocol/profile tests and 23 browser tests passed. This
  includes Google/email/recovery flows, flag-off behavior, redirects and the
  browser-bundle/environment credential checks.
- Local UI suite: 203 of 205 initially passed; two obsolete role-label assertions
  were changed to expect the synthetic display name. All four tests in the two
  affected files then passed. Desktop and mobile account screenshots were reviewed.

Follow-up verification after `7222c2c`, 7 October 2026:

- Typecheck and the offline Webpack production build passed.
- Full API suite: **1,420 passed, 11 skipped**, including per-field Thai errors,
  phone parity, distinct decision errors, reopening, stale versions and retention.
- DB suite passed, including competing reopen decisions (one audit event),
  anonymised-request denial, last-admin protection and existing agency isolation.
- H1 simulation: **11 protocol/profile tests and 33 browser tests passed**
  (25 account/H1, 3 configuration/credential-boundary, 5 outage tests). The 43
  migrations apply under simulated managed permissions. Browser checks cover
  input retention, submitted-only counts, agency gating, rejection history,
  resubmission, 10-second timeouts, 503 versus 401/403, and OAuth outage retry.
- Full local UI suite: **205 passed**. The five intake-proxy tests also passed
  after adding an explicit unchanged local-demo 401 wording assertion.
- Thai validation and reopened-request history screenshots were reviewed locally.
  All identities and OTP delivery were synthetic; no hosted acceptance was run.

Redesign verification after `34a6c36`, 8 October 2026:

- Typecheck and offline Webpack build passed. Migrations **44** (company/position,
  private notes, profile validation and purge) and **45** (invitations and protected
  Auth confirmation) apply locally and under the managed-permission simulation.
- Full API: **1,444 passed, 11 skipped** (baseline 1,420 + 11). New checks cover
  invite creation/duplicates/roles, confirmed current email, older identities,
  expiry/cancel/extend, agency validity, acceptance, profile fields and note privacy.
- Full DB passed, including exact 14-day lifetime, no direct invite/Auth grants,
  single-use acceptance, concurrent same-email creation (one winner), last-admin,
  stale-row, retention and existing agency-isolation checks.
- Full H1: **11 protocol/profile + 38 browser tests passed** (baseline 11 + 33):
  30 main scenarios, 3 flags/credential-boundary, 5 outage scenarios. No skips or
  retries. Initial deterministic failures exposed dialog focus loss and a test
  clock installed after the polling timer; both were corrected. Outage fixtures
  were updated for the new search label/invitation response before the final run.
- Full local UI: **208 passed** (baseline 205), including local persona authority,
  invite creation/duplicate/extend/cancel, and a contained 400 px users table.
  No UI/H1 tests were skipped or marked flaky in the final runs.
- Queue, users, normal/self/last-admin panels, invitation creation/acceptance and
  400 px screenshots were reviewed. No new animations, dependencies or per-tab ACL.

The 11 existing API skips are named explicitly below; none is a new accounts test.
These require separate opt-in local integration fixtures/tools or flags:

| Test | Reason |
|---|---|
| `test_actuals_import.py::test_real_import_replay_conflict_and_failed_rows_preserve_last_good` | Explicit migrated read-back acceptance |
| `test_archive_db.py::test_archive_review_application_evidence_versions_and_private_access` | `HUB_ARCHIVE_TEST` opt-in |
| `test_assistant_db.py::test_assistant_http_citations_generated_proposal_and_explicit_save` | `HUB_ASSISTANT_TEST` opt-in |
| `test_assistant_model.py::test_sdk_reads_fictional_project_through_real_caller_rls_without_egress` | Synthetic assistant seed |
| `test_assistant_tools_db.py::test_all_thirteen_readers_real_rls_exact_evidence_and_domain_boundaries` | `HUB_ASSISTANT_TEST` opt-in |
| `test_demo_finance.py::test_finance_seed_real_controls_replay_preserved_edits_and_complete_snapshot` | `HUB_DEMO_FINANCE_TEST` opt-in |
| `test_document_worker.py::test_real_local_image_ocr_preserves_all_occurrences_and_exact_money` | Windows OCR opt-in |
| `test_hosted_h1.py::test_disposable_managed_simulation_end_to_end` | Separate explicit loopback H1 runner (run above) |
| `test_hub_demo.py::test_complete_business_seed_replay_rolls_back_and_preserves_document_work` | Demo seed opt-in |
| `test_promotions_db.py::test_real_promotion_snapshots_approvals_atomic_release_and_stale_rollback` | `HUB_PROMOTIONS_TEST` opt-in |
| `test_residential_seed.py::test_seed_replay_preserves_originals_and_user_edits` | Fixed local test seed opt-in |

Sign-in-method question: **DECIDED, owner 7 Oct 2026: Google or email/password,
self-registration, verified email and Hub admin approval**. Non-blocking IT
question: when and how should the Workspace sender and Google Cloud project
move from the owner's account to IT ownership? This does not block local MVP work.
