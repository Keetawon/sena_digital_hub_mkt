"""Synthetic finance handoffs: integrity, no source writes, no card-column retention."""
import copy
import csv
import io
import json
from decimal import Decimal
from uuid import UUID

import pytest

from sena_hub_api import finance_imports as intake


def manifest(kind="ledger", count=1):
    headers = ({"rem_project_id": "ProjectID", "formatted_mapping": "Formatted Mapping", "bud": "BUD",
                "agency": "Agency", "gross_amount": "BUDGET ONLINE การตลาดให้", "fee_po_ref": "เลข PO", "memo_no": "เลข Memo"}
               if kind == "ledger" else {"charge_date": "Charge Date", "amount": "Amount", "category": "Category",
                                          "bud": "BUD", "detail": "Detail", "direction": "Direction"})
    return {"format_version": 1, "logical_source_id": "synthetic-" + kind, "source_file": "synthetic.csv",
            "tab": "Sep synthetic", "month": "2026-09-01", "source_header_row": 1,
            "source_rows": list(range(2, count + 2)), "exported_at": "2026-09-30T12:00:00+07:00",
            "safe_projection_reviewed": True, "header_profile": {"id": "synthetic-" + kind, "version": 1,
                "synthetic": True, "headers": headers, "category_map": {"OA": "CHANNEL", "Ads": "MEDIA", "Software": "TOOL"}},
            "statement_control_id": str(UUID(int=101)), "control_total": str(count * 100)}


def csv_data(handoff, rows=None, *, order=None, omit=None, extras=None):
    profile = handoff["header_profile"]
    fields = order or [k for k in profile["headers"] if k != omit]
    headers = [profile["headers"][k] for k in fields] + list((extras or {}).keys())
    sample = {"rem_project_id": "00412", "formatted_mapping": "C-DEMO-TEST1", "bud": "DEMO",
              "agency": "KIN", "gross_amount": "100.00", "fee_po_ref": "0000123", "memo_no": "",
              "charge_date": "2026-09-05", "posting_date": "", "amount": "100.00", "direction": "DEBIT",
              "category": "OA", "detail": "SYNTHETIC LINE OA", "account_id": "0000123456", "platform": "GOOGLE"}
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    for changes in rows if rows is not None else [{}]:
        row = {**sample, **changes}
        writer.writerow([row.get(k, "") for k in fields] + list((extras or {}).values()))
    return output.getvalue()


def test_ledger_binds_reordered_exact_headers_preserves_source_ids_and_missing_memo():
    handoff = manifest()
    fields = list(reversed(list(handoff["header_profile"]["headers"])))
    normal = intake.validate_export(handoff, csv_data(handoff), "ledger")
    reordered = intake.validate_export(handoff, csv_data(handoff, order=fields), "ledger")
    assert normal == reordered
    assert normal["rows"][0]["rem_project_id"] == "00412"
    assert normal["rows"][0]["fee_po_ref"] == "0000123"
    assert normal["rows"][0]["memo_no"] is None
    assert normal["issues"] == []


def test_optional_memo_column_can_be_absent_without_filling():
    handoff = manifest()
    value = intake.validate_export(handoff, csv_data(handoff, omit="memo_no"), "ledger")
    assert value["rows"][0]["memo_no"] is None
    assert "เลข Memo" not in value["rows"][0]["raw_row"]


@pytest.mark.parametrize("change", ["missing", "duplicate", "near_match", "unexpected"])
def test_structural_header_failure_retains_no_raw_rows(change):
    handoff = manifest()
    source = csv_data(handoff)
    if change == "missing":
        source = csv_data(handoff, omit="bud")
    elif change == "duplicate":
        source = source.replace("Agency", "BUD")
    elif change == "near_match":
        source = source.replace("ProjectID", "ProjectID ")
    else:
        source = csv_data(handoff, extras={"Card last4": "PRIVATE-CARD-VALUE"})
    with pytest.raises(intake.ImportFormatError) as error:
        intake.validate_export(handoff, source, "ledger")
    assert "PRIVATE" not in str(error.value)
    assert "Card" not in str(error.value)


