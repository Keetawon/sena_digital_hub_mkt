"""Small, port-free checks for the authorized upload adapter."""
import hashlib
import io
import logging
import unittest
from unittest.mock import patch

from PIL import Image, PngImagePlugin
from pypdf import PdfReader, PdfWriter

from sena_hub_api import assets
from sena_hub_api.upload_pipeline import prepare_authorized_upload
from sena_hub_api.upload_optimization import UploadProcessingError


def raster():
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text('Comment', 'not retained')
    Image.new('RGB', (3, 2), '#2468ab').save(output, 'PNG', pnginfo=metadata)
    return output.getvalue()


def resolved(kind, category=None):
    return {'processing_class': kind, 'context': {'v': 1, 'kind': 'project',
            'ref': 'synthetic', 'purpose': 'media', 'category': category},
            'coordinates': None, 'active_tags': []}


class UploadPipelineChecks(unittest.TestCase):
    def test_marketing_result_uses_stored_identity_and_private_envelope(self):
        original = raster()
        result = prepare_authorized_upload(original, 'image/png', 'synthetic.png', resolved('marketing_raster', 'exterior'))
        self.assertEqual(result.original['checksum'], hashlib.sha256(original).hexdigest())
        self.assertEqual(result.metadata['checksum'], hashlib.sha256(result.content).hexdigest())
        self.assertNotEqual(result.original['checksum'], result.metadata['checksum'])
        self.assertEqual(result.metadata['width'], 3)
        with Image.open(io.BytesIO(result.content)) as image:
            self.assertNotIn('Comment', image.info)
        self.assertEqual(set(result.suggestions), {'source', 'pipeline_version', 'confirmed', 'values'})
        self.assertFalse(result.suggestions['confirmed'])
        self.assertEqual(result.suggestions['source'], 'file_metadata')
        self.assertNotIn('coordinates', repr(result))

    def test_unknown_context_is_byte_exact_and_has_no_suggestions(self):
        original = raster()
        result = prepare_authorized_upload(original, 'image/png', 'private.png', resolved('private_exact'))
        self.assertEqual(result.content, original)
        self.assertEqual(result.original['checksum'], result.metadata['checksum'])
        self.assertEqual(result.suggestions['values'], {})
        self.assertTrue(result.processing['kept_unchanged_legal'])

    def test_original_reuse_never_reencodes_and_preserves_prior_pipeline(self):
        original = raster()
        context = resolved('marketing_raster', 'exterior')
        first = prepare_authorized_upload(original, 'image/png', 'first.png', context)
        existing = {'original': first.original, 'asset': {**first.metadata, 'id': 'private-row', 'extra': 'private'},
                    'pipeline_version': 'previous-pipeline', 'processing': first.processing}
        with patch('sena_hub_api.upload_pipeline.optimize_image', side_effect=AssertionError('must not reencode')):
            reused = prepare_authorized_upload(original, 'image/png', 'renamed.png', context, existing)
        self.assertIsNone(reused.content)
        self.assertEqual(reused.metadata, first.metadata)
        self.assertEqual(reused.processing['pipeline_version'], 'previous-pipeline')
        self.assertNotIn('id', reused.metadata)
        with self.assertRaises(UploadProcessingError):
            prepare_authorized_upload(original + b'x', 'image/png', 'renamed.png', context, existing)

    def test_pdf_title_is_private_suggestion_and_stored_metadata_is_removed(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.add_metadata({'/Title': 'Synthetic brochure', '/Author': 'discard-this'})
        stream = io.BytesIO()
        writer.write(stream)
        result = prepare_authorized_upload(stream.getvalue(), 'application/pdf', 'brochure.pdf', resolved('marketing_pdf', 'brochure'))
        self.assertEqual(result.suggestions['values'], {'caption': 'Synthetic brochure'})
        self.assertEqual(len(PdfReader(io.BytesIO(result.content)).pages), 1)
        self.assertFalse(PdfReader(io.BytesIO(result.content)).metadata)
        self.assertNotIn(b'discard-this', result.content)

    def test_unsafe_optional_pdf_titles_do_not_reject_valid_files(self):
        for title in ('https://example.test', 'unmatched < marker', 'marker > unmatched', '123.456.78901'):
            with self.subTest(title=title):
                writer = PdfWriter()
                writer.add_blank_page(width=100, height=100)
                writer.add_metadata({'/Title': title})
                stream = io.BytesIO()
                writer.write(stream)
                result = prepare_authorized_upload(stream.getvalue(), 'application/pdf', 'brochure.pdf', resolved('marketing_pdf', 'brochure'))
                self.assertNotIn('caption', result.suggestions['values'])
                self.assertFalse(PdfReader(io.BytesIO(result.content)).metadata)

    def test_dropped_credit_keeps_fixed_stock_signal(self):
        stream = io.BytesIO()
        exif = Image.Exif()
        exif[315] = 'Getty Images https://example.test'
        Image.new('RGB', (3, 2), 'blue').save(stream, 'JPEG', exif=exif)
        result = prepare_authorized_upload(stream.getvalue(), 'image/jpeg', 'photo.jpg', resolved('marketing_raster', 'exterior'))
        self.assertEqual(result.suggestions['values']['stock'], 'present')
        self.assertEqual(result.suggestions['values']['stock_evidence'], ['stock_2'])
        self.assertNotIn('credit', result.suggestions['values'])
        self.assertNotIn('credit_evidence', result.suggestions['values'])
    def test_private_thumbnail_decode_does_not_log_legal_metadata(self):
        marker = 'private-synthetic-thumbnail-marker'
        stream = io.BytesIO()
        exif = Image.Exif()
        exif[315] = marker
        Image.new('RGB', (3, 2), 'blue').save(stream, 'JPEG', exif=exif)
        records = []
        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())
        handler = Capture()
        logger = logging.getLogger('PIL')
        previous_level, previous_propagate = logger.level, logger.propagate
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
        logger.addHandler(handler)
        try:
            with assets.render_thumbnail(stream.getvalue(), 'image/jpeg') as image:
                self.assertEqual(image.size, (3, 2))
        finally:
            logger.removeHandler(handler)
            logger.setLevel(previous_level)
            logger.propagate = previous_propagate
        self.assertTrue(records)
        self.assertNotIn(marker, '\n'.join(records))
    def test_svg_keeps_sanitizer_and_does_not_create_suggestions(self):
        raw = b'<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><script>bad()</script><rect width="3" height="2"/></svg>'
        result = prepare_authorized_upload(raw, 'image/svg+xml', 'logo.svg', resolved('sanitized_svg'))
        self.assertNotIn(b'script', result.content)
        self.assertEqual(result.suggestions['values'], {})
        self.assertNotEqual(result.original['checksum'], result.metadata['checksum'])


if __name__ == '__main__':
    unittest.main()