import copy
import hashlib
import io
import os
from decimal import Decimal
from uuid import uuid4

import pytest
from pypdf import PdfReader

from sena_hub_api import document_storage as storage
from sena_hub_api import document_worker as worker


@pytest.fixture(scope='module')
def fixtures():
    return storage.fixture_catalog()


def test_fixture_bytes_are_deterministic_and_independent_of_extraction(fixtures):
    again = storage.fixture_catalog()
    assert [item['content'] for item in again] == [item['content'] for item in fixtures]
    assert len({item['metadata']['sha256'] for item in fixtures}) == 3
    for item in fixtures:
        assert hashlib.sha256(item['content']).hexdigest() == item['metadata']['sha256']
        assert len(PdfReader(io.BytesIO(item['content'])).pages) == item['metadata']['page_count']
    statement = PdfReader(io.BytesIO(fixtures[-1]['content']))
    assert len(statement.pages) == 5
    assert all(not page.extract_text().strip() and len(page.images) == 1 for page in statement.pages)
    assert sum(Decimal(row['amount']) for row in fixtures[-1]['truth']['rows']) == Decimal('4812.00')


def test_private_storage_is_idempotent_and_rejects_paths_and_corruption(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'STORAGE_ROOT', tmp_path / 'private')
    first = storage.install_fixtures()
    assert storage.install_fixtures() == first
    metadata = first[0][0]
    assert storage.read_document(metadata['storage_key'], metadata['sha256']).startswith(b'%PDF-')
    for path in ('../memo.pdf', '/memo.pdf', 'memo/sha256/' + 'a' * 64 + '.pdf.exe', 'https://example.com/a.pdf'):
        with pytest.raises(storage.DocumentStorageError):
            storage.read_document(path, 'a' * 64)
    with pytest.raises(storage.DocumentStorageError):
        storage.read_document(metadata['storage_key'], 'a' * 64)
    (storage.STORAGE_ROOT / metadata['storage_key']).write_bytes(b'corrupt')
    with pytest.raises(storage.DocumentStorageError):
        storage.install_fixtures()


def test_text_layer_memo_uses_observed_fields_and_page_provenance(fixtures, monkeypatch):
    monkeypatch.setattr(worker, 'local_ocr', lambda *_a, **_k: pytest.fail('Text memo must not call OCR'))
    for item in fixtures[:2]:
        result = worker.extract_document(item['content'], 'E_MEMO', job_id=str(uuid4()))
        assert result['fields'] == item['truth']['fields']
        assert result['rows'] == [] and result['controls'] == {}
        assert all(source['page'] == 1 and source['method'] == 'TEXT' and source['confidence'] is None for source in result['field_sources'].values())
        assert 'MO2610901' in result['field_sources']['memo_no']['observed_text']


def test_bad_or_duplicate_observations_remain_unknown():
    pages = [{'page': 1, 'method': 'TEXT', 'confidence': None, 'text': 'GROSS_AMOUNT: 100.00\nGROSS_AMOUNT: 200.00\nAPPROVAL_DATE: 2026-02-31'}]
    result = worker.extract_fields(pages, 'E_MEMO')
    assert result['fields']['gross_amount'] is None
    assert result['fields']['approval_date'] is None
    assert result['fields']['subject'] is None
    assert worker._money('100.001') is None
    assert worker._money('1,000.00') is None
    assert worker._money('1O0.00') is None


