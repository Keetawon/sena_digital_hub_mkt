"""Admission uses decoder dimensions and unique inline-image provenance."""
import base64
import io
import struct
import unittest
from unittest.mock import patch

from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, EncodedStreamObject, NameObject, NumberObject

from sena_hub_api.upload_limits import pdf_image_pixels, preflight_upload
from sena_hub_api.upload_optimization import UploadProcessingError, _pdf_reader
from test_upload_limits import jpeg, pdf, png


def encoded_pdf(data, filters, *, size=(2, 3), depth=8, parameters=None, indirect=False,
                globals_data=None, embedded_mask=0, copies=1, shared_pages=1):
    writer = PdfWriter()
    item = EncodedStreamObject()
    item._data = data
    item.update({NameObject("/Subtype"): NameObject("/Image"),
                 NameObject("/Width"): NumberObject(size[0]), NameObject("/Height"): NumberObject(size[1]),
                 NameObject("/ColorSpace"): NameObject("/DeviceRGB")})
    if depth is not None:
        item[NameObject("/BitsPerComponent")] = NumberObject(depth)
    if embedded_mask:
        item[NameObject("/SMaskInData")] = NumberObject(embedded_mask)
    value = ArrayObject([NameObject(name) for name in filters])
    item[NameObject("/Filter")] = writer._add_object(value) if indirect else value
    if parameters is not None or globals_data is not None:
        params = DictionaryObject({NameObject(key): NumberObject(value) for key, value in (parameters or {}).items()})
        if globals_data is not None:
            import zlib
            globals_stream = EncodedStreamObject()
            globals_stream._data = zlib.compress(globals_data)
            globals_stream[NameObject("/Filter")] = NameObject("/FlateDecode")
            params[NameObject("/JBIG2Globals")] = writer._add_object(globals_stream)
        item[NameObject("/DecodeParms")] = writer._add_object(params) if indirect else params
    images = DictionaryObject()
    for index in range(copies):
        image = EncodedStreamObject()
        image._data = data
        image.update(item)
        images[NameObject(f"/Im{index}")] = writer._add_object(image)
    for _ in range(shared_pages):
        page = writer.add_blank_page(width=100, height=100)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"): images})
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def jpx_header(width, height, depth=16, components=3, boxed=False):
    siz = struct.pack(">HHIIIIIIIIH", 38 + 3 * components, 0, width, height, 0, 0,
                      width, height, 0, 0, components) + bytes((depth - 1, 1, 1)) * components
    codestream = b"\xff\x4f\xff\x51" + siz + b"\xff\xd9"
    if not boxed:
        return codestream
    def box(kind, payload):
        return struct.pack(">I4s", len(payload) + 8, kind) + payload
    return (box(b"jP  ", b"\r\n\x87\n") + box(b"ftyp", b"jp2 \0\0\0\0jp2 ")
            + box(b"jp2h", box(b"ihdr", struct.pack(">IIHBBBB", height, width, components, depth - 1, 7, 0, 0)))
            + box(b"jp2c", codestream))


def jbig2_header(width, height, *, striped=False, unknown_region=None):
    def segment(number, kind, payload):
        return struct.pack(">IBBBI", number, kind, 0, 1, len(payload)) + payload
    result = segment(1, 48, struct.pack(">IIIIBH", width, 0xFFFFFFFF if striped else height,
                                        72, 72, 0, 0x8000 | height if striped else 0))
    if unknown_region is not None:
        mmr = unknown_region
        region = struct.pack(">IIIIBB", width, height, 0, 0, 0, int(mmr))
        region += b"" if mmr else bytes((1, 0, 2, 0, 3, 0, 4, 0))
        region += b"\x12\x34" + (b"\x00\x00" if mmr else b"\xff\xac") + struct.pack(">I", height)
        result += struct.pack(">IBBBI", 2, 38, 0, 1, 0xFFFFFFFF) + region
    if striped:
        result += segment(3, 50, struct.pack(">I", height - 1))
    return result


