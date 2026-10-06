from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sena_hub_api import main
from sena_hub_api.project_progress import build_progress, review_content
from test_api import TOKENS, settings

NOW = datetime(2026, 10, 3, tzinfo=timezone.utc)


def fixture():
    source = {"rem_project_id": "0007", "project_name_rem": "โครงการจำลอง", "brand_name_rem": "แบรนด์จำลอง",
              "public_project_id": "prj_test", "model_count": 1, "source_record": {"is_deleted": False, "project_status": "2"},
              "mirror_imported_at": (NOW - timedelta(days=40)).isoformat()}
    project = {"public_project_id": "prj_test", "public_name": {"th": "ชื่อเผยแพร่"}, "updated_at": NOW.isoformat(),
               "source": source, "published_version_id": "v1", "publication_available": True,
               "readiness": {"ready": True, "missing": [], "percent": 100},
               "models": [{"public_model_id": "model1", "match_status": "CONFIRMED"}],
               "assets": [{"id": "asset1", "asset_role": "hero", "rights_status": "approved"}],
               "facilities": {"collected_count": 0, "expected_count": 6}}
    record = {"detail": project, "live_payload": deepcopy(project), "version_count": 1, "live_brand_withdrawn": False}
    return record, source


def test_counts_follow_gate_and_completeness_is_separate():
    record, source = fixture()
    extra = {**source, "rem_project_id": "0008", "public_project_id": None}
    data = build_progress([record], [source, extra], [], NOW)
    assert data["counts"] == {"all": 2, "new_from_rem": 1, "filling": 0, "awaiting_publisher": 0, "published": 1, "needs_attention": 0}
    row = data["rows"][0]
    assert row["rem_project_id"] == "0007" and row["age_days"] == 40 and row["age_basis"] == "mirror_import"
    assert row["amenities"] == {"collected": 0, "total": 6}
    assert row["confirmed_models"] == row["total_models"] == 1
    assert row["waiting_on"] == [] and row["checklist"]["ready"]
    record["detail"]["readiness"] = {"ready": False, "percent": 100, "missing": [{"field": "latitude", "message": "พิกัดนอกประเทศไทย"}]}
    row = build_progress([record], [source], [], NOW)["rows"][0]
    assert row["filling"] and row["gaps"]["core"][0]["field"] == "latitude" and row["waiting_on"] == ["editor"]


@pytest.mark.parametrize("never_published,pending_rights", [(True, False), (False, False), (False, True)])
def test_waiting_for_publisher_includes_ready_changes_and_pending_rights(never_published, pending_rights):
    record, source = fixture()
    record["detail"]["public_name"]["en"] = "Changed"
    if never_published:
        record["live_payload"] = None
        record["detail"]["published_version_id"] = None
    if pending_rights:
        record["detail"]["assets"][0]["rights_status"] = "pending"
        record["detail"]["readiness"] = {"ready": False, "missing": [{"field": "assets.asset1.rights_status", "message": "รอสิทธิ์"}]}
    row = build_progress([record], [source], [], NOW)["rows"][0]
    assert row["awaiting_publisher"] and row["waiting_on"] == ["publisher"]


@pytest.mark.parametrize("days,expected", [(31, False), (30, True), (0, True), (-1, True)])
def test_attention_uses_live_hero_rights_and_inclusive_30_day_window(days, expected):
    record, source = fixture()
    # A newly selected draft hero does not replace the live asset being monitored.
    record["detail"]["assets"][0]["id"] = "new-draft"
    assets = [{"id": "asset1", "rights_status": "approved", "effective_to": NOW + timedelta(days=days)}]
    row = build_progress([record], [source], assets, NOW)["rows"][0]
    assert row["needs_attention"] is expected
    if expected:
        assert row["attention"][0]["field"] == "assets.asset1.rights"


