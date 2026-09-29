import pytest
from fastapi.testclient import TestClient
from sena_hub_api.main import create_app
from test_api import settings, TOKENS


@pytest.mark.parametrize("role,status", [(None,401),("viewer",403),("service_consumer",403)])
def test_facility_write_access_rejected_before_database(role,status):
    client=TestClient(create_app(settings()),client=("127.0.0.1",50000))
    headers={"Authorization":f"Bearer {TOKENS[role]}"} if role else {}
    response=client.put('/v1/admin/projects/test/facilities/pool',json={},headers=headers)
    assert response.status_code==status


@pytest.mark.parametrize("body", [
    {"status":"yes"}, {"status":"present","reviewed":True},
    {"status":"present","expected_open_date":"2027-01-01"},
    {"status":"planned","expected_open_date":"2026-02-30"},
    {"status":"present","description":{"th":True}},
    {"status":"present","location_note":None},
    {"status":"present","description":{"th":"x"*4001}},
])
def test_invalid_facility_content_rejected_before_database(body):
    client=TestClient(create_app(settings()),client=("127.0.0.1",50000))
    response=client.put('/v1/admin/projects/test/facilities/pool',
      json={"updated_at":"2026-09-20T10:00:00Z",**body},
      headers={"Authorization":f"Bearer {TOKENS['editor']}"})
    assert response.status_code==422
