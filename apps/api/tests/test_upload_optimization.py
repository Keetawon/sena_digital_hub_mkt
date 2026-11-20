"""Pure W9 boundary checks; the API suite supplies its normal disposable guard."""
import io
import hashlib
import json
import logging
import re
import struct
import threading
import time
import unittest
import zlib
from xml.etree import ElementTree
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from PIL import Image, ImageChops, ImageCms, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DecodedStreamObject, NameObject, NumberObject, read_object
import pypdfium2 as pdfium

from sena_hub_api import upload_optimization as pipeline
from upload_optimization_fixtures import (
    EXCLUDED, jpeg_fixture, jpeg_thumbnail_fixture, raster_fixture, dimension_header_bomb,
    pdf_fixture, pdf_incremental_fixture, pdf_nested_metadata_fixture,
    xmp_packet,
    pdf_metadata_image_fixture, xmp_image_fixture, user_computer_fixture,
    pdf_unsupported_rewrite_fixture, png_sixteen_bit_alpha_fixture, png_sixteen_bit_fixture, HDR_SRGB16_REFERENCE,
)

CONTEXT = pipeline.UploadContext(category="exterior", project_coordinates=(0, 0),
                                 active_tags=(("active-tag-id", "SYNTHETIC_TAG"),))


def fixture_thumbnail(content):
    """Independently read fixture IFD1 before asserting that it is removed."""
    with Image.open(io.BytesIO(content)) as picture:
        tiff = next(raw[6:] for kind, raw in picture.applist if kind == "APP1" and raw.startswith(b"Exif\0\0"))
    endian = "<" if tiff[:2] == b"II" else ">"
    ifd0 = struct.unpack_from(endian + "I", tiff, 4)[0]
    count = struct.unpack_from(endian + "H", tiff, ifd0)[0]
    ifd1 = struct.unpack_from(endian + "I", tiff, ifd0 + 2 + 12 * count)[0]
    assert ifd1
    count = struct.unpack_from(endian + "H", tiff, ifd1)[0]
    entries = [struct.unpack_from(endian + "HHII", tiff, ifd1 + 2 + 12 * index) for index in range(count)]
    values = {tag: value for tag, kind, count, value in entries if kind == 4 and count == 1}
    return tiff[values[513]:values[513] + values[514]]


def fixture_pdf_jpeg(reader, placement):
    page = reader.pages[0]
    if placement == "inline":
        stream = ContentStream(page.get_contents(), reader)
        return next(operands["data"] for operands, operator in stream.operations if operator == b"INLINE IMAGE")
    resources = page["/Resources"]
    if placement == "form":
        resources = resources["/XObject"]["/Fm0"]["/Resources"]
    return resources["/XObject"]["/Im0"].get_data()


