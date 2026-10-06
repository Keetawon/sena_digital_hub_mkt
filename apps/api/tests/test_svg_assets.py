import hashlib
from contextlib import asynccontextmanager
import xml.etree.ElementTree as ET

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from sena_hub_api import assets, main, svg
from sena_hub_api.main import create_app
from test_api import settings, TOKENS


MIME = "image/svg+xml"
ASSET_ID = "10000000-0000-0000-0000-000000000049"


def logo(children="", attributes='viewBox="0 0 512 512"'):
    return f'<svg xmlns="{svg.SVG}" {attributes}>{children}</svg>'.encode()


def test_static_shapes_gradients_text_and_clipping_survive_canonically():
    content = logo('''<defs><linearGradient id="gold"><stop offset="0%" stop-color="#fff"/>
        <stop offset="100%" stop-color="rgb(0, 50, 0)"/></linearGradient>
        <clipPath id="crop"><rect width="512" height="512"/></clipPath></defs>
        <g clip-path="url(#crop)"><path d="M0 0L512 0L512 512Z" fill="url(#gold)"/>
        <text x="10" y="20" font-family="sans-serif">โลโก้ <tspan>ทดสอบ</tspan></text></g>''')
    clean, width, height = svg.sanitize_svg(content)
    root = ET.fromstring(clean)
    assert (width, height) == (512, 512)
    assert root.find(f".//{{{svg.SVG}}}path").get("fill") == "url(#gold)"
    assert root.find(f".//{{{svg.SVG}}}g").get("clip-path") == "url(#crop)"
    assert "โลโก้" in clean.decode()
    assert svg.sanitize_svg(clean)[0] == clean


@pytest.mark.parametrize("active", [
    '<script>alert(1)</script>', '<g><script xmlns="http://www.w3.org/1999/xhtml">evil()</script></g>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">evil</div></foreignObject>',
    '<image href="https://evil.invalid/x"/>', '<image href="data:image/svg+xml,evil"/>',
    '<use href="#self" id="self"/>', '<a href="javascript:alert(1)"><path d="M0 0"/></a>',
    '<style>@import url(https://evil.invalid/x); path {fill:red}</style>',
    '<animate attributeName="href" values="javascript:alert(1)"/>',
    '<set attributeName="onload" to="evil()"/>', '<animateTransform attributeName="transform"/>',
    '<filter id="x"><feImage href="https://evil.invalid/x"/></filter>',
    '<g xmlns="https://evil.invalid/svg"><path d="M1 2"/></g>',
])
def test_active_unknown_and_external_subtrees_are_dropped(active):
    clean, _, _ = svg.sanitize_svg(logo(active + '<rect width="20" height="30"/>'))
    assert b"evil" not in clean and b"script" not in clean and b"foreignObject" not in clean
    assert len(ET.fromstring(clean).findall(f".//{{{svg.SVG}}}rect")) == 1
    assert all(svg.local_tag(node.tag) in svg.ELEMENTS for node in ET.fromstring(clean).iter())


@pytest.mark.parametrize("attributes", [
    'onload="alert(1)" onclick="evil()"', 'ONLOAD="evil()"', 'style="fill:url(https://evil.invalid/x)"',
    'href="javascript:evil()"', 'xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.invalid/x"',
    'xml:base="https://evil.invalid/"', 'fill="url(https://evil.invalid/x)"',
    'fill="url(data:image/svg+xml,evil)"', 'fill="u&#114;l(https://evil.invalid/x)"',
    r'fill="u\72l(https://evil.invalid/x)"', 'fill="url(#safe) red"',
    'stroke="var(--evil)"', 'filter="url(#filter)"', 'cursor="url(https://evil.invalid/x)"',
    'd="M1e999 0"', 'transform="scale(1e999)"',
])
def test_only_static_allowlisted_attributes_survive(attributes):
    clean, _, _ = svg.sanitize_svg(logo(f'<rect width="20" height="30" {attributes}/>'))
    rect = ET.fromstring(clean)[0]
    assert rect.attrib == {"height": "30", "width": "20"}


def test_local_references_reject_wrong_missing_duplicate_or_recursive_targets():
    content = logo('''<defs><clipPath id="clip"><g clip-path="url(#clip)"><path d="M0 0"/></g></clipPath>
        <linearGradient id="dup"/><linearGradient id="dup"/></defs>
        <path fill="url(#missing)" stroke="url(#dup)" clip-path="url(#dup)" d="M0 0"/>
        <path fill="url(#clip)" d="M1 1"/>''')
    clean, _, _ = svg.sanitize_svg(content)
    assert b"url(" not in clean
    assert b'id="dup"' not in clean


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16", "utf-16-le", "utf-16-be"])
@pytest.mark.parametrize("subset", [
    '<!ENTITY leak SYSTEM "file:///private-test">',
    '<!ENTITY leak SYSTEM "https://evil.invalid/">',
    '<!ENTITY a "1234567890"><!ENTITY leak "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">',
    '<!ENTITY % remote SYSTEM "https://evil.invalid/">%remote;',
])
def test_dtd_entities_rejected_before_expansion_in_every_encoding(encoding, subset):
    content = f'<!DOCTYPE svg [{subset}]><svg xmlns="{svg.SVG}" viewBox="0 0 1 1"><text>&leak;</text></svg>'
    with pytest.raises(ValueError, match="DTD"):
        svg.sanitize_svg(content.encode(encoding))


