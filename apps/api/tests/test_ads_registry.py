import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from starlette.requests import Request

from sena_hub_api.auth import Authentication, DEMO_ROLES, ROLES, Settings
from sena_hub_api import main
from sena_hub_api.main import create_app

TOKENS = {role: f"ads-test-only-{role}-" + "x" * 40 for role in DEMO_ROLES}
HEADERS = {role: {"Authorization": f"Bearer {token}"} for role, token in TOKENS.items()}
PATH = "/v1/admin/ads"
GROUP = "30000000-0000-0000-0000-000000000001"
CORP = "30000000-0000-0000-0000-000000000005"
BU = "30000000-0000-0000-0000-000000000007"
VALID = {"scope_kind": "A", "scope_id": GROUP, "objective": "LEADS", "agency": "KIN", "variant": "KW-BRAND"}


def settings(**overrides):
    return Settings(**{"database_url": "postgresql://test:test@127.0.0.1:55432/test", "auth_mode": "demo",
                       "environment": "local", "demo_tokens": TOKENS, **overrides})


@pytest.fixture
def client():
    return TestClient(create_app(settings()), client=("127.0.0.1", 50000))


@pytest.mark.parametrize("method,path", [
    ("GET", "/settings"), ("GET", "/vocab"), ("GET", "/scopes"), ("GET", "/registrations"),
    ("GET", "/registrations/SN2600001M"), ("POST", "/registrations/preview"),
    ("POST", "/registrations"), ("POST", "/registrations/SN2600001M/names"),
    ("POST", "/registrations/SN2600001M/bindings"), ("POST", "/names/validate"),
])
def test_all_registry_routes_require_authentication(client, method, path):
    response = client.request(method, PATH + path, headers={"X-Hub-Role": "admin"})
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["editor", "publisher", "viewer", "service_consumer"])
@pytest.mark.parametrize("method,path", [("GET", "/registrations"), ("GET", "/settings"), ("POST", "/registrations")])
def test_existing_residential_roles_do_not_gain_registry_access(client, role, method, path):
    response = client.request(method, PATH + path, json=VALID, headers={**HEADERS[role], "X-Hub-Role": "admin"})
    assert response.status_code == 403


@pytest.mark.parametrize("role", ["online_staff", "agency_kin", "agency_combay"])
def test_registry_roles_do_not_gain_residential_management_access(client, monkeypatch, role):
    assert client.get("/v1/admin/projects", headers=HEADERS[role]).status_code == 403
    calls = []
    class DB:
        async def fetch(self, query, *args):
            assert 'FROM public_api.read_projects()' in query
            calls.append(query)
            return []
    @asynccontextmanager
    async def database(request, actor):
        assert actor.role == role == 'online_staff'
        yield DB()
    monkeypatch.setattr(main, 'database', database)
    assert client.get("/v1/projects", headers=HEADERS[role]).status_code == (200 if role == 'online_staff' else 403)
    assert bool(calls) == (role == 'online_staff')


@pytest.mark.parametrize("role", ["agency_kin", "agency_combay"])
@pytest.mark.parametrize("path", ["/registrations", "/registrations/preview", "/registrations/SN2600001M/names"])
def test_agencies_cannot_issue_or_preview_names(client, role, path):
    assert client.post(PATH + path, json=VALID, headers=HEADERS[role]).status_code == 403


@pytest.mark.parametrize("changes", [
    {"name": "forged name"}, {"frozen_name": "forged name"}, {"utm_campaign": "forged"},
    {"code": "SN2600001M"}, {"created_by": str(uuid4())}, {"label": "FORGED"},
    {"content_label": "APPROVED"}, {"content_label_approved": True},
    {"objective": "SEM"}, {"agency": "kin"}, {"scope_id": None},
    {"scope_kind": "C", "scope_id": None, "parent_group_id": "C-DEMO-TEST1", "member_ids": ["00001"]},
    {"scope_kind": "C", "scope_id": None, "parent_group_id": "C-DEMO-TEST1", "member_ids": ["00001", "00001"]},
    {"scope_kind": "D", "scope_id": None, "member_ids": ["", "OTHER"]},
    {"scope_kind": "F", "scope_id": CORP, "content_label": "ชื่อไทย", "content_label_approved": True},
    {"scope_kind": "F", "scope_id": CORP, "content_label": "TEST DRIVE", "content_label_approved": "true"},
])
def test_registration_rejects_client_names_and_invalid_structured_selections_before_sql(client, changes):
    response = client.post(PATH + "/registrations", json={**VALID, **changes}, headers=HEADERS["online_staff"])
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert "input" not in response.text


