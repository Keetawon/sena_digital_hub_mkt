# P2 operator export format

Implementation contract for the read-only importers in
[doc 23](../23-media-lines-and-memo-register.md) and
[doc 24](../24-card-costs-and-recurring-commitments.md). Examples below are entirely
synthetic. The CLI applies only to the loopback development database using the
restricted runtime login and `online_staff` role; it cannot deploy/import into the
remote Supabase project. Production profile/access acceptance remains Q4/Q22.

## Local commands

Store handoffs under ignored `.local/finance-intake/`. The CSV path in a manifest is
resolved relative to that manifest. Dry run reads local files and writes nothing:

```powershell
uv run --project apps/api --cache-dir .cache/uv python scripts/stage-ads-ledger.py --manifest .local/finance-intake/ledger.json
uv run --project apps/api --cache-dir .cache/uv python scripts/stage-ads-card-costs.py --manifest .local/finance-intake/card.json
# After reviewing the safe report, repeat the relevant command with --apply.
```

The default actor is the existing synthetic Online actor (UUID ending `000006`).
`--actor-id` records a trusted local operator actor; it does not grant a new role.
No source file is changed or archived. Output contains only receipt/status/hash,
row count, net total and safe issue codes. It never prints credentials or raw rows.

The API/database must have migration 0015 before apply. An APPLIED ledger receipt
means a draft budget was imported; APPLIED_DRAFT card receipts still require staff
review and confirmation in the Hub. Neither means a memo or payment was approved.

## Ledger example

`ledger.csv` (exact header spelling, UTF-8; column order may change):

```csv
ProjectID,Formatted Mapping,BUD,Agency,BUDGET ONLINE การตลาดให้,เลข PO,เลข Memo
00001,C-DEMO-TEST1,C1,KIN,100.00,0000123,
```

`ledger.json`:

```json
{
  "format_version": 1,
  "csv_file": "ledger.csv",
  "logical_source_id": "synthetic-ledger",
  "source_file": "synthetic-ledger.csv",
  "tab": "Sep synthetic",
  "month": "2091-09-01",
  "source_header_row": 1,
  "source_rows": [2],
  "exported_at": "2026-09-30T12:00:00+07:00",
  "safe_projection_reviewed": true,
  "header_profile": {
    "id": "synthetic-ledger-v1",
    "version": 1,
    "synthetic": true,
    "headers": {
      "rem_project_id": "ProjectID",
      "formatted_mapping": "Formatted Mapping",
      "bud": "BUD",
      "agency": "Agency",
      "gross_amount": "BUDGET ONLINE การตลาดให้",
      "fee_po_ref": "เลข PO",
      "memo_no": "เลข Memo"
    }
  }
}
```

The fixture phase `00001` belongs to `C-DEMO-TEST1`; leading zeros are text. The
memo column is optional and blank remains null. The importer does not look at old
campaign names or adjacent rows for a memo. Ledger files must contain only approved
columns; unexpected/duplicate/missing headers reject the file before staging.
Corporate program-period rows require explicit manual entry until a reviewed source
profile is supplied, rather than guessing programs from labels.

## Card example

Create a **synthetic** statement control in the Hub first, with a reviewed NET_CHARGES
total of `200.00`, then put its UUID in `statement_control_id`. The UUID below is a
placeholder for dry-run illustration and is not a deployed record.

`card.csv`:

```csv
Charge Date,Amount,Category,BUD,Detail,Direction
2091-09-05,100.00,OA,C1,SYNTHETIC LINE OA,DEBIT
2091-09-05,100.00,OA,C1,SYNTHETIC LINE OA,DEBIT
```

`card.json`:

```json
{
  "format_version": 1,
  "csv_file": "card.csv",
  "logical_source_id": "synthetic-card-sheet",
  "source_file": "synthetic-card.csv",
  "tab": "Sep synthetic",
  "statement_control_id": "00000000-0000-0000-0000-000000000101",
  "control_total": "200.00",
  "source_header_row": 1,
  "source_rows": [2, 3],
  "exported_at": "2026-09-30T12:00:00+07:00",
  "safe_projection_reviewed": true,
  "header_profile": {
    "id": "synthetic-card-v1",
    "version": 1,
    "synthetic": true,
    "headers": {
      "charge_date": "Charge Date",
      "amount": "Amount",
      "category": "Category",
      "bud": "BUD",
      "detail": "Detail",
      "direction": "Direction"
    },
    "category_map": {"OA": "CHANNEL", "Ads": "MEDIA", "Software": "TOOL"}
  }
}
```

Both identical rows are retained. Hash is an integrity check, not charge identity.
Optional card fields: `posting_date`, `memo_no`, `account_id`, `platform`. Unknown
Category stays unclassified in staging, never silently becomes MEDIA. Account
attribution can remain unresolved after the amounts/classification are reviewed.
No LINE OA count matcher or statement PDF processor exists in P2.

A reviewed card profile may specify `discard_headers` containing exact source
headers that must not be retained. These cells do not enter hashes, staging, logs
or archived files. The profile itself is not copied into provenance; only retained
header mappings are stored. Free-text Detail also requires privacy review: sanitize
the operator's export copy before handoff when necessary. Known masked/full card
number patterns cause rejection, but pattern checks are not a substitute for that
review. The Media team's source process is unchanged.

An optional reviewed `account_descriptor_rule` is a literal Google rule:
`{"prefix":"SYNTHETIC GOOGLE ","suffix":"","digits":10,"platform":"GOOGLE"}`.
It extracts only an exact full descriptor match and preserves zeros. A disagreement
with an explicit account ID is quarantined; no fuzzy account/campaign inference.

## Shared rules

- Real profiles use `synthetic: false`, `status: APPROVED`, `reviewed_by` and
  `evidence_ref`; these are trusted operator handoff evidence, not client role grants.
  Do not relabel enterprise data as a synthetic fixture. Real source/go-live approval
  remains outstanding; development verification uses synthetic profiles only.
- `source_rows` contains the original row numbers in CSV record order, with no
  duplicates. Preserve them rather than renumbering an export. One file has one
  reviewed month/statement context; partition mixed statements explicitly.
- Use canonical decimal strings without grouping commas, signs, currency marks or
  exponents. CREDIT uses a positive magnitude and `direction: CREDIT`; a card
  repayment is not a cost refund. Date strings are CE `YYYY-MM-DD`, calendar months
  use day 1, timestamps include timezone offsets. UTF-8 BOM is accepted.
- Maximum 10 MiB and 5,000 data rows per handoff. No formula evaluation, URL reads,
  workbook execution or database access during validation.
- Renaming an identical file or changing receipt/export timestamp does not change
  its replay identity. Logical source/profile, coordinates and retained values do.
  Exact replay is a no-op. Ledger conflicting facts or moved duplicate business
  keys are quarantined. Card changed/reordered statement batches require explicit
  replacement; identical occurrences inside a batch remain distinct.
- SQL rechecks statement totals, master bridges, vocab, replay and permissions in
  one transaction. Dry-run success cannot promise that a later apply will succeed
  against changed database state. Quarantined receipts retain safe evidence without
  partially applying domain records.
