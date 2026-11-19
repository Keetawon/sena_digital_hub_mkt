"""Port-free input-header guards; malformed pixel bodies must never be decoded here."""
import io
import struct
import unittest
import zlib
from unittest.mock import patch

from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import (ArrayObject, BooleanObject, DecodedStreamObject,
    DictionaryObject, NameObject, NumberObject)
from sena_hub_api import upload_optimization as processing
from sena_hub_api.upload_pipeline import prepare_authorized_upload


def png(width, height, depth=8, transfer=None):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    header = struct.pack(">IIBBBBB", width, height, depth, 6, 0, 0, 0)
    color = chunk(b"cICP", bytes((9, transfer, 0, 1))) if transfer else b""
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + color + chunk(b"IDAT", zlib.compress(b"\0")) + chunk(b"IEND", b"")


def jpeg(width, height):
    out = io.BytesIO()
    Image.new("RGB", (2, 2), "blue").save(out, "JPEG")
    data = bytearray(out.getvalue())
    pos = 2
    while data[pos:pos + 2] != b"\xff\xda":
        marker, length = data[pos + 1], int.from_bytes(data[pos + 2:pos + 4], "big")
        if marker in (0xC0, 0xC2):
            data[pos + 5:pos + 9] = struct.pack(">HH", height, width)
            return bytes(data)
        pos += 2 + length
    raise AssertionError("Missing synthetic JPEG frame")


def pdf(images, *, shared_pages=1, nested=False, mask=None):
    writer = PdfWriter()
    refs = []
    for width, height, depth in images:
        image = DecodedStreamObject()
        image.set_data(b"synthetic header-only raster")
        image.update({NameObject("/Type"): NameObject("/XObject"),
            NameObject("/Subtype"): NameObject("/Image"),
            NameObject("/Width"): NumberObject(width), NameObject("/Height"): NumberObject(height),
            NameObject("/BitsPerComponent"): NumberObject(depth),
            NameObject("/ColorSpace"): NameObject("/DeviceRGB")})
        refs.append(writer._add_object(image))
    if mask:
        width, height, depth = mask
        image = DecodedStreamObject()
        image.set_data(b"synthetic mask")
        image.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"),
            NameObject("/Width"): NumberObject(width), NameObject("/Height"): NumberObject(height),
            NameObject("/BitsPerComponent"): NumberObject(depth), NameObject("/ColorSpace"): NameObject("/DeviceGray")})
        refs[0].get_object()[NameObject("/SMask")] = writer._add_object(image)
    resources = DictionaryObject({NameObject("/XObject"): DictionaryObject({
        NameObject(f"/Im{index}"): ref for index, ref in enumerate(refs)})})
    commands = b"q 100 0 0 100 0 0 cm /Im0 Do Q\n"
    if nested:
        form = DecodedStreamObject()
        form.set_data(commands)
        form.update({NameObject("/Subtype"): NameObject("/Form"), NameObject("/Resources"): resources,
            NameObject("/BBox"): ArrayObject([NumberObject(x) for x in (0, 0, 100, 100)])})
        resources = DictionaryObject({NameObject("/XObject"): DictionaryObject({NameObject("/Fm0"): writer._add_object(form)})})
        commands = b"/Fm0 Do\n"
    for _ in range(shared_pages):
        page = writer.add_blank_page(width=100, height=100)
        page[NameObject("/Resources")] = resources
        stream = DecodedStreamObject()
        stream.set_data(commands)
        page[NameObject("/Contents")] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


