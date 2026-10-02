# Hub published-content TEST fixture

Contract: `hub-published-content-v1`, source key `hub`, local TEST and synthetic
only. The two JSON arrays contain the complete eligible exported view sets at
the manifest's capture time: two brand rows and one project row, eight columns
per view. The [contract](../../../../docs/28-dw-brands-and-published-content.md#published-content-export-contract-v1)
defines eligibility, types, nullable English and project logo snapshot semantics.

`brand_published.json` and `project_published.json` contain public identifiers,
published names/slugs, exact version IDs/times and sorted logo-role arrays only.
No asset ID, locator, bytes, rights evidence, actor, raw source row or draft is
included. IDs remain strings; the invented fixture's source keys start with
`00000-HUB-EXPORT-`. English remains null when absent.

The manifest freezes file bytes/SHA-256, row counts, ordered column names and
PostgreSQL types/catalog nullability, source commit, UTC export time, applied
migration hashes and generator hashes. The source commit predates the export
implementation; migration/generator hashes identify the exact additional files
without an impossible self-referential commit hash. LF-normalized hashes support
portable checks alongside actual workstation/applied hashes.
The fixture directory pins JSON to LF on checkout so frozen byte hashes survive
Windows `autocrlf`, as in the existing financial fixture package.

The generator authenticates as the existing `dw_hub_reader` login and reads both
views in one REPEATABLE READ, READ ONLY transaction. An admin read-only session
checks complete-set synthetic provenance and exact public text, then shares its
PostgreSQL snapshot with that reader. Only the reader's view SELECTs serialize
rows. Any extra/unverified published content blocks the entire fixture output;
real brand dictionaries in private local staging are never exported as fixtures.

After the local database/migrations are ready:

```powershell
npm.cmd run dev:dw-reader
npm.cmd run dev:hub-content-fixtures -- --seed
node --test supabase/tests/hub_export.test.mjs
```

`--seed` prepares the named invented examples through the existing guarded
publication workflow. It preserves existing fixture work and refuses incomplete
or withdrawn examples. Registry metadata represents synthetic files solely for
the database contract; no asset files are generated or included. The command has
no target/credential overrides and rejects hosted targets.

The tests verify frozen checksums/schema, nullable English, publication-only
reads, hidden draft changes, original project logo roles after a later brand
publication, withdrawal/rollback/source/rights eligibility, private data/file
denials and absent write ACLs with read-only disabled. `npm run test:db` includes
these checks and retains the separate frozen `ads_export` fixture tests.