class SmallImageChecks(unittest.TestCase):
    def assert_private_removed(self, result):
        encoded = json.dumps({"original": result.original, "processing": result.processing,
                              "suggestions": result.suggestions}, ensure_ascii=False)
        for text in [*EXCLUDED.values(), "SYNTHETIC_LENS_SERIAL_EXCLUDE"]:
            self.assertNotIn(text, encoded)
            self.assertNotIn(text.encode(), result.content)
        with Image.open(io.BytesIO(result.content)) as stored:
            self.assertFalse(stored.getexif())
            for key in ("exif", "xmp", "XML:com.adobe.xmp", "icc_profile", "comment", "photoshop"):
                self.assertNotIn(key, stored.info)
        self.assertEqual(result.suggestions["source"], "file_metadata")
        self.assertEqual(result.suggestions["pipeline_version"], pipeline.PIPELINE_VERSION)
        self.assertFalse(result.suggestions["confirmed"])
        self.assertEqual(set(result.suggestions), {"source", "pipeline_version", "confirmed", "values"})
        self.assertEqual(set(result.original), {"checksum", "size", "mime_type", "width", "height"})
        self.assertLessEqual(set(result.suggestions["values"]), {
            "taken_at", "credit", "credit_evidence", "stock", "stock_evidence", "image_kind",
            "caption", "tags", "unmapped_keywords", "proximity"})
        self.assertEqual(set(result.processing), {"pipeline_version", "max_edge", "quality", "output_format",
            "metadata_stripped", "pdf_images_recompressed", "kept_original_because_no_gain"})
        self.assertEqual(result.processing["pipeline_version"], pipeline.PIPELINE_VERSION)

    def test_absolute_path_text_is_excluded_from_image_and_pdf_suggestions(self):
        for value in ("/tmp/SYNTHETIC_PATH_EXCLUDE/source.psd",
                      "file:///var/tmp/SYNTHETIC_PATH_EXCLUDE/source.psd",
                      "./cache/SYNTHETIC_PATH_EXCLUDE/source.psd",
                      "~/Library/SYNTHETIC_PATH_EXCLUDE/source.psd"):
            for field in ("dc:description", "dc:rights", "dc:subject"):
                with self.subTest(value=value, field=field):
                    content, _ = xmp_image_fixture(field, value)
                    self.assertIn(value.encode(), content)
                    result = pipeline.optimize_image(content, "image/png", CONTEXT)
                    self.assertNotIn("SYNTHETIC_PATH_EXCLUDE", json.dumps(result.suggestions))
                    self.assert_private_removed(result)
            with self.subTest(value=value, field="pdf_title"):
                content, _ = pdf_fixture()
                writer = PdfWriter(io.BytesIO(content))
                writer.add_metadata({"/Title": value})
                output = io.BytesIO(); writer.write(output)
                self.assertEqual(PdfReader(io.BytesIO(output.getvalue())).metadata["/Title"], value)
                result = pipeline.optimize_pdf(output.getvalue(), CONTEXT)
                self.assertNotIn("SYNTHETIC_PATH_EXCLUDE", json.dumps(result.suggestions))
                self.assertNotIn(value.encode(), result.content)

    def test_nested_history_properties_never_become_current_suggestions(self):
        for property_text in (
            '<rdf:Description dc:description="SYNTHETIC_HISTORY_EXCLUDE"/>',
            '<rdf:Description><dc:description>SYNTHETIC_HISTORY_EXCLUDE</dc:description></rdf:Description>',
        ):
            with self.subTest(property_text=property_text):
                xml = ('<x:xmpmeta xmlns:x="adobe:ns:meta/" '
                       'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" '
                       'xmlns:dc="http://purl.org/dc/elements/1.1/" '
                       'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
                       '<rdf:RDF><rdf:Description dc:rights="SYNTHETIC current credit">'
                       '<xmpMM:History><rdf:Seq><rdf:li>' + property_text +
                       '</rdf:li></rdf:Seq></xmpMM:History>'
                       '</rdf:Description></rdf:RDF></x:xmpmeta>')
                self.assertIn("SYNTHETIC_HISTORY_EXCLUDE", xml)
                info = PngImagePlugin.PngInfo(); info.add_itxt("XML:com.adobe.xmp", xml)
                output = io.BytesIO(); Image.new("RGB", (16, 12), "blue").save(output, "PNG", pnginfo=info)
                result = pipeline.optimize_image(output.getvalue(), "image/png", CONTEXT)
                self.assertNotIn("SYNTHETIC_HISTORY_EXCLUDE", json.dumps(result.suggestions))
                self.assertNotIn("caption", result.suggestions["values"])
                self.assertEqual(result.suggestions["values"]["credit"], "SYNTHETIC current credit")
                self.assert_private_removed(result)

        for property_text in (
            'dc:description="SYNTHETIC_HISTORY_EXCLUDE"/>',
            '><dc:description>SYNTHETIC_HISTORY_EXCLUDE</dc:description></xmpMM:History>',
        ):
            with self.subTest(root_property=property_text):
                xml = ('<xmpMM:History xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" '
                       'xmlns:dc="http://purl.org/dc/elements/1.1/" ' + property_text)
                self.assertEqual(pipeline._xmp_fields(xml.encode()), {})

    def test_dedicated_user_and_computer_names_are_excluded(self):
        content, names = user_computer_fixture()
        with Image.open(io.BytesIO(content)) as source:
            for key, value in names.items():
                self.assertEqual(source.info[key], value)
                self.assertIn(value.encode(), content)
        result = pipeline.optimize_image(content, "image/png", CONTEXT)
        self.assertEqual(result.suggestions["values"], {"proximity": "unknown"})
        self.assert_private_removed(result)
        for value in names.values():
            self.assertNotIn(value.encode(), result.content)
            self.assertNotIn(value, json.dumps([result.original, result.processing, result.suggestions]))
        with Image.open(io.BytesIO(result.content)) as stored:
            for key in names:
                self.assertNotIn(key, stored.info)

    def test_excluded_input_fields_exist_before_stripping(self):
        content, _ = jpeg_fixture(xmp=True)
        with Image.open(io.BytesIO(content)) as source:
            capture = source.getexif().get_ifd(34665)
            for tag, value in ((42033, EXCLUDED["serial"]), (42032, EXCLUDED["owner"]),
                               (42037, "SYNTHETIC_LENS_SERIAL_EXCLUDE")):
                self.assertEqual(capture[tag], value)
            xml = next(raw.split(b"\0", 1)[1] for kind, raw in source.applist
                       if kind == "APP1" and raw.startswith(b"http://ns.adobe.com/xap/1.0/\0"))
        nodes = ElementTree.fromstring(xml)
        for path, value in (
            ("{http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/}CiEmailWork", EXCLUDED["contact"]),
            ("{http://www.metadataworkinggroup.com/schemas/regions/}Name", EXCLUDED["face"]),
            ("{http://ns.adobe.com/xap/1.0/sType/ResourceRef#}filePath", EXCLUDED["path"])):
            self.assertIn(value, [node.attrib[path] for node in nodes.iter() if path in node.attrib])
        history = nodes.find(".//{http://ns.adobe.com/xap/1.0/mm/}History")
        self.assertIn(EXCLUDED["history"], list(history.itertext()))
        self.assert_private_removed(pipeline.optimize_image(content, "image/jpeg", CONTEXT))

    def test_full_image_xmp_create_date_with_and_without_offset(self):
        for attribute in (False, True):
            for offset in ("+07:00", ""):
                with self.subTest(attribute=attribute, offset=offset):
                    value = "2026-01-02T03:04:05" + offset
                    content, _ = xmp_image_fixture("xmp:CreateDate", value, attribute=attribute)
                    with Image.open(io.BytesIO(content)) as source:
                        self.assertFalse(source.getexif())
                        xml = ElementTree.fromstring(source.info["XML:com.adobe.xmp"])
                        key = "{http://ns.adobe.com/xap/1.0/}CreateDate"
                        self.assertEqual(xml.attrib[key] if attribute else xml.find(key).text, value)
                    result = pipeline.optimize_image(content, "image/png", CONTEXT)
                    self.assertEqual(result.suggestions["values"], {
                        "proximity": "unknown", "taken_at": {"value": value, "offset_known": bool(offset)}})
                    self.assert_private_removed(result)

    def test_full_image_stock_identifier_only_is_categorical(self):
        for field, identifier, agency in (("dc:identifier", "GettyImages_123456", "getty"),
                                          ("photoshop:Source", "Shutterstock_987654", "shutterstock")):
            for attribute in (False, True):
                with self.subTest(field=field, attribute=attribute):
                    content, _ = xmp_image_fixture(field, identifier, attribute=attribute)
                    with Image.open(io.BytesIO(content)) as source:
                        xml = ElementTree.fromstring(source.info["XML:com.adobe.xmp"])
                        self.assertEqual(list(xml.attrib.values()) if attribute else [node.text for node in xml],
                                         [identifier])
                        self.assertFalse(source.getexif())
                    result = pipeline.optimize_image(content, "image/png", CONTEXT)
                    self.assertEqual(result.suggestions["values"], {
                        "proximity": "unknown", "stock": "present", "stock_evidence": [agency]})
                    self.assertNotIn(identifier, json.dumps([result.original, result.processing, result.suggestions]))
                    self.assertNotIn(identifier.encode(), result.content)
                    self.assert_private_removed(result)

    def test_gps_ifd_is_not_read_without_project_coordinates(self):
        content, _ = jpeg_fixture(orientation=1, gps="near")
        with Image.open(io.BytesIO(content)) as picture:
            self.assertTrue(picture.getexif().get_ifd(34853))
        get_ifd = Image.Exif.get_ifd
        reads = []
        def guarded(exif, tag):
            reads.append(tag)
            if tag == 34853:
                raise AssertionError("No project coordinates: GPS must not be decoded")
            return get_ifd(exif, tag)
        with patch.object(Image.Exif, "get_ifd", guarded):
            result = pipeline.optimize_image(content, "image/jpeg", pipeline.UploadContext(category="exterior"))
        self.assertNotIn(34853, reads)
        self.assertEqual(result.suggestions["values"]["proximity"], "unknown")
        self.assert_private_removed(result)

    def test_orientation_and_capture_offsets(self):
        for offset in ("+07:00", None):
            with self.subTest(offset=offset):
                content, _ = jpeg_fixture(offset=offset)
                result = pipeline.optimize_image(content, "image/jpeg", CONTEXT)
                self.assertEqual((result.width, result.height), (64, 96))
                taken = result.suggestions["values"]["taken_at"]
                self.assertEqual(taken, {"value": "2026-01-02T03:04:05" + (offset or ""),
                                         "offset_known": offset is not None})
                with Image.open(io.BytesIO(content)) as source, Image.open(io.BytesIO(result.content)) as stored:
                    self.assertEqual(source.quantization, stored.quantization)
                self.assertEqual(result.processing["quality"], "keep")
                self.assert_private_removed(result)

    def test_credit_stock_and_controlled_tags_are_unconfirmed(self):
        content, _ = jpeg_fixture(xmp=True, iptc=True, stock=True, ai=True)
        result = pipeline.optimize_image(content, "image/jpeg", CONTEXT)
        values = result.suggestions["values"]
        self.assertIn("SYNTHETIC Artist", values["credit"])
        self.assertIn("SYNTHETIC copyright", values["credit"])
        self.assertEqual(values["stock"], "present")
        self.assertEqual(values["stock_evidence"], ["adobe stock", "getty"])
        self.assertEqual(values["image_kind"], "render")
        self.assertEqual(values["caption"], "SYNTHETIC caption")
        self.assertEqual(values["tags"], ["active-tag-id"])
        self.assertEqual(values["unmapped_keywords"], ["SYNTHETIC_UNKNOWN_TAG"])
        self.assertEqual({item["field"]: item["text"] for item in values["credit_evidence"]}, {
            "exif_artist": "SYNTHETIC Artist", "exif_copyright": "SYNTHETIC Copyright",
            "iptc_byline": "SYNTHETIC byline", "iptc_credit": "SYNTHETIC Getty credit",
            "iptc_copyright": "SYNTHETIC copyright", "xmp_creator": "SYNTHETIC Adobe Stock credit",
            "xmp_rights": "SYNTHETIC copyright", "xmp_usage_terms": "SYNTHETIC usage terms"})
        self.assert_private_removed(result)

    def test_nonzero_gps_has_only_categorical_output_and_no_capture_date_fallback(self):
        exif = Image.Exif()
        exif[34853] = {1: "N", 2: (IFDRational(13), IFDRational(45), IFDRational(123, 10)),
                       3: "E", 4: (IFDRational(100), IFDRational(31), IFDRational(457, 10))}
        picture = Image.new("RGB", (2, 1), "white")
        stream = io.BytesIO()
        picture.save(stream, format="PNG", exif=exif)
        result = pipeline.optimize_image(stream.getvalue(), "image/png", pipeline.UploadContext(
            category="exterior", project_coordinates=(13 + 45 / 60 + 12.3 / 3600, 100 + 31 / 60 + 45.7 / 3600)))
        self.assertEqual(result.suggestions, {"source": "file_metadata", "pipeline_version": pipeline.PIPELINE_VERSION,
                                             "confirmed": False, "values": {"proximity": "near"}})
        self.assert_private_removed(result)

    def test_real_image_contact_fields_are_excluded_and_stock_hint_survives(self):
        from xml.sax.saxutils import escape
        for contact in ("synthetic-contact@example.invalid", "+66 81 234 5678", "Address: 123 Synthetic Road"):
            with self.subTest(contact=contact):
                exif = Image.Exif()
                exif[315] = "iStock " + contact
                exif[33432] = contact
                xml = ('<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" '
                       'xmlns:r="http://ns.adobe.com/xap/1.0/rights/">'
                       + ''.join(f'<{tag}>{escape(contact)}</{tag}>' for tag in (
                           "dc:creator", "dc:rights", "dc:description", "dc:subject", "r:UsageTerms")) + '</rdf:Description>')
                info = PngImagePlugin.PngInfo()
                info.add_itxt("XML:com.adobe.xmp", xml)
                stream = io.BytesIO()
                Image.new("RGB", (2, 1), "white").save(stream, format="PNG", exif=exif, pnginfo=info)
                result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
                self.assertEqual(result.suggestions["values"], {
                    "proximity": "unknown", "stock": "present", "stock_evidence": ["istock"]})
                self.assertNotIn(contact, json.dumps(result.suggestions))
                self.assertNotIn(contact.encode(), result.content)
                self.assert_private_removed(result)

    def test_caption_keywords_and_composite_signal_work_without_iptc(self):
        source, _ = raster_fixture("JPEG")
        xml = xmp_packet(ai=True).replace(b"/trainedAlgorithmicMedia", b"/compositeWithTrainedAlgorithmicMedia")
        payload = b"http://ns.adobe.com/xap/1.0/\0" + xml
        source = source[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + source[2:]
        result = pipeline.optimize_image(source, "image/jpeg", pipeline.UploadContext(
            category="exterior", active_tags=(("first", "SYNTHETIC_TAG"), ("second", "SYNTHETIC_TAG"))))
        values = result.suggestions["values"]
        self.assertEqual(values["caption"], "SYNTHETIC caption")
        self.assertEqual(values["image_kind"], "render")
        self.assertNotIn("tags", values)
        self.assertEqual(values["unmapped_keywords"], ["SYNTHETIC_TAG", "SYNTHETIC_UNKNOWN_TAG"])
        self.assert_private_removed(result)

    def test_gps_only_returns_categorical_proximity(self):
        for gps, project, expected in (("near", (0, 0), "near"), ("far", (0, 0), "far"),
                                       (None, (0, 0), "unknown"), ("near", None, "unknown")):
            with self.subTest(expected=expected, gps=gps):
                content, _ = jpeg_fixture(gps=gps)
                result = pipeline.optimize_image(content, "image/jpeg",
                    pipeline.UploadContext(category="exterior", project_coordinates=project))
                self.assertEqual(result.suggestions["values"]["proximity"], expected)
                self.assertNotIn("coordinates", json.dumps(result.suggestions))
                self.assertNotIn("distance", json.dumps(result.suggestions))
                self.assert_private_removed(result)

    def test_render_software_precedes_camera_signal(self):
        for software, expected in (("SYNTHETIC camera software", "photo"), ("Blender 4.0", "render")):
            content, _ = jpeg_fixture(software=software)
            result = pipeline.optimize_image(content, "image/jpeg", CONTEXT)
            self.assertEqual(result.suggestions["values"]["image_kind"], expected)
            self.assertNotIn("software", json.dumps(result.suggestions).lower())

    def test_different_embedded_thumbnail_is_removed(self):
        content, expected = jpeg_thumbnail_fixture(xmp=True, iptc=True)
        preview = fixture_thumbnail(content)
        self.assertEqual(hashlib.sha256(preview).hexdigest(), expected["thumbnail_checksum"])
        with Image.open(io.BytesIO(preview)) as embedded, Image.open(io.BytesIO(content)) as main:
            self.assertEqual(embedded.size, expected["thumbnail_size"])
            self.assertNotEqual(embedded.resize(main.size).tobytes(), main.tobytes())
        result = pipeline.optimize_image(content, "image/jpeg", CONTEXT)
        self.assertEqual((result.width, result.height), (64, 96))
        self.assertEqual(result.content.count(b"\xff\xd8"), 1)
        self.assertNotIn(preview, result.content)
        self.assert_private_removed(result)

    def test_small_png_line_art_and_webp_keep_pixels_and_dimensions(self):
        for format, mime in (("PNG", "image/png"), ("WEBP", "image/webp")):
            for alpha in (False, True):
                with self.subTest(format=format, alpha=alpha):
                    content, _ = raster_fixture(format, transparent=alpha)
                    result = pipeline.optimize_image(content, mime, CONTEXT)
                    self.assertEqual((result.width, result.height), (96, 64))
                    self.assertEqual(result.mime_type, mime)
                    with Image.open(io.BytesIO(content)) as source, Image.open(io.BytesIO(result.content)) as stored:
                        self.assertIsNone(ImageChops.difference(source.convert("RGBA"), stored.convert("RGBA")).getbbox())
                    self.assert_private_removed(result)

    def test_small_jpeg_and_webp_without_color_or_orientation_work_keep_encoded_pixels(self):
        for format, mime in (("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            content, _ = raster_fixture(format, (96, 64), noise=True)
            result = pipeline.optimize_image(content, mime, CONTEXT)
            self.assertLessEqual(len(result.content), len(content))
            self.assertEqual(result.processing["quality"], "keep")
            with Image.open(io.BytesIO(content)) as before, Image.open(io.BytesIO(result.content)) as after:
                self.assertEqual(before.tobytes(), after.tobytes())

    def test_animated_and_bomb_inputs_rejected_without_allocating_giant_image(self):
        for format, mime in (("PNG", "image/png"), ("WEBP", "image/webp")):
            content, _ = raster_fixture(format, animated=True)
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^animated_image$"):
                pipeline.optimize_image(content, mime, CONTEXT)
        content, _ = dimension_header_bomb()
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^png_pixel_limit$"):
            pipeline.optimize_image(content, "image/png", CONTEXT)

    def test_unknown_or_legal_context_never_enters_optimizer(self):
        content, _ = jpeg_fixture()
        for context in (pipeline.UploadContext(), pipeline.UploadContext(category="legal_document"),
                        pipeline.UploadContext(category="brochure", disclosure_evidence=True)):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^legal_processing_forbidden$"):
                pipeline.optimize_image(content, "image/jpeg", context)

    def test_allowlisted_text_does_not_admit_contact_or_path_values(self):
        for text in ("Creator synthetic-contact@example.invalid", "phone: +66 123 456 789",
                     "C:/Users/Synthetic/source.psd", "address: synthetic address"):
            self.assertIsNone(pipeline._plain(text))
        self.assertEqual(pipeline._plain("<b>Synthetic</b> creator"), "Synthetic creator")
        self.assertEqual(pipeline._plain("https://example.invalid/license"), "https://example.invalid/license")
        self.assertEqual(len(pipeline._plain("a" * 2000)), 1000)
        self.assertEqual(pipeline._xmp_fields(b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///private">]><x>&e;</x>'), {})

    def test_contact_filter_does_not_erase_stock_restriction(self):
        source, _ = jpeg_fixture()
        with Image.open(io.BytesIO(source)) as picture:
            exif = picture.getexif()
            exif[315] = "Shutterstock 123456 synthetic-contact@example.invalid"
            stream = io.BytesIO()
            picture.save(stream, format="JPEG", quality="keep", exif=exif)
        result = pipeline.optimize_image(stream.getvalue(), "image/jpeg", CONTEXT)
        self.assertEqual(result.suggestions["values"]["stock"], "present")
        self.assertEqual(result.suggestions["values"]["stock_evidence"], ["shutterstock"])
        self.assertNotIn("123456", json.dumps(result.suggestions))
        self.assert_private_removed(result)
        parsed = pipeline._xmp_fields(b'<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier>GettyImages_123456</dc:identifier></rdf:Description>')
        self.assertEqual(parsed, {"stock_agencies": ["getty"]})

    def test_concurrent_png_processing_is_serialized(self):
        content, _ = raster_fixture()
        counter_lock = threading.Lock()
        active = peak = 0
        encode = pipeline._strip_png_metadata
        def observed(*args, **kwargs):
            nonlocal active, peak
            with counter_lock:
                active += 1
                peak = max(peak, active)
            try:
                time.sleep(0.005)
                return encode(*args, **kwargs)
            finally:
                with counter_lock:
                    active -= 1
        with patch.object(pipeline, "_strip_png_metadata", observed), ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: pipeline.optimize_image(content, "image/png", CONTEXT), range(8)))
        self.assertEqual(peak, 1)
        self.assertEqual(len({result.content for result in results}), 1)

    def test_png_profile_and_text_metadata_are_removed_without_pixel_loss(self):
        picture = Image.new("RGB", (96, 64), (45, 85, 190))
        info = PngImagePlugin.PngInfo()
        info.add_itxt("XML:com.adobe.xmp", xmp_packet().decode())
        info.add_text("Comment", "SYNTHETIC_SERIAL_EXCLUDE")
        stream = io.BytesIO()
        picture.save(stream, format="PNG", pnginfo=info,
                     icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
        result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
        with Image.open(io.BytesIO(result.content)) as stored:
            self.assertEqual(picture.tobytes(), stored.tobytes())
            self.assertNotIn("Comment", stored.info)
        self.assertEqual(result.suggestions["values"]["caption"], "SYNTHETIC caption")
        self.assert_private_removed(result)

    def test_sixteen_bit_gray_png_jpeg_conversion_preserves_intensity(self):
        samples = (0, 4609, 32768, 65535)
        row = b"".join(struct.pack("<H", sample) * 32 for sample in samples)
        picture = Image.frombytes("I;16", (128, 32), row * 32)
        stream = io.BytesIO()
        picture.save(stream, format="PNG")
        with Image.open(io.BytesIO(stream.getvalue())) as before:
            self.assertEqual(tuple(before.getpixel((x * 32 + 16, 16)) for x in range(4)), samples)
        # Actual 4 MiB boundary is covered by the real-size PNG fixtures. Lower
        # only that encoding threshold here to isolate 16-bit color conversion.
        with patch.object(pipeline, "MIB", 1):
            result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
        self.assertEqual(result.mime_type, "image/jpeg")
        self.assertEqual(result.processing["quality"], 90)
        with Image.open(io.BytesIO(result.content)) as stored:
            for x, expected in enumerate((0, 18, 128, 255)):
                pixel = stored.convert("L").getpixel((x * 32 + 16, 16))
                self.assertLessEqual(abs(pixel - expected), 2)
        self.assert_private_removed(result)

    def test_large_opaque_alpha_channel_png_uses_jpeg_exception(self):
        content, _ = raster_fixture("PNG", (1200, 1200), noise=True)
        with Image.open(io.BytesIO(content)) as picture:
            rgba = picture.convert("RGBA")
            self.assertEqual(rgba.getchannel("A").getextrema(), (255, 255))
            stream = io.BytesIO()
            rgba.save(stream, format="PNG", optimize=True)
        content = stream.getvalue()
        self.assertGreater(len(content), 4 * pipeline.MIB)
        result = pipeline.optimize_image(content, "image/png", CONTEXT)
        self.assertEqual(result.mime_type, "image/jpeg")
        self.assertEqual(result.processing["quality"], 90)
        self.assertEqual((result.width, result.height), (1200, 1200))
        self.assert_private_removed(result)


    def test_sixteen_bit_opaque_alpha_png_uses_jpeg_exception_for_every_filter_and_pass(self):
        for color_type in (4, 6):
            for interlaced in (False, True):
                for filter_type in (0, 1, 2, 3, 4, None):
                    with self.subTest(color_type=color_type, interlaced=interlaced, filter_type=filter_type):
                        content, _ = png_sixteen_bit_alpha_fixture(color_type=color_type,
                            interlaced=interlaced, filter_type=filter_type)
                        with Image.open(io.BytesIO(content)) as source:
                            self.assertEqual(source.convert('RGBA').getchannel('A').getextrema(), (255, 255))
                        # Isolate the format decision with small synthetic pixels.
                        # Real 4 MiB fixtures remain in the separate serial queue.
                        with patch.object(pipeline, 'MIB', 1):
                            result = pipeline.optimize_image(content, 'image/png', CONTEXT)
                        self.assertEqual(result.mime_type, 'image/jpeg')
                        self.assertEqual(result.processing['quality'], 90)
                        self.assertEqual((result.width, result.height), (17, 9))
                        with Image.open(io.BytesIO(result.content)) as stored:
                            expected = (18, 18, 18) if color_type == 4 else (18, 128, 254)
                            for actual, target in zip(stored.convert('RGB').getpixel((8, 4)), expected):
                                self.assertLessEqual(abs(actual - target), 3)
                        self.assert_private_removed(result)

    def test_sixteen_bit_partial_alpha_keeps_exact_png_samples_including_low_byte(self):
        for color_type in (4, 6):
            for interlaced in (False, True):
                for filter_type in (0, 1, 2, 3, 4, None):
                    for alpha in (65534, 65280, 0):
                        with self.subTest(color_type=color_type, interlaced=interlaced, filter_type=filter_type, alpha=alpha):
                            content, samples = png_sixteen_bit_alpha_fixture(color_type=color_type,
                                interlaced=interlaced, filter_type=filter_type, last_alpha=alpha)
                            with patch.object(pipeline, 'MIB', 1):
                                result = pipeline.optimize_image(content, 'image/png', CONTEXT)
                            self.assertEqual(result.mime_type, 'image/png')
                            chunks = dict(pipeline._png_chunks(result.content))
                            self.assertEqual(zlib.decompress(chunks[b'IDAT']), samples)
                            self.assertEqual(chunks[b'IHDR'][8:10], bytes((16, color_type)))
                            self.assertIsNone(result.processing['quality'])
                            self.assert_private_removed(result)

    def test_sixteen_bit_alpha_small_and_exact_size_boundary_remain_lossless(self):
        for size in ((1, 1), (1, 9), (9, 1), (17, 9)):
            for interlaced in (False, True):
                with self.subTest(size=size, interlaced=interlaced):
                    content, samples = png_sixteen_bit_alpha_fixture(size=size, interlaced=interlaced,
                        filter_type=None)
                    original = pipeline.optimize_image(content, 'image/png', CONTEXT)
                    self.assertEqual(original.mime_type, 'image/png')
                    self.assertEqual(zlib.decompress(dict(pipeline._png_chunks(original.content))[b'IDAT']), samples)
                    with patch.object(pipeline, 'MIB', len(original.content) / 4):
                        boundary = pipeline.optimize_image(content, 'image/png', CONTEXT)
                    self.assertEqual(boundary.content, original.content)
                    with patch.object(pipeline, 'MIB', (len(original.content) - 1) / 4):
                        above = pipeline.optimize_image(content, 'image/png', CONTEXT)
                    self.assertEqual(above.mime_type, 'image/jpeg')
                    self.assertEqual((above.width, above.height), size)

    def test_png_transparent_color_key_survives_metadata_stripping(self):
        for mode, color, transparency in (("RGB", (45, 85, 190), (45, 85, 190)), ("L", 80, 80)):
            picture = Image.new(mode, (96, 64), color)
            stream = io.BytesIO()
            picture.save(stream, format="PNG", transparency=transparency)
            result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
            with Image.open(io.BytesIO(stream.getvalue())) as before, Image.open(io.BytesIO(result.content)) as after:
                self.assertEqual(before.convert("RGBA").tobytes(), after.convert("RGBA").tobytes())

    def test_png_linear_gamma_and_display_p3_convert_to_srgb_without_touching_alpha(self):
        def process(chunks, color=(128, 64, 32, 111), profile=None):
            picture = Image.new("RGBA", (2, 1), color)
            info = PngImagePlugin.PngInfo()
            for name, value in chunks:
                info.add(name, value)
            stream = io.BytesIO()
            picture.save(stream, format="PNG", pnginfo=info, icc_profile=profile)
            result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
            self.assert_private_removed(result)
            with Image.open(io.BytesIO(result.content)) as stored:
                return stored.getpixel((0, 0))
        # Independently known sRGB encoding of linear 8-bit samples.
        self.assertEqual(process([(b"gAMA", struct.pack(">I", 100000))]), (188, 137, 99, 111))
        # Display P3 uses the sRGB curve with wider primaries; alpha is linear.
        result = process([(b"cICP", bytes((12, 13, 0, 1)))])
        for actual, expected in zip(result, (138, 59, 21, 111)):
            self.assertLessEqual(abs(actual - expected), 1)
        # An understood cICP description has priority over a conflicting ICC.
        self.assertEqual(result, process([(b"cICP", bytes((12, 13, 0, 1)))],
            profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()))
        # cHRM with the same primaries and the inherited sRGB transfer agrees.
        chrm = struct.pack(">8I", 31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000)
        self.assertEqual(result, process([(b"cHRM", chrm)]))
        # sRGB takes precedence over lower-priority gAMA; no sample change.
        self.assertEqual(process([(b"sRGB", b"\0"), (b"gAMA", struct.pack(">I", 100000))]), (128, 64, 32, 111))

    def test_png_gamma_only_grayscale_and_invalid_color_descriptions(self):
        picture = Image.new("L", (2, 1), 128)
        info = PngImagePlugin.PngInfo()
        info.add(b"gAMA", struct.pack(">I", 100000))
        stream = io.BytesIO()
        picture.save(stream, format="PNG", pnginfo=info)
        result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
        with Image.open(io.BytesIO(result.content)) as stored:
            self.assertEqual(stored.getpixel((0, 0)), (188, 188, 188))
        for chromaticity, gamma in ((None, 0), (None, float("nan")),
                                    ((.3127, .329, .64, .33, .64, .33, .64, .33), None)):
            with self.subTest(chromaticity=chromaticity, gamma=gamma):
                with self.assertRaisesRegex(pipeline.UploadProcessingError, "^invalid_color_profile$"):
                    pipeline._png_sdr_profile(chromaticity, gamma)

    def test_png_high_bit_depth_samples_survive_metadata_only_processing(self):
        def chunk(kind, payload):
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
        for color, samples in ((2, (0x1201, 0x3402, 0x5603, 0x12FE, 0x34FD, 0x56FC)),
                               (6, (0x1201, 0x3402, 0x5603, 0x7804, 0x12FE, 0x34FD, 0x56FC, 0x78FB))):
            raw = b"\0" + struct.pack(">" + "H" * len(samples), *samples)
            header = struct.pack(">IIBBBBB", 2, 1, 16, color, 0, 0, 0)
            content = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            content += chunk(b"tEXt", b"Comment\0SYNTHETIC_SERIAL_EXCLUDE")
            content += chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
            result = pipeline.optimize_image(content, "image/png", CONTEXT)
            output = dict(pipeline._png_chunks(result.content))
            self.assertEqual(output[b"IHDR"], header)
            self.assertEqual(zlib.decompress(output[b"IDAT"]), raw)
            self.assertNotIn(b"tEXt", output)
            self.assertNotIn(b"SYNTHETIC_SERIAL_EXCLUDE", result.content)

    def test_supported_sixteen_bit_grayscale_resize_preserves_precision(self):
        picture = Image.new("I;16", (6000, 1), 4609)
        stream = io.BytesIO()
        picture.save(stream, format="PNG")
        result = pipeline.optimize_image(stream.getvalue(), "image/png", CONTEXT)
        with Image.open(io.BytesIO(result.content)) as stored:
            self.assertEqual(stored.size, (4096, 1))
            self.assertEqual(stored.mode, "I;16")
            self.assertEqual(stored.getpixel((0, 0)), 4609)

    def test_webp_exif_xmp_and_unknown_offset_date(self):
        source, _ = jpeg_fixture(xmp=True, offset=None)
        with Image.open(io.BytesIO(source)) as picture:
            stream = io.BytesIO()
            picture.save(stream, format="WEBP", exif=picture.info["exif"],
                         xmp=picture.info["xmp"], lossless=True)
        result = pipeline.optimize_image(stream.getvalue(), "image/webp", CONTEXT)
        self.assertEqual((result.width, result.height), (64, 96))
        self.assertFalse(result.suggestions["values"]["taken_at"]["offset_known"])
        self.assertEqual(result.suggestions["values"]["caption"], "SYNTHETIC caption")
        self.assert_private_removed(result)

    def test_xmp_capture_date_attribute_and_element_keep_actual_offset(self):
        namespace = "http://ns.adobe.com/xap/1.0/"
        for date in ("2026-01-02T03:04:05+07:00", "2026-01-02T03:04:05"):
            for mode in ("attribute", "element"):
                content = (f'<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="{namespace}" xmp:CreateDate="{date}"/>' if mode == "attribute"
                           else f'<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="{namespace}"><xmp:CreateDate>{date}</xmp:CreateDate></rdf:Description>')
                parsed = pipeline._capture_date({}, pipeline._xmp_fields(content.encode()))
                self.assertEqual(parsed, {"value": date, "offset_known": "+" in date})

    def test_c2pa_store_presence_is_unconfirmed_render_signal_and_is_stripped(self):
        def box(kind, payload):
            return struct.pack(">I", len(payload) + 8) + kind + payload
        # A structural store header tests presence, not signed authenticity.
        description = bytes.fromhex("6332706100110010800000aa00389b71") + b"\x03c2pa\x00"
        store = box(b"jumb", box(b"jumd", description))
        for format, mime in (("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")):
            with self.subTest(format=format):
                source, _ = raster_fixture(format)
                if format == "JPEG":
                    payload = b"JP\x00\x01\x00\x00\x00\x01" + store
                    content = source[:2] + b"\xff\xeb" + struct.pack(">H", len(payload) + 2) + payload + source[2:]
                elif format == "PNG":
                    chunk = struct.pack(">I", len(store)) + b"caBX" + store + struct.pack(">I", zlib.crc32(b"caBX" + store))
                    content = source[:33] + chunk + source[33:]
                else:
                    chunk = b"C2PA" + struct.pack("<I", len(store)) + store + (b"\0" if len(store) % 2 else b"")
                    content = source[:4] + struct.pack("<I", len(source) + len(chunk) - 8) + source[8:] + chunk
                result = pipeline.optimize_image(content, mime, CONTEXT)
                self.assertEqual(result.suggestions["values"]["image_kind"], "render")
                self.assertNotIn(store, result.content)
                self.assert_private_removed(result)
        self.assertFalse(pipeline._jumbf_store(store.replace(b"c2pa\0", b"fake\0")))
        extended = struct.pack(">I4sQ", 1, b"jumb", len(store) + 8) + store[8:]
        self.assertTrue(pipeline._jumbf_store(extended))
        source, _ = raster_fixture("JPEG")
        pieces = (extended[:19], extended[19:])
        markers = b""
        for sequence, piece in enumerate(pieces, 1):
            payload = b"JP\x00\x01" + struct.pack(">I", sequence) + piece
            markers += b"\xff\xeb" + struct.pack(">H", len(payload) + 2) + payload
        result = pipeline.optimize_image(source[:2] + markers + source[2:], "image/jpeg", CONTEXT)
        self.assertEqual(result.suggestions["values"]["image_kind"], "render")

    def test_input_and_output_limits_use_distinct_error_codes(self):
        content, _ = raster_fixture()
        with patch.object(pipeline, "IMAGE_INPUT_BYTES", len(content) - 1):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_input_too_large$"):
                pipeline.optimize_image(content, "image/png", CONTEXT)

    def test_library_diagnostics_cannot_log_private_metadata(self):
        content, _ = raster_fixture()
        encode = pipeline._strip_png_metadata
        def diagnostic(*args, **kwargs):
            logging.getLogger("pypdf.synthetic_late_logger").warning("untrusted %s", EXCLUDED["serial"])
            return encode(*args, **kwargs)
        with self.assertLogs("pypdf.synthetic_late_logger", level="WARNING") as captured:
            with patch.object(pipeline, "_strip_png_metadata", diagnostic):
                pipeline.optimize_image(content, "image/png", CONTEXT)
            logging.getLogger("pypdf.synthetic_late_logger").warning("ordinary diagnostic after processing")
        self.assertNotIn(EXCLUDED["serial"], " ".join(captured.output))
        self.assertIn("Private upload decoder diagnostic suppressed", captured.output[0])
        self.assertIn("ordinary diagnostic after processing", captured.output[1])
        with patch.object(pipeline, "IMAGE_OUTPUT_BYTES", 1):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_output_too_large$"):
                pipeline.optimize_image(content, "image/png", CONTEXT)

    def test_repeated_module_reload_keeps_suppression_and_preexisting_factory(self):
        import importlib
        original_factory = logging.getLogRecordFactory()
        def app_factory(*args, **kwargs):
            record = original_factory(*args, **kwargs)
            record.app_preexisting = True
            return record
        logging.setLogRecordFactory(app_factory)
        try:
            importlib.reload(pipeline)
            wrapper = logging.getLogRecordFactory()
            for _ in range(2):
                importlib.reload(pipeline)
                # Repeated reload must not chain one suppression wrapper per reload.
                self.assertIs(logging.getLogRecordFactory(), wrapper)
            content, _ = raster_fixture()
            encode = pipeline._strip_png_metadata
            def diagnostic(*args, **kwargs):
                logging.getLogger("pypdf.synthetic_reload_logger").warning("untrusted %s", EXCLUDED["serial"])
                importlib.reload(pipeline)
                # The reload happens while the private decoding context is
                # active: suppression continues and the context exits cleanly.
                logging.getLogger("pypdf.synthetic_reload_logger").warning("still untrusted %s", EXCLUDED["serial"])
                self.assertTrue(pipeline._PRIVATE_DECODING.get())
                self.assertTrue(pipeline.IMAGE_PROCESSING_LOCK.locked())
                return encode(*args, **kwargs)
            with self.assertLogs("pypdf.synthetic_reload_logger", level="WARNING") as captured:
                with patch.object(pipeline, "_strip_png_metadata", diagnostic):
                    pipeline.optimize_image(content, "image/png", CONTEXT)
                logging.getLogger("pypdf.synthetic_reload_logger").warning("ordinary diagnostic after reload")
            self.assertFalse(pipeline._PRIVATE_DECODING.get())
            self.assertIs(logging.getLogRecordFactory(), wrapper)
            self.assertNotIn(EXCLUDED["serial"], " ".join(captured.output))
            self.assertEqual([record.getMessage() for record in captured.records], [
                "Private upload decoder diagnostic suppressed",
                "Private upload decoder diagnostic suppressed",
                "ordinary diagnostic after reload"])
            self.assertTrue(all(getattr(record, "app_preexisting", False) for record in captured.records))
        finally:
            logging.setLogRecordFactory(original_factory)

    def test_concurrent_unrelated_logging_and_record_factory_remain_intact(self):
        original_factory = logging.getLogRecordFactory()
        def app_factory(*args, **kwargs):
            record = original_factory(*args, **kwargs)
            record.app_preexisting = True
            return record
        logging.setLogRecordFactory(app_factory)
        try:
            content, _ = raster_fixture()
            unrelated = logging.getLogger("sena_hub.unrelated_application")
            decoder_named = logging.getLogger("PIL.synthetic_probe_logger")
            application_records_emitted = threading.Event()
            decode_started = threading.Event()
            def background():
                if not decode_started.wait(5):
                    return
                unrelated.warning("app event %s", "unchanged")
                decoder_named.warning("app-side diagnostic %s", "intact")
                application_records_emitted.set()
            encode = pipeline._strip_png_metadata
            def diagnostic(*args, **kwargs):
                # Both application records were created while the decoding
                # context is active in this thread; the event handshake makes
                # the overlap deterministic without sleeping or polling.
                decode_started.set()
                self.assertTrue(application_records_emitted.wait(5))
                unrelated.warning("decode-side application diagnostic")
                decoder_named.warning("decode path %s", EXCLUDED["serial"])
                return encode(*args, **kwargs)
            with self.assertLogs(unrelated, level="WARNING") as app_captured, \
                    self.assertLogs(decoder_named, level="WARNING") as probe_captured:
                thread = threading.Thread(target=background)
                thread.start()
                try:
                    with patch.object(pipeline, "_strip_png_metadata", diagnostic):
                        pipeline.optimize_image(content, "image/png", CONTEXT)
                finally:
                    decode_started.set()
                    thread.join(5)
                self.assertFalse(thread.is_alive())
                self.assertFalse(pipeline._PRIVATE_DECODING.get())
                # A failing decode must also leave no decoding context behind.
                with patch.object(pipeline, "IMAGE_OUTPUT_BYTES", 1):
                    with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_output_too_large$"):
                        pipeline.optimize_image(content, "image/png", CONTEXT)
                self.assertFalse(pipeline._PRIVATE_DECODING.get())
                unrelated.warning("post-processing app diagnostic")
                decoder_named.warning("post-processing probe diagnostic")
            self.assertNotIn(EXCLUDED["serial"], " ".join(probe_captured.output))
            self.assertEqual([record.getMessage() for record in probe_captured.records], [
                "app-side diagnostic intact",
                "Private upload decoder diagnostic suppressed",
                "post-processing probe diagnostic"])
            self.assertEqual([record.getMessage() for record in app_captured.records],
                             ["app event unchanged", "decode-side application diagnostic",
                              "post-processing app diagnostic"])
            for record in (*app_captured.records, *probe_captured.records):
                self.assertTrue(getattr(record, "app_preexisting", False))
        finally:
            logging.setLogRecordFactory(original_factory)


class SmallPdfChecks(unittest.TestCase):
    def assert_nonlegal_private(self, result, values):
        reader = PdfReader(io.BytesIO(result.content))
        self.assertFalse(reader.metadata)
        self.assertNotIn("/Prev", reader.trailer)
        self.assertNotIn(b"/Metadata", result.content)
        self.assertEqual(result.suggestions, {"source": "file_metadata", "pipeline_version": pipeline.PIPELINE_VERSION,
                                             "confirmed": False, "values": values})
        self.assertEqual(result.processing["pipeline_version"], pipeline.PIPELINE_VERSION)
        self.assertTrue(result.processing["metadata_stripped"])
        for text in [*EXCLUDED.values(), "SYNTHETIC_AUTHOR_EXCLUDE", "SYNTHETIC_CREATOR_EXCLUDE",
                     "SYNTHETIC_PRODUCER_EXCLUDE"]:
            self.assertNotIn(text, json.dumps(result.suggestions))
            self.assertNotIn(text.encode(), result.content)
            # pypdf escapes underscores in literal Info strings.
            self.assertNotIn(text.replace("_", "\\137").encode(), result.content)

    def test_nonlegal_page_thumbnail_removed_and_legal_bytes_preserved(self):
        content, _ = pdf_fixture(metadata=False)
        writer = PdfWriter(io.BytesIO(content))
        preview = DecodedStreamObject()
        pixels = b"SYNTHETIC_PRIVATE_PAGE_THUMBNAIL"
        preview.set_data(pixels)
        preview.update({NameObject("/Type"): NameObject("/XObject"),
                        NameObject("/Subtype"): NameObject("/Image"),
                        NameObject("/Width"): NumberObject(len(pixels)),
                        NameObject("/Height"): NumberObject(1),
                        NameObject("/ColorSpace"): NameObject("/DeviceGray"),
                        NameObject("/BitsPerComponent"): NumberObject(8)})
        writer.pages[0][NameObject("/Thumb")] = writer._add_object(preview)
        stream = io.BytesIO()
        writer.write(stream)
        content = stream.getvalue()
        before = PdfReader(io.BytesIO(content))
        self.assertEqual(before.pages[0]["/Thumb"].get_data(), pixels)
        expected_text = before.pages[0].extract_text()
        result = pipeline.optimize_pdf(content, CONTEXT)
        after = PdfReader(io.BytesIO(result.content))
        self.assertNotIn("/Thumb", after.pages[0])
        self.assertNotIn(pixels, result.content)
        self.assertEqual(len(after.pages), 1)
        self.assertEqual(after.pages[0].extract_text(), expected_text)
        self.assert_nonlegal_private(result, {})
        for context in (pipeline.UploadContext(category="legal_document"),
                        pipeline.UploadContext(category="exterior", disclosure_evidence=True),
                        pipeline.UploadContext()):
            legal = pipeline.optimize_pdf(content, context)
            self.assertEqual(legal.content, content)
            self.assertFalse(legal.suggestions)

    def test_pdf_high_bit_depth_pixels_are_not_reinterpreted_by_image_extraction(self):
        content, _ = pdf_fixture(embedded_raster=True, raster_size=(2, 1))
        writer = PdfWriter(io.BytesIO(content))
        item = writer.pages[0]["/Resources"]["/XObject"]["/Im0"]
        samples = struct.pack(">6H", 0x1201, 0x3402, 0x5603, 0x12FE, 0x34FD, 0x56FC)
        item._data = samples
        item.pop("/Filter", None)
        item[NameObject("/BitsPerComponent")] = NumberObject(16)
        stream = io.BytesIO()
        writer.write(stream)
        result = pipeline.optimize_pdf(stream.getvalue(), CONTEXT)
        after = PdfReader(io.BytesIO(result.content))
        image = after.pages[0]["/Resources"]["/XObject"]["/Im0"]
        self.assertEqual(image["/BitsPerComponent"], 16)
        self.assertEqual(image.get_data(), samples)
        self.assertFalse(result.processing["pdf_images_recompressed"])

    def test_metadata_only_pdf_rewrite_preserves_rendered_page(self):
        def pixels(content):
            with pdfium.PdfDocument(content) as document:
                page = document[0]
                try:
                    bitmap = page.render(scale=1)
                    try:
                        image = bitmap.to_pil()
                        return image.size, image.tobytes()
                    finally:
                        bitmap.close()
                finally:
                    page.close()
        for placement in ("direct", "form", "inline"):
            with self.subTest(placement=placement):
                content, _ = pdf_metadata_image_fixture(placement=placement)
                result = pipeline.optimize_pdf(content, CONTEXT)
                self.assertEqual(pixels(content), pixels(result.content))

    def test_metadata_inside_direct_nested_and_inline_images_is_removed(self):
        for placement in ("direct", "form", "inline"):
            with self.subTest(placement=placement):
                content, expected = pdf_metadata_image_fixture(placement=placement)
                result = pipeline.optimize_pdf(content, CONTEXT)
                before, after = PdfReader(io.BytesIO(content)), PdfReader(io.BytesIO(result.content))
                original_jpeg = fixture_pdf_jpeg(before, placement)
                self.assertEqual(hashlib.sha256(original_jpeg).hexdigest(), expected["main_jpeg_checksum"])
                preview = fixture_thumbnail(original_jpeg)
                self.assertEqual(hashlib.sha256(preview).hexdigest(), expected["thumbnail_checksum"])
                self.assert_nonlegal_private(result, {})
                self.assertEqual(before.pages[0].extract_text(), after.pages[0].extract_text())
                self.assertEqual(before.pages[0].images[0].image.tobytes(), after.pages[0].images[0].image.tobytes())
                self.assertFalse(after.pages[0].images[0].image.getexif())
                self.assertNotIn("xmp", after.pages[0].images[0].image.info)
                self.assertNotIn("photoshop", after.pages[0].images[0].image.info)
                self.assertNotIn(preview, result.content)
                # pypdf's high-level image.data is re-encoded on extraction;
                # inspect the actual retained JPEG stream independently.
                with Image.open(io.BytesIO(fixture_pdf_jpeg(after, placement))) as stored:
                    self.assertFalse(stored.getexif())
                    self.assertNotIn("xmp", stored.info)
                    self.assertNotIn("photoshop", stored.info)
                for text in EXCLUDED.values():
                    self.assertNotIn(text.encode(), result.content)
                self.assertFalse(result.processing["pdf_images_recompressed"])

    def test_nonlegal_metadata_removed_even_without_recompression_gain(self):
        for builder in (pdf_fixture, pdf_incremental_fixture, pdf_nested_metadata_fixture):
            with self.subTest(builder=builder.__name__):
                content, expected = builder(pages=2)
                before = PdfReader(io.BytesIO(content))
                self.assertEqual(len(before.pages), 2)
                if builder is pdf_incremental_fixture:
                    # Incremental writers emit /Prev in an xref stream, which
                    # PdfReader does not copy into its normalized trailer.
                    revision = io.BytesIO(content)
                    revision.seek(before._startxref)
                    header = re.match(rb"\d+\s+\d+\s+obj\s*", content[before._startxref:])
                    self.assertIsNotNone(header)
                    revision.seek(before._startxref + header.end())
                    xref = read_object(revision, before)
                    self.assertEqual(xref["/Type"], "/XRef")
                    base = content[:expected["base_revision_size"]]
                    previous = PdfReader(io.BytesIO(base))
                    self.assertNotIn("/Prev", previous.trailer)
                    self.assertEqual(xref["/Prev"], previous._startxref)
                    self.assertEqual(previous.metadata["/Author"], expected["old_revision_sentinel"])
                    self.assertEqual(before.metadata["/Author"], expected["current_revision_sentinel"])
                    for key in ("old_revision_sentinel", "current_revision_sentinel"):
                        self.assertIn(expected[key].encode(), content)
                    self.assertEqual([p.extract_text() for p in previous.pages],
                                     [p.extract_text() for p in before.pages])
                if builder is pdf_nested_metadata_fixture:
                    self.assertIn("/Metadata", before.trailer["/Root"])
                    for page in before.pages:
                        for target, key in ((page, "page"),
                                            (page["/Resources"]["/XObject"]["/Im0"], "resource")):
                            metadata = target["/Metadata"]
                            self.assertEqual(metadata["/Type"], "/Metadata")
                            self.assertEqual(metadata["/Subtype"], "/XML")
                            xml = ElementTree.fromstring(metadata.get_data())
                            self.assertIn(expected["nested_xmp_sentinels"][key], list(xml.itertext()))
                result = pipeline.optimize_pdf(content, CONTEXT)
                self.assert_nonlegal_private(result, {"caption": "SYNTHETIC document caption"})
                before, after = PdfReader(io.BytesIO(content)), PdfReader(io.BytesIO(result.content))
                self.assertEqual(len(after.pages), 2)
                self.assertEqual([p.extract_text() for p in before.pages], [p.extract_text() for p in after.pages])
                self.assertFalse(after.metadata)
                self.assertNotIn("/Prev", after.trailer)
                self.assertNotIn(b"/Prev", result.content)
                self.assertTrue(result.processing["metadata_stripped"])
                self.assertFalse(result.processing["pdf_images_recompressed"])
                self.assertFalse(result.processing["kept_original_because_no_gain"])
                self.assertTrue(result.processing["kept_image_encoding_because_no_gain"])
                self.assertNotEqual(result.content, content)
                self.assertEqual(result.suggestions["values"], {"caption": "SYNTHETIC document caption"})
                self.assertFalse(result.suggestions["confirmed"])
                for item in pipeline._pdf_objects(after.trailer):
                    if isinstance(item, dict):
                        self.assertNotIn("/Metadata", item)
                all_output = result.content + json.dumps(result.suggestions).encode()
                for excluded in [*EXCLUDED.values(), "SYNTHETIC_AUTHOR_EXCLUDE", "SYNTHETIC_CREATOR_EXCLUDE",
                                 "SYNTHETIC_PRODUCER_EXCLUDE", *expected.get("nested_xmp_sentinels", {}).values(),
                                 expected.get("old_revision_sentinel", "SYNTHETIC_ABSENT"),
                                 expected.get("current_revision_sentinel", "SYNTHETIC_ABSENT")]:
                    self.assertNotIn(excluded.encode(), all_output)

    def test_legal_unknown_and_disclosure_are_byte_exact(self):
        content, _ = pdf_incremental_fixture()
        for context in (pipeline.UploadContext(), pipeline.UploadContext(category="legal_document"),
                        pipeline.UploadContext(category="brochure", disclosure_evidence=True)):
            result = pipeline.optimize_pdf(content, context)
            self.assertEqual(result.content, content)
            self.assertEqual(result.suggestions, {})
            self.assertFalse(result.processing["metadata_stripped"])

    def test_unsupported_metadata_safe_rewrite_is_rejected(self):
        content, _ = pdf_unsupported_rewrite_fixture()
        reader = PdfReader(io.BytesIO(content))
        self.assertEqual(reader.metadata["/Title"], "SYNTHETIC document caption")
        self.assertIn("/Metadata", reader.trailer["/Root"])
        image = reader.pages[0]["/Resources"]["/XObject"]["/Im0"]
        self.assertEqual(image["/Filter"], "/JPXDecode")
        with Image.open(io.BytesIO(image.get_data())) as source:
            self.assertEqual(source.format, "JPEG2000")
            self.assertEqual(source.size, (8, 6))
            source.load()
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^pdf_reexport_required$"):
            pipeline.optimize_pdf(content, CONTEXT)
        self.assertEqual(pipeline.optimize_pdf(content, pipeline.UploadContext(
            category="legal_document")).content, content)

    def test_active_input_rejected_for_marketing_and_legal(self):
        content, _ = pdf_fixture(active=True)
        for context in (CONTEXT, pipeline.UploadContext(category="legal_document")):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^pdf_reexport_required$"):
                pipeline.optimize_pdf(content, context)

    def test_brochure_recompression_preserves_text_and_at_least_twenty_percent_gain(self):
        content, _ = pdf_fixture(embedded_raster=True, raster_size=(1024, 768))
        result = pipeline.optimize_pdf(content, CONTEXT)
        self.assert_nonlegal_private(result, {"caption": "SYNTHETIC document caption"})
        self.assertTrue(result.processing["pdf_images_recompressed"])
        self.assertLessEqual(len(result.content), len(content) * 0.8)
        before, after = PdfReader(io.BytesIO(content)), PdfReader(io.BytesIO(result.content))
        self.assertEqual(after.pages[0].extract_text(), before.pages[0].extract_text())
        image = after.pages[0].images[0].image
        self.assertLessEqual(image.width, 534)
        self.assertLessEqual(image.height, 356)

    def test_embedded_jpeg_metadata_stripping_preserves_exact_pixels(self):
        content, _ = jpeg_thumbnail_fixture(xmp=True, iptc=True)
        stripped = pipeline._strip_jpeg_metadata(content)
        with Image.open(io.BytesIO(content)) as before, Image.open(io.BytesIO(stripped)) as after:
            self.assertEqual(before.tobytes(), after.tobytes())
            self.assertFalse(after.getexif())
            self.assertNotIn("xmp", after.info)
            self.assertNotIn("photoshop", after.info)
        for text in EXCLUDED.values():
            self.assertNotIn(text.encode(), stripped)


class LargeUploadChecks(unittest.TestCase):
    """Run in the lead's serial lane; fixtures intentionally allocate real pixels."""
    def test_large_oriented_jpeg_resized_to_4096_and_gps_removed(self):
        content, _ = jpeg_fixture(size=(6000, 4000), orientation=6, xmp=True, iptc=True)
        result = pipeline.optimize_image(content, "image/jpeg", CONTEXT)
        self.assertEqual((result.width, result.height), (2731, 4096))
        self.assertEqual((result.original["width"], result.original["height"]), (6000, 4000))
        self.assertEqual(result.processing["quality"], 85)
        self.assertLessEqual(len(result.content), 10 * 1024 * 1024)
        SmallImageChecks().assert_private_removed(result)

    def test_large_opaque_png_converts_to_jpeg_but_transparent_png_stays_lossless(self):
        for transparent in (False, True):
            with self.subTest(transparent=transparent):
                content, _ = raster_fixture("PNG", (1800, 1200), noise=True, transparent=transparent)
                self.assertGreater(len(content), 4 * 1024 * 1024)
                result = pipeline.optimize_image(content, "image/png", CONTEXT)
                self.assertEqual(result.mime_type, "image/png" if transparent else "image/jpeg")
                if transparent:
                    with Image.open(io.BytesIO(content)) as before, Image.open(io.BytesIO(result.content)) as after:
                        self.assertEqual(before.tobytes(), after.tobytes())
                else:
                    self.assertEqual(result.processing["quality"], 90)


    def test_real_size_sixteen_bit_alpha_png_fallback_keeps_partial_alpha_lossless(self):
        for alpha in (65535, 65534):
            with self.subTest(alpha=alpha):
                content, samples = png_sixteen_bit_alpha_fixture(size=(1000, 800),
                    last_alpha=alpha, noise=True)
                self.assertGreater(len(content), 4 * 1024 * 1024)
                self.assertLess(len(content), pipeline.IMAGE_INPUT_BYTES)
                result = pipeline.optimize_image(content, 'image/png', CONTEXT)
                self.assertEqual((result.width, result.height), (1000, 800))
                self.assertLessEqual(len(result.content), pipeline.IMAGE_OUTPUT_BYTES)
                if alpha == 65535:
                    self.assertEqual(result.mime_type, 'image/jpeg')
                    self.assertEqual(result.processing['quality'], 90)
                else:
                    self.assertEqual(result.mime_type, 'image/png')
                    self.assertGreater(len(result.content), 4 * 1024 * 1024)
                    chunks = dict(pipeline._png_chunks(result.content))
                    self.assertEqual(zlib.decompress(chunks[b'IDAT']), samples)
                SmallImageChecks().assert_private_removed(result)

    def test_uncompressible_transparent_output_over_ten_mebibytes_is_rejected(self):
        content, _ = raster_fixture("PNG", (2200, 1800), noise=True, transparent=True)
        self.assertLessEqual(len(content), 30 * 1024 * 1024)
        self.assertGreater(len(content), 10 * 1024 * 1024)
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_output_too_large$"):
            pipeline.optimize_image(content, "image/png", CONTEXT)

    def test_real_byte_limits_reject_before_decoding(self):
        for mime, size, context, error in (
            ("image/png", 30 * 1024 * 1024 + 1, CONTEXT, "image_input_too_large"),
            ("application/pdf", 50 * 1024 * 1024 + 1, CONTEXT, "pdf_input_too_large"),
            ("application/pdf", 10 * 1024 * 1024 + 1, pipeline.UploadContext(), "legal_input_too_large"),
        ):
            content = b"x" * size
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^" + error + "$"):
                if mime == "application/pdf":
                    pipeline.optimize_pdf(content, context)
                else:
                    pipeline.optimize_image(content, mime, context)



class ReuseSuggestionChecks(unittest.TestCase):
    def extract(self, content, mime, context=CONTEXT):
        return pipeline.extract_reused_suggestions(content, mime, context, hashlib.sha256(content).hexdigest())

    def test_same_original_recomputes_context_without_encoding_or_retaining_private_metadata(self):
        content, _ = jpeg_fixture(xmp=True, iptc=True, stock=True)
        original = hashlib.sha256(content).hexdigest()
        with patch.object(Image.Image, "save", side_effect=AssertionError("must not encode")):
            for coordinates, expected in [((0, 0), "near"), ((1, 1), "far"), (None, "unknown")]:
                result = self.extract(content, "image/jpeg", pipeline.UploadContext(category="exterior", project_coordinates=coordinates))
                self.assertEqual(result["values"]["proximity"], expected)
                self.assertFalse(result["confirmed"])
                self.assertEqual(result["source"], "file_metadata")
                encoded = json.dumps(result)
                for excluded in [*EXCLUDED.values(), "SYNTHETIC_LENS_SERIAL_EXCLUDE"]:
                    self.assertNotIn(excluded, encoded)
                self.assertNotIn("coordinates", encoded)
                self.assertNotIn("distance", encoded)
        self.assertEqual(hashlib.sha256(content).hexdigest(), original)

    def test_reuse_reports_current_extraction_version_and_revalidates_active_tags(self):
        content, _ = jpeg_fixture(xmp=True, iptc=True)
        with patch.object(pipeline, "PIPELINE_VERSION", "synthetic-next-pipeline"), patch.object(pipeline, "_encode", side_effect=AssertionError("must not encode")):
            active = self.extract(content, "image/jpeg")
            retired = self.extract(content, "image/jpeg", pipeline.UploadContext(category="exterior"))
        self.assertEqual(active["pipeline_version"], "synthetic-next-pipeline")
        self.assertEqual(active["values"]["tags"], ["active-tag-id"])
        self.assertNotIn("tags", retired["values"])
        self.assertIn("SYNTHETIC_TAG", retired["values"]["unmapped_keywords"])

    def test_reuse_checksum_and_byte_limits_reject_before_decoding(self):
        content, _ = raster_fixture()
        with patch.object(Image, "open", side_effect=AssertionError("must not decode")):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^original_source_mismatch$"):
                pipeline.extract_reused_suggestions(content, "image/png", CONTEXT, "0" * 64)
            with patch.object(pipeline, "IMAGE_INPUT_BYTES", len(content) - 1):
                with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_input_too_large$"):
                    self.extract(content, "image/png")

    def test_reuse_keeps_animation_bomb_and_mime_guards(self):
        for format, mime in [("PNG", "image/png"), ("WEBP", "image/webp")]:
            content, _ = raster_fixture(format, animated=True)
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^animated_image$"):
                self.extract(content, mime)
        content, _ = dimension_header_bomb()
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^invalid_image$"):
            self.extract(content, "image/png")
        content, _ = raster_fixture()
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^invalid_image$"):
            self.extract(content, "image/jpeg")

    def test_reused_pdf_extracts_only_title_without_rewrite_and_still_checks_active_content(self):
        content, _ = pdf_fixture()
        with patch.object(PdfWriter, "write", side_effect=AssertionError("must not rewrite")):
            result = self.extract(content, "application/pdf")
        self.assertEqual(result["values"], {"caption": "SYNTHETIC document caption"})
        self.assertEqual(set(result), {"source", "pipeline_version", "confirmed", "values"})
        self.assertFalse(result["confirmed"])
        content, _ = pdf_fixture(active=True)
        with self.assertRaises(pipeline.UploadProcessingError):
            self.extract(content, "application/pdf")

    def test_legal_unknown_and_disclosure_reuse_extracts_nothing(self):
        for content, mime in [(jpeg_fixture()[0], "image/jpeg"), (pdf_fixture()[0], "application/pdf")]:
            with patch.object(Image, "open", side_effect=AssertionError("must not inspect")), patch.object(pipeline, "_pdf_reader", side_effect=AssertionError("must not inspect")):
                for context in [pipeline.UploadContext(), pipeline.UploadContext(category="legal_document"), pipeline.UploadContext(category="exterior", disclosure_evidence=True)]:
                    self.assertEqual(self.extract(content, mime, context), {})

    def test_reuse_and_new_upload_share_one_processing_lock(self):
        content, _ = raster_fixture()
        counter_lock = threading.Lock()
        active = peak = 0
        suggestions = pipeline._suggestions
        def observed(*args, **kwargs):
            nonlocal active, peak
            with counter_lock:
                active += 1
                peak = max(peak, active)
            try:
                time.sleep(0.005)
                return suggestions(*args, **kwargs)
            finally:
                with counter_lock: active -= 1
        with patch.object(pipeline, "_suggestions", observed), ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda index: self.extract(content, "image/png") if index % 2 else pipeline.optimize_image(content, "image/png", CONTEXT).suggestions, range(8)))
        self.assertEqual(peak, 1)
        self.assertEqual(results, [results[0]] * 8)


class HighDepthImageChecks(unittest.TestCase):
    assert_private_removed = SmallImageChecks.assert_private_removed

    def decode(self, content):
        # Independent PNG unfiltering verifies stored low bytes, not Pillow's
        # rounded RGB decode or the same native decoder that produced output.
        chunks = list(pipeline._png_chunks(content))
        header = chunks[0][1]
        width, height, depth, kind, _, _, interlace = struct.unpack(">IIBBBBB", header)
        self.assertEqual((depth, interlace), (16, 0))
        channels = {0: 1, 2: 3, 4: 2, 6: 4}[kind]
        raw = zlib.decompress(b"".join(value for name, value in chunks if name == b"IDAT"))
        previous, pixels, position = bytes(width * channels * 2), [], 0
        for _ in range(height):
            method, row = raw[position], bytearray(raw[position + 1:position + 1 + len(previous)])
            position += 1 + len(previous)
            for i in range(len(row)):
                left = row[i - channels * 2] if i >= channels * 2 else 0
                above = previous[i]
                corner = previous[i - channels * 2] if i >= channels * 2 else 0
                if method == 0: prediction = 0
                elif method == 1: prediction = left
                elif method == 2: prediction = above
                elif method == 3: prediction = (left + above) // 2
                else:
                    self.assertEqual(method, 4)
                    estimate = left + above - corner
                    prediction = min((left, above, corner), key=lambda x: abs(estimate - x))
                row[i] = (row[i] + prediction) & 255
            samples = struct.unpack(">" + "H" * (width * channels), row)
            pixels.extend(tuple(samples[i:i + channels]) for i in range(0, len(samples), channels))
            previous = row
        self.assertEqual(position, len(raw))
        return (width, height), pixels

    def test_high_depth_all_orientations_preserve_samples_and_transparency_keys(self):
        orders = ((0, 1, 2, 3, 4, 5), (2, 1, 0, 5, 4, 3), (5, 4, 3, 2, 1, 0),
                  (3, 4, 5, 0, 1, 2), (0, 3, 1, 4, 2, 5), (3, 0, 4, 1, 5, 2),
                  (5, 2, 4, 1, 3, 0), (2, 5, 1, 4, 0, 3))
        for kind in (0, 2, 4, 6):
            for key in (False, True) if kind in (0, 2) else (False,):
                colors = [(4609 + i,) if kind in (0, 4) else (4609 + i, 32768 + i, 65000 + i) for i in range(6)]
                pixels = [c + ((0, 1, 65534, 65535, 12345, 45321)[i],) if kind in (4, 6) else c
                          for i, c in enumerate(colors)]
                extra = [(b"tRNS", struct.pack(">" + "H" * len(colors[1]), *colors[1]))] if key else []
                expected = [c + (0 if i == 1 else 65535,) for i, c in enumerate(colors)] if key else pixels
                for orientation in range(1, 9):
                    with self.subTest(kind=kind, key=key, orientation=orientation):
                        exif = Image.Exif(); exif[274] = orientation
                        # A profile forces the identity-orientation pixel route
                        # separately below; orientation=1 exercises the fast path.
                        content = png_sixteen_bit_fixture((3, 2), kind, pixels,
                            chunks=[*extra, (b"eXIf", exif.tobytes()[6:]),
                                    (b"tEXt", b"Comment\0SYNTHETIC_SERIAL_EXCLUDE")])
                        result = pipeline.optimize_image(content, "image/png", CONTEXT)
                        if orientation == 1 and key:
                            self.assertIn(b"tRNS", dict(pipeline._png_chunks(result.content)))
                            continue
                        size, output = self.decode(result.content)
                        self.assertEqual(size, (3, 2) if orientation <= 4 else (2, 3))
                        self.assertEqual(output, [expected[i] for i in orders[orientation - 1]])
                        self.assert_private_removed(result)

    def test_high_depth_resize_constant_low_bits_for_all_channel_types_and_adam7(self):
        for kind, pixel in ((0, (4609,)), (2, (4609, 32768, 65001)),
                            (4, (4609, 65534)), (6, (4609, 32768, 65001, 65534))):
            for interlaced in (False, True):
                with self.subTest(kind=kind, interlaced=interlaced):
                    content = png_sixteen_bit_fixture((6, 4), kind, [pixel] * 24, interlaced=interlaced)
                    with patch.object(pipeline, "MAX_EDGE", 3):
                        result = pipeline.optimize_image(content, "image/png", CONTEXT)
                    self.assertEqual(self.decode(result.content), ((3, 2), [pixel] * 6))
                    self.assert_private_removed(result)

    def test_high_depth_transparent_edges_are_premultiplied_and_stay_png(self):
        pixels = [(65535, 0, 0, 0)] * 2 + [(0, 0, 65535, 65535)] * 2
        content = png_sixteen_bit_fixture((4, 1), 6, pixels)
        with patch.object(pipeline, "MAX_EDGE", 2), patch.object(pipeline, "MIB", 1):
            result = pipeline.optimize_image(content, "image/png", CONTEXT)
        size, output = self.decode(result.content)
        self.assertEqual(size, (2, 1))
        self.assertTrue(any(0 < pixel[3] < 65535 for pixel in output))
        for red, green, blue, alpha in output:
            self.assertEqual((red, green), (0, 0))
            self.assertEqual(blue, 65535 if alpha else 0)
        self.assert_private_removed(result)

    def test_high_depth_transform_handles_all_filters_and_interlace(self):
        for interlaced in (False, True):
            for filter_type in (0, 1, 2, 3, 4, None):
                content, _ = png_sixteen_bit_alpha_fixture(size=(3, 2), interlaced=interlaced,
                    filter_type=filter_type, last_alpha=65534)
                exif = Image.Exif(); exif[274] = 3
                payload = exif.tobytes()[6:]
                insertion = struct.pack(">I", len(payload)) + b"eXIf" + payload + struct.pack(">I", zlib.crc32(b"eXIf" + payload))
                content = content[:33] + insertion + content[33:]
                result = pipeline.optimize_image(content, "image/png", CONTEXT)
                self.assertEqual(self.decode(result.content), ((3, 2),
                    [(4609, 32768, 65150, 65534)] + [(4609, 32768, 65150, 65535)] * 5))

    def test_high_depth_sdr_transfer_vectors_preserve_alpha_and_precision(self):
        def srgb(value):
            return 12.92 * value if value <= .0031308 else 1.055 * value ** (1 / 2.4) - .055
        for transfer in (1, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15):
            samples = (32768, 16384, 8192)
            if transfer in (4, 5, 8):
                linear = [(v / 65535) ** {4: 2.2, 5: 2.8, 8: 1}[transfer] for v in samples]
            elif transfer == 13:
                linear = [v / 65535 / 12.92 if v / 65535 <= .04045 else ((v / 65535 + .055) / 1.055) ** 2.4 for v in samples]
            else:
                alpha, threshold, slope = ((1.111572195921731, .09128634211778, 4)
                                           if transfer == 7 else (1.099296826809442, .08124285829863, 4.5))
                linear = [v / 65535 / slope if v / 65535 < threshold
                          else ((v / 65535 + alpha - 1) / alpha) ** (1 / .45) for v in samples]
            content = png_sixteen_bit_fixture((1, 1), 6, [samples + (65534,)],
                chunks=[(b"cICP", bytes((1, transfer, 0, 1)))])
            result = pipeline.optimize_image(content, "image/png", CONTEXT)
            actual = self.decode(result.content)[1][0]
            for value, reference in zip(actual[:3], linear):
                self.assertLessEqual(abs(value - round(srgb(reference) * 65535)), 8, transfer)
            self.assertEqual(actual[3], 65534)
            self.assert_private_removed(result)

    def test_high_depth_icc_and_cicp_precedence_and_output_limits(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        pixels = [(4609, 32768, 65001, 1), (4610, 32769, 65002, 65534)]
        icc = (b"iCCP", b"profile\0\0" + zlib.compress(profile))
        source = png_sixteen_bit_fixture((2, 1), 6, pixels, chunks=[icc])
        result = pipeline.optimize_image(source, "image/png", CONTEXT)
        output = self.decode(result.content)[1]
        for before, after in zip(pixels, output):
            self.assertEqual(before[3], after[3])
            for a, b in zip(before[:3], after[:3]): self.assertLessEqual(abs(a - b), 8)
        cicp = (b"cICP", bytes((12, 13, 0, 1)))
        plain = pipeline.optimize_image(png_sixteen_bit_fixture((2, 1), 6, pixels, chunks=[cicp]), "image/png", CONTEXT)
        conflicting = pipeline.optimize_image(png_sixteen_bit_fixture((2, 1), 6, pixels, chunks=[icc, cicp]), "image/png", CONTEXT)
        self.assertEqual(plain.content, conflicting.content)
        with patch.object(pipeline, "IMAGE_OUTPUT_BYTES", len(result.content) - 1):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_output_too_large$"):
                pipeline.optimize_image(source, "image/png", CONTEXT)
        self.assert_private_removed(result)

    def test_sdr_cicp_primaries_accept_defined_full_range_subset(self):
        for primaries in (1, 4, 5, 6, 7, 8, 9, 11, 12, 22):
            for transfer in (1, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15):
                with self.subTest(primaries=primaries, transfer=transfer):
                    content = png_sixteen_bit_fixture((1, 1), 6, [(16384, 16384, 16384, 65534)],
                        chunks=[(b"cICP", bytes((primaries, transfer, 0, 1)))])
                    result = pipeline.optimize_image(content, "image/png", CONTEXT)
                    pixel = self.decode(result.content)[1][0]
                    self.assertEqual(pixel[3], 65534)
                    self.assertLessEqual(max(pixel[:3]) - min(pixel[:3]), 8)
                    self.assert_private_removed(result)

    def test_high_depth_transparency_key_exact_match_controls_jpeg_exception(self):
        for kind, pixels in ((0, [(4609,), (4610,)]),
                             (2, [(4609, 32768, 65001), (4610, 32769, 65002)])):
            for matched in (False, True):
                key = pixels[0] if matched else tuple(value + 256 for value in pixels[0])
                content = png_sixteen_bit_fixture((2, 1), kind, pixels,
                    chunks=[(b"tRNS", struct.pack(">" + "H" * len(key), *key))])
                with patch.object(pipeline, "MIB", 1):
                    result = pipeline.optimize_image(content, "image/png", CONTEXT)
                self.assertEqual(result.mime_type, "image/png" if matched else "image/jpeg")
                if matched:
                    self.assertEqual(self.decode(result.content), ((2, 1), pixels))
                    self.assertEqual(dict(pipeline._png_chunks(result.content))[b"tRNS"], struct.pack(">" + "H" * len(key), *key))
                self.assert_private_removed(result)

    def test_native_decoder_logs_are_redacted_on_worker_threads_and_cache_is_empty(self):
        import gc
        import weakref
        import pyvips
        stream, handler = io.StringIO(), logging.StreamHandler()
        handler.setStream(stream)
        logger = logging.getLogger("pyvips")
        old_level = logger.level
        logger.setLevel(logging.DEBUG)
        logger.addHandler(handler)
        try:
            def native_callback():
                pyvips._log_handler_callback(pyvips.ffi.new("char[]", b"VIPS"), 16,
                    pyvips.ffi.new("char[]", b"SYNTHETIC_NATIVE_PRIVATE_EXCLUDE"), pyvips.ffi.NULL)
            thread = threading.Thread(target=native_callback)
            thread.start(); thread.join()
            self.assertNotIn("SYNTHETIC_NATIVE_PRIVATE_EXCLUDE", stream.getvalue())
            self.assertIn("Private upload decoder diagnostic suppressed", stream.getvalue())
            references = []
            loader = pyvips.Image.pngload_buffer
            def observed(*args, **kwargs):
                self.assertTrue(kwargs.get("memory"))
                image = loader(*args, **kwargs)
                references.append(weakref.ref(image.pointer))
                return image
            exif = Image.Exif(); exif[274] = 3
            content = png_sixteen_bit_fixture((2, 1), 6, [(1, 2, 3, 4), (5, 6, 7, 8)],
                chunks=[(b"eXIf", exif.tobytes()[6:])])
            with patch.object(pyvips.Image, "pngload_buffer", observed):
                pipeline.optimize_image(content, "image/png", CONTEXT)
            gc.collect()
            self.assertTrue(references and all(reference() is None for reference in references))
            self.assertEqual(pyvips.cache_get_size(), 0)
        finally:
            logger.removeHandler(handler)
            logger.setLevel(old_level)


    def test_server_resolved_processing_class_is_explicit_and_not_a_suggestion(self):
        image, _ = raster_fixture()
        pdf, _ = pdf_fixture()
        raster = pipeline.UploadContext(processing_class="marketing_raster")
        document = pipeline.UploadContext(processing_class="marketing_pdf")
        self.assertFalse(raster.legal)
        result = pipeline.optimize_image(image, "image/png", raster)
        self.assert_private_removed(result)
        self.assertNotIn("processing_class", json.dumps(result.suggestions))
        self.assertNotIn("marketing_raster", json.dumps(result.suggestions))
        result = pipeline.optimize_pdf(pdf, document)
        self.assertTrue(result.processing["metadata_stripped"])
        self.assertNotIn("processing_class", json.dumps(result.suggestions))
        for context in (pipeline.UploadContext(), pipeline.UploadContext(processing_class="private_exact"),
                        pipeline.UploadContext(category="exterior", processing_class="unrecognized"),
                        pipeline.UploadContext(category="legal_document", processing_class="marketing_raster"),
                        pipeline.UploadContext(disclosure_evidence=True, processing_class="marketing_raster")):
            self.assertTrue(context.legal)
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^legal_processing_forbidden$"):
                pipeline.optimize_image(image, "image/png", context)
            self.assertEqual(pipeline.optimize_pdf(pdf, context).content, pdf)
            self.assertEqual(pipeline.extract_reused_suggestions(image, "image/png", context,
                hashlib.sha256(image).hexdigest()), {})
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^legal_processing_forbidden$"):
            pipeline.optimize_image(image, "image/png", document)
        with self.assertRaisesRegex(pipeline.UploadProcessingError, "^legal_processing_forbidden$"):
            pipeline.optimize_pdf(pdf, raster)
        for content, mime, context in ((image, "image/png", document), (pdf, "application/pdf", raster)):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^legal_processing_forbidden$"):
                pipeline.extract_reused_suggestions(content, mime, context, hashlib.sha256(content).hexdigest())

    def test_remaining_sdr_cicp_combinations_preserve_alpha_and_precision(self):
        # Exhaust all specified SDR combinations outside the prior 110 ICC cases.
        for primaries in (1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 22):
            for transfer in (1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17):
                for full_range in (0, 1):
                    if full_range and primaries != 10 and transfer not in (9, 10, 17):
                        continue
                    with self.subTest(primaries=primaries, transfer=transfer, full_range=full_range):
                        content = png_sixteen_bit_fixture((1, 1), 6, [(16384, 16385, 16386, 65534)],
                            chunks=[(b"cICP", bytes((primaries, transfer, 0, full_range)))])
                        result = pipeline.optimize_image(content, "image/png", CONTEXT)
                        pixel = self.decode(result.content)[1][0]
                        self.assertEqual(pixel[3], 65534)
                        self.assertTrue(all(0 <= value <= 65535 for value in pixel))
                        self.assert_private_removed(result)

    def test_narrow_range_endpoints_and_signed_matrix_reference(self):
        # H.273 code range and BT.2020 -> BT.709 linear matrix; negative green
        # must contribute to red/blue before destination gamut clipping.
        matrix = ((1.660491, -.587641, -.072850), (-.124550, 1.132900, -.008349),
                  (-.018151, -.100579, 1.118730))
        source = (16000, 0, 20000)
        signal = [(v / 256 - 16) / 219 for v in source]
        linear = [sum(a * b for a, b in zip(row, signal)) for row in matrix]
        expected = [round(65535 * (12.92 * max(0, v) if v <= .0031308
                    else min(1, 1.055 * v ** (1 / 2.4) - .055))) for v in linear]
        content = png_sixteen_bit_fixture((1, 1), 6, [source + (4609,)],
            chunks=[(b"cICP", bytes((9, 8, 0, 0)))])
        actual = self.decode(pipeline.optimize_image(content, "image/png", CONTEXT).content)[1][0]
        for a, b in zip(actual[:3], expected): self.assertLessEqual(abs(a - b), 8)
        self.assertEqual(actual[3], 4609)
        for depth in (8, 16):
            values = (16, 126, 235)
            if depth == 16:
                source = png_sixteen_bit_fixture((3, 1), 6,
                    [(v * 256,) * 3 + (4609,) for v in values], chunks=[(b"cICP", bytes((1, 13, 0, 0)))])
            else:
                image = Image.new("RGBA", (3, 1)); image.putdata([(v,) * 3 + (17,) for v in values])
                info = PngImagePlugin.PngInfo(); info.add(b"cICP", bytes((1, 13, 0, 0)))
                out = io.BytesIO(); image.save(out, "PNG", pnginfo=info); source = out.getvalue()
            result = pipeline.optimize_image(source, "image/png", CONTEXT)
            pixels = self.decode(result.content)[1] if depth == 16 else list(Image.open(io.BytesIO(result.content)).getdata())
            peak = (1 << depth) - 1
            for before, after in zip(values, pixels):
                self.assertLessEqual(abs(after[0] - round((before - 16) / 219 * peak)), 1)
                self.assertEqual(after[3], 4609 if depth == 16 else 17)

    def test_log_and_cinema_transfer_reference_vectors(self):
        for transfer in (9, 10, 17):
            for full_range in (0, 1):
                samples = (0, 4096, 16384, 32768, 60160, 65535)
                content = png_sixteen_bit_fixture((len(samples), 1), 6,
                    [(v,) * 3 + (4609,) for v in samples],
                    chunks=[(b"cICP", bytes((1, transfer, 0, full_range)))])
                output = self.decode(pipeline.optimize_image(content, "image/png", CONTEXT).content)[1]
                for sample, pixel in zip(samples, output):
                    value = sample / 65535 if full_range else (sample / 256 - 16) / 219
                    linear = (10 ** ((abs(value) - 1) * (2 if transfer == 9 else 2.5))
                              if transfer in (9, 10) else 52.37 / 48 * abs(value) ** 2.6)
                    if value < 0: linear = -linear
                    if not full_range and value == 0: linear = 0
                    expected = round(65535 * min(1, max(0, 12.92 * linear if linear <= .0031308
                                      else 1.055 * linear ** (1 / 2.4) - .055)))
                    self.assertLessEqual(abs(pixel[0] - expected), 1, (transfer, sample, full_range))
                    self.assertEqual(pixel[3], 4609)

    def test_xyz_cinema_uses_absolute_tristimulus_reference_without_invented_white(self):
        # Standard D65 XYZ -> linear sRGB; equal XYZ is not a neutral D65 patch.
        matrix = ((3.2406, -1.5372, -.4986), (-.9689, 1.8758, .0415), (.0557, -.2040, 1.0570))
        source = (16384, 20000, 24576)
        for transfer in (8, 17):
            xyz = [v / 65535 if transfer == 8 else 52.37 / 48 * (v / 65535) ** 2.6 for v in source]
            rgb = [sum(a * b for a, b in zip(row, xyz)) for row in matrix]
            expected = [round(65535 * min(1, max(0, 12.92 * v if v <= .0031308
                        else 1.055 * v ** (1 / 2.4) - .055))) for v in rgb]
            content = png_sixteen_bit_fixture((1, 1), 6, [source + (65534,)],
                chunks=[(b"cICP", bytes((10, transfer, 0, 1)))])
            pixel = self.decode(pipeline.optimize_image(content, "image/png", CONTEXT).content)[1][0]
            for a, b in zip(pixel[:3], expected): self.assertLessEqual(abs(a - b), 8)
            self.assertEqual(pixel[3], 65534)

    def test_unspecified_cicp_uses_complete_fallback_and_never_guesses_missing_description(self):
        pixels = [(4609, 32768, 65001, 65534)]
        icc = (b"iCCP", b"profile\0\0" + zlib.compress(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()))
        gamma = (b"gAMA", struct.pack(">I", 45455))
        chroma = (b"cHRM", struct.pack(">8I", 31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000))
        for description in ((2, 13, 0, 1), (1, 2, 0, 1), (2, 2, 0, 1)):
            unknown = (b"cICP", bytes(description))
            for fallback in ([icc], [(b"sRGB", b"\0")], [gamma, chroma]):
                baseline = pipeline.optimize_image(png_sixteen_bit_fixture((1, 1), 6, pixels, chunks=fallback), "image/png", CONTEXT)
                actual = pipeline.optimize_image(png_sixteen_bit_fixture((1, 1), 6, pixels, chunks=[unknown, *fallback]), "image/png", CONTEXT)
                self.assertEqual(actual.content, baseline.content)
            for incomplete in ([], [gamma], [chroma]):
                content = png_sixteen_bit_fixture((1, 1), 6, pixels, chunks=[unknown, *incomplete])
                with self.assertRaisesRegex(pipeline.UploadProcessingError, "^image_color_space_requires_export$"):
                    pipeline.optimize_image(content, "image/png", CONTEXT)



    def test_narrow_range_bt1361_negative_branch_and_palette_precision(self):
        matrix = ((1.660491, -.587641, -.072850), (-.124550, 1.132900, -.008349),
                  (-.018151, -.100579, 1.118730))
        samples = (20000, 0, 30000)
        linear = []
        for sample in samples:
            value = (sample / 256 - 16) / 219
            if value < -.08124285829863 / 4:
                decoded = -((1.099296826809442 - 1 - 4 * value) / 1.099296826809442) ** (1 / .45) / 4
            elif value < .08124285829863: decoded = value / 4.5
            else: decoded = ((value + 1.099296826809442 - 1) / 1.099296826809442) ** (1 / .45)
            linear.append(decoded)
        rgb = [sum(a * b for a, b in zip(row, linear)) for row in matrix]
        expected = [round(65535 * min(1, max(0, 12.92 * v if v <= .0031308
                    else 1.055 * v ** (1 / 2.4) - .055))) for v in rgb]
        source = png_sixteen_bit_fixture((1, 1), 6, [samples + (4609,)],
            chunks=[(b"cICP", bytes((9, 12, 0, 0)))])
        actual = self.decode(pipeline.optimize_image(source, "image/png", CONTEXT).content)[1][0]
        for a, b in zip(actual[:3], expected): self.assertLessEqual(abs(a - b), 8)
        palette = Image.new("P", (2, 1)); palette.putpalette([16, 16, 16, 235, 235, 235] + [0] * 762)
        palette.putdata([0, 1])
        info = PngImagePlugin.PngInfo(); info.add(b"cICP", bytes((1, 13, 0, 0)))
        out = io.BytesIO(); palette.save(out, "PNG", bits=1, transparency=bytes((0, 255)), pnginfo=info)
        result = pipeline.optimize_image(out.getvalue(), "image/png", CONTEXT)
        self.assertEqual(list(Image.open(io.BytesIO(result.content)).getdata()), [(0, 0, 0, 0), (255, 255, 255, 255)])

    def test_cicp_invalid_reserved_fields_remain_rejected(self):
        for description in (b"\1\1\0", bytes((1, 13, 1, 1)), bytes((1, 13, 0, 2)),
                            bytes((0, 13, 0, 1)), bytes((13, 13, 0, 1)), bytes((1, 3, 0, 1))):
            content = png_sixteen_bit_fixture((1, 1), 2, [(1000,) * 3], chunks=[(b"cICP", description)])
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^invalid_color_profile$"):
                pipeline.optimize_image(content, "image/png", CONTEXT)



    def assert_hdr_rejected(self, source):
        with patch.object(pipeline, "_png_hdr_to_sdr", side_effect=AssertionError("HDR must not decode")), \
                patch.object(Image, "open", side_effect=AssertionError("HDR must reject from headers")):
            with self.assertRaisesRegex(pipeline.UploadProcessingError, "^png_hdr_requires_export$"):
                pipeline.optimize_image(source, "image/png", CONTEXT)

    def test_hdr_reference_vectors_reject_before_decode(self):
        for primaries, transfer, full_range, samples, _ in HDR_SRGB16_REFERENCE:
            with self.subTest(primaries=primaries, transfer=transfer, full_range=full_range):
                source = png_sixteen_bit_fixture((1, 1), 6, [samples + (65534,)],
                    chunks=[(b"cICP", bytes((primaries, transfer, 0, full_range)))])
                self.assert_hdr_rejected(source)

    def test_hdr_all_primary_range_channel_combinations_reject(self):
        for primaries in (1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 22):
            for transfer in (16, 18):
                for full_range in (0, 1):
                    for kind, samples in ((0, (32768,)), (2, (32768, 16384, 49151)),
                                          (4, (32768, 4609)), (6, (32768, 16384, 49151, 4609))):
                        with self.subTest(primaries=primaries, transfer=transfer, full_range=full_range, kind=kind):
                            self.assert_hdr_rejected(png_sixteen_bit_fixture((1, 1), kind, [samples],
                                chunks=[(b"cICP", bytes((primaries, transfer, 0, full_range)))]))

    def test_hdr_narrow_pq_entire_code_domain_is_finite_and_matches_decimal_edges(self):
        from array import array
        from decimal import Decimal, localcontext
        import math
        import pyvips

        # The pole is in the powered domain at c2/c3, hence signal=(c2/c3)^m2.
        # Every legal PNG code is far below it, including narrow-range overshoot.
        pole = (2413 / 2392) ** (2523 / 32)
        self.assertGreater(pole, 1.99)
        for depth in (8, 16):
            peak, shift = (1 << depth) - 1, 2 ** (depth - 8)
            signals = array("d", ((code / shift - 16) / 219 for code in range(peak + 1)))
            image = pyvips.Image.new_from_memory(signals.tobytes(), 256, (peak + 1) // 256, 1, "double")
            decoded = pipeline._hdr_pq_decode(image)
            self.assertLess(signals[-1], pole)
            self.assertEqual((decoded == decoded).min(), 255)  # No NaN at any code.
            self.assertLessEqual(decoded.abs().max(), 25500)  # Also excludes infinities.
            for code in (0, 1, 16 * shift, peak - 1, peak):
                with localcontext() as decimal_context:
                    decimal_context.prec = 60
                    signal = (Decimal(code) / shift - 16) / 219
                    power = abs(signal) ** (Decimal(32) / 2523)
                    expected = 10000 * (max(power - Decimal(3424) / 4096, 0) /
                        (Decimal(2413) / 128 - Decimal(2392) / 128 * power)) ** (Decimal(16384) / 2610)
                    if signal < 0: expected = -expected
                actual = decoded.getpoint(code % 256, code // 256)[0]
                self.assertTrue(math.isfinite(actual))
                self.assertAlmostEqual(actual, float(expected), delta=max(1e-11, abs(float(expected)) * 1e-11))
            self.assertLess(decoded.getpoint(0, 0)[0], 0)
            self.assertGreater(decoded.getpoint(255, (peak + 1) // 256 - 1)[0], 10000)


    def test_hdr_highlight_and_low_bit_samples_reject(self):
        samples = (32768, 32769, 49151, 55000, 60000, 65535)
        for transfer in (16, 18):
            self.assert_hdr_rejected(png_sixteen_bit_fixture((6, 1), 6,
                [(v,) * 3 + (65534,) for v in samples], chunks=[(b"cICP", bytes((9, transfer, 0, 1)))]))

    def test_hdr_alpha_transparency_orientation_interlacing_reject(self):
        for transfer in (16, 18):
            exif = Image.Exif(); exif[274] = 6
            samples = [(4609, 32768, 60000)] * 6
            chunks = [(b"cICP", bytes((9, transfer, 0, 1))), (b"eXIf", exif.tobytes()[6:])]
            self.assert_hdr_rejected(png_sixteen_bit_fixture((3, 2), 6,
                [p + (4609,) for p in samples], chunks=chunks, interlaced=True))
            self.assert_hdr_rejected(png_sixteen_bit_fixture((2, 1), 2,
                [samples[0], (4610, 32768, 60000)], chunks=[*chunks, (b"tRNS", struct.pack(">3H", *samples[0]))]))
            for alpha in (65535, 65534):
                self.assert_hdr_rejected(png_sixteen_bit_fixture((1, 1), 6, [samples[0] + (alpha,)], chunks=chunks))

    def test_hdr_eight_bit_palette_and_rgba_reject(self):
        for transfer in (16, 18):
            info = PngImagePlugin.PngInfo(); info.add(b"cICP", bytes((9, transfer, 0, 1)))
            for mode in ("RGBA", "P"):
                image = Image.new(mode, (2, 1))
                if mode == "RGBA": image.putdata([(128, 64, 192, 17), (255, 255, 255, 254)])
                else:
                    image.putpalette([128, 64, 192, 255, 255, 255] + [0] * 762); image.putdata([0, 1])
                out = io.BytesIO()
                image.save(out, "PNG", pnginfo=info, **({"bits": 1, "transparency": bytes((17, 254))} if mode == "P" else {}))
                self.assert_hdr_rejected(out.getvalue())

    def test_hdr_rejection_precedes_lower_metadata_but_preserves_legal_guard(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        lower = [(b"iCCP", b"profile\0\0" + zlib.compress(profile)), (b"sRGB", b"\0"),
                 (b"gAMA", struct.pack(">I", 100000)),
                 (b"mDCV", struct.pack(">8HII", 13250, 34500, 7500, 3000, 34000, 16000, 15635, 16450, 10000000, 0)),
                 (b"cLLI", struct.pack(">II", 100000000, 10000000)),
                 (b"tEXt", b"Comment\0SYNTHETIC_HDR_PRIVATE_EXCLUDE")]
        for transfer in (16, 18):
            cicp = (b"cICP", bytes((9, transfer, 0, 1)))
            for chunks in ([cicp], [cicp, *lower]):
                source = png_sixteen_bit_fixture((1, 1), 6, [(16384, 32768, 49151, 65534)], chunks=chunks)
                self.assert_hdr_rejected(source)
                for context in (pipeline.UploadContext(), pipeline.UploadContext(processing_class="private_exact"),
                                pipeline.UploadContext(category="legal_document", processing_class="marketing_raster"),
                                pipeline.UploadContext(disclosure_evidence=True, processing_class="marketing_raster")):
                    with self.assertRaisesRegex(pipeline.UploadProcessingError, "^legal_processing_forbidden$"):
                        pipeline.optimize_image(source, "image/png", context)

if __name__ == "__main__":
    unittest.main()