@pytest.mark.parametrize("changes", [{"account_id": 123}, {"campaign_id": 123}, {"campaign_id": " "},
                                      {"campaign_id": "\u0000"}, {"platform": "GOOG"}, {"agency": "COMBAY"}])
def test_native_ids_are_text_and_binding_cannot_change_agency(client, changes):
    body = {"name_id": str(uuid4()), "platform": "GOOGLE", "account_id": "0001", "campaign_id": "0002", **changes}
    response = client.post(PATH + "/registrations/SN2600001M/bindings", json=body, headers=HEADERS["online_staff"])
    assert response.status_code == 422


@pytest.mark.parametrize("offset", [-1, 9223372036854775808])
def test_pagination_rejects_offsets_outside_database_range(client, offset):
    response = client.get(PATH + f"/registrations?offset={offset}", headers=HEADERS["online_staff"])
    assert response.status_code == 422


def test_observed_name_explanation_is_read_only(client):
    name = "TEST DRIVE__ENGAGEMENT__CORP-LIVNEX__INHOUSE__SN2600123Q"
    response = client.post(PATH + "/names/validate", json={"name": name}, headers=HEADERS["online_staff"])
    assert response.status_code == 200
    assert response.json()["data"]["valid"] is True
    bad = client.post(PATH + "/names/validate", json={"name": name[:-1] + "K"}, headers=HEADERS["online_staff"])
    assert bad.json()["data"]["valid"] is False


def test_original_demo_configuration_still_works_and_optional_accounts_are_distinct():
    settings(demo_tokens={role: TOKENS[role] for role in ROLES})
    with pytest.raises(ValueError):
        settings(demo_tokens={**{role: TOKENS[role] for role in ROLES}, "online_staff": TOKENS["online_staff"]})
    with pytest.raises(ValueError):
        settings(demo_tokens={**TOKENS, "agency_kin": TOKENS["admin"]})
    auth = Authentication(settings())
    for key, agency, number in [("agency_kin", "KIN", 7), ("agency_combay", "COMBAY", 8)]:
        request = Request({"type": "http", "path": "/v1/me", "method": "GET", "headers": [(b"authorization", HEADERS[key]["Authorization"].encode())],
                           "client": ("127.0.0.1", 1)})
        actor = asyncio.run(auth(request))
        assert actor.role == "agency" and actor.agency_code == agency and actor.id.int == number


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.mark.parametrize("metadata,accepted", [
    ({"hub_role": "agency", "hub_agency": "KIN"}, True),
    ({"hub_role": "agency", "hub_agency": "COMBAY"}, True),
    ({"hub_role": "online_staff"}, True),
    ({"hub_role": "agency"}, False),
    ({"hub_role": "agency", "hub_agency": "kin"}, False),
    ({"hub_role": "agency", "hub_agency": "KIN; SET ROLE admin"}, False),
])
def test_identity_verification_ignores_all_role_and_agency_metadata(signing_key, metadata, accepted):
    auth = Authentication(settings(auth_mode="supabase", environment="production", supabase_url="https://example.supabase.co"))
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    public.update(kid="test-key", alg="RS256", use="sig")
    auth.jwks.fetch_data = lambda: {"keys": [public]}
    claims = {"iss": "https://example.supabase.co/auth/v1", "aud": "authenticated", "iat": int(time.time()) - 1,
              "exp": int(time.time()) + 60, "sub": str(uuid4()), "email": "test@example.test", "app_metadata": metadata,
              "user_metadata": {"hub_role": "admin", "hub_agency": "COMBAY"}, "role": "admin"}
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test-key"})
    identity = auth.verify_jwt(token)
    assert identity["sub"] == claims["sub"]
    assert not hasattr(identity, "agency_code")



