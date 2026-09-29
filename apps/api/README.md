# SENA Hub API

Working backend slice for residential projects and brands: staged REM source selection,
draft editing, human model review, local asset uploads/rights/bindings, readiness, publish,
withdrawal, version history and rollback.
Data and immutable publication snapshots are stored in PostgreSQL. This is not the complete
September pilot: production asset storage, promotions, live source sync and RAG are not implemented here.
Staged source records and demo seeds are illustrative data, not verified enterprise content.

## Run locally

From the repository root, apply the Supabase migration and seed using the local bootstrap,
then load the server environment supplied by the root project setup. Install and run:

```powershell
uv sync --project apps/api --cache-dir .cache/uv
uv run --project apps/api --env-file apps/api/.env --cache-dir .cache/uv python -m sena_hub_api
```

Required configuration (no secret defaults):

| Variable | Purpose |
|---|---|
| `HUB_DATABASE_URL` | PostgreSQL `hub_runtime` login, a NOINHERIT member of the five mapped roles; never use an owner/superuser login |
| `HUB_ENV` | `local` or `production` |
| `HUB_AUTH_MODE` | `demo` or `supabase` |
| `HUB_DEMO_EDITOR_TOKEN` | Local editor token |
| `HUB_DEMO_PUBLISHER_TOKEN` | Local publisher token |
| `HUB_DEMO_VIEWER_TOKEN` | Local viewer token |
| `HUB_DEMO_SERVICE_CONSUMER_TOKEN` | Local published-view consumer token |
| `HUB_DEMO_ADMIN_TOKEN` | Local administrator token; cannot approve rights or publish |
| `HUB_SUPABASE_URL` | HTTPS project origin for Supabase JWT verification |
| `HUB_HOST` / `HUB_PORT` | Default `127.0.0.1:8000`; demo mode allows loopback binding only |

Demo requires `HUB_ENV=local`, a loopback database, and five distinct ASCII tokens of at
least 32 characters. Tokens stay in the Next.js server proxy; never use `NEXT_PUBLIC_*`
variables or deliver them to the browser. Demo requests from non-loopback peers are rejected.
The runner disables proxy-header trust. Do not expose a demo deployment through a public proxy.
Missing/invalid configuration fails startup. There is no client-supplied role header or token-minting endpoint.

Supabase mode verifies JWT signature with the project's JWKS endpoint, issuer
`<HUB_SUPABASE_URL>/auth/v1`, audience `authenticated`, expiration and issued-at claims.
Only asymmetric ES256/RS256 keys are accepted. `sub` must be a UUID. A trusted administrator
must set `app_metadata.hub_role` to `editor`, `publisher`, `viewer`, `service_consumer` or `admin`.
Top-level `role`, `user_metadata` and request role headers never grant Hub permissions.
Do not assign the `service_consumer` role to ordinary staff JWTs; use its dedicated credential.
Production login/consumer credential provisioning is external to this slice.

Each request transaction executes `SET LOCAL ROLE` from that fixed server mapping and
sets `app.actor_id`. Public endpoints use the eligible `public_api` views/functions as `service_consumer`.
Draft writes and publishing use guarded database functions. No CORS origins are enabled;
use the Next.js same-origin server proxy. Every response uses `Cache-Control: no-store`.
`/health` is an unauthenticated liveness check; startup must establish the database pool.
Swagger/OpenAPI endpoints are disabled so there are no additional unauthenticated surfaces.

## Contract

Every endpoint except `/health` requires `Authorization: Bearer ...`. The `admin` role
also has the editor/staff permissions in the project/asset table below; publication and
rights approval remain publisher-only. Demo actor IDs 1–4 stay unchanged; admin is ID 5.

