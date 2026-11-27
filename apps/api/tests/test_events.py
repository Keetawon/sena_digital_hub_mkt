"""API and RBAC tests for SENA Event Hub (/v1/admin/events/*)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from test_permission_baseline import disposable_operator
from test_permission_foundations import h, permission_accounts


def test_event_hub_denies_agency_and_service_consumer(permission_accounts):
    client, _ = permission_accounts
    for denied_role in ("agency", "service_consumer"):
        resp = client.get(
            "/v1/admin/events",
            headers=h(denied_role),
        )
        assert resp.status_code == 403, denied_role


def test_event_hub_lifecycle_cojoin_and_change_acknowledgement(permission_accounts):
    client, _ = permission_accounts
    editor_headers = h("editor")
    viewer_headers = h("viewer")
    online_headers = h("online_staff")

    refs = client.get("/v1/admin/events/references", headers=editor_headers)
    assert refs.status_code == 200
    ref_data = refs.json()["data"]
    assert any(b["id"] == "solar" for b in ref_data["businesses"])

    now = datetime.now(timezone.utc).replace(microsecond=0)
    starts = (now + timedelta(days=5)).isoformat()
    ends = (now + timedelta(days=8)).isoformat()

    created = client.post(
        "/v1/admin/events",
        headers=editor_headers,
        json={
            "title": "บูธทดสอบ API เซ็นทรัล พระราม 9",
            "venue_name": "เซ็นทรัล พระราม 9",
            "venue_zone": "ชั้น 1 โซน A",
            "province": "กรุงเทพมหานคร",
            "starts_at": starts,
            "ends_at": ends,
            "host_scope_type": "bud",
            "host_scope_id": "BUD-API-TEST",
            "host_label": "BUD ทดสอบ",
            "open_for_join": True,
            "cost_share_mode": "proportional_split",
            "estimated_cost_thb": 80000,
            "memo_no": "MO2611888",
            "campaign_code": "SN2600888A",
        },
    )
    assert created.status_code == 201, created.text
    ev = created.json()["data"]
    event_id = ev["id"]
    assert ev["event_code"].startswith("EVT-")
    assert ev["schedule_revision"] == 1

    # Viewer cannot see finance fields prior to joining, but CAN submit a co-join request
    viewer_read = client.get(f"/v1/admin/events/{event_id}", headers=viewer_headers)
    assert viewer_read.status_code == 200
    assert viewer_read.json()["data"]["estimated_cost_thb"] is None

    joined = client.post(
        f"/v1/admin/events/{event_id}/join",
        headers=viewer_headers,
        json={
            "participant_scope_type": "business",
            "participant_scope_id": "ngernsod_jaidee",
            "participant_label": "เงินสดใจดี",
            "staff_count": 2,
            "booth_needs": "โต๊ะให้คำปรึกษา 1 ชุด",
            "shares_cost": True,
            "cost_share_thb": 20000,
            "contact_name": "เจ้าหน้าที่เงินสดใจดี",
            "contact_phone": "089-123-4567",
        },
    )
    assert joined.status_code == 200, joined.text
    participant_id = joined.json()["data"]["participants"][0]["id"]

    # Host approves co-join request
    approved = client.post(
        f"/v1/admin/events/participants/{participant_id}/decision",
        headers=editor_headers,
        json={"decision": "approved", "note": "ยินดีร่วมบูธครับ"},
    )
    assert approved.status_code == 200
    assert approved.json()["data"]["participants"][0]["join_state"] == "approved"

    # Moving zone without change_reason must fail with 422
    missing_reason = client.put(
        f"/v1/admin/events/{event_id}",
        headers=editor_headers,
        json={
            "expected_revision": 1,
            "title": ev["title"],
            "venue_name": ev["venue_name"],
            "venue_zone": "ชั้น G ลานลิฟต์แก้ว",
            "province": ev["province"],
            "starts_at": starts,
            "ends_at": ends,
            "host_scope_type": "bud",
            "host_scope_id": "BUD-API-TEST",
            "host_label": "BUD ทดสอบ",
            "open_for_join": True,
            "campaign_code": "SN2600888A",
            "state": "scheduled",
            "change_reason": "",
        },
    )
    assert missing_reason.status_code == 422

    # Moving zone WITH change_reason increments schedule_revision and creates alerts
    moved = client.put(
        f"/v1/admin/events/{event_id}",
        headers=editor_headers,
        json={
            "expected_revision": 1,
            "title": ev["title"],
            "venue_name": ev["venue_name"],
            "venue_zone": "ชั้น G ลานลิฟต์แก้ว",
            "province": ev["province"],
            "starts_at": starts,
            "ends_at": ends,
            "host_scope_type": "bud",
            "host_scope_id": "BUD-API-TEST",
            "host_label": "BUD ทดสอบ",
            "open_for_join": True,
            "campaign_code": "SN2600888A",
            "state": "scheduled",
            "change_reason": "ห้างแจ้งย้ายจุดตั้งบูธลงมาชั้น G เพื่อรับทราฟฟิกหน้าลิฟต์แก้ว",
        },
    )
    assert moved.status_code == 200, moved.text
    moved_data = moved.json()["data"]
    assert moved_data["schedule_revision"] == 2
    assert len(moved_data["revisions"]) == 1

    viewer_alerts = client.get("/v1/admin/events/alerts", headers=viewer_headers).json()["data"]["items"]
    my_alert = next(a for a in viewer_alerts if a["event_id"] == event_id and a["target_kind"] == "participant")
    acked = client.post(
        f"/v1/admin/events/alerts/{my_alert['ack_id']}/acknowledge",
        headers=viewer_headers,
        json={"note": "รับทราบจุดตั้งบูธใหม่เรียบร้อย"},
    )
    assert acked.status_code == 200

    online_alerts = client.get("/v1/admin/events/alerts", headers=online_headers).json()["data"]["items"]
    ads_alert = next(a for a in online_alerts if a["event_id"] == event_id and a["target_kind"] == "online_ads")
    acked_ads = client.post(
        f"/v1/admin/events/alerts/{ads_alert['ack_id']}/acknowledge",
        headers=online_headers,
        json={"note": "อัปเดตข้อความโฆษณาเป็นชั้น G แล้ว"},
    )
    assert acked_ads.status_code == 200

    # Cleanup test event using disposable operator connection
    async def cleanup():
        db = await disposable_operator()
        try:
            await db.execute("DELETE FROM hub.events WHERE id = $1", event_id)
        finally:
            await db.close()

    asyncio.run(cleanup())
