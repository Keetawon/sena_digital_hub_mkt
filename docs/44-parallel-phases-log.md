# 44 — Parallel phases log (Phases 4, 7 and 10a)

Parallel delivery of the [project content and website FAQ programme](41-project-content-and-faq.md)
for Phase 4 (FAQ intake, K2), Phase 7 (facilities, features and places, C4) and the articles
part of Phase 10. Each phase is an owner-merged pull request from its own `claude/*` branch.
Codex's main-line phases are logged in [42](42-project-content-programme-log.md).

## Phase 4 — FAQ intake (K2)

Branch `claude/k2-faq-intake`, built on Phase 2 (`01d288f`) and rebased onto Phase 5 (`d9837de`). Design: doc 41 §3.8.

### Permission card

| Field | Decision |
|---|---|
| Feature / owner | Deciding legacy FAQ candidates cluster by cluster; Marketing (Knowledge E), Managers (Knowledge A) for proposed questions |
| Tab | Existing `knowledge`. No new tab or special |
| View | Cluster list (filters, progress, brand facets), cluster detail: question variants with source URL/reference, answer groups with exact REM phases and closed flag, suggestion, existing FAQ identities for the suggested key, decision history |
| Edit | Create one draft answer through Phase 2 `hub.save_faq`, reject (note), hold (code + note), propose a new standard question through `hub.save_faq_question` |
| Approve | Unchanged: proposed questions are activated by the existing Knowledge A approval with editor separation (D6). No publication |
| Separation | Decisions record the actor; the question approver must differ from its version author (existing rule) |
| Templates / agency | No template or account change; agencies, service consumers and pending accounts are denied |
| Sensitivity | Internal evidence; candidate text is never sent to an AI provider. Clustering is offline |
| Other tabs | Project names and closed status are minimal REM references already exposed by `hub.faq_references` |
| Shared surfaces | No public endpoint, RAG, export, assistant tool or worker |
| Endpoints / SQL | `GET /v1/admin/faq-intake/clusters`, `GET …/{cluster_id}`, `POST …/{cluster_id}/decision`; tables `staging.faq_clusters`, `hub.faq_intake_decisions`; functions `hub.faq_intake_clusters`, `hub.faq_intake_cluster`, `hub.decide_faq_cluster`, private `hub.faq_intake_state`/`hub.faq_intake_text`, operator-only `staging.replace_faq_clusters` |
| Verification | Real `hub_app` SQL per role, V/E denial and revocation, stale revisions, immutable decisions, frozen regeneration, API route/filter denial, 1280/390 px browser flow |

### Design decisions

- **Clusters are derived and regenerable.** `scripts/generate-faq-clusters.py` reads FAQ
  candidates that have no Knowledge review, computes clusters with
  `sena_hub_api.faq_clusters.build_clusters` and replaces only undecided clusters. Any cluster
  with a decision (including a hold) is frozen, and its candidates are never regrouped; the
  database rejects a regeneration that would regroup them. The same inputs give the same
  clusters, keys, order and generation hash.
- **Grouping.** Questions are normalised (NFC, whitespace, case folding, punctuation and Thai
  politeness particles), each candidate's own project and brand names become `{project}` /
  `{brand}`, and pairs are merged when the mean of character-trigram and newmm-token Jaccard
  similarity is at least 0.72. Answers are grouped the same way at 0.9 after removing the
  legacy KM `<page name> — ` prefix, so the website and KM copies of one answer share a group.
- **Suggestions.** The representative template is matched to approved and proposed bank
  questions (score ≥ 0.55) for key, level and kind. Without a match, a heuristic suggests
  programme, corporate (one answer used across brands), brand (one answer across projects) or
  project level, and handoff for availability/instalment questions.
- **Holds** come from candidate holds and the text: `numeric`, `commercial`, `programme_terms`
  (programme candidates, pending Q70), `phase_decision`, `mapping_conflict` (unknown REM ID or
  scope conflict), `prompt_injection` and `closed_project`.