def test_card_discarded_columns_affect_neither_hashes_nor_payload():
    handoff = manifest("card")
    handoff["header_profile"]["discard_headers"] = ["Card last4", "Cardholder", "Address"]
    extras = {"Card last4": "PRIVATE-1234", "Cardholder": "PRIVATE-HOLDER", "Address": "PRIVATE-ADDRESS"}
    first = intake.validate_export(handoff, csv_data(handoff, extras=extras), "card")
    second = intake.validate_export(handoff, csv_data(handoff, extras={k: "CHANGED-PRIVATE" for k in extras}), "card")
    assert first == second
    encoded = json.dumps(first)
    assert all(value not in encoded for value in [*extras, *extras.values(), "CHANGED-PRIVATE"])


@pytest.mark.parametrize("sensitive", ["XXXX 1234", "4444-3333-2222-1111", "4444333322221111"])
def test_retained_free_text_card_pattern_rejected_without_echo(sensitive):
    handoff = manifest("card")
    with pytest.raises(intake.ImportFormatError) as error:
        intake.validate_export(handoff, csv_data(handoff, [{"detail": sensitive}]), "card")
    assert sensitive not in str(error.value)


def test_111_identical_card_occurrences_keep_multiplicity_and_nonunique_hashes():
    handoff = manifest("card", 111)
    payload = intake.validate_export(handoff, csv_data(handoff, [{}] * 111), "card")
    assert len(payload["rows"]) == 111
    assert len({row["row_hash"] for row in payload["rows"]}) == 1
    assert len({row["row_no"] for row in payload["rows"]}) == 111
    assert payload["net_total"] == "11100.00"
    assert payload["issues"] == []


def test_batch_identity_ignores_filename_and_receipt_but_preserves_order_changes():
    handoff = manifest("card", 2)
    first_rows = [{"detail": "SYNTHETIC A"}, {"detail": "SYNTHETIC B"}]
    first = intake.validate_export(handoff, csv_data(handoff, first_rows), "card")
    renamed = copy.deepcopy(handoff)
    renamed.update(source_file="renamed.csv", exported_at="2026-10-01T00:00:00+07:00")
    second = intake.validate_export(renamed, csv_data(renamed, first_rows), "card")
    reversed_rows = intake.validate_export(handoff, csv_data(handoff, first_rows[::-1]), "card")
    assert first["source_fingerprint"] == second["source_fingerprint"]
    assert first["source_fingerprint"] != reversed_rows["source_fingerprint"]


def test_card_credits_and_mismatch_are_exact_without_balancing_rows():
    handoff = manifest("card", 2)
    handoff["control_total"] = "66.67"
    rows = [{"amount": "100.00"}, {"amount": "33.33", "direction": "CREDIT"}]
    payload = intake.validate_export(handoff, csv_data(handoff, rows), "card")
    assert payload["net_total"] == "66.67"
    assert payload["issues"] == []
    handoff["control_total"] = "66.68"
    bad = intake.validate_export(handoff, csv_data(handoff, rows), "card")
    assert [x["code"] for x in bad["issues"]] == ["statement_total_mismatch"]
    assert len(bad["rows"]) == 2


@pytest.mark.parametrize("amount", ["1e3", "1,000.00", "1.001", "-1.00", "NaN", "1000000000000.00", "=SUM(A1)"])
def test_invalid_amount_quarantines_semantics(amount):
    handoff = manifest()
    payload = intake.validate_export(handoff, csv_data(handoff, [{"gross_amount": amount}]), "ledger")
    assert payload["issues"][0]["code"] == "invalid_amount"
    assert "gross_amount" not in payload["rows"][0]


@pytest.mark.parametrize("day", ["2026-09-02", "2026-02-30", "01/09/2026"])
def test_calendar_month_not_guessed(day):
    handoff = manifest()
    handoff["month"] = day
    with pytest.raises(intake.ImportFormatError):
        intake.validate_export(handoff, csv_data(handoff), "ledger")


def test_ledger_duplicate_phase_is_not_summed():
    handoff = manifest(count=2)
    payload = intake.validate_export(handoff, csv_data(handoff, [{}, {}]), "ledger")
    assert payload["issues"][0]["code"] == "duplicate_phase"
    assert len(payload["rows"]) == 2


