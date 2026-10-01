# Frozen synthetic P3 read-back

Copied byte-for-byte, after verification, from the read-only DW package
`data/hub-registry/p3-readback/4e7f2eaf-8807-4f39-9aa0-b4750d37211f/`.
The owner identifies DW producer/contract commit `ec2a182`,
`docs/MARKETING_OPS_INTEGRATION.md` §5. That commit identifies the producer;
the generated package is the separately preserved local handoff above.
The manifest SHA-256 is
`a72f9aaa407128780a71b93bd7b0f50ed60a05dac7ba6af7a95a5f68dc6197ae`.
The `.gitattributes` rule preserves original JSON bytes across checkout.

The four arrays contain 13 line revisions, 17 campaign/month matches, 8 line/month
facts and 73 finding evaluations: **111 rows / 147 columns**. All file hashes,
ordered column lists and row counts are recorded in `manifest.json`.
The source schema commit is `488698177e570a4e2cc9b334793a951819a385f2`; original
Hub P2 fixture files came from `30972d03614deda82966edd1ce056d78987d4abf`.

The closed `hub-p3-test-v1` adapter accepts lossless string IDs, exact monetary
strings and JSON arrays. `evaluation_status=UNAVAILABLE` retains null conditions
and absent observation times. Of 73 evaluations, 11 are present, 44 false and
18 unavailable. These are not 73 breaches. Source periods/watermarks through 2356
are **synthetic demo evidence**, never a statement of current business freshness.
Cadence and operating cutover remain null/proposed.

```powershell
uv run --project apps/api python scripts/stage-ads-actuals.py --package supabase/tests/fixtures/ads_actuals
uv run --project apps/api python scripts/stage-ads-actuals.py --package supabase/tests/fixtures/ads_actuals --apply
```

Dry run validates without reading credentials, connecting to a DB or writing files.
Apply is fixed to `127.0.0.1:55432/sena_hub_local`, with the existing ignored local
admin configuration. The database function performs one atomic publication,
optimistic pointer checking, exact replay/no-op and conflict quarantine. Optional
`--expected-current <snapshot-UUID|none>` supplies an explicitly reviewed pointer.
The content fingerprint is SHA-256 over compact sorted-key UTF-8 JSON of
`{"manifest": manifest, "relations": {relation: original_row_array}}`.
Source rows remain immutable. No DW writes or P1/P2 mutations are involved.