def shared_inline_pdf(*, split=False, distinct=False):
    from pypdf.generic import DecodedStreamObject
    writer = PdfWriter()
    command = b"q BI /W 6000 /H 4000 /BPC 8 /CS /RGB /F /DCT ID " + jpeg(6000, 4000) + b" EI Q\n"
    def stream(data):
        value = DecodedStreamObject()
        value.set_data(data)
        return writer._add_object(value)
    # Keep one inline image spread over two streams; parse the array as a whole.
    cut = command.index(b" EI") - 4 if split == "data" else command.index(b" /CS") if split else len(command)
    shared = [stream(command[:cut])]
    if split:
        shared.append(stream(command[cut:]))
    for _ in range(11):
        page = writer.add_blank_page(width=100, height=100)
        parts = [stream(command)] if distinct else shared
        page[NameObject("/Contents")] = ArrayObject([*parts, stream(b"q Q\n")])
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def conflicting_jpeg_headers(marker=0xC0):
    first, second = jpeg(2, 3), jpeg(8000, 6001)
    start = second.index(b"\xff\xc0")
    length = int.from_bytes(second[start + 2:start + 4], "big")
    insert = first.index(b"\xff\xda")
    frame = second[start:start + 2 + length]
    return first[:insert] + frame[:1] + bytes((marker,)) + frame[2:] + first[insert:]


