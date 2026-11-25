# Design Spec: Top-Right User Profile Menu & Self-Profile Editing

**Status:** DESIGN ONLY — Deferred to post-`f07f7cb` release slice (future migration `0095_account_self_profile.sql`).  
**Constraint:** Do NOT fold into frozen release `f07f7cb-media-dd33d4d7f14b` or migrations `0089`–`0094`.

---

## 1. Purpose & Current Gap

Currently, the top-right user badge in `apps/admin/components/hub-shell.tsx` (line 100) renders a static `<span className="avatar">` initial and role label with no click action. Active Hub accounts already store contact/profile fields (`display_name_th`, `phone`, `team`, `company_type`, `company_name`, `position`) captured during onboarding/invite acceptance (`hub.submit_access_request` / `hub.accept_account_invite`), but:

1. Active users have no UI or API endpoint to view or update their own contact details after approval.
2. There is no user avatar storage, upload pipeline, or authenticated avatar serving endpoint.

---

## 2. UI Design (`HubShell` Top-Right Popover / Drawer)

### Trigger Button (Top Bar)
- Replace static `<span className="avatar">` + label in `HubShell` header with an accessible trigger button:
  - Displays current avatar thumbnail (if present) or circular initial fallback, plus `display_name_th` (or role label fallback) and a subtle chevron.
  - Attributes: `type="button"`, `aria-haspopup="dialog"`, `aria-expanded={open}`, `aria-controls={dialogId}`.
  - Styled strictly via SENA semantic tokens (`styles/tokens.css`), light/dark safe, minimal motion respecting `prefers-reduced-motion`.

### Profile Popover / Mobile Drawer
- Opens anchored below the top-right trigger on desktop (`>= 721px`), or as a compact sheet/dialog on narrow viewports (`<= 720px`).
- Supports `Esc` close, outside-click dismissal, and focus return to the trigger button on close.
- **Read-Only Identity Summary:**
  - Avatar preview (larger circle) + **แก้ไขรูปโปรไฟล์** controls (Upload / Replace / Remove).
  - Thai display name, Email (`read-only`), Hub Role / Account Status badge (`read-only`), and Company badge (`read-only` when `AGENCY`).
  - **ออกจากระบบ (Sign Out)** action button.
- **Inline Form — "แก้ไขข้อมูลส่วนตัว" (Self-Editable Fields):**
  - `display_name_th`: Required, must match `[ก-๙]`, `1..200` chars.
  - `phone`: Required, matches `^\+?[0-9 ()-]{8,30}$`.
  - `team`: Required, `1..200` chars.
  - `position`: Required, `1..100` chars.
  - `company_type` / `company_name`:
    - For internal/subsidiary/contractor staff (`SENA`, `SENA_SUBSIDIARY`, `CONTRACTOR`), `company_name` required when `company_type !== 'SENA'` (≤200 chars).
    - **Locked / read-only** when `account.hub_role === 'agency'` or `account.company_type === 'AGENCY'`, preventing external agency accounts from reclassifying themselves as `SENA`.

### Avatar Upload Rules
- Accepted MIME/formats: **JPEG, PNG, WebP only** (SVG strictly rejected).
- Maximum upload size: **2 MiB** raw input; processed server-side through the existing `upload_limits.py` and `upload_optimization.py` pipeline (strip EXIF/metadata, validate magic bytes and dimensions, resize/normalize to `<= 256x256` WebP).
- Inline progress, Thai error feedback on oversized/unsupported files, and clean reset after removal.

---

## 3. Database, Security, RLS & PDPA Boundary (`0095_account_self_profile.sql`)

### Schema Additions (`hub.user_account`)
- `avatar_object_key text` (nullable; relative R2 key `avatars/<account_id>/<sha256>.webp`).
- `avatar_sha256 text` (nullable; 64-char hex).
- `avatar_content_type text check (avatar_content_type in ('image/webp'))` (nullable).
- `avatar_updated_at timestamptz` (nullable).

