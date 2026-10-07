# Login and accounts MVP

Owner decisions: **7 October 2026**. Implementation and verification are local
only, synthetic identities only, no hosted requests and no real emails. Hosted
execution remains blocked until the owner says **“credentials ready”**. This
supersedes the invite-only and JWT-metadata-role rules in doc 27 §4 and Q12.

## Identity and access

Sign in with Google or email/password. Self sign-up is allowed. Every new identity
has a PENDING Hub account and must submit the same access request. Supabase JWTs
prove identity only; neither app_metadata nor user_metadata authorizes access.
Provider data set by Supabase supplies the display-only sign-in method; editable
profile names are only initial suggestions on the request form.

`hub.user_account`, keyed by Auth UUID, stores the verified email, display name,
work phone, team/company, requested tasks, reason, privacy acknowledgement, status,
role, agency code and decision fields. `hub.user_account_event` records decisions
and request edits without copying personal request text into immutable history.
API responses and evidence retain UUIDs; staff screens resolve display names.
Requests never enter assistant tools, exports, RAG, embeddings or indexing.

Super user = `admin`. Only ACTIVE admins approve accounts/change roles. Manager =
existing `publisher`, labelled **Manager · อนุมัติและเผยแพร่**; its existing approve
and publish permissions remain unchanged. Agency approvals require an ACTIVE,
canonical, date-valid code from `ads.vocab`; existing agency RLS is unchanged.

FastAPI verifies the JWT then performs one primary-key account lookup per request,
with no role cache. Only ACTIVE accounts receive a role. PENDING, REJECTED and
SUSPENDED accounts can call `GET /v1/me`, `POST/PATCH /v1/me/access-request` (edits
are accepted only while pending), and Auth sign-out. Other data routes reject
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
  agency company, task checkboxes, reason/projects and privacy acknowledgement.
  Suggested roles: read→viewer, edit→editor, publish→publisher,
  online→online_staff, agency→agency. Suggestions never grant access.
- After submission: **รออนุมัติ**, request summary/status, optional configured admin
  contact, edit while pending. Rejected users see the decision reason; suspended
  users see their status. ACTIVE users can enter their workspace.
- An API 401 shows a Thai banner linking to sign-in in a new tab and the same
  page. It does not navigate, reload or reset the current form. Users return to
  their original tab and retry saving; existing dirty guards remain active.

## ผู้ใช้และสิทธิ์

`/admin/accounts` is admin-only, with รออนุมัติ / ใช้งานอยู่ / ระงับ / ปฏิเสธ
filters, name/email/team search and a sidebar pending-request count. Expand a row
for email, sign-in method, telephone link, team, requested tasks, suggested role,
reason and audit history. Approve with a chosen role (plus agency code), change
role, suspend, reactivate, or reject with a reason. Native confirmation dialogs
protect granting admin and suspension. Errors leave typed fields intact.

Security-definer decisions recheck the actor in the table, forbid self decisions,
require an unchanged `updated_at`, and serialize concurrent decisions under a
transaction lock. At least one active admin remains. App roles cannot directly
update status/roles or mutate audit events. Users read only their own full row;
admins read all; staff directory access returns only UUID/display name.

Rejected personal fields are removed after 90 days by the operator maintenance
command below. Audit account/actor references for those requests are anonymised;
the anonymous transition record remains. The purge is the sole operator-only
exception to append-only events and cannot be invoked by app roles. Later sign-in
does not restore scrubbed fields. Schedule this command daily when hosting is
authorized; the local MVP has no hosted scheduler.

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

Sign-in-method question: **DECIDED, owner 7 Oct 2026: Google or email/password,
self-registration, verified email and Hub admin approval**. Non-blocking IT
question: when and how should the Workspace sender and Google Cloud project
move from the owner's account to IT ownership? This does not block local MVP work.
