"""Exercise actual guarded importer transactions; every fixture is rolled back."""
import asyncio
from contextlib import asynccontextmanager
import copy
import json
import os
from urllib.parse import urlsplit
from uuid import uuid4

import asyncpg
import pytest

from sena_hub_api.finance_imports import validate_export
from test_finance_imports import csv_data, manifest

DSN = os.getenv("HUB_TEST_DATABASE_URL", "")
pytestmark = [pytest.mark.integration, pytest.mark.skipif(
    not DSN or urlsplit(DSN).hostname not in {"127.0.0.1", "localhost", "::1"},
    reason="Requires local synthetic finance database")]


@asynccontextmanager
async def local_transaction():
    connection = await asyncpg.connect(DSN)
    await connection.set_type_codec("jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads)
    transaction = connection.transaction()
    await transaction.start()
    try:
        await connection.execute("SET LOCAL ROLE online_staff")
        await connection.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000006',true)")
        yield connection
    finally:
        await transaction.rollback()
        await connection.close()


async def command(connection, action, payload):
    return await connection.fetchval("SELECT ads.finance_command($1,$2::jsonb)", action, payload)


def test_guarded_ledger_replay_conflict_and_atomic_whole_batch_quarantine():
    async def run():
        async with local_transaction() as connection:
            handoff = manifest()
            handoff.update(logical_source_id="synthetic-ledger-" + uuid4().hex, month="2091-09-01")
            data = [{"rem_project_id": "00001", "bud": "C1"}]
            payload = validate_export(handoff, csv_data(handoff, data), "ledger")
            first = await command(connection, "ledger_import", payload)
            assert first["status"] == "APPLIED"
            again = await command(connection, "ledger_import", payload)
            assert again["id"] == first["id"] and again["replayed"] is True
            before = await connection.fetchval("SELECT count(*) FROM ads.media_line_component")
            changed = validate_export(handoff, csv_data(handoff, [{**data[0], "gross_amount": "120.00"}]), "ledger")
            conflict = await command(connection, "ledger_import", changed)
            assert conflict["status"] == "QUARANTINED"
            assert await connection.fetchval("SELECT count(*) FROM ads.media_line_component") == before
            quarantined_replay = await command(connection, "ledger_import", changed)
            assert quarantined_replay["id"] == conflict["id"] and quarantined_replay["replayed"] is True

            mixed = manifest(count=2)
            mixed.update(logical_source_id="synthetic-mixed-" + uuid4().hex, month="2092-09-01")
            mixed_payload = validate_export(mixed, csv_data(mixed, [data[0], {"rem_project_id": "UNKNOWN-PHASE", "bud": "C1"}]), "ledger")
            assert mixed_payload["issues"] == []  # database must verify the master bridge
            blocked = await command(connection, "ledger_import", mixed_payload)
            assert blocked["status"] == "QUARANTINED"
            assert await connection.fetchval("SELECT count(*) FROM ads.media_line_component") == before
            assert not await connection.fetchval("SELECT exists(SELECT 1 FROM ads.media_line WHERE month='2092-09-01')")
    asyncio.run(run())


async def create_statement(connection, amount):
    return await command(connection, "statement_create", {
        "operator_ref": "synthetic-statement-" + uuid4().hex, "issuer": "SYNTHETIC ISSUER",
        "cycle_start": "2091-08-26", "cycle_end": "2091-09-25", "due_date": "2091-10-15",
        "declared_total": amount, "total_meaning": "NET_CHARGES", "review_status": "CONFIRMED",
        "evidence_ref": "synthetic-control-only",
    })


def test_guarded_card_111_occurrences_replay_changed_batch_and_safe_projection():
    async def run():
        async with local_transaction() as connection:
            control = await create_statement(connection, "11100.00")
            handoff = manifest("card", 111)
            handoff.update(logical_source_id="synthetic-card-" + uuid4().hex, statement_control_id=control["id"])
            handoff["header_profile"]["discard_headers"] = ["Card last4"]
            rows = [{"bud": "C1", "charge_date": "2091-09-05"}] * 111
            payload = validate_export(handoff, csv_data(handoff, rows, extras={"Card last4": "MUST-NOT-PERSIST"}), "card")
            first = await command(connection, "card_import", payload)
            assert first["status"] == "APPLIED_DRAFT"
            stored = await connection.fetch("SELECT row_no,row_hash,raw_row FROM staging.ads_card_row WHERE batch_id=$1", first["id"])
            assert len(stored) == 111 and len({row["row_hash"] for row in stored}) == 1
            assert "MUST-NOT-PERSIST" not in json.dumps([dict(row) for row in stored])
            again = await command(connection, "card_import", payload)
            assert again["id"] == first["id"] and again["replayed"] is True
            changed_rows = list(rows)
            changed_rows[0] = {**rows[0], "detail": "SYNTHETIC RECLASSIFICATION"}
            changed = validate_export(handoff, csv_data(handoff, changed_rows, extras={"Card last4": "MUST-NOT-PERSIST"}), "card")
            conflict = await command(connection, "card_import", changed)
            assert conflict["status"] == "QUARANTINED"
            assert await connection.fetchval("SELECT count(*) FROM staging.ads_card_row WHERE batch_id=$1", first["id"]) == 111
    asyncio.run(run())


def test_database_rechecks_statement_total_instead_of_trusting_manifest():
    async def run():
        async with local_transaction() as connection:
            control = await create_statement(connection, "99.99")
            handoff = manifest("card")
            handoff.update(statement_control_id=control["id"], logical_source_id="synthetic-wrong-control-" + uuid4().hex)
            # The local parser reconciles its supplied 100.00, but SQL must check 99.99.
            payload = validate_export(handoff, csv_data(handoff, [{"charge_date": "2091-09-05", "bud": "C1"}]), "card")
            assert payload["issues"] == []
            result = await command(connection, "card_import", payload)
            assert result["status"] == "QUARANTINED"
            assert not await connection.fetchval("SELECT exists(SELECT 1 FROM ads.cost_record c JOIN staging.ads_card_row r ON r.id=c.source_row_id WHERE r.batch_id=$1 AND c.status='CONFIRMED')", result["id"])
    asyncio.run(run())


def test_ledger_group_retains_distinct_phase_bud_memo_and_fee_po_references():
    async def run():
        async with local_transaction() as connection:
            handoff = manifest(count=2)
            handoff.update(logical_source_id="synthetic-phases-" + uuid4().hex, month="2093-09-01")
            rows = [{"rem_project_id": "00001", "bud": "C1", "memo_no": "MO9309001", "fee_po_ref": "0000123"},
                    {"rem_project_id": "00002", "bud": "C2", "gross_amount": "50.01", "memo_no": "MO9309002", "fee_po_ref": "0000456"}]
            result = await command(connection, "ledger_import", validate_export(handoff, csv_data(handoff, rows), "ledger"))
            assert result["status"] == "APPLIED"
            records = await connection.fetch("""SELECT c.rem_project_id,c.bud,c.gross_amount,c.observed_memo_no,c.memo_id,c.fee_po_ref
                FROM ads.media_line l JOIN ads.media_line_revision r ON r.line_id=l.id
                JOIN ads.media_line_component c ON c.revision_id=r.id WHERE l.month='2093-09-01' ORDER BY c.rem_project_id""")
            assert len(records) == 2
            assert [(r["rem_project_id"], r["bud"], str(r["gross_amount"]), r["observed_memo_no"], r["memo_id"], r["fee_po_ref"]) for r in records] == [
                ("00001", "C1", "100.00", "MO9309001", None, "0000123"),
                ("00002", "C2", "50.01", "MO9309002", None, "0000456")]
            assert await connection.fetchval("SELECT count(*) FROM ads.media_line WHERE month='2093-09-01'") == 1
    asyncio.run(run())


def test_invalid_card_cells_are_quarantined_without_partially_created_costs():
    async def run():
        async with local_transaction() as connection:
            control = await create_statement(connection, "200.00")
            handoff = manifest("card", count=2)
            handoff.update(statement_control_id=control["id"], logical_source_id="synthetic-invalid-cells-" + uuid4().hex)
            payload = validate_export(handoff, csv_data(handoff, [
                {"charge_date": "2091-09-05", "bud": "C1"},
                {"charge_date": "invalid-date", "bud": "C1", "amount": "100.001", "direction": "UNKNOWN"},
            ]), "card")
            assert {issue["code"] for issue in payload["issues"]} >= {"invalid_amount", "invalid_date", "invalid_direction"}
            result = await command(connection, "card_import", payload)
            assert result["status"] == "QUARANTINED"
            assert await connection.fetchval("SELECT count(*) FROM staging.ads_card_row WHERE batch_id=$1", result["id"]) == 2
            assert await connection.fetchval("SELECT count(*) FROM ads.cost_record c JOIN staging.ads_card_row r ON r.id=c.source_row_id WHERE r.batch_id=$1", result["id"]) == 0
    asyncio.run(run())
