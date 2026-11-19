"""Convert an authorized future upload without changing any stored object."""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import re

from . import assets
from .upload_optimization import (PIPELINE_VERSION, UploadContext, UploadProcessingError,
    _private_decoding, extract_reused_suggestions, optimize_image, optimize_pdf, preflight_upload)

_STORED_KEYS = ('original_filename', 'mime_type', 'storage_path', 'checksum', 'file_size',
                'asset_type', 'width', 'height', 'language', 'storage_bucket', 'storage_provider')
_STOCK_CODES = {'shutterstock': 'stock_1', 'getty': 'stock_2', 'istock': 'stock_3', 'adobe stock': 'stock_4'}


@dataclass(frozen=True)
class UploadResult:
    content: bytes | None = field(repr=False)
    metadata: dict
    original: dict
    processing: dict
    suggestions: dict = field(repr=False)
    thumbnail: bytes | None = field(default=None, repr=False)
    thumbnail_error: str | None = None


def _evidence(value: dict) -> dict:
    values = dict(value.get('values', {}))
    # Optional metadata must not turn a valid file into a failed upload.
    # Match the recorder's text boundary after extraction/joining.
    def safe_text(text):
        return isinstance(text, str) and not re.search(
            r'[<>\x00-\x1f\x7f]|https?://|[\w.%+-]+@[\w.-]+|[A-Za-z]:[\\/]|\\\\|[0-9][0-9 ()+.-]{8,}[0-9]', text, re.I)
    for key in ('credit', 'caption'):
        if key in values and not safe_text(values[key]):
            values.pop(key)
    for key, text_key in (('credit_evidence', 'text'), ('unmapped_keywords', None)):
        if key in values:
            values[key] = [item for item in values[key] if safe_text(item.get(text_key) if text_key else item)]
            if not values[key]:
                values.pop(key)
    if 'stock_evidence' in values:
        try:
            values['stock_evidence'] = sorted({_STOCK_CODES[item] for item in values['stock_evidence']})
        except (KeyError, TypeError):
            raise UploadProcessingError('invalid_file_suggestions') from None
    return {'source': 'file_metadata', 'pipeline_version': PIPELINE_VERSION, 'confirmed': False, 'values': values}


def prepare_authorized_upload(content: bytes, mime: str, filename: str, resolved: dict,
                              existing: dict | None = None) -> UploadResult:
    """resolved is the private SQL projection, never an HTTP or caller payload."""
    preflight_upload(content, mime)
    kind = resolved['processing_class']
    context = resolved['context']
    processing_context = UploadContext(
        category=context.get('category'),
        disclosure_evidence=kind == 'private_exact',
        project_coordinates=tuple(resolved['coordinates']) if resolved.get('coordinates') else None,
        active_tags=tuple(tuple(item) for item in resolved.get('active_tags', [])),
        processing_class=kind,
    )
    checksum = hashlib.sha256(content).hexdigest()
    if existing is not None:
        original = existing['original']
        if original['checksum'] != checksum or original['size'] != len(content) or original['mime_type'] != mime:
            raise UploadProcessingError('original_source_mismatch')
        suggestions = {} if kind in {'private_exact', 'sanitized_svg'} else extract_reused_suggestions(
            content, mime, processing_context, checksum)
        metadata = {key: existing['asset'][key] for key in _STORED_KEYS if key in existing['asset']}
        processing = {**existing['processing'], 'pipeline_version': existing['pipeline_version']}
        return UploadResult(None, metadata, original, processing, _evidence(suggestions))
    if kind in {'private_exact', 'sanitized_svg'}:
        with _private_decoding():
            stored, metadata = assets.prepare_upload(content, mime, filename)
        original = {'checksum': checksum, 'size': len(content), 'mime_type': mime,
                    'width': metadata['width'], 'height': metadata['height']}
        processing = {'pipeline_version': PIPELINE_VERSION, 'max_edge': None, 'quality': None,
                      'output_format': assets.FORMATS[mime][1].replace('jpg', 'jpeg'),
                      'metadata_stripped': kind == 'sanitized_svg', 'pdf_images_recompressed': False,
                      'kept_original_because_no_gain': False, 'kept_unchanged_legal': kind == 'private_exact'}
        return UploadResult(stored, metadata, original, processing, _evidence({}))
    if kind == 'marketing_pdf' and mime == 'application/pdf':
        result = optimize_pdf(content, processing_context)
    elif kind == 'marketing_raster' and mime in {'image/jpeg', 'image/png', 'image/webp'}:
        result = optimize_image(content, mime, processing_context)
    else:
        raise UploadProcessingError('invalid_processing_class')
    with _private_decoding():
        metadata = assets.validate_file(result.content, result.mime_type, filename,
                                        max_bytes=assets.stored_byte_limit(result.mime_type))
    return UploadResult(result.content, metadata, result.original, result.processing, _evidence(result.suggestions))