| Method/path | Role | Body / result |
|---|---|---|
| `GET /health` | None | `{status:"ok"}` |
| `GET /v1/admin/projects` | editor/publisher/viewer | `{data:[Project]}`; at most 100 |
| `GET /v1/admin/sources/projects` | editor/publisher/viewer | `{data:[SourceProject]}` |
| `POST /v1/admin/projects` | editor/publisher | `{rem_project_id,brand_id?:UUID}`; 201 `{data:Project}`; optional assignment is atomic with creation |
| `GET /v1/admin/projects/{public_id}` | editor/publisher/viewer | `{data:Project}` |
| `PATCH /v1/admin/projects/{public_id}` | editor/publisher | Required `updated_at` plus changed editable fields; `{data:Project}` |
| `GET /v1/admin/projects/{public_id}/source-models` | editor/publisher/viewer | `{data:[SourceModel]}` |
| `POST /v1/admin/projects/{public_id}/models` | editor/publisher | `{rem_model_id,updated_at}`; `{data:Project}` |
| `PATCH /v1/admin/projects/{public_id}/models/{public_model_id}` | editor/publisher | Parent `updated_at` plus changed model fields; `{data:Project}` |
| `POST /v1/admin/projects/{public_id}/models/{public_model_id}/review` | editor/publisher | `{updated_at,decision,change_reason}`; `{data:Project}` |
| `GET /v1/admin/projects/{public_id}/versions` | editor/publisher/viewer | `{data:[{version_id,version_no,payload,published_at,publisher,change_reason}]}`; latest 100 |
| `POST /v1/admin/projects/{public_id}/publish` | publisher | `{change_reason}`; `{data:Project}` |
| `POST /v1/admin/projects/{public_id}/withdraw` | publisher | `{change_reason}`; `{data:Project}` |
| `POST /v1/admin/projects/{public_id}/rollback` | publisher | `{version_id,change_reason}`; `{data:Project}` |
| `GET /v1/projects` | service_consumer | Optional `?brand_id={public_brand_id}`; `{data:[publishedPayload + meta],meta}`; at most 100 |
| `GET /v1/projects/{public_id}` | service_consumer | `{data:publishedPayload,meta}` or 404 |
| `GET /v1/admin/assets` | editor/publisher/viewer | `{data:[Asset]}` |
| `POST /v1/admin/assets` | editor/publisher | Raw file body; 201 new or 200 duplicate, `{data:Asset,meta:{reused}}` |
| `GET /v1/admin/assets/{asset_id}` | editor/publisher/viewer | `{data:Asset}` |
| `GET /v1/admin/assets/{asset_id}/file` | editor/publisher/viewer | Authenticated original file, including pending/revoked assets |
| `POST /v1/admin/assets/{asset_id}/review` | publisher | `{updated_at,decision,rights_notes,effective_from,effective_to,change_reason}`; `{data:Asset}` |
| `POST /v1/admin/projects/{public_id}/assets` | editor/publisher | `{updated_at,asset_id,asset_role,alt_text}`; `{data:Project}` |
| `POST /v1/admin/projects/{public_id}/assets/{binding_id}/remove` | editor/publisher | `{updated_at}`; `{data:Project}` |
| `GET /v1/assets/{asset_id}/file` | service_consumer | Original file only when referenced by an eligible published project/brand snapshot |

`Project` contains `id`, `public_project_id`, read-only `source`, `models`, `assets`,
`updated_at`, `published_version_id`, and `readiness:{ready,missing:[{field,message}],percent}`.
Editable fields are `public_name`, `slug`, `address`, `latitude`, `longitude`,
`ad_disclaimer`, `meta_title`, `meta_description`. Text fields except `slug` are locale
objects such as `{ "th": "ชื่อโครงการ" }`. Coordinates may be cleared with null; text may
be blank in a draft but required Thai values block publication. Project PATCH cannot change
source fields, models, assets or publication pointers. IDs are opaque: obtain the demo
`public_project_id` from the admin list rather than hardcoding it.

`SourceProject` contains `rem_project_id`, `project_name_rem`, `source_updated_at`,
`source_snapshot_at`, `source_fingerprint`, `model_count` and nullable `public_project_id`.
It also exposes source `rem_brand_id`, `rem_company_id`, `brand_name_rem` and `company_name_rem`.
`SourceModel` contains `rem_model_id`, `model_name_rem`, the same three source metadata fields,
and nullable `public_model_id`. Source IDs are exact text (1–200 characters, not blank,
no NUL), including ordinary DW punctuation and Thai; the API does not normalize them.
These endpoints select already staged records; they do not connect to or synchronize a live DW.
Project creation also imports its staged models as `SUGGESTED`; the model selection endpoint
can add subsequently staged models from that project's source only.

Model PATCH accepts only `public_name` (locale object), `bedrooms`, `bathrooms`,
`usable_area_sqm` and `parking_spaces`. Numeric fields may be null in an incomplete draft.
Bedrooms/bathrooms must be finite nonnegative numbers, usable area must be positive when
provided, and parking must be an integer from 0 to 2147483647. Strings and booleans are
not numbers. Admin models also expose read-only source names/metadata, `match_method`,
`match_confidence`, `match_status`, `verified_by`, `verified_at` and model `updated_at`.

Review decisions are exactly `CONFIRMED` or `REJECTED`, with a nonblank reason of at most
1000 characters. Confirmation records the authenticated actor and time. Rejection remains
visible to staff and excludes the model from new releases; rejecting a model referenced by
the current published version makes that version unavailable until corrected or replaced.
At least one confirmed, complete model is still required for publication. Model edits do
not themselves publish anything, and source IDs/names and review metadata cannot be edited.

