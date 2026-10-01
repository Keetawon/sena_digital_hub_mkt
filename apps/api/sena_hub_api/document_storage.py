"""Private synthetic-only document fixtures and byte storage, with no network I/O."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
import time

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DictionaryObject, NameObject, DecodedStreamObject

from .assets import validate_pdf

ROOT = Path(__file__).resolve().parents[3]
STORAGE_ROOT = ROOT / '.local/document-archive'
PIPELINE = 'hub-document-local-v1'
MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 20
KEY = re.compile(r'(memo|statement)/sha256/([0-9a-f]{64})\.pdf\Z')


class DocumentStorageError(ValueError):
    """Safe failure code only; never include a path or source content."""


def _path(key: str) -> Path:
    if not isinstance(key, str) or not KEY.fullmatch(key):
        raise DocumentStorageError('DOCUMENT_KEY_INVALID')
    base = STORAGE_ROOT.absolute()
    path = base / key
    if base.resolve() != base or path.resolve() != path or any(parent.is_symlink() for parent in [path, *path.parents] if parent != parent.parent):
        raise DocumentStorageError('DOCUMENT_PATH_INVALID')
    return path


def read_document(storage_key: str, expected_sha256: str) -> bytes:
    path = _path(storage_key)
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise DocumentStorageError('DOCUMENT_UNAVAILABLE')
    content = path.read_bytes()
    match = KEY.fullmatch(storage_key)
    if match[2] != expected_sha256 or hashlib.sha256(content).hexdigest() != expected_sha256:
        raise DocumentStorageError('DOCUMENT_HASH_MISMATCH')
    return content


def render_statement_page(content: bytes, page: int) -> bytes:
    """Return exact source pixels only for the known full-page raster layout.

    This is not OCR or a reconstruction from extracted fields. Unsupported PDF
    composition fails closed; the immutable full PDF remains downloadable.
    """
    if type(page) is not int or not 1 <= page <= MAX_PAGES or not content or len(content) > MAX_BYTES:
        raise DocumentStorageError('DOCUMENT_PAGE_INVALID')
    try:
        validate_pdf(content)
        reader = PdfReader(io.BytesIO(content), strict=True)
        if not 1 <= len(reader.pages) <= MAX_PAGES or page > len(reader.pages):
            raise ValueError()
        source = reader.pages[page - 1]
        width, height = float(source.mediabox.width), float(source.mediabox.height)
        images = list(source.images)
        operations = ContentStream(source.get_contents(), reader).operations
        xobjects = source['/Resources']['/XObject']
        if (len(images) != 1 or len(xobjects) != 1 or source.rotation != 0
                or list(source.cropbox) != list(source.mediabox)
                or tuple(source.mediabox.lower_left) != (0, 0)
                or len(operations) != 4 or [op for _, op in operations] != [b'q', b'cm', b'Do', b'Q']
                or [float(value) for value in operations[1][0]] != [width, 0, 0, height, 0, 0]
                or list(operations[2][0]) != list(xobjects.keys())):
            raise ValueError()
        picture = images[0].image
        if picture.width * picture.height > 40_000_000 or min(picture.size) < 1:
            raise ValueError()
        output = io.BytesIO()
        picture.convert('RGB').save(output, format='PNG')
        result = output.getvalue()
        if len(result) > MAX_BYTES:
            raise ValueError()
        return result
    except Exception:
        raise DocumentStorageError('DOCUMENT_PAGE_UNAVAILABLE') from None


def _memo_pdf(lines: list[str]) -> bytes:
    """Deterministic text-layer fixture; English source content, Thai review UI."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    escaped = [line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)') for line in lines]
    stream = DecodedStreamObject()
    stream.set_data(('BT /F1 12 Tf 45 795 Td 22 TL ' + ' '.join(f'({line}) Tj T*' for line in escaped) + ' ET').encode('ascii'))
    page[NameObject('/Contents')] = writer._add_object(stream)
    writer.add_metadata({'/Title': 'SYNTHETIC HUB DEMO MEMO', '/Producer': PIPELINE})
    output = io.BytesIO(); writer.write(output)
    return output.getvalue()


def statement_rows() -> list[dict]:
    entries = [
        ('GOOGLE ADS DEMO0001', '1200.00', 'MEDIA'), ('META FB-INV1001', '800.00', 'MEDIA'),
        ('LINEPAY LP LINEOFFICIA', '299.00', 'CHANNEL'), ('LINEPAY LP LINEOFFICIA', '299.00', 'CHANNEL'),
        ('LINEPAY LP LINEOFFICIA', '299.00', 'CHANNEL'), ('PLUGIN ANNUAL PLAN', '1200.00', 'TOOL'),
        ('AGENCY SERVICE', '500.00', 'AGENCY_FEE'), ('BANK SERVICE FEE', '35.00', 'BANK_FEE'),
        ('GOOGLE ADS REFUND', '-120.00', 'MEDIA'), ('SOFTWARE MONTHLY PLAN', '300.00', 'TOOL'),
    ]
    return [{'page': index // 2 + 1, 'occurrence': index % 2 + 1,
             'charge_date': '2026-10-03' if cost_type == 'CHANNEL' else f'2026-10-{index // 2 + 2:02}',
             'descriptor': descriptor, 'amount': amount, 'cost_type': cost_type, 'payment_method': 'CORPORATE_CARD'}
            for index, (descriptor, amount, cost_type) in enumerate(entries)]


