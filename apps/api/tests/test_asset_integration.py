"""Real committed asset lifecycle on the guarded disposable DB and file store."""
import asyncio
import hashlib
import io
import json
from urllib.parse import quote
from uuid import uuid4

from PIL import Image, PngImagePlugin
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject
import pytest

from sena_hub_api import assets
from test_permission_baseline import disposable_operator
from test_permission_content import call
from test_permission_foundations import permission_accounts, h
from test_website_content import project_fixture


@pytest.mark.integration
def test_disposable_upload_dedup_rights_and_private_file_lifecycle(permission_accounts, monkeypatch, tmp_path):
    client, ids = permission_accounts
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path / "assets")

    async def make_project():
        operator = await disposable_operator()
        try:
            return await project_fixture(operator, ids["editor"])
        finally:
            await operator.close()

    project = asyncio.run(make_project())
    other_project = asyncio.run(make_project())
    project_path = f"/v1/admin/projects/{project['public_project_id']}"
    marker = uuid4()
    # Uniqueness must survive metadata stripping. These are synthetic pixels and
    # visible page marks, not a UUID hidden only in removable PNG/PDF metadata.
    pixels = (marker.bytes * 3)[:36]
    png = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text("local-test-fixture", str(marker))
    Image.frombytes("RGB", (4, 3), pixels).save(png, format="PNG", pnginfo=info)
    pdf = io.BytesIO()
    writer = PdfWriter()
    page = writer.add_blank_page(width=100, height=100)
    marks = DecodedStreamObject()
    marks.set_data("\n".join(
        f"{value / 255:.6f} g {(index % 4) * 20} {(index // 4) * 20} 20 20 re f"
        for index, value in enumerate(marker.bytes)
    ).encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(marks)
    writer.add_metadata({"/Title": "Synthetic asset lifecycle title"})
    writer.write(pdf)
    contents = [
        (png.getvalue(), "image/png", f"ภาพทดสอบ-{marker}.png", "floor_plan", 4, 3),
        (pdf.getvalue(), "application/pdf", f"เอกสารทดสอบ-{marker}.pdf", "brochure", None, None),
    ]
    asset_ids = set()

    for content, mime, filename, purpose, width, height in contents:
        context = {"v": 1, "kind": "project", "ref": project["public_project_id"],
                   "category": purpose, "purpose": purpose}
        upload_headers = {**h("editor"), "Content-Type": mime, "X-Filename": quote(filename),
                          "X-Upload-Context": json.dumps(context, separators=(",", ":"), ensure_ascii=True)}

        def upload():
            return client.post("/v1/admin/assets", content=content, headers=upload_headers)

        # Admission has separate deterministic tests; actual SQL contention has
        # concurrent_upload_optimization.mjs. This lifecycle requires real commits.
        uploaded = upload()
        assert uploaded.status_code == 201, uploaded.text
        assert uploaded.headers["cache-control"] == "no-store"
        asset = uploaded.json()["data"]
        upload_evidence = uploaded.json()["meta"]["upload"]
        assert asset["rights_status"] == "pending" and asset["reviewed_by"] is None
        assert asset["owner_id"] == str(ids["editor"])
        assert asset["original_filename"] == filename
        original = {"size": len(content), "mime_type": mime, "width": width, "height": height}
        assert upload_evidence["original"] == original
        assert upload_evidence["stored"] == {"size": asset["file_size"], "mime_type": asset["mime_type"],
                                              "width": asset["width"], "height": asset["height"]}
        assert upload_evidence["suggestions"]["confirmed"] is False
        assert "checksum" not in upload_evidence["original"]
        asset_ids.add(asset["id"])
        asset_path = f"/v1/admin/assets/{asset['id']}"
        assert client.get(f"{asset_path}/file", headers=h("viewer")).status_code == 404
        denied = client.get(asset_path, headers={**h("viewer"), "X-Upload-Context": upload_headers["X-Upload-Context"]})
        assert denied.status_code == 404 and "meta" not in denied.json()
        assert upload_evidence["source_id"] not in denied.text and "Synthetic asset lifecycle title" not in denied.text
        owner_preview = client.get(f"{asset_path}/file", headers=h("editor"))
        assert owner_preview.status_code == 200, owner_preview.text
        stored = owner_preview.content
        assert len(stored) == asset["file_size"]
        assert hashlib.sha256(stored).hexdigest() == asset["checksum"]
        assert stored != content, "Marketing fixture metadata must be stripped"
        assert assets.readable_file(asset).read_bytes() == stored
        if mime == "image/png":
            with Image.open(io.BytesIO(stored)) as image:
                assert image.size == (4, 3) and image.tobytes() == pixels
                assert "local-test-fixture" not in image.info
        else:
            document = PdfReader(io.BytesIO(stored))
            assert len(document.pages) == 1
            assert "/Title" not in (document.metadata or {})

        async def source_mapping():
            async with client.app.state.pool.acquire() as connection:
                return await call(connection, ids["editor"], "select hub.find_uploaded_asset_source($1,$2,$3)",
                                  hashlib.sha256(content).hexdigest(), mime, context)

        mapping = client.portal.call(source_mapping)
        assert mapping["asset"] == asset
        assert mapping["original"] == {**original, "checksum": hashlib.sha256(content).hexdigest()}
        assert mapping["source_id"] == upload_evidence["source_id"]
        duplicate = upload()
        assert duplicate.status_code == 200, duplicate.text
        assert duplicate.json()["meta"]["reused"] is True
        assert duplicate.json()["data"] == asset
        assert duplicate.json()["meta"]["upload"]["source_id"] == upload_evidence["source_id"]
        assert duplicate.json()["meta"]["upload"]["evidence_id"] != upload_evidence["evidence_id"]

        # Bind only this run's new project, then verify ordinary View and rights
        # authority. No DEMO project, published snapshot or account grant changes.
        current = client.get(project_path, headers=h("editor")).json()["data"]
        bound = client.post(f"{project_path}/assets", headers=h("editor"), json={
            "asset_id": asset["id"], "asset_role": purpose, "alt_text": {"th": "Synthetic fixture"},
            "updated_at": current["updated_at"],
        })
        assert bound.status_code == 200, bound.text
        detail = client.get(asset_path, headers=h("editor"))
        assert detail.status_code == 200 and "meta" not in detail.json()
        assert "Synthetic asset lifecycle title" not in detail.text
        asset = detail.json()["data"]
        evidence_get = client.get(asset_path, headers={**h("editor"), "X-Upload-Context": upload_headers["X-Upload-Context"]})
        assert evidence_get.status_code == 200, evidence_get.text
        evidence = evidence_get.json()["meta"]["upload"]
        assert evidence_get.json()["data"] == asset
        assert set(evidence) == {"source_id", "evidence_id", "original", "stored", "pipeline_version",
                                 "extraction_version", "processing", "suggestions"}
        assert evidence["source_id"] == upload_evidence["source_id"]
        assert evidence["evidence_id"] == duplicate.json()["meta"]["upload"]["evidence_id"]
        assert evidence["original"] == original and evidence["stored"] == upload_evidence["stored"]
        assert set(evidence["suggestions"]) == {"source", "confirmed", "values"}
        assert evidence["suggestions"]["source"] == "file_metadata" and evidence["suggestions"]["confirmed"] is False
        if mime == "application/pdf":
            assert evidence["suggestions"]["values"]["caption"] == "Synthetic asset lifecycle title"
        changed_context = {**context, "purpose": "media"}
        persisted = client.get(asset_path, headers={**h("editor"), "X-Upload-Context": json.dumps(changed_context)})
        assert persisted.status_code == 200 and persisted.json()["meta"]["upload"] == evidence
        other_context = {**context, "ref": other_project["public_project_id"]}
        isolated = client.get(asset_path, headers={**h("editor"), "X-Upload-Context": json.dumps(other_context)})
        assert isolated.status_code == 200 and isolated.json() == {"data": asset, "meta": {"upload": None}}
        assert evidence["source_id"] not in isolated.text and "Synthetic asset lifecycle title" not in isolated.text
        preview = client.get(f"{asset_path}/file", headers=h("viewer"))
        assert preview.status_code == 200, preview.text
        assert preview.content == stored
        assert preview.headers["content-type"].startswith(mime)
        assert preview.headers["content-disposition"].startswith("attachment" if mime == "application/pdf" else "inline")
        assert preview.headers["cache-control"] == "no-store"
        assert preview.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in preview.headers["content-security-policy"]
        public_path = f"/v1/assets/ast_{asset['checksum']}/file"
        assert client.get(public_path, headers=h("service_consumer")).status_code == 404
        review_body = {"updated_at": asset["updated_at"], "decision": "approved", "rights_notes": "Synthetic fixture rights",
                       "effective_from": None, "effective_to": None, "change_reason": "Synthetic rights approval"}
        assert client.post(f"{asset_path}/review", json=review_body, headers=h("editor")).status_code == 403
        reviewed = client.post(f"{asset_path}/review", json=review_body, headers=h("publisher"))
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["data"]["rights_status"] == "approved"
        assert reviewed.json()["data"]["reviewed_by"] == str(ids["publisher"])
        stale = client.post(f"{asset_path}/review", json=review_body, headers=h("publisher"))
        assert stale.status_code == 409, stale.text
        duplicate = upload()
        assert duplicate.status_code == 200 and duplicate.json()["meta"]["reused"] is True
        assert duplicate.json()["data"] == reviewed.json()["data"]
        assert client.get(public_path, headers=h("service_consumer")).status_code == 404
        revoked = client.post(f"{asset_path}/review", headers=h("publisher"), json={
            **review_body, "updated_at": reviewed.json()["data"]["updated_at"],
            "decision": "revoked", "change_reason": "Synthetic rights revocation",
        })
        assert revoked.status_code == 200, revoked.text
        duplicate = upload()
        assert duplicate.status_code == 200 and duplicate.json()["data"] == revoked.json()["data"]
        assert client.get(f"{asset_path}/file", headers=h("viewer")).status_code == 200
        assert client.portal.call(source_mapping)["original"]["checksum"] == hashlib.sha256(content).hexdigest()

    listing = client.get("/v1/admin/assets", headers=h("viewer"))
    assert listing.status_code == 200
    assert asset_ids <= {item["id"] for item in listing.json()["data"]}
    # The verified disposable runner removes this run's DB and tmp_path store.
    # Never delete immutable provenance or deregister assets by original hashes.
