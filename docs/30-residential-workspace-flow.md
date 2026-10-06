# 30 — Brand, group and project workspace

Owner-approved direction: 5 October 2026. Conversation labels are English; product labels remain Thai.

## First increment

Brand rows expand into project groups. Opening a group shows its member projects with direct source-selection, editor and reviewer links. A project can also be found directly. Group navigation is a read-only projection of existing staged evidence, not a new editable master or a publication entity.

Use exact REM BrandID and ProjectGroupID, never names or trimmed keys. Label groups as REM references, not certified Marketing groups. Keep missing groups and identity/group conflicts in separate, visible buckets. Show original REM and Marketing group values for disputed projects. A group spanning brands is labelled as shared; a brand-scoped view shows only that brand's projects. No membership, draft, mapping, evidence or publication changes occur from browsing.

REM and Marketing group IDs are separate namespaces. A different Marketing ID alone does not create a conflict. Use the exported Gold identity/group flags and intake exceptions; never substitute a Marketing ID for a missing REM ID. Whitespace-bearing IDs remain separate and are displayed with an explicit warning.

Use one project table with pagination (10/25/50), a sticky header, filters and compact named gap summaries. Keep direct field links and all underlying readiness items available. Source scope remains nondeleted status 0/1/2 by default; show other source states on request, and retain out-of-scope live attention items. Group counts reflect the selected scope. No project readiness percentages.

Readability follow-up approved 5 October: keep the project and brand columns fixed during horizontal scrolling on desktop; fix only the project column on narrower tablets. Give core, media, model, brand-binding and status columns explicit reading widths instead of squeezing all eleven columns into the viewport. Limit each visible gap summary to two lines, keep repeated-item counts visible, and preserve every full message and field link in the expandable list. Mobile retains stacked cards. Use existing surface, text and border tokens.

Expansion, list filters and pagination are reflected in the URL. Detail links retain a same-origin list return address; reject external or detail-recursive return addresses. Existing authoring pages remain dedicated pages with their existing unsaved-change handling.

## Roles and actions

- Admin: reviewed eligible brand creation with preview/confirmation; project draft creation and editing.
- Editor: project draft creation, content editing and explicit REM mapping confirmation.
- Publisher: open incomplete records, approve asset use, compare changes and publish only through existing gates. A publication checkbox is never the entry point for review.
- Viewer: all supported browsing and read-only details, no mutation controls.

Project attachments expose asset review next to the file, including model attachments. The existing asset review API remains authoritative. Publishing is separate from saving drafts, mapping confirmation and asset approval. No additional submit-for-approval state is introduced.

## Deferred

Shared group-content authoring/publication, Marketing unit type publication and verified unit partitions require their own contracts. Grouping does not assert common amenities, plans, specifications, prices or availability. Canonical REM models and private Marketing unit types remain separate as documented in docs/18.

## Validation

API checks cover exact source keys, conflicting/missing membership and safe metadata; UI checks cover brand expansion, group/project navigation, filter restoration, pagination, role actions and mobile layout. Run through the disposable test runner. No working-data mutation, hosted changes, migration or new RLS grants are required.

Verified on 5 October 2026: admin typecheck and production build passed (existing Google Sans fallback warning); full API suite: 1,327 passed, 11 skipped, one Starlette/AnyIO deprecation warning; database SQL, concurrency, guard and export checks passed through `npm.cmd run test:db`.

Relevant browser run: 65 passed and four legacy workflow cases initially timed out because the original DEMO-001 fixture has no REM status. Its test entry helper now explicitly includes unknown-status records. The focused workflow/group rerun passed all nine tests, covering all four initial failures; all 69 selected scenarios have passing results. Desktop/group and mobile screenshots were inspected. A final CSS adjustment keeps the group expansion label on one line and gives tablet expansions the available width.

Table readability follow-up: typecheck and build passed; `npm.cmd run test:ui -- tests/ui/project-dashboard.spec.ts tests/ui/project-groups.spec.ts` passed all 10 tests. New cases verify pinned column positions while scrolling in both directions at 1440/844 px, header stacking, unobscured keyboard focus, readable widths, a compact 63-model row and access to all 126 gap links. Desktop and tablet screenshots were inspected. No API or database behavior changed in this follow-up, so those suites were not rerun.