@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("HUB_TEST_DATABASE_URL"), reason="Requires seeded local registry and runtime login")
def test_registry_issue_variants_exact_ids_scope_cascade_and_agency_isolation():
    config = settings(database_url=os.environ["HUB_TEST_DATABASE_URL"])
    with TestClient(create_app(config), client=("127.0.0.1", 50000)) as client:
        def call(method, path, role="online_staff", expected=200, **kwargs):
            response = client.request(method, PATH + path, headers=HEADERS[role], **kwargs)
            assert response.status_code == expected, response.text
            return response.json().get("data")

        status = call("GET", "/settings")
        assert status["sena_h_approved"] is False and status["test_mode"] and status["can_issue"]
        scopes = call("GET", "/scopes?kind=A")
        assert any(row["scope_id"] == GROUP and row["member_ids"] == ["C-DEMO-TEST1"] for row in scopes)
        phases = call("GET", "/scopes?kind=B&parent_group_id=C-DEMO-TEST1")
        assert {row["member_ids"][0] for row in phases} >= {"00001", "00002"}
        preview = call("POST", "/registrations/preview", json=VALID)
        assert "รหัสจะออกเมื่อบันทึก" in preview["preview_name"] and "SN26" not in preview["preview_name"]
        kin = call("POST", "/registrations", json=VALID, expected=201)
        combay = call("POST", "/registrations", json={**VALID, "agency": "COMBAY"}, expected=201)
        code = kin["registration"]["code"]
        other = combay["registration"]["code"]
        assert code != other
        assert kin["names"][0]["utm_campaign"] == kin["names"][0]["frozen_name"]
        assert kin["names"][0]["utm_google"].endswith("utm_id={campaignid}")
        for role, own, foreign in [("agency_kin", code, other), ("agency_combay", other, code)]:
            assert call("GET", f"/registrations/{own}", role)["registration"]["code"] == own
            call("GET", f"/registrations/{foreign}", role, expected=404)
            call("GET", "/registrations/DOESNOTEXIST", role, expected=404)
            assert call("GET", f"/registrations?q={foreign}", role) == []
            listings = call("GET", "/registrations?limit=100", role)
            assert all(row["registration"]["agency"] == ("KIN" if role == "agency_kin" else "COMBAY") for row in listings)
        variants = call("POST", f"/registrations/{code}/names", json={"variant": "KW-COMPETITOR"})
        assert variants["registration"]["code"] == code and len(variants["names"]) == 2
        replay = call("POST", f"/registrations/{code}/names", json={"variant": "KW-COMPETITOR"})
        assert {row["name_id"] for row in replay["names"]} == {row["name_id"] for row in variants["names"]}
        account = "000" + uuid4().hex
        binding = {"name_id": kin["names"][0]["name_id"], "platform": "GOOGLE", "account_id": account, "campaign_id": "0000123"}
        bound = call("POST", f"/registrations/{code}/bindings", "agency_kin", 201, json=binding)
        assert bound["account_id"] == account and bound["campaign_id"] == "0000123"
        assert call("POST", f"/registrations/{code}/bindings", "agency_kin", 201, json=binding) == bound
        conflict = {**binding, "name_id": combay["names"][0]["name_id"]}
        call("POST", f"/registrations/{other}/bindings", "agency_combay", 409, json=conflict)
        call("POST", f"/registrations/{code}/bindings", "agency_kin", 404, json=conflict)
        corporate = {"scope_kind": "F", "scope_id": CORP, "objective": "ENGAGEMENT", "agency": "INHOUSE",
                     "content_label": "TEST DRIVE", "content_label_approved": True}
        created = call("POST", "/registrations", json=corporate, expected=201)
        assert created["registration"]["label"] == "TEST DRIVE"
        call("POST", "/registrations", json={**corporate, "scope_id": BU}, expected=422)
        multi = {"scope_kind": "C", "parent_group_id": "C-DEMO-TEST1", "member_ids": ["00002", "00001"],
                 "objective": "LEADS", "agency": "KIN"}
        multi_preview = call("POST", "/registrations/preview", json=multi)
        assert multi_preview["scope"]["scope_code"] == "C-DEMO-TEST1"
        selection = call("POST", "/registrations", json=multi, expected=201)
        assert [row["member_id"] for row in selection["members"]] == ["00001", "00002"]
        zone = {"scope_kind": "D", "member_ids": ["C-DEMO-TEST2", "C-DEMO-TEST1"], "objective": "TRAFFIC", "agency": "KIN"}
        zone_preview = call("POST", "/registrations/preview", json=zone)
        assert zone_preview["scope"]["scope_code"].startswith("ZONE-")
        reverse = call("POST", "/registrations/preview", json={**zone, "member_ids": list(reversed(zone["member_ids"]))})
        assert reverse["scope"]["scope_code"] == zone_preview["scope"]["scope_code"]