### Strict Authorization & Forbidden Self-Edits
- Self-profile updates MUST execute through `hub.update_own_profile(p jsonb)` (`SECURITY DEFINER`, `set search_path = pg_catalog, pg_temp`, `revoke all from public`, granted only to authenticated internal/agency runtime roles as appropriate).
- Locks caller row (`select * into a from hub.user_account where id = actor and status = 'ACTIVE' for update`). Raises `42501` if caller is missing, pending, suspended, rejected, or anonymized.
- **Forbidden fields (never writable by self):** `email`, `status`, `hub_role`, `agency_code`, `can_manage_users`, `account_permission`, `account_content_scope`, `anonymised_at`. Any unexpected key is rejected by Pydantic (`ConfigDict(extra='forbid')`).
- Reuses existing `hub.validate_account_profile(p)` rules (with explicit agency company-lock enforcement: if `a.hub_role = 'agency'` or `a.company_type = 'AGENCY'`, reject any change to `company_type` or `company_name`).
- Appends an immutable audit entry `PROFILE_UPDATED` to `hub.user_account_event` (recording `actor_id = actor`, no sensitive PII deltas leaked to logs).

### Private R2 Avatar Storage & PDPA
- Avatars are stored strictly in the **private** R2 bucket under `avatars/<account_id>/<sha256>.webp` (never in any public website bucket).
- Replaced or removed avatars enqueue/delete the superseded R2 object (`avatar_object_key` cleared atomically in DB; cleanup never touches another user's prefix).
- Update `hub.purge_rejected_accounts()` so retention anonymization also clears `avatar_object_key`, `avatar_sha256`, `avatar_content_type`, `avatar_updated_at` and removes the stored R2 object.

---

## 4. Planned Backend Endpoints (`apps/api/sena_hub_api/accounts.py`)

| Endpoint | Behavior |
| --- | --- |
| `PATCH /v1/me/profile` | Validates self-profile payload (`extra='forbid'`), executes `hub.update_own_profile($1::jsonb)` under caller RLS transaction, returns updated `/v1/me` projection. |
| `POST /v1/me/avatar` | Multipart upload (`max 2 MiB`), validates JPEG/PNG/WebP, strips EXIF, converts to `<= 256x256` WebP, writes private R2 `avatars/<account_id>/<sha256>.webp`, calls `hub.set_own_avatar(...)`, deletes previous object on replace. |
| `DELETE /v1/me/avatar` | Clears caller avatar metadata via `hub.clear_own_avatar()`, removes private R2 object, returns updated profile. |
| `GET /v1/me/avatar` | Authenticated caller-only stream from private R2 with `Cache-Control: private, max-age=300` and `X-Content-Type-Options: nosniff` (404 if unset). |
| `GET /v1/accounts/{account_id}/avatar` | Internal active staff (`admin`, `editor`, `publisher`, `viewer`, `online_staff`) only; `403` for `agency`, `pending`, or `service_consumer`. Serves staff avatar with `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`. |

---

## 5. Planned Verification Matrix (Deferred Until Post-`f07f7cb` Slice)

1. **DB / Migration & Baseline Tests (`test:db`, `test_permission_db_baseline.py`):**
   - Add `0095_account_self_profile.sql` to `profile.json` and migration test suite.
   - Assert non-active/rejected/anonymized caller cannot call `hub.update_own_profile`, `hub.set_own_avatar`, or `hub.clear_own_avatar`.
   - Assert agency account cannot change `company_type` to `SENA` or escalate role/permissions/scopes.
   - Assert `hub.purge_rejected_accounts()` clears avatar columns.
2. **API Tests (`apps/api/tests/test_account_self_profile.py`):**
   - `PATCH /v1/me/profile`: valid update + stale/invalid Thai name/phone/extra-field rejection (`422`), `hub_role`/`can_manage_users` forbidden (`422` via `extra='forbid'`), `PROFILE_UPDATED` event recorded.
   - `POST /v1/me/avatar`: JPEG/PNG/WebP normalized to `<=256x256` WebP, SVG/`>2 MiB`/corrupt bytes rejected (`422`), EXIF stripped, replace deletes old key.
   - `GET /v1/me/avatar` and `/v1/accounts/{id}/avatar`: unauthenticated `401`, agency reading staff avatar `403`, response has `private` cache header and `nosniff`.
3. **Browser UI Tests (`tests/ui/account-self-profile.spec.ts`):**
   - Desktop `1280` & Mobile `390` in light and dark modes: open top-right profile popover, verify `Esc`/outside-click focus return, edit phone/team/position, upload/remove avatar, reload persistence.