class UploadLimitChecks(unittest.TestCase):
    def check_header(self, data, mime):
        self.assertTrue(hasattr(processing, "preflight_upload"), "input-header admission is missing")
        with patch.object(Image.Image, "load", side_effect=AssertionError("pixel decoding before admission")):
            return processing.preflight_upload(data, mime)

    def test_png_limit_rejects_before_full_decode_for_both_depths(self):
        for depth in (8, 16):
            with self.subTest(depth=depth), self.assertRaisesRegex(processing.UploadProcessingError, "^png_pixel_limit$"):
                self.check_header(png(6001, 4000, depth), "image/png")

    def test_png_24mp_boundary_is_admitted_without_decoding(self):
        for depth in (8, 16):
            with self.subTest(depth=depth):
                self.check_header(png(6000, 4000, depth), "image/png")

    def test_pq_and_hlg_rejected_even_for_small_images(self):
        for transfer in (16, 18):
            for depth in (8, 16):
                with self.subTest(transfer=transfer, depth=depth), self.assertRaisesRegex(processing.UploadProcessingError, "^png_hdr_requires_export$"):
                    self.check_header(png(2, 2, depth, transfer), "image/png")

    def test_jpeg_100mp_boundary_and_over_limit(self):
        self.check_header(jpeg(10000, 10000), "image/jpeg")
        with self.assertRaisesRegex(processing.UploadProcessingError, "^jpeg_pixel_limit$"):
            self.check_header(jpeg(10001, 10000), "image/jpeg")

    def test_pdf_240mp_boundary_and_over_limit(self):
        self.check_header(pdf([(6000, 4000, 8)] * 10), "application/pdf")
        with self.assertRaisesRegex(processing.UploadProcessingError, "^pdf_pixel_limit$"):
            self.check_header(pdf([(6000, 4000, 8)] * 10 + [(1, 1, 8)]), "application/pdf")

    def test_pdf_high_depth_is_weighted(self):
        self.check_header(pdf([(3000, 4000, 16)] * 10), "application/pdf")
        with self.assertRaisesRegex(processing.UploadProcessingError, "^pdf_pixel_limit$"):
            self.check_header(pdf([(3000, 4000, 16)] * 10 + [(1, 1, 1)]), "application/pdf")

    def test_pdf_shared_reference_counts_once_across_200_pages(self):
        self.check_header(pdf([(6000, 4000, 8)], shared_pages=200), "application/pdf")

    def test_pdf_nested_form_and_mask_are_counted(self):
        self.check_header(pdf([(3000, 4000, 8)], nested=True, mask=(3000, 4000, 8)), "application/pdf")
        with self.assertRaisesRegex(processing.UploadProcessingError, "^pdf_image_pixel_limit$"):
            self.check_header(pdf([(3000, 4000, 8)], nested=True, mask=(3000, 4001, 8)), "application/pdf")

    def test_header_guard_applies_before_original_reuse(self):
        data = png(6001, 4000)
        resolved = {"processing_class": "marketing_raster", "context": {"category": "gallery"}}
        with self.assertRaisesRegex(processing.UploadProcessingError, "^png_pixel_limit$"):
            prepare_authorized_upload(data, "image/png", "synthetic.png", resolved, {"original": {}})

    def test_hdr_is_rejected_for_private_exact_without_modification(self):
        resolved = {"processing_class": "private_exact", "context": {"category": "legal_document"}}
        with self.assertRaisesRegex(processing.UploadProcessingError, "^png_hdr_requires_export$"):
            prepare_authorized_upload(png(2, 2, 8, 16), "image/png", "synthetic.png", resolved)


    def test_memory_failure_keeps_its_type_for_the_supervisor(self):
        with patch.object(processing, "_srgb", side_effect=MemoryError):
            with self.assertRaises(MemoryError):
                processing.optimize_image(jpeg(2,2),"image/jpeg",processing.UploadContext(processing_class="marketing_raster"))
        with patch.object(processing, "_write_pdf", side_effect=MemoryError):
            with self.assertRaises(MemoryError):
                processing.optimize_pdf(pdf([(2,2,8)]),processing.UploadContext(processing_class="marketing_pdf"))


    def test_pdf_per_image_24mp_and_aggregate_240mp_are_independent(self):
        for image in [(6000,4000,8),(3000,4000,16)]:
            with self.subTest(image=image):
                self.check_header(pdf([image]*10),"application/pdf")
                with self.assertRaisesRegex(processing.UploadProcessingError,"^pdf_pixel_limit$"):
                    self.check_header(pdf([image]*10+[(1,1,8)]),"application/pdf")
        for image in [(6001,4000,8),(3000,4001,16)]:
            with self.subTest(image=image), self.assertRaisesRegex(processing.UploadProcessingError,"^pdf_image_pixel_limit$"):
                self.check_header(pdf([image]),"application/pdf")

    def test_webp_24mp_limit_checks_each_encoding_header_without_decoder(self):
        def webp(width,height,kind):
            if kind==b"VP8X":
                payload=b"\0"*4+(width-1).to_bytes(3,"little")+(height-1).to_bytes(3,"little")
            elif kind==b"VP8L":
                payload=b"\x2f"+((width-1)|((height-1)<<14)).to_bytes(4,"little")
            else:
                payload=b"\0"*3+b"\x9d\x01\x2a"+struct.pack("<HH",width,height)
            data=kind+struct.pack("<I",len(payload))+payload+b"\0"*(len(payload)%2)
            return b"RIFF"+struct.pack("<I",len(data)+4)+b"WEBP"+data
        with patch.object(Image,"open",side_effect=AssertionError("WebP decoder used for header admission")):
            for kind in (b"VP8X",b"VP8L",b"VP8 "):
                with self.subTest(kind=kind):
                    self.check_header(webp(6000,4000,kind),"image/webp")
                    with self.assertRaisesRegex(processing.UploadProcessingError,"^webp_pixel_limit$"):
                        self.check_header(webp(6001,4000,kind),"image/webp")


if __name__ == "__main__":
    unittest.main()