- **Decision rules (SQL).** Commercial or numeric source text cannot be accepted unchanged;
  selling content (commercial topics or selling words) cannot apply to a closed REM phase
  (TPRAK); Q70 programme and unsafe-text clusters can only be held or rejected; every
  non-corporate answer needs explicit REM phases; a second answer for the same question and
  scope must be added as a version of the existing one. Rule-based applicability (D1) remains
  Codex's Phase 6.
- Candidates already handled in the Knowledge review queue are excluded from intake, so the
  same evidence is not decided twice.

### Real data

The 647 public-website FAQs and the legacy KM pairs live only in the owner's working local
database. This branch did not touch it. After merge, the owner (or Codex) runs the plan and
then `--apply` from docs/11 against the working database; the counts are reported there.

### Verification

Rebased onto Codex Phase 3 (`13fcc66`) and Phase 5 (`d9837de`). The migration was renumbered
from 62 to `202610220068_faq_intake.sql` without content change (same LF SHA-256). Shared
registration conflicts kept Codex's lines and appended the intake entries. Phase 3/5 do not
change the FAQ tables, functions or candidates used here; the intake tab and its browser flow
were re-verified against the combined code.

| Gate | Result |
|---|---|
| Admin typecheck + offline webpack production build | Passed |
| Full API suite | 1,964 passed, 11 unchanged opt-in skips, 0 failed; 6 existing deprecation warnings; 872.11 s |
| Full DB suite, incl. disposable populated upgrade / migration replay through migration 68 | 58 SQL/concurrency checks + 10 Node tests passed; 0 skipped/failed |
| Full browser suite, one run (includes `faq-intake.spec.ts` at 1280 and 390 px) | 275 passed, 0 failed, 0 flaky; 10.9 min |
| Loopback H1 (68 migrations) | 11 protocol + 45 browser cases passed (35 core, 3 flags, 7 outage); 0 failed |
| Credential scan (changed files, browser static files, rebase artifacts) | 0 matches; receipt `credential-scan.json` |

Rebase gate logs are ignored under `artifacts/project-content-phase4-rebase/`. Ports were
released after every run.

Before the rebase, the same branch passed 1,923 API tests, 56 SQL + 8 Node DB checks, H1 and
264 of 265 browser cases; the single `permission-navigation.spec.ts` identity-switch failure
then passed 45/45 when repeated and passed in the rebased full run above. Earlier failed runs
are not counted: five failures caused by this phase (a test transaction that committed, and a
read-ceiling probe entry for a `hub_app`-only function, removed as Phase 2 did), two SQL bugs
(an omitted candidate selection did not fall back to all members; an ordering column that
`hub.faqs` lacks), an overnight run that stalled for 8.5 hours with one connection timeout, and
a run that collided with a leftover run of this branch on port 55432, where the data-directory
guard refused every foreign connection. The overnight log printed a local test password in a
traceback and was deleted. The hold-badge list reused the filter's accessible name; it is now
"เงื่อนไขของกลุ่มนี้". No test was skipped, quarantined or weakened.

### Screenshots

Synthetic local data, ignored and never force-added:
`artifacts/project-content-phase4/intake-list-{1280,390}.png`,
`intake-decision-{1280,390}.png`, `intake-decided-{1280,390}.png`. The 1280 px list and
390 px decision form were inspected: no horizontal overflow, readable hold badges, stacked form.

### Shared-file edits (registration only)

`main.py` (one import and one registration line), `content_permissions.py` (three
`CONTENT_RULES` entries), `faq-workspace.tsx` (one tab and its render line),
`content-routes.ts` + proxy `route.ts` (exact routes and the list filter allowlist),
`test_permission_baseline.py` / `test_permission_db_baseline.py` (new inventories),
`scripts/test-db.mjs`, `supabase/hosted-test/profile.json` and
`tests/supabase-test-migrations.test.mjs` (migration 68 checksum and count).
No Codex migration was edited.

No new pending question. Working database, hosted resources, DW, REM and providers were not
touched; `sena_h_approved` remains false.