class PdfHeaderAdmissionChecks(unittest.TestCase):
    def reject(self, data, code="pdf_reexport_required"):
        with patch.object(Image.Image, "load", side_effect=AssertionError("pixel decoding during admission")):
            with self.assertRaisesRegex(UploadProcessingError, "^" + code + "$"):
                preflight_upload(data, "application/pdf")

    def test_indirect_filter_cannot_hide_jpeg_dimensions(self):
        self.reject(encoded_pdf(jpeg(8000, 6001), ["/DCTDecode"], indirect=True))

    def test_jpeg_precision_must_match_the_charged_dictionary(self):
        data = bytearray(jpeg(2, 3))
        marker = next(i for i in range(len(data) - 4) if data[i:i + 2] in (b"\xff\xc0", b"\xff\xc2"))
        data[marker + 4] = 12
        self.reject(encoded_pdf(bytes(data), ["/DCTDecode"]))

    def test_ccitt_dimensions_and_depth_cannot_disagree(self):
        for params, depth in [({"/Columns": 8000, "/Rows": 6000}, 1),
                              ({"/Columns": 2, "/Rows": 6000}, 1), ({"/Columns": 2, "/Rows": 3}, 8)]:
            with self.subTest(parameters=params, depth=depth):
                self.reject(encoded_pdf(b"header-only", ["/CCITTFaxDecode"], depth=depth, parameters=params, indirect=True))

    def test_ccitt_zero_rows_and_matching_columns_are_admitted(self):
        preflight_upload(encoded_pdf(b"header-only", ["/CCITTFaxDecode"], depth=1,
                                     parameters={"/Columns": 2, "/Rows": 0}, indirect=True), "application/pdf")

    def test_ascii85_wrapped_png_dimensions_and_depth_are_checked(self):
        for data, size in [(png(6000, 4000), (2, 3)), (png(2, 3, 16), (2, 3))]:
            self.reject(encoded_pdf(base64.a85encode(data, adobe=True), ["/ASCII85Decode"], size=size))

    def test_standalone_png_rejects_duplicate_size_headers_before_decode(self):
        data = png(2, 3)[:33] + png(6000, 4001)[8:]
        with patch.object(Image.Image, "load", side_effect=AssertionError("pixel decoding during admission")):
            with self.assertRaisesRegex(UploadProcessingError, "^invalid_image$"):
                preflight_upload(data, "image/png")

    def test_wrapped_png_rejects_duplicate_size_headers_before_decode(self):
        data = png(2, 3)[:33] + png(6000, 4001)[8:]
        self.reject(encoded_pdf(base64.a85encode(data, adobe=True), ["/ASCII85Decode"]))

    def test_standalone_jpeg_rejects_conflicting_frame_headers_before_decode(self):
        for marker in (0xC0, 0xC2, 0xC9):
            data = conflicting_jpeg_headers(marker)
            with self.subTest(marker=marker), patch.object(
                    Image.Image, "load", side_effect=AssertionError("pixel decoding during admission")):
                with self.assertRaisesRegex(UploadProcessingError, "^invalid_image$"):
                    preflight_upload(data, "image/jpeg")

    def test_embedded_jpeg_rejects_conflicting_frame_headers_before_decode(self):
        for marker in (0xC0, 0xC2, 0xC9):
            with self.subTest(marker=marker):
                self.reject(encoded_pdf(conflicting_jpeg_headers(marker), ["/DCTDecode"]))

    def test_masks_without_subtype_still_count_in_unique_aggregate(self):
        from pypdf.generic import DecodedStreamObject
        writer = PdfWriter(clone_from=io.BytesIO(pdf([(3000, 4000, 8)] * 11)))
        images = writer.pages[0]["/Resources"]["/XObject"]
        for image in images.values():
            mask = DecodedStreamObject()
            mask.set_data(b"synthetic header-only mask")
            mask.update({NameObject("/Width"): NumberObject(3000),
                         NameObject("/Height"): NumberObject(4000),
                         NameObject("/BitsPerComponent"): NumberObject(8),
                         NameObject("/ColorSpace"): NameObject("/DeviceGray")})
            image.get_object()[NameObject("/SMask")] = writer._add_object(mask)
        out = io.BytesIO()
        writer.write(out)
        self.reject(out.getvalue(), "pdf_pixel_limit")

    def test_transport_wrapped_tiff_depth_is_checked_without_pixels(self):
        output = io.BytesIO()
        Image.new("I;16", (2, 3)).save(output, "TIFF")
        self.reject(encoded_pdf(base64.a85encode(output.getvalue(), adobe=True), ["/ASCII85Decode"]))

    def test_transport_header_inspection_does_not_cache_expanded_stream(self):
        data = encoded_pdf(base64.a85encode(png(2, 3), adobe=True), ["/ASCII85Decode"])
        reader = _pdf_reader(data)
        self.assertEqual(pdf_image_pixels(reader), 6)
        self.assertIsNone(reader.pages[0]["/Resources"]["/XObject"]["/Im0"].decoded_self)

    def test_transport_unwrapping_retains_configured_expansion_guard(self):
        import zlib
        from pypdf import apply_configuration
        data = encoded_pdf(zlib.compress(jpeg(2, 3)), ["/FlateDecode", "/DCTDecode"])
        with apply_configuration(zlib_maximum_output_length=64):
            self.reject(data)

    def test_jpx_dimensions_and_precision_are_checked_without_pixels(self):
        for boxed in (False, True):
            # PDF explicitly ignores a JPX dictionary's BitsPerComponent.
            self.assertEqual(pdf_image_pixels(_pdf_reader(encoded_pdf(jpx_header(2, 3, boxed=boxed),
                                                                      ["/JPXDecode"], depth=8))), 12)
            self.reject(encoded_pdf(jpx_header(8000, 6000, 8, boxed=boxed), ["/JPXDecode"], depth=8))
            data = encoded_pdf(jpx_header(3000, 4000, boxed=boxed), ["/JPXDecode"], size=(3000, 4000), depth=None)
            self.assertEqual(pdf_image_pixels(_pdf_reader(data)), 24_000_000)

    def test_jpx_omitted_depth_still_obeys_weighted_per_image_limit(self):
        for depth in (None, 8, 16):
            self.reject(encoded_pdf(jpx_header(3000, 4001), ["/JPXDecode"], size=(3000, 4001), depth=depth),
                        "pdf_image_pixel_limit")

    def test_jpx_box_and_codestream_precision_must_be_consistent(self):
        data = bytearray(jpx_header(2, 3, boxed=True))
        data[data.index(b"ihdr") + 4 + 10] = 7
        self.reject(encoded_pdf(bytes(data), ["/JPXDecode"], depth=None))

    def test_jpx_palette_precision_is_charged(self):
        data = bytearray(jpx_header(2, 3, 8, components=1, boxed=True))
        palette = struct.pack(">HB", 2, 3) + b"\x0f" * 3 + b"\0" * 12
        palette = struct.pack(">I4s", len(palette) + 8, b"pclr") + palette
        start = data.index(b"jp2h") - 4
        size = struct.unpack_from(">I", data, start)[0]
        data[start + size:start + size] = palette
        struct.pack_into(">I", data, start, size + len(palette))
        self.assertEqual(pdf_image_pixels(_pdf_reader(encoded_pdf(bytes(data), ["/JPXDecode"], depth=8))), 12)

    def test_jpx_embedded_mask_is_charged_once_with_shared_image(self):
        for mask in (1, 2):
            data = encoded_pdf(jpx_header(3000, 4000, 8, components=4), ["/JPXDecode"],
                               size=(3000, 4000), depth=None, embedded_mask=mask, shared_pages=11)
            self.assertEqual(pdf_image_pixels(_pdf_reader(data)), 24_000_000)
            self.reject(encoded_pdf(jpx_header(3000, 4001, 8, components=4), ["/JPXDecode"],
                                    size=(3000, 4001), depth=None, embedded_mask=mask), "pdf_image_pixel_limit")

    def test_jpx_embedded_masks_obey_aggregate_limit(self):
        options = dict(size=(3000, 4000), depth=None, embedded_mask=1)
        source = jpx_header(3000, 4000, 8, components=4)
        self.assertEqual(pdf_image_pixels(_pdf_reader(encoded_pdf(source, ["/JPXDecode"], copies=10, **options))),
                         240_000_000)
        self.reject(encoded_pdf(source, ["/JPXDecode"], copies=11, **options), "pdf_pixel_limit")

    def test_jbig2_page_dimensions_and_fixed_depth_are_checked(self):
        self.reject(encoded_pdf(jbig2_header(8000, 6000), ["/JBIG2Decode"], depth=1))
        self.reject(encoded_pdf(jbig2_header(2, 3), ["/JBIG2Decode"], depth=8))
        for striped in (False, True):
            self.assertEqual(pdf_image_pixels(_pdf_reader(encoded_pdf(jbig2_header(2, 3, striped=striped),
                                                                      ["/JBIG2Decode"], depth=1))), 6)

    def test_jbig2_unknown_segment_length_and_final_stripe_are_header_only(self):
        for mmr in (False, True):
            for striped in (False, True):
                data = jbig2_header(2, 3, striped=striped, unknown_region=mmr)
                with patch("pypdf.filters.JBIG2Decode.decode", side_effect=AssertionError("JBIG2 pixel decoder used")):
                    self.assertEqual(pdf_image_pixels(_pdf_reader(encoded_pdf(data, ["/JBIG2Decode"], depth=1))), 6)

    def test_jbig2_globals_are_unwrapped_without_pixel_decoding(self):
        globals_data = struct.pack(">IBBBI", 0, 0, 0, 0, 4) + b"data"
        with patch("pypdf.filters.JBIG2Decode.decode", side_effect=AssertionError("JBIG2 pixel decoder used")):
            preflight_upload(encoded_pdf(jbig2_header(2, 3), ["/JBIG2Decode"], depth=1,
                                         globals_data=globals_data, indirect=True), "application/pdf")
            self.reject(encoded_pdf(jbig2_header(2, 3), ["/JBIG2Decode"], depth=1,
                                    globals_data=globals_data[:-1]))

    def test_jbig2_unknown_height_requires_complete_final_stripe(self):
        data = jbig2_header(2, 3, striped=True)
        self.reject(encoded_pdf(data[:-15], ["/JBIG2Decode"], depth=1))
        self.reject(encoded_pdf(jbig2_header(2, 4, striped=True), ["/JBIG2Decode"], depth=1))

    def test_shared_inline_images_count_once_in_separate_content_arrays(self):
        for split in (False, True, "data"):
            self.assertEqual(pdf_image_pixels(_pdf_reader(shared_inline_pdf(split=split))), 24_000_000)

    def test_distinct_inline_streams_are_charged_separately(self):
        self.reject(shared_inline_pdf(distinct=True), "pdf_pixel_limit")

    def test_pdf_above_100mp_uses_the_per_image_limit_message(self):
        self.reject(pdf([(10001, 10000, 8)]), "pdf_image_pixel_limit")

    def test_malformed_cicp_preserves_color_profile_error(self):
        import zlib
        source = png(2, 3)
        payload = b"\x09\x10\x00"
        chunk = struct.pack(">I", len(payload)) + b"cICP" + payload + struct.pack(">I", zlib.crc32(b"cICP" + payload))
        with self.assertRaisesRegex(UploadProcessingError, "^invalid_color_profile$"):
            preflight_upload(source[:33] + chunk + source[33:], "image/png")


if __name__ == "__main__":
    unittest.main()