def test_statement_keeps_duplicates_signed_money_unknowns_and_conflicting_controls():
    text = 'ISSUER: SYNTHETIC\nSTATEMENT TOTAL: 598.00\nMEANING: NET CHARGES\n'
    text += 'ROW: 1\nDATE: 2026-10-03\nDETAIL: LINEPAY LP LINEOFFICIA\nAMOUNT: 299.00\n'
    text += 'ROW: 2\nDATE: 2026-10-03\nDETAIL: LINEPAY LP LINEOFFICIA\nAMOUNT: 299.00\n'
    pages = [{'page': 1, 'method': 'OCR', 'confidence': None, 'text': text}]
    result = worker.extract_fields(pages, 'CARD_STATEMENT')
    assert len(result['rows']) == 2
    assert result['rows'][0]['descriptor'] == result['rows'][1]['descriptor']
    assert [row['occurrence'] for row in result['rows']] == [1, 2]
    assert result['controls']['meaning'] == 'NET_CHARGES'
    bad = copy.deepcopy(pages)
    bad.append({'page': 2, 'method': 'OCR', 'confidence': None, 'text': 'STATEMENT TOTAL: 599.00\nROW: 1\nDATE: 2026-10-03\nDETAIL: UNKNOWN\nAMOUNT: -1.00'})
    result = worker.extract_fields(bad, 'CARD_STATEMENT')
    assert result['controls']['statement_total'] is None
    assert result['rows'][-1]['amount'] == '-1.00'
    assert result['rows'][-1]['cost_type'] is None
    assert worker.extract_fields([], 'CARD_STATEMENT')['rows'] == []


def test_unsafe_pdf_and_unsupported_ocr_do_not_fabricate_rows(fixtures, monkeypatch):
    with pytest.raises(Exception):
        list(worker.extract_pages(b'not a PDF', job_id=str(uuid4())))
    def unavailable(*_args, **_kwargs):
        raise storage.DocumentStorageError('LOCAL_OCR_UNAVAILABLE')
    monkeypatch.setattr(worker, 'local_ocr', unavailable)
    with pytest.raises(storage.DocumentStorageError, match='LOCAL_OCR_UNAVAILABLE'):
        worker.extract_document(fixtures[-1]['content'], 'CARD_STATEMENT', job_id=str(uuid4()))


def test_statement_preview_is_exact_source_pixels_and_rejects_other_layouts(fixtures):
    from PIL import Image, ImageChops
    from pypdf import PdfWriter
    source = fixtures[-1]['content']
    reader = PdfReader(io.BytesIO(source))
    for page in (1, 3, 5):
        preview = Image.open(io.BytesIO(storage.render_statement_page(source, page)))
        original = reader.pages[page - 1].images[0].image.convert('RGB')
        assert preview.format == 'PNG' and preview.size == original.size
        assert ImageChops.difference(preview, original).getbbox() is None
    for page in (0, 6, True, '1'):
        with pytest.raises(storage.DocumentStorageError):
            storage.render_statement_page(source, page)
    with pytest.raises(storage.DocumentStorageError):
        storage.render_statement_page(fixtures[0]['content'], 1)
    # A raster with another drawing/transform must not masquerade as the full page.
    writer = PdfWriter(); writer.add_page(reader.pages[0]); writer.pages[0].rotate(90)
    changed = io.BytesIO(); writer.write(changed)
    with pytest.raises(storage.DocumentStorageError):
        storage.render_statement_page(changed.getvalue(), 1)


@pytest.mark.skipif(os.getenv('HUB_DOCUMENT_OCR_TEST') != '1', reason='Opt-in real local Windows OCR, no external processing')
def test_real_local_image_ocr_preserves_all_occurrences_and_exact_money(fixtures):
    result = worker.extract_document(fixtures[-1]['content'], 'CARD_STATEMENT', job_id=str(uuid4()))
    truth = fixtures[-1]['truth']
    assert len(result['rows']) == 10
    assert result['controls'] == truth['controls']
    assert [row['amount'] for row in result['rows']] == [row['amount'] for row in truth['rows']]
    assert [row['charge_date'] for row in result['rows']] == [row['charge_date'] for row in truth['rows']]
    assert all(page['method'] == 'OCR' and page['confidence'] is None and page['line_boxes'] for page in result['pages'])
    # Source IDs/descriptors are verbatim OCR, not silently repaired against truth.
    assert result['rows'][1]['descriptor'] in result['pages'][0]['text']
    assert len([row for row in result['rows'] if row['cost_type'] == 'CHANNEL']) == 3