Public detail metadata includes `version`, `entity_version`, `published_at`, `publisher`,
`source_updated_at`, `data_freshness`, `locale`, `is_fallback_locale`, `fallback_indicator`
and `cache_ttl`. The sample's freshness is `unknown`. List items carry their own `meta`
so version/publisher provenance is unambiguous; aggregate metadata has null entity fields.
This slice returns the locale-keyed content object with Thai as its authoring default;
it does not yet implement per-request locale selection or claim complete API-contract coverage.

Project PATCH and every model mutation must send the exact latest **project** `updated_at`
value, not the model timestamp. Each successful model mutation returns the refreshed project
and a new timestamp. A stale timestamp returns 409;
reload and let the editor reconcile rather than automatically overwriting their work.
Errors use `{error:{code,message,details?}}`, with Thai messages and no SQL or trace output.
Validation is 422; unauthenticated is 401; insufficient permission is 403;
missing/unpublished is 404. Publishing errors require rechecking readiness, not retry loops.

## Brands

| Method/path | Role | Body / result |
|---|---|---|
| `GET /v1/admin/sources/brands` | staff | `{data:[SourceBrand]}` with nullable `public_brand_id` |
| `GET /v1/admin/brands` | staff | `{data:[Brand]}` |
| `GET /v1/admin/brands/{public_id}` | staff | `{data:Brand}` |
| `POST /v1/admin/brands` | admin | `{rem_brand_id}`; 201 `{data:Brand}` |
| `PATCH /v1/admin/brands/{public_id}` | editor/admin | `{updated_at,public_name?,description?,slug?,status?}`; `{data:Brand}` |
| `GET /v1/admin/brands/{public_id}/versions` | staff | `{data:[{version_id,version_no,published_at,publisher,change_reason}]}` |
| `POST /v1/admin/brands/{public_id}/publish` or `/withdraw` | publisher | `{change_reason}`; `{data:Brand}` |
| `POST /v1/admin/brands/{public_id}/rollback` | publisher | `{version_id,change_reason}`; `{data:Brand}` |
| `POST /v1/admin/brands/{public_id}/assets` | editor/admin | `{updated_at,asset_id,asset_role,alt_text}`; `{data:Brand}` |
| `POST /v1/admin/brands/{public_id}/assets/{binding_id}/remove` | editor/admin | `{updated_at}`; `{data:Brand}` |
| `POST /v1/admin/projects/{public_id}/brand` | editor/admin/publisher | `{updated_at,brand_id:UUID}`; `{data:Project}` |
| `GET /v1/admin/brand-requests` | staff | `{data:[BrandRequest]}` |
| `POST /v1/admin/brand-requests` | editor/admin | `{requested_name,rem_brand_id?:null/string,change_reason}`; 201 `{data:BrandRequest}` |
| `POST /v1/admin/brand-requests/{id}/resolve` | admin | `{updated_at,brand_id:null/UUID,decision,change_reason}`; `{data:BrandRequest}` |
| `GET /v1/brands` or `/v1/brands/{public_id}` | service_consumer | Same list/detail envelopes and provenance metadata as public projects |

Here staff means editor/publisher/viewer/admin. Publishers read brand drafts and control
publication; they do not edit brand marketing fields or logos. Brand `public_name` and
`description` are locale objects (max 20,000 characters per value); `slug` follows the
project rules and may be blank in a draft; `status` is `active` or `inactive`. Every brand
draft/logo mutation requires the brand's latest `updated_at`. The logo roles are
`logo_primary`, `logo_white`, `logo_mono`, `favicon`, all images only. Binding uses the
same local-only asset feature. Publication requires Thai name/description, slug, active
status and a primary logo with Thai alt text and approved/current rights.

Brand detail includes `id`, opaque `public_brand_id`, `rem_brand_id`, editable fields,
`updated_at`, `published_version_id`, `publication_available`, `readiness`, source metadata,
enriched asset bindings and associated projects with project-company provenance.
Brand requests preserve the requester, reason and optional exact REM ID. `resolved` requires
an existing matching brand UUID; `rejected` requires null `brand_id`. Both require a reason
and current request timestamp. A request does not invent or modify DW source records.

A project may be created without a brand and remain an incomplete draft. Assignment must
match its staged REM BrandID, using the selected brand's internal UUID. Project publication
requires an eligible published brand and freezes that brand's content/version. Brand drafts
and later brand releases do not silently change the project snapshot. Brand withdrawal,
disabled/deleted source brand or invalid logo rights block affected consumer access; rights
are checked for the referenced brand snapshot as well as current brand eligibility.