@pytest.mark.parametrize("content", [
    b"<svg/>", b"<not-svg/>", b"<svg", b"<svg>&unknown;</svg>",
    logo(attributes='viewBox="0 0 -5 512"'), logo(attributes='viewBox="0 0 0 512"'),
    logo(attributes='viewBox="0 0 100 100 100"'), logo(attributes='width="1e999" height="512"'),
    logo(attributes='width="-1" height="512"'), logo(attributes='width="10000" height="10000"'),
    logo(attributes='width="100%" height="100%"'),
    logo("<g>" * 33 + "</g>" * 33), logo("<rect/>" * 5001),
    logo('<path d="' + "M1 1 " * 14000 + '"/>'),
    logo("<text>" + "x" * 262145 + "</text>"),
    logo(attributes='viewBox="0 0 1 1" ' + " ".join(f'a{i}="x"' for i in range(49))),
    b" " * (svg.MAX_SVG_BYTES + 1),
], ids=["no-dimensions", "wrong-root", "malformed", "unknown-entity", "negative-viewbox", "zero-viewbox",
        "extra-viewbox-values", "infinite-size", "negative-size", "pixel-limit", "percentage-size",
        "depth-limit", "node-limit", "attribute-limit", "text-limit", "attribute-count", "byte-limit"])
def test_malformed_unknown_size_and_resource_exhaustion_fail_cleanly(content):
    with pytest.raises(HTTPException) as error:
        assets.prepare_upload(content, MIME, "synthetic.svg")
    assert error.value.status_code == 422


def test_processing_instructions_comments_and_foreign_namespace_attributes_are_removed():
    content = b'<?xml-stylesheet href="https://evil.invalid/x"?>' + logo(
        '<!-- unsafe metadata --><path xmlns:e="https://evil.invalid/" e:fill="red" d="M0 0"/>')
    clean, _, _ = svg.sanitize_svg(content)
    assert b"evil" not in clean and b"stylesheet" not in clean and b"metadata" not in clean


def test_prepare_hashes_sanitized_bytes_and_safe_dimensions_only(monkeypatch, tmp_path):
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path)
    raw = logo('<script>evil()</script><path d="M0 0"/>', 'viewBox="0 0 12.2 14.8"')
    clean, metadata = assets.prepare_upload(raw, MIME, "synthetic.svg")
    assert metadata["checksum"] == hashlib.sha256(clean).hexdigest() != hashlib.sha256(raw).hexdigest()
    assert (metadata["width"], metadata["height"]) == (13, 15)
    assert metadata["file_size"] == len(clean)
    assert assets.install_file(clean, metadata)
    assert assets.readable_file(metadata).read_bytes() == clean
    same, same_metadata = assets.prepare_upload(raw.replace(b"evil()", b"another()"), MIME, "other.svg")
    assert same == clean and same_metadata["checksum"] == metadata["checksum"]
    assert not assets.install_file(same, same_metadata)
    with pytest.raises(HTTPException):
        assets.validate_file(raw, MIME, "unsafe.svg")


@pytest.mark.parametrize("actor,path", [("editor", "/v1/admin/assets"), ("service_consumer", "/v1/assets")])
def test_svg_endpoint_stores_only_clean_bytes_and_serves_csp(monkeypatch, tmp_path, actor, path):
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path)
    saved = {}

    class Connection:
        async def execute(self, *_):
            pass

        async def fetchval(self, query, *args):
            if "register_uploaded_asset" in query:
                reused = bool(saved)
                saved.update(args[0], id=ASSET_ID, rights_status="pending")
                return {"asset": saved.copy(), "reused": reused}
            assert "asset_file" in query
            return saved

    @asynccontextmanager
    async def database(request, called_actor):
        yield Connection()

    monkeypatch.setattr(main, "database", database)
    client = TestClient(create_app(settings()), client=("127.0.0.1", 50000))
    headers = {"Authorization": f"Bearer {TOKENS['editor']}", "Content-Type": MIME, "X-Filename": "synthetic.svg"}
    raw = logo('<script>alert(1)</script><rect width="512" height="512" fill="#14532d" onload="evil()"/>')
    first = client.post("/v1/admin/assets", content=raw, headers=headers)
    assert first.status_code == 201 and first.json()["data"]["rights_status"] == "pending"
    duplicate = client.post("/v1/admin/assets", content=raw, headers=headers)
    assert duplicate.status_code == 200 and duplicate.json()["meta"]["reused"]
    response = client.get(f"{path}/{ASSET_ID}/file", headers={"Authorization": f"Bearer {TOKENS[actor]}"})
    assert response.status_code == 200
    assert response.headers["content-type"] == MIME
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "sandbox; default-src 'none'; frame-ancestors 'none'"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"
    assert b"script" not in response.content and b"onload" not in response.content
    originals = [item for item in tmp_path.iterdir() if item.is_file()]
    assert len(originals) == 1 and response.content == originals[0].read_bytes()
    assert len(list((tmp_path / 'thumbnails-v1').glob('*.webp'))) == 1


@pytest.mark.parametrize("role", ["viewer", "service_consumer"])
def test_svg_does_not_relax_upload_permission(role, monkeypatch, tmp_path):
    monkeypatch.setattr(assets, "STORAGE_ROOT", tmp_path / "never-created")
    client = TestClient(create_app(settings()), client=("127.0.0.1", 50000))
    response = client.post("/v1/admin/assets", content=logo(), headers={
        "Authorization": f"Bearer {TOKENS[role]}", "Content-Type": MIME, "X-Filename": "synthetic.svg"})
    assert response.status_code == 403 and not assets.STORAGE_ROOT.exists()