@pytest.mark.parametrize("reason", ["brand", "revoked", "deleted", "inactive"])
def test_attention_named_reasons_and_no_new_readiness_rules(reason):
    record, source = fixture()
    assets = []
    if reason == "brand": record["live_brand_withdrawn"] = True
    if reason == "revoked": assets = [{"id": "asset1", "rights_status": "revoked"}]
    if reason == "deleted": source["source_record"]["is_deleted"] = True
    if reason == "inactive": source["source_record"]["is_active"] = False
    row = build_progress([record], [source], assets, NOW)["rows"][0]
    assert row["needs_attention"] and len(row["attention"]) == 1 and not row["filling"]
    record["detail"]["published_version_id"] = None
    assert not build_progress([record], [source], assets, NOW)["rows"][0]["needs_attention"]


def test_no_guessed_source_dates_or_numeric_status_semantics_and_grouped_links():
    record, source = fixture()
    source.pop("mirror_imported_at")
    source["source_snapshot_at"] = "2020-01-01T00:00:00Z"
    source["source_record"]["project_status"] = 0
    record["detail"]["readiness"] = {"ready": False, "missing": [{"field": field, "message": field} for field in
        ("brand", "assets.hero", "models.model1.bedrooms", "slug")]}
    row = build_progress([record], [source], [], NOW)["rows"][0]
    assert row["age_days"] is None and row["age_basis"] == "unknown" and not row["needs_attention"]
    assert all(len(group) == 1 for group in row["gaps"].values())
    source["first_seen_at"] = (NOW - timedelta(days=10)).isoformat()
    source["mirror_imported_at"] = (NOW - timedelta(days=2)).isoformat()
    row = build_progress([record], [source], [], NOW)["rows"][0]
    assert row["age_days"] == 10 and row["age_basis"] == "first_seen"


def test_comparison_ignores_optional_collection_and_evidence():
    record, _ = fixture()
    project = record["detail"]
    project["facilities"]["collected_count"] = 6
    project["models"][0]["verified_by"] = "private actor"
    project["assets"][0]["rights_notes"] = "private evidence"
    assert review_content(project) == review_content(record["live_payload"])


def test_navigation_preserves_exact_membership_without_gold_substitution_or_private_values():
    record, source = fixture()
    source.update(rem_brand_id="00025", source_record={"ProjectGroupID": "GROUP-01 ", "ProjectStatus": "2", "isDeleted": False},
                  gold_source={"record": {"marketing_project_group_id": "GROUP-01", "private_price": "9000000"}})
    before = deepcopy(record)
    row = build_progress([record], [source], [], NOW)["rows"][0]
    assert row["rem_brand_id"] == "00025" and row["rem_project_group_id"] == "GROUP-01 "
    assert row["marketing_project_group_id"] == "GROUP-01" and row["group_status"] == "rem_reference"
    assert "private_price" not in str(row) and record == before


@pytest.mark.parametrize("raw,gold,expected", [
    ({}, {}, "missing"), ({"ProjectGroupID": ""}, {}, "missing"),
    ({"ProjectGroupID": None}, {"marketing_project_group_id": "G"}, "missing"),
    ({"ProjectGroupID": "G"}, {}, "rem_reference"),
    ({"ProjectGroupID": "G"}, {"marketing_project_group_id": "G"}, "rem_reference"),
    ({"ProjectGroupID": "G"}, {"project_identity_conflict": True}, "conflict"),
    ({"ProjectGroupID": None, "rem_project_group_id": "LEGACY"}, {}, "missing"),
])
def test_source_only_navigation_membership(raw, gold, expected):
    _, source = fixture()
    source.update(public_project_id=None, source_record=raw, gold_source={"record": gold})
    row = build_progress([], [source], [], NOW)["rows"][0]
    assert row["group_status"] == expected
    assert row["public_project_id"] is None