def test_unknown_category_does_not_invent_a_cost_type_or_oa_identity():
    handoff = manifest("card")
    payload = intake.validate_export(handoff, csv_data(handoff, [{"category": "Unknown"}]), "card")
    assert payload["rows"][0]["cost_type"] is None
    assert payload["rows"][0]["account_id"] is None
    assert payload["issues"] == []  # financially reconciled, still needs classification


def test_google_descriptor_rule_retains_leading_zero_and_conflicts_are_findings():
    handoff = manifest("card")
    handoff["header_profile"]["account_descriptor_rule"] = {"prefix": "SYNTHETIC GOOGLE ", "suffix": "", "digits": 10, "platform": "GOOGLE"}
    payload = intake.validate_export(handoff, csv_data(handoff, [{"detail": "SYNTHETIC GOOGLE 0000123456"}]), "card")
    assert payload["rows"][0]["account_id"] == "0000123456"
    handoff["header_profile"]["headers"]["account_id"] = "Account"
    bad = intake.validate_export(handoff, csv_data(handoff, [{"detail": "SYNTHETIC GOOGLE 0000123456", "account_id": "0000999999"}]), "card")
    assert bad["issues"][0]["code"] == "account_conflict"


def test_real_profile_requires_review_evidence():
    handoff = manifest()
    handoff["header_profile"]["synthetic"] = False
    with pytest.raises(intake.ImportFormatError):
        intake.validate_export(handoff, csv_data(handoff), "ledger")


def test_reviewed_numeric_account_id_keeps_leading_zeros_without_card_guessing():
    handoff = manifest("card")
    handoff["header_profile"]["headers"]["account_id"] = "Account ID"
    payload = intake.validate_export(handoff, csv_data(handoff, [{"account_id": "0000123456789012"}]), "card")
    assert payload["rows"][0]["account_id"] == "0000123456789012"
    with pytest.raises(intake.ImportFormatError):
        intake.validate_export(handoff, csv_data(handoff, [{"account_id": "XXXX-XXXX-XXXX-1234"}]), "card")


@pytest.mark.parametrize("bad_field", ["format_version", "profile_version", "category_map"])
def test_profile_types_reject_boolean_versions_and_nontext_categories(bad_field):
    handoff = manifest("card")
    source = csv_data(handoff)
    if bad_field == "format_version":
        handoff["format_version"] = True
    elif bad_field == "profile_version":
        handoff["header_profile"]["version"] = True
    else:
        handoff["header_profile"]["category_map"]["OA"] = ["CHANNEL"]
    with pytest.raises(intake.ImportFormatError):
        intake.validate_export(handoff, source, "card")


def test_dry_run_has_no_database_or_source_mutation(tmp_path, monkeypatch, capsys):
    handoff = manifest()
    handoff["csv_file"] = "source.csv"
    source = csv_data(handoff).encode("utf-8")
    csv_path = tmp_path / "source.csv"
    csv_path.write_bytes(source)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(handoff), encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["stage-ads-ledger.py", "--manifest", str(manifest_path)])
    monkeypatch.setattr(intake, "apply_local", lambda *_: pytest.fail("dry run attempted database write"))
    assert intake.main("ledger") == 0
    assert csv_path.read_bytes() == source
    assert json.loads(capsys.readouterr().out)["status"] == "VALIDATED_DRY_RUN"
    assert len(list(tmp_path.iterdir())) == 2


def test_unsafe_input_never_calls_apply(tmp_path, monkeypatch, capsys):
    handoff = manifest()
    handoff["csv_file"] = "source.csv"
    (tmp_path / "source.csv").write_text(csv_data(handoff, extras={"Card last4": "PRIVATE-SECRET"}), encoding="utf-8")
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(handoff), encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["stage-ads-ledger.py", "--manifest", str(path), "--apply"])
    monkeypatch.setattr(intake, "apply_local", lambda *_: pytest.fail("unsafe input reached database"))
    assert intake.main("ledger") == 1
    output = capsys.readouterr().out
    assert "PRIVATE-SECRET" not in output
    assert json.loads(output)["status"] == "REJECTED"
