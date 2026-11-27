# Design Spec & Implementation: Top-Right User Profile Menu & Self-Profile Editing

**Status:** IMPLEMENTED — Migration `0095_account_self_profile.sql`, FastAPI endpoints, Next.js proxy routes, and `HubShell` `AccountMenu` UI.

---

## 1. Purpose & Resolved Gaps

Previously, the top-right user badge in `apps/admin/components/hub-shell.tsx` rendered a static `<span className="avatar">` initial and role label with no menu action, while `<SignOut />` only lived inside the TEST notice banner and a non-clickable `ไทย` badge sat in `.topbar-right`. This slice replaces those static elements with an interactive `<AccountMenu />` component backed by self-profile editing and private avatar storage.

---

## 2. UI Design (`AccountMenu` in `HubShell` Top-Right)

### Trigger Button (Top Bar)
- Interactive pill button (`min-height: 44px`, `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-controls={menuId}`):
  - Displays authenticated avatar thumbnail (`/api/hub/v1/me/avatar?v=...`) when `has_avatar` is true, or circular initial of `display_name_th || roleLabel`.
  - Shows `display_name_th` as primary label and `roleLabel` as subtitle on desktop; hides `.account-trigger-meta` at `<= 720px` so mobile search stays spacious.
  - Styled via `styles/tokens.css`, respecting `prefers-reduced-motion`.

### Popover Menu (`role="menu"`)
- Anchored top-right (`max 320px`), `Esc` close returning focus to trigger, outside `mousedown` dismissal, `140ms` animation (`none` under `prefers-reduced-motion: reduce`):
  1. **Read-Only Identity Header**: 44px avatar preview, Thai display name, email, role/company/team summary, and content scope pill.
  2. **ข้อมูลส่วนตัวและรูปโปรไฟล์**: opens modal `<dialog>` for avatar upload/removal + self-editable profile form.
  3. **สิทธิ์และขอบเขตการใช้งานของฉัน**: opens read-only `<dialog>` listing permitted tabs (`ดู / แก้ไข / อนุมัติ`) and content scope boundaries.
  4. **ความปลอดภัยและรหัสผ่าน**: opens `<dialog>` showing `sign_in_method` (`Google` / `อีเมลและรหัสผ่าน`) and password update via `supabase.auth.updateUser` (for hosted email/password users).
  5. **ธีมหน้าจอ (`ตามระบบ | สว่าง | มืด`)**: segmented toggle saving `hub-theme` in `localStorage` and setting `html[data-theme]`, paired with `:root:not([data-theme="light"])` + `:root[data-theme="dark"]` in `apps/admin/styles/tokens.css`.
  6. **ทางลัดผู้ดูแลระบบ** (conditional): `จัดการผู้ใช้และสิทธิ์` (`/admin/accounts` + pending count badge for admins) and `ตั้งค่าระบบและคลังข้อมูล` (`/settings`).
  7. **Footer**: environment label (`hostedConfig?.label`) + **`ออกจากระบบ`** (`hostedBrowser(config).auth.signOut()` -> `/login` in hosted mode; `/account/request` link in local demo mode). Existing `<SignOut />` in `.hosted-h1-note` stays preserved.

### Avatar Upload Rules
- Accepted MIME/formats: **JPEG, PNG, WebP only** (SVG strictly rejected).
- Maximum upload size: **2 MiB** raw input; validated and decoded via Pillow (`ImageOps.exif_transpose` + `ImageOps.fit(..., (256, 256))`), stripped of EXIF/ICC metadata, and encoded as clean `image/webp`.

---

## 3. Database, Security, RLS & PDPA Boundary (`0095_account_self_profile.sql`)

### Schema Additions (`hub.user_account`)
- `avatar_object_key text` (`^avatars/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$`)
- `avatar_sha256 text` (`^[0-9a-f]{64}$`)
- `avatar_content_type text check (avatar_content_type in ('image/webp'))`
- `avatar_size_bytes integer check (avatar_size_bytes > 0 and avatar_size_bytes <= 2097152)`
- `avatar_updated_at timestamptz`

### Guarded `SECURITY DEFINER` Functions
- `hub.account_identity(...)`: strips raw `avatar_*` storage metadata from `/v1/me` and exposes `has_avatar` + `avatar_updated_at`.
- `hub.update_own_profile(p jsonb)`: locks active non-anonymised caller (`42501` otherwise), enforces `AGENCY` company lock (`account_company_locked`), calls `hub.validate_account_profile`, updates only self-editable profile columns, records `PROFILE_UPDATED` in `hub.user_account_event`.
- `hub.set_own_avatar(...)` / `hub.clear_own_avatar()`: locks active caller, binds `avatars/<actor_id>/<sha256>.webp`, records `AVATAR_UPDATED` / `AVATAR_REMOVED`, returns `previous_object_key` for storage cleanup.
- `hub.read_avatar_metadata(target uuid)`: caller self-read or internal active staff (`admin`, `editor`, `publisher`, `viewer`, `online_staff`) only; refuses external `agency` reading staff avatars (`42501`).
- `hub.purge_rejected_accounts()`: retains prior 90-day anonymisation behavior while also clearing all `avatar_*` columns.

### Private Storage & Endpoints
- Hosted R2 (`R2Assets`), simulation (`HostedAssets`), and local disposable asset root (`STORAGE_ROOT/avatars/<id>/<sha>.webp`) store and read objects strictly by validated avatar key (`avatars/<uuid>/<sha256>.webp`).

| Endpoint | Proxy Route | Behavior |
| --- | --- | --- |
| `PATCH /v1/me/profile` | `/api/hub/v1/me/profile` | Validates `SelfProfileUpdate` (`extra='forbid'`), updates profile via `hub.update_own_profile`. |
| `POST /v1/me/avatar` | `/api/hub/v1/me/avatar` | Raw binary or multipart (`max 2 MiB`), normalizes to 256×256 WebP, stores object, calls `hub.set_own_avatar`, deletes superseded object. |
| `DELETE /v1/me/avatar` & `POST /v1/me/avatar/remove` | `/api/hub/v1/me/avatar/remove` | Clears metadata via `hub.clear_own_avatar`, deletes object best-effort (Next.js proxy keeps `DELETE()` returning `405` and exposes `POST /remove`). |
| `GET /v1/me/avatar` | `/api/hub/v1/me/avatar` | Streams `image/webp` with `Cache-Control: private, max-age=300` and `X-Content-Type-Options: nosniff`. |
| `GET /v1/accounts/{account_id}/avatar` | `/api/hub/v1/accounts/{account_id}/avatar` | Internal active staff only (`403` for agency). |
