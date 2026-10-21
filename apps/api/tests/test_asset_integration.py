"""Generated local fixtures only; no demo project edits or publication changes."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path
from urllib.parse import quote, urlparse
from uuid import UUID, uuid4

import asyncpg
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from pypdf import PdfWriter
import pytest

from sena_hub_api import assets
from sena_hub_api.auth import ROLES, Settings
from sena_hub_api.main import create_app


@pytest.mark.integration
def test_local_upload_dedup_rights_private_files_and_cleanup():
    database_url = os.getenv("HUB_TEST_DATABASE_URL", "")
    parsed = urlparse(database_url)
    config_path = Path(__file__).resolve().parents[3] / ".local" / "development.json"
    if (parsed.scheme != "postgresql" or parsed.hostname != "127.0.0.1" or parsed.port != 55432
            or parsed.path != "/sena_hub_local" or parsed.username != "hub_runtime" or not config_path.is_file()):
        pytest.skip("Requires this workspace's generated local PostgreSQL and owner cleanup config")
    local = json.loads(config_path.read_text(encoding="utf-8"))
    if parsed.password != local.get("runtimePassword"):
        pytest.skip("Runtime DSN does not match this workspace's local fixture database")

    tokens = {role: f"asset-integration-{role}-" + "x" * 40 for role in ROLES}
    config = Settings(database_url, "demo", "local", tokens)
    headers = {role: {"Authorization": f"Bearer {token}"} for role, token in tokens.items()}
    marker = str(uuid4())
    png = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("local-test-fixture", marker)
    Image.new("RGB", (4, 3), "green").save(png, format="PNG", pnginfo=metadata)
    pdf = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_metadata({"/Title": f"local-test-{marker}"})
    writer.write(pdf)
    contents = [(png.getvalue(), "image/png", f"ภาพทดสอบ-{marker}.png"),
                (pdf.getvalue(), "application/pdf", f"เอกสารทดสอบ-{marker}.pdf")]
    checksums = [hashlib.sha256(content).hexdigest() for content, _, _ in contents]

    async def cleanup():
        # Owner access is solely for removing this run's random checksum fixtures.
        connection = await asyncpg.connect(host="127.0.0.1", port=55432, database="sena_hub_local",
                                           user="postgres", password=local["adminPassword"])
        try:
            async with connection.transaction():
                await connection.execute("SELECT set_config('app.actor_id', $1, true)", str(UUID(int=2)))
                for checksum in checksums:
                    await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", checksum)
                    await connection.execute("DELETE FROM hub.entity_assets WHERE asset_id IN (SELECT id FROM hub.assets WHERE checksum=$1)", checksum)
                    # A concurrent user's reference is a reason to retain, never delete.
                    removed = await connection.fetchval("""DELETE FROM hub.assets a WHERE checksum=$1
                        AND NOT EXISTS (SELECT 1 FROM hub.entity_assets b WHERE b.asset_id=a.id)
                        AND NOT EXISTS (SELECT 1 FROM hub.brand_assets b WHERE b.asset_id=a.id)
                        RETURNING storage_path""", checksum)
                    if removed:
                        assets.storage_path(removed).unlink(missing_ok=True)
        finally:
            await connection.close()

    try:
        with TestClient(create_app(config), client=("127.0.0.1", 50000)) as client:
            def upload(item):
                content, mime, filename = item
                return client.post("/v1/admin/assets", content=content,
                                   headers={**headers["editor"], "Content-Type": mime, "X-Filename": quote(filename)})

            # Independent requests must share one file and registry identity under contention.
            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(executor.map(upload, [contents[0], contents[0]]))
            assert sorted(response.status_code for response in responses) == [200, 201], [response.text for response in responses]
            image_asset = next(response.json()["data"] for response in responses if response.status_code == 201)
            assert {response.json()["data"]["id"] for response in responses} == {image_asset["id"]}
            uploaded_pdf = upload(contents[1])
            assert uploaded_pdf.status_code == 201, uploaded_pdf.text
            pdf_asset = uploaded_pdf.json()["data"]

            for asset, item in zip([image_asset, pdf_asset], contents):
                assert asset["rights_status"] == "pending" and asset["reviewed_by"] is None
                assert asset["owner_id"] == str(UUID(int=1))
                assert asset["file_size"] == len(item[0])
                asset_path = f"/v1/admin/assets/{asset['id']}"
                # Only the uploader sees a new unbound file. Bind it before
                # another staff member previews or reviews its rights.
                assert client.get(f"{asset_path}/file", headers=headers["viewer"]).status_code == 404
                assert client.get(f"{asset_path}/file", headers=headers["editor"]).status_code == 200
                project = next(p for p in client.get('/v1/admin/projects', headers=headers['editor']).json()['data']
                               if p['rem_project_id'] == 'DEMO-001')
                bound = client.post(f"/v1/admin/projects/{project['public_project_id']}/assets", headers=headers['editor'], json={
                    'asset_id': asset['id'], 'asset_role': 'floor_plan', 'alt_text': {'th': 'Synthetic fixture'}, 'updated_at': project['updated_at']})
                assert bound.status_code == 200, bound.text
                asset = client.get(asset_path, headers=headers['editor']).json()['data']
                preview = client.get(f"{asset_path}/file", headers=headers["viewer"])
                assert preview.status_code == 200, preview.text
                assert preview.content == item[0]
                assert preview.headers["content-type"].startswith(item[1])
                assert preview.headers["content-disposition"].startswith("attachment" if item[1] == "application/pdf" else "inline")
                assert preview.headers["cache-control"] == "no-store"
                assert preview.headers["x-content-type-options"] == "nosniff"
                assert "sandbox" in preview.headers["content-security-policy"]
                assert client.get(f"/v1/assets/ast_{asset['checksum']}/file", headers=headers["service_consumer"]).status_code == 404
                review_body = {"updated_at": asset["updated_at"], "decision": "approved", "rights_notes": "ไฟล์สร้างขึ้นสำหรับทดสอบเท่านั้น",
                               "effective_from": None, "effective_to": None, "change_reason": "ทดสอบอนุมัติสิทธิ์"}
                assert client.post(f"{asset_path}/review", json=review_body, headers=headers["editor"]).status_code == 403
                reviewed = client.post(f"{asset_path}/review", json=review_body, headers=headers["publisher"])
                assert reviewed.status_code == 200, reviewed.text
                assert reviewed.json()["data"]["rights_status"] == "approved"
                assert reviewed.json()["data"]["reviewed_by"] == str(UUID(int=2))
                stale = client.post(f"{asset_path}/review", json=review_body, headers=headers["publisher"])
                assert stale.status_code == 409, stale.text
                duplicate = upload(item)
                assert duplicate.status_code == 200 and duplicate.json()["meta"]["reused"]
                assert duplicate.json()["data"] == reviewed.json()["data"]
                assert client.get(f"/v1/assets/ast_{asset['checksum']}/file", headers=headers["service_consumer"]).status_code == 404
                revoked = client.post(f"{asset_path}/review", headers=headers["publisher"], json={
                    **review_body, "updated_at": reviewed.json()["data"]["updated_at"], "decision": "revoked", "change_reason": "สิ้นสุดการทดสอบ",
                })
                assert revoked.status_code == 200, revoked.text
                assert upload(item).json()["data"]["rights_status"] == "revoked"
                assert client.get(f"{asset_path}/file", headers=headers["viewer"]).status_code == 200

            listing = client.get("/v1/admin/assets", headers=headers["viewer"])
            assert listing.status_code == 200
            assert {image_asset["id"], pdf_asset["id"]} <= {item["id"] for item in listing.json()["data"]}
    finally:
        asyncio.run(cleanup())
