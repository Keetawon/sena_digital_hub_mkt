# 26 — Residential demo, promotions and atomic releases

1 October 2026, Asia/Bangkok. Task 3 is authorized by the demo-first owner decision.
This design note precedes implementation. It narrows docs 04/08 to per-project
residential promotions and the existing brand/project/model publishing model.
Q40/Q41 record defaults; no external source, hosting or production rollout is involved.

## Promotions

Use `hub.public_promotions` with an exact Hub project FK, unique code, localized
title/summary/conditions/legal terms/disclaimer, benefit type, stackability/priority,
explicit timezone-qualified start/end, draft revision and immutable published
versions. IDs stay text at source boundaries. Money, when present, is exact
`numeric(14,2)` THB. Promotion data is structured and `rag_eligible=false` is enforced.
Per-project applicability is explicit; no name-based mapping, cross-BU targeting or
new REM ingestion is included. Optional source-offer references are read-only mirrors;
inactive/deleted source evidence withdraws consumer eligibility immediately.

Editors maintain drafts. Publishers separately record data and legal review evidence
for the current draft and publish; editing substantive promotion fields invalidates
both reviews. Q40's local demo uses clearly synthetic review evidence, never a claim
of real Legal approval. Viewer reads; online_staff, agencies and service consumers
cannot use editorial write APIs. Admin retains existing content administration but
cannot bypass publisher-only publication. All mutations use actor/RLS/audit controls.

Consumer reads use immutable snapshots and the half-open interval `[starts_at, ends_at)`
in Bangkok business time. Expiry removes eligibility at read time without a scheduler.
Inactive sources, withdrawn projects and missing/revoked approvals also fail closed.
Every response includes legal terms/disclaimer and provenance. No-cache responses
avoid an expired promotion surviving in a consumer cache. At this demo scope, offers
are per project; resolve non-stackable benefits by priority and deterministic identity.
No price calculation or assumption that an offer grants a sales entitlement.

## One atomic release

Publish a selected set of brand drafts, project drafts (including their model edits)
and promotion drafts in one PostgreSQL transaction. Reuse existing readiness,
immutable snapshot and asset-rights checks. A model remains part of its project's
snapshot, not a second independently published entity. Lock selected records in a
stable order and require expected draft revisions/pointers before changing anything.
Publish selected brands before dependent projects and promotions. Any failure leaves
every previous publication pointer unchanged; keep one release ID and an immutable
member history with before/after pointers. No external webhook is sent in this task.

Rollback explicitly names the release, requires a reason and unchanged current member
pointers, and restores its complete previous set in one transaction. Revalidate all
restored snapshots against current source/rights controls; rollback cannot restore
an expired promotion or revoked asset. A later independent publication makes the old
release stale rather than allowing it to overwrite newer work. Q41 keeps consumer
deployment/change-feed decisions separate; the local database operation is atomic.

## HYABC and FLEXI

Keep existing REM identities, source evidence and any nonempty saved editorial fields.
Fill only missing demo fields with explicit synthetic values, retaining per-entity
field provenance in snapshots/API responses and showing `ข้อมูลตัวอย่าง` beside affected
content. Use local synthetic assets/review evidence only. Never relabel real source
facts as synthetic or overwrite user edits to make a demo pass readiness.
Seed operations are local-only, replayable and record the values they introduced;
conflicting edited data is reported rather than silently reset. Reuse the existing
HYABC/FLEXI records when present. Fresh local demo setup may create separately marked
synthetic source fixtures; it does not claim those fixtures were read from REM/DW.

The current HYABC draft contains two unapproved original assets and thirteen
unconfirmed source models. Preserve their bindings, rights and review state. A
local-only, explicit `demo_mode` release uses a seeder-owned selection of approved
synthetic assets and one additional synthetic model, then runs the same readiness
and rights checks on that selected snapshot. Ordinary publication stays strict.
The alternate snapshot carries a demo flag, field provenance and excluded-original
counts; admin users can still inspect the untouched originals. The selection is
not an application-editable bypass and cannot include unmarked real assets/models.

The demo supports editing a project promotion, previewing validity/expiry, publishing
a coherent release and rolling it back. The later Task 6 command composes this seed
with ads, actuals and documents. This task must leave a callable residential seed step.

## UI, API and verification

Thai `/promotions` and `/releases` workspaces use HubShell, pending-question remarks,
the existing Emerald/Champagne tokens and motion primitives. Promotion detail shows
draft versus published, Bangkok validity, separate review evidence, legal terms and
the example-data badge. Release review lists exactly which entities/revisions will
publish and presents one explicit publisher action; rollback lists the complete set.
Unsaved/stale edits remain recoverable. The existing project/brand screens show demo
provenance without replacing their editing or source-review flows.

Use the next migration counter **0021**. SQL/RLS and concurrency checks cover expiry
boundaries, source withdrawal, approval invalidation, atomic failure/rollback,
concurrent stale drafts/releases and immutable provenance. API tests cover closed
inputs/permissions, read-only consumers and snapshot isolation. Edge tests cover Thai
forms, publisher gates, one-release failure/rollback and synthetic badges. Run the
five required suites before committing/pushing Task 3; P1/P2/P3 remain intact.

## Local residential seed

Run `npm.cmd run dev:residential-demo` after migrations, with the local database
running. The command reads the ignored local administrator configuration without
printing it and refuses any target except `127.0.0.1:55432/sena_hub_local`.
All database work is one transaction. It fills missing fields, adds one synthetic
model and three deterministic test graphics, configures the explicit demo selection,
and creates/reviews one synthetic promotion. Existing records, rights decisions,
source models, promotion edits and publication pointers are preserved on replay.
It does not publish automatically; the publisher reviews the selected release.
Generated graphics remain under ignored `.local/assets/`. The fixed demonstration
offer runs from 1 October 2026 through 1 April 2027 (exclusive), Asia/Bangkok; expiry
still applies. The Task 6 command composes this step into the full presentation seed.


## Readiness decision — 7 October 2026

The product owner split publication requirements from recommended completeness. The [current contract](31-readiness-and-review.md) supersedes earlier model-blocking rules in this document. Models never block publication; only confirmed models with complete required specs enter new versions. Optional media with pending/expired rights is omitted. Existing versions remain immutable. `model_catalogue_complete` is frozen in new project payloads and appended as a nullable boolean in `hub_export.project_published` (NULL for older versions). Draft fact cards expose current completeness; published fact cards use the frozen value. Incomplete/unknown catalogues cause a chatbot handoff for room/specification questions.