def test_latest_intake_conflict_prevents_certifying_accepted_group():
    record, source = fixture()
    source["source_record"]["ProjectGroupID"] = "G"
    source["source_review"] = {"default_scope": True, "exceptions": [{"code": "GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT"}]}
    assert build_progress([record], [source], [], NOW)["rows"][0]["group_status"] == "conflict"


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "admin"])
def test_progress_endpoint_uses_caller_and_read_only_queries(monkeypatch, role):
    record, source = fixture()
    actors = []
    class Connection:
        async def fetch(self, sql):
            assert sql.lstrip().startswith("SELECT")
            return [record] if "project_detail" in sql else []
        async def fetchval(self, sql):
            assert sql == "SELECT hub.list_rem_projects()"
            return [source]
    @asynccontextmanager
    async def database(request, actor):
        actors.append(actor.role)
        yield Connection()
    monkeypatch.setattr(main, "database", database)
    client = TestClient(main.create_app(settings()), client=("127.0.0.1", 50000))
    response = client.get("/v1/admin/projects/progress", headers={"Authorization": f"Bearer {TOKENS[role]}"})
    assert response.status_code == 200 and actors == [role]
    assert response.json()["data"]["counts"]["published"] == 1
    assert "rights_notes" not in response.text and "public_url" not in response.text


def test_consumer_cannot_read_progress():
    client = TestClient(main.create_app(settings()), client=("127.0.0.1", 50000))
    assert client.get("/v1/admin/projects/progress", headers={"Authorization": f"Bearer {TOKENS['service_consumer']}"}).status_code == 403


@pytest.mark.integration
def test_actual_staff_queries_are_read_only_and_not_capped():
    import asyncio
    import json
    import os
    from pathlib import Path
    import asyncpg
    from sena_hub_api.auth import DEMO_ACTORS
    from sena_hub_api.project_progress import read_progress
    if os.getenv("HUB_PROGRESS_TEST") != "1":
        pytest.skip("Opt-in read-only local PostgreSQL progress check")
    config = json.loads((Path(__file__).resolve().parents[3] / ".local/development.json").read_text(encoding="utf-8"))
    async def run():
        connection = await asyncpg.connect(host="127.0.0.1", port=55432, database="sena_hub_local", user="postgres", password=config["adminPassword"])
        try:
            await main.initialize_connection(connection)
            expected = None
            for role in ("editor", "publisher", "viewer", "admin"):
                async with connection.transaction(readonly=True):
                    await connection.execute(f"SET LOCAL ROLE {role}")
                    await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(DEMO_ACTORS[role]))
                    result = await read_progress(connection)
                    count = await connection.fetchval("SELECT count(*) FROM hub.projects WHERE deleted_at IS NULL")
                    assert len([row for row in result["rows"] if row["public_project_id"]]) == count
                    assert result['counts']['all'] == sum(row['source_review']['default_scope'] for row in result['rows'])
                    if expected is not None:
                        assert result['counts'] == expected
                    expected = result["counts"]
        finally:
            await connection.close()
    asyncio.run(run())


def test_completeness_counts_confirmation_and_specs_independently_and_sorts_ready_first():
    record, source = fixture()
    readiness = record['detail']['readiness']
    readiness.update(required=[{'field':'slug','group':'core','passed':True}], recommended=[
        {'field':'models.m.confirmation','group':'models','passed':False},
        {'field':'models.m.specifications','group':'models','passed':True}])
    row=build_progress([record],[source],[],NOW)['rows'][0]
    assert row['checklist']['ready'] and row['checklist']['passed']==2 and row['checklist']['total']==3
    assert row['checklist']['percent']==66 and not row['filling']
    readiness['recommended'][0]['passed']=True
    assert build_progress([record],[source],[],NOW)['rows'][0]['checklist']['percent']==100
    other=deepcopy(record);other['detail']['source']={**source,'rem_project_id':'0006'}
    other['detail']['readiness']['ready']=False
    rows=build_progress([other,record],[source],[],NOW)['rows']
    assert rows[0]['rem_project_id']=='0007'