`GET /v1/projects?brand_id=...` compares the **public** brand ID exactly against the frozen
project payload. It does not accept the internal UUID, source REM ID or a name as an alias.
No match returns an empty list. Unknown/repeated query keys and blank filters return 422;
public brand endpoints and project detail currently accept no query parameters. Company provenance comes
from each project's source; a brand does not imply one legal company or ownership.

## Local asset files

All asset library, upload, review, binding and file endpoints require `HUB_ENV=local`.
In other environments they return 503 before accessing the local filesystem. Private files
live under the repository's `.local/assets`; there is no static/public directory mount or
remote URL fetching. Production storage is outside this implementation.

Send the binary body directly, with `Content-Type` equal to `image/png`, `image/jpeg`,
`image/webp` or `application/pdf` and `X-Filename` containing the percent-encoded UTF-8
basename (`encodeURIComponent(file.name)` in the browser). Names are limited to 200
characters; paths, control characters and invalid Windows basenames are rejected. The
original name never determines the storage path. Set `Content-Length` when available;
the server also bounds the actual stream to 10 MiB if this header is absent or inaccurate.

Pillow verifies and decodes image content, rejects MIME mismatches, animations and images
over 40 million pixels. PDFs use strict structural parsing, allow at most 200 pages and
reject encryption, JavaScript/actions, forms, embedded files and URI links. This structural
validation is not a malware scan or production acceptance. PDFs always download as attachments;
images can display inline. File responses require authentication and use `no-store`,
`nosniff` and a sandbox CSP.

Storage filenames are `<sha256>.<png|jpg|webp|pdf>`. A database advisory lock coordinates
concurrent uploads of the same checksum, and atomic file creation never overwrites an
existing original. New assets start as `pending`; duplicates return the existing registry
record with its rights and timestamps intact. Temporary files are removed on failure.
After an ambiguous database commit the server rechecks registration before removing a new
file; if the database is unavailable, it retains a private orphan for later inspection.

`Asset` includes `id`, `original_filename`, `mime_type`, `asset_type`, `checksum`, `file_size`,
nullable `width`/`height`, `storage_bucket`, `storage_path`, `public_url`, `owner_id`,
`rights_status`, `rights_notes`, `reviewed_by`, `reviewed_at`, `review_reason`,
`effective_from`, `effective_to`, and `updated_at`. File contents and upload metadata are
immutable. The registry and preview endpoints let staff inspect pending/revoked files.

Only publishers can approve or revoke rights. Review requires the asset's latest
`updated_at`, decision `approved` or `revoked`, nonblank `rights_notes` and `change_reason`,
and both effective-date keys (nullable ISO timestamps with timezone). Approval of an
already expired interval is rejected. Binding/removal instead uses the project's latest
`updated_at`. `alt_text.th` is required. `hero`/`thumbnail` require images, `floor_plan`
accepts an image or PDF, and `brochure` requires PDF. Binding replaces the current primary
asset for that role in the draft; removal affects the draft. These actions do not publish.

Consumer downloads query the current project/brand publication eligibility in PostgreSQL on every request.
Approval alone does not expose a file. Revoked/expired rights, withdrawal or loss of the
eligible published reference blocks subsequent consumer access, including guessed asset IDs.

## Checks

```powershell
uv run --project apps/api --cache-dir .cache/uv pytest apps/api/tests
```

The auth/validation suite uses an offline generated RSA JWKS. For the real database
workflow, set `HUB_TEST_DATABASE_URL` to the seeded local runtime connection first.
The integration tests exercise draft isolation, optimistic conflict, real publication,
withdrawal, rollback, readiness gates, source lists, selection conflicts and human model review.
Run them only against the local test fixtures after all migrations are applied. They restore
edited draft fields, review status and publication pointers; immutable test version/audit
records and fresh verification timestamps remain in the demo DB. Creating projects,
adding later staged models and cross-project ownership also have database and UI checks.

The asset integration test uses generated image/PDF fixtures with unique checksums, covers
concurrent deduplication, rights transitions, stale reviews and authenticated file responses,
and removes its registry/files in `finally`. Cleanup reads the ignored local owner config
only after checking the runtime DSN matches this workspace's local port/database/credential.
It never edits demo project bindings or publishes its test assets. Rights/publication access
and project binding/removal also have database and UI coverage.

The brand integration test requires the published synthetic brand assigned to `DEMO-001`.
It checks draft isolation, frozen brand content in project releases, exact brand filtering,
withdrawal/rollback and logo revocation. It restores brand/project publication pointers,
draft fields and logo rights; immutable test releases/audits and review timestamps remain.
Run integration tests serially, without simultaneous browser edits on the demo project.
