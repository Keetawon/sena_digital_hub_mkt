# Promotion source confirmation — design for after rollout

Owner decision, 23 November 2026. **Design only; excluded from the current
release and migrations 1–94.** First follow-up after rollout. Estimate: **1–2
working days**, including migration, focused DB/API/UI checks and review;
hosted deployment remains a separate owner approval.

Promotions arrive with external BUD, legal and management approval. Hub should
record one confirmation that its current data matches that approved document,
made by someone with `promotions.approve` in the existing content scope.
Keep the approval reference in the existing `promotion_reviews.evidence` field.

## Smallest safe implementation

Use the existing review endpoint/table/audit mechanism. Add one explicit review
kind, proposed `SOURCE`, instead of inventing a second approval system. Keeping
`DATA` and relabelling it would silently promote old partial DATA reviews to
complete approval; creating a new table would duplicate the audit mechanism.
The distinct kind keeps old DATA/LEGAL evidence legible and avoids that promotion.

| Area | Proposed change |
| --- | --- |
| Readiness | One latest APPROVED SOURCE review for the exact draft revision, with nonblank approval reference and matching resolved project IDs, replaces the two-lane/count-of-two requirement. Latest REVOKED or a new draft/scope invalidates readiness. Keep all dates, required fields, manual legal/English translation, source-offer, target, media and published-project checks. |
| Authorization | Keep `promotions.approve`, existing object scope, real-promotion contributor/self-review denial, revision locks and scope digest. Keep promotions Edit/Approve mutually exclusive. No grant/template/RLS broadening. |
| Publication | Update `web_promotion_check` and every promotion publishing/rollback path to consume the same decision. Keep `knowledge.publish_web` and independent web publisher: the publisher still differs from editors, translators and the approver. One content approval is not automatic publication. |
| Review UI/API | Replace DATA/LEGAL selector and two status rows with one source-confirmation action and current status. Require “เลขอ้างอิงเอกสารอนุมัติ” (e.g. memo number) in `evidence`, plus existing reason. Show “ยืนยันว่าข้อมูลตรงกับเอกสารที่อนุมัติแล้ว”. Validate nonblank trimmed evidence and the existing 4,000-character bound on both API and DB; the system cannot independently authenticate an external memo from text alone. Update review DTO/types and home/contextual/history projections. |
| Audit/history | Append a review event; retain actor, revision, timestamp, scope snapshot, evidence, reason and audit trail. Never edit or manufacture old reviews, memo references or published versions. |

## Existing promotions and public output

The current `public_api.promotions` calls `promotion_approvals_ok` against the
**published version**. Changing that helper indiscriminately would hide live
legacy promotions. Preserve the existing full DATA+LEGAL rule for historical
published revisions, including their revocation/expiry/source checks. Proposed
storage: one internal `approval_policy` marker on `promotion_versions`, default
`LEGACY_DATA_LEGAL` for existing versions and explicitly `SOURCE` for new ones.
Keep that marker out of public payloads. Evaluate live approval/revocation using
the policy frozen with each version, not by guessing from whichever review was
most recently added. A later SOURCE review must not reactivate a withdrawn or
revoked legacy version without an explicit publication action.

Proposal for drafts at cutover: require a fresh SOURCE confirmation before the
next publication, including drafts that have old DATA/LEGAL records; retain
those old records as history. Do not turn a lone old DATA review into approval.
Already published output must remain byte-for-byte and visibility-equivalent
immediately after the migration. Old versions remain subject to the same live
withdrawal/revocation rules. This transition policy is explicit for owner review.

Visible changes: one review action/status; a required approval-document reference;
old pending drafts need source confirmation before their next publication.
External BUD/legal approval is represented as evidence, not performed inside Hub.

## Migration, tests and rollback

Allocate the next migration number **after rollout**, without editing 0089–0094.
Expand the review-kind constraint and add the version-policy marker, replace
the shared decision and readiness/publication functions, update read projections,
copy and hash pins. Keep the existing evidence field; no approval or reference
is backfilled. Preserve owners, signatures,
grants, fixed search paths and audit triggers. Trace the current function
definitions including all later patches, not only the original migration.

Focused coverage: one authorized approver succeeds; empty reference fails;
editor/viewer/agency/out-of-scope/contributor cannot approve; stale revision,
changed scope, revocation, expired offer and incomplete translations still fail;
independent web publication succeeds while self-publication fails. Cover
project/brand/multi-project promotions, home/queue readiness and history, legacy
complete/incomplete reviews and live snapshots, withdrawn versions and rollback.
Prove exact public output equality at migration cutover, and no public appearance
from an approval alone. Run clean apply and hash/ACL checks, DB suite, affected
API tests and affected UI specs at 1280/390 under the sole test lease.

Rollback is a prepared forward correction plus matched application, not edited
migration history or a database restore. Keep SOURCE rows, version-policy
markers and audit events. Before new SOURCE publications exist, disable new
source-confirmation writes and restore the two-lane gate for new publication,
while retaining compatible history rendering and legacy checks that explicitly
filter DATA/LEGAL. Blindly restoring the original count-all-types helper would
break revisions that now have a third, SOURCE, record. After any SOURCE-only
publication, STOP for owner review before reverting: the old application cannot
safely interpret it. Preserve those live snapshots and revocation semantics, or
explicitly hold affected publication actions; never fabricate a second reviewer.
Rehearse both states locally before deployment.

Report the implementation and focused evidence to the owner after rollout;
deploy nothing from this note without that separate approval.