def _statement_pdf(rows: list[dict], controls: dict) -> bytes:
    fonts = [Path('C:/Windows/Fonts/arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    font_path = next((path for path in fonts if path.is_file()), None)
    font = ImageFont.truetype(str(font_path), 28) if font_path else ImageFont.load_default(size=28)
    title_font = ImageFont.truetype(str(font_path), 40) if font_path else ImageFont.load_default(size=40)
    pages = []
    for page_no in range(1, 6):
        picture = Image.new('RGB', (1500, 1900), 'white')
        draw = ImageDraw.Draw(picture)
        # Separate watermark from transaction cells: visible without hiding evidence.
        draw.text((80, 75), 'SYNTHETIC DEMO - NOT A REAL BANK STATEMENT', font=title_font, fill='#777777')
        headers = [f'PAGE: {page_no}', 'ISSUER: SYNTHETIC', 'CYCLE_START: 2026-10-01',
                   'CYCLE_END: 2026-10-31', 'DUE_DATE: 2026-11-15', 'MEANING: NET_CHARGES', 'STATEMENT_TOTAL: 4812.00']
        for index, line in enumerate(headers):
            draw.text((80, 180 + index * 55), line, font=font, fill='black')
        draw.line((80, 605, 1400, 605), fill='#777777', width=2)
        for index, row in enumerate(row for row in rows if row['page'] == page_no):
            y = 675 + index * 280
            for offset, line in enumerate([f"ROW: {row['occurrence']}", f"DATE: {row['charge_date']}",
                f"DETAIL: {row['descriptor']}", f"AMOUNT: {row['amount']}"]):
                draw.text((100, y + offset * 52), line, font=font, fill='black')
        draw.text((80, 1630), 'SYNTHETIC DATA ONLY', font=title_font, fill='#999999')
        pages.append(picture)
    output = io.BytesIO()
    pages[0].save(output, format='PDF', save_all=True, append_images=pages[1:], resolution=144.0,
        title='SYNTHETIC HUB DEMO STATEMENT', producer=PIPELINE, creationDate=time.gmtime(0), modDate=time.gmtime(0))
    return output.getvalue()


def fixture_catalog() -> list[dict]:
    """Trusted seeder only. Truth is never returned by worker claim or public APIs."""
    catalog = []
    for version in (1, 2):
        fields = {'memo_no': 'MO2610901', 'subject': 'HYABC synthetic media budget' + (' revised wording' if version == 2 else ''),
            'requesting_bud': 'C1', 'gross_amount': '12000.00', 'mirrored_status': 'APPROVED',
            'approval_date': '2026-10-01', 'period_start': '2026-10-01', 'period_end': '2026-10-31'}
        lines = ['SYNTHETIC DEMO - NOT A REAL MEMO', *[f'{key.upper()}: {value}' for key, value in fields.items()],
                 'No actual approval, expenditure or sales entitlement is represented.']
        catalog.append({'fixture_id': f'memo-hyabc-v{version}', 'document_type': 'E_MEMO',
            'label_th': f'บันทึกข้อความ HYABC ตัวอย่าง รุ่น {version}', 'content': _memo_pdf(lines),
            'truth': {'fields': fields}, 'page_count': 1})
    controls = {'issuer': 'SYNTHETIC', 'cycle_start': '2026-10-01', 'cycle_end': '2026-10-31',
        'due_date': '2026-11-15', 'statement_total': '4812.00', 'meaning': 'NET_CHARGES',
        'page_counts': [{'page': page, 'count': 2} for page in range(1, 6)]}
    rows = statement_rows()
    catalog.append({'fixture_id': 'statement-october-v1', 'document_type': 'CARD_STATEMENT',
        'label_th': 'ใบแจ้งยอดบัตรตัวอย่าง ตุลาคม 2569 · 5 หน้า', 'content': _statement_pdf(rows, controls),
        'truth': {'rows': rows, 'controls': controls}, 'page_count': 5})
    for item in catalog:
        sha = hashlib.sha256(item['content']).hexdigest()
        prefix = 'memo' if item['document_type'] == 'E_MEMO' else 'statement'
        item['metadata'] = {'fixture_id': item['fixture_id'], 'document_type': item['document_type'],
            'label_th': item['label_th'], 'sha256': sha, 'byte_size': len(item['content']), 'mime': 'application/pdf',
            'filename': f"synthetic-{item['fixture_id']}.pdf", 'page_count': item['page_count'],
            'storage_key': f'{prefix}/sha256/{sha}.pdf', 'pipeline_version': PIPELINE}
    return catalog


def install_fixtures() -> list[tuple[dict, dict]]:
    result = []
    for fixture in fixture_catalog():
        content, metadata = fixture['content'], fixture['metadata']
        validate_pdf(content)
        if len(content) > MAX_BYTES or len(PdfReader(io.BytesIO(content)).pages) != metadata['page_count'] or metadata['page_count'] > MAX_PAGES:
            raise DocumentStorageError('FIXTURE_INVALID')
        path = _path(metadata['storage_key']); path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.fixture-', delete=False) as target:
                    temporary = Path(target.name); target.write(content); target.flush(); os.fsync(target.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    pass  # Concurrent same-hash install is verified below.
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        read_document(metadata['storage_key'], metadata['sha256'])
        result.append((metadata, fixture['truth']))
    return result
