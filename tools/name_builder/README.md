# Name_Builder (interim Google Sheets front end)

`name_builder_setup.gs` is the Apps Script bound to the registry Sheet `SENA — Campaign Name
Registry` (spreadsheet `1NltzExXglQjQqYstaMhhw_-2Zhun8TTB0XSSYFLcstg`, script project
`1adMk_mvBqdLsB3bw5zm0F817r0DPqLjXN2Y7qIsP-Cufn3iGMunPrHs4`). It was moved on 29 September 2026 from
`sena_idea_mkt_data_warehouse/apps_script/` (last change there: commit `f92d399`). The content here
is identical (only line endings differ, from the Windows checkout) and is now the only maintained copy.

Deploy: open the Sheet → Extensions → Apps Script, paste the file, save, then run `setupNameBuilder`
once. The live project must equal this file.

**Status:** it generates the 9-field V1 grammar. Before the management demo it must be re-pointed to
SENA-7 ([docs/19](../../docs/19-campaign-naming-registry.md)): build names from a media line
(ledger row: group, BUD, memo, agency, launch-month PO) and drop the month/sequence inputs. The field
spec is in [docs/ads/SENA_REGISTRY_GOOGLE_SHEETS_FIELD_SPEC.md](../../docs/ads/SENA_REGISTRY_GOOGLE_SHEETS_FIELD_SPEC.md).
