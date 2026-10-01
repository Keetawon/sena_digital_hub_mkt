# Frozen local TEST export

These checked-in files are an intentional DW contract fixture, not production data.
All 15 views are exported in full from the synthetic local database. The manifest
records the source Hub commit, applied migration checksums, exact view columns,
catalog nullability, row counts, UTC export time and each file's SHA-256 checksum.
It describes this frozen snapshot; later local tests may add further synthetic rows.
Migration `sha256` is the actual applied workstation file hash; the additional
`normalized_lf_sha256` supports portable checks across LF/CRLF Git checkouts.
Generator checksums identify the seed/export scripts added after the source Hub
commit, avoiding an impossible self-referential commit hash in the fixture itself.

The exporter authenticates as `dw_hub_reader` and reads all views in **one
REPEATABLE READ, READ ONLY transaction**. A separate read-only admin session checks
the local synthetic provenance and migration checksums; its PostgreSQL snapshot is
shared with the reader so validation and exported rows cannot race. Only the
reader's view SELECTs produce fixture rows. Unknown scope members, non-synthetic
evidence/source profiles or account IDs fail closed before any fixture is written.
These checks are intentionally limited to the explicit local fixture vocabulary;
they are not a general anonymization tool. Never use the exporter on real data.

JSON arrays preserve SQL `numeric`/`bigint` values as strings, including monetary
values nested in `budget_items`, `cost_breakdown` and `memo_covers`. Source IDs stay
strings, including leading zeros. Date-only months stay first-day Asia/Bangkok
dates; timestamp strings use UTC. Parse money as a decimal, not a binary float.
Catalog nullability on a view does not prove a field can be null in valid business
data. JSON object-key order has no semantic meaning.

Reproduce from the Hub repository root after starting the local DB and applying
its migrations/standard synthetic fixtures:

```powershell
npm.cmd run dev:dw-reader
node scripts/export-dw-fixtures.mjs --seed
node --test supabase/tests/dw_fixtures.test.mjs
```

`--seed` atomically adds the named `SYNTHETIC-DW-CONTRACT-V1` examples once through
the existing guarded commands. It does not truncate tables, delete rows, edit
issued names or change `sena_h_approved`. It adds a 2096 test line, a superseded and
applicable revision, an explicit SN assignment and applied correction, leading-zero
native/account IDs, a confirmed memo alias, a LINE OA mapping, an annual commitment,
and a 1,199.99 cash charge allocated over 12 months (11 × 100.00 + 99.99).
Existing browser/API synthetic rows are retained. On the same unchanged database,
replays keep data-file checksums unchanged; export time is refreshed. A newly seeded
database will have different generated UUIDs, SN sequences and timestamps.

Sum media-line components only when `is_applicable=true`; do not add superseded
revisions, memo reference amounts or typed budget items to the component gross.
Only `is_applied` correction targets are effective. Cash costs and monthly
allocations are separate measures and must never be added together. The annual
commitment is a forecast/cap, not another cash expense.

Credentials remain only in ignored `.local/dw-reader.json`. That login works only
on this workstation's `127.0.0.1:55432/sena_hub_local`. Hosted/production provisioning
is a separate approved operation; these fixtures do not authorize production
issuing or resolve pending business decisions.
