"""On-demand synthetic W9 inputs; no application/settings imports or disk IO.

Builders return (encoded bytes, source expectations), never product suggestions.
JPEG: real EXIF IFD0/Exif/GPS, standard XMP APP1, Photoshop APP13 IPTC-IIM.
Additional builders emit EXIF IFD1 thumbnails and PDF revision/nested XMP fixtures.
No C2PA/JUMBF or extended XMP fixture.
"""
import hashlib
import io
import random
import struct
import zlib

from PIL import Image, ImageDraw, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject, TextStringObject

SYNTHETIC_TEXT = "SYNTHETIC W9 searchable brochure text."
SYNTHETIC_PROJECT = (0.0, 0.0)  # Invented context, never a real SENA project.
EXCLUDED = {
    "serial": "SYNTHETIC_SERIAL_EXCLUDE", "owner": "SYNTHETIC_OWNER_EXCLUDE",
    "contact": "synthetic-contact@example.invalid", "face": "SYNTHETIC_FACE_EXCLUDE",
    "history": "SYNTHETIC_HISTORY_EXCLUDE", "path": "C:/SYNTHETIC_PATH_EXCLUDE/source.psd",
}


def _encode(image, format, **options):
    output = io.BytesIO()
    image.save(output, format=format, **options)
    return output.getvalue()


def raster_fixture(format="PNG", size=(96, 64), *, noise=False, transparent=False,
                   animated=False, seed=9):
    """Small line art or seeded photographic/noise surrogate; large sizes opt in.

    Animation uses two distinct frames (PNG/WebP/GIF). Noise allocates RGB bytes
    for the requested dimensions; do not call with large sizes during other gates.
    """
    format = format.upper()
    if format not in {"PNG", "JPEG", "WEBP", "GIF"}:
        raise ValueError("Unsupported fixture format")
    if animated and format not in {"PNG", "WEBP", "GIF"}:
        raise ValueError("Animation requires PNG, WebP or GIF")
    if noise:
        image = Image.frombytes("RGB", size, random.Random(seed).randbytes(size[0] * size[1] * 3))
        if transparent:
            image = image.convert("RGBA")
            image.putalpha(128)
    else:
        image = Image.new("RGBA" if transparent else "RGB", size,
                          (0, 0, 0, 0) if transparent else "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4), fill="blue")
        draw.line((0, 0, size[0] - 1, size[1] - 1), fill="red", width=1)
    if format == "JPEG":
        image = image.convert("RGB")
    options = {"save_all": True, "append_images": [Image.new(image.mode, size, "green")],
               "duration": 100, "loop": 0} if animated else {}
    return _encode(image, format, **options), {
        "format": format, "mime_type": Image.MIME[format], "size": size,
        "frames": 2 if animated else 1, "transparent": transparent and format != "JPEG", "noise": noise}


def xmp_packet(*, stock=False, ai=False, excluded=True):
    """UTF-8 XMP RDF for standard JPEG APP1 or PDF catalog /Metadata."""
    creator = "SYNTHETIC Adobe Stock credit" if stock else "SYNTHETIC creator"
    fields = {
        "dc:creator": f"<rdf:Seq><rdf:li>{creator}</rdf:li></rdf:Seq>",
        "dc:rights": "<rdf:Alt><rdf:li xml:lang='x-default'>SYNTHETIC copyright</rdf:li></rdf:Alt>",
        "dc:description": "<rdf:Alt><rdf:li xml:lang='x-default'>SYNTHETIC caption</rdf:li></rdf:Alt>",
        "dc:subject": "<rdf:Bag><rdf:li>SYNTHETIC_TAG</rdf:li><rdf:li>SYNTHETIC_UNKNOWN_TAG</rdf:li></rdf:Bag>",
        "xmpRights:UsageTerms": "<rdf:Alt><rdf:li xml:lang='x-default'>SYNTHETIC usage terms</rdf:li></rdf:Alt>",
    }
    if ai:
        fields["Iptc4xmpExt:DigitalSourceType"] = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
    if excluded:
        fields.update({
            "Iptc4xmpCore:CreatorContactInfo": "<rdf:Description Iptc4xmpCore:CiEmailWork='synthetic-contact@example.invalid'/>",
            "mwg-rs:Regions": "<rdf:Description mwg-rs:Name='SYNTHETIC_FACE_EXCLUDE'/>",
            "xmpMM:History": "<rdf:Seq><rdf:li>SYNTHETIC_HISTORY_EXCLUDE</rdf:li></rdf:Seq>",
            "xmpMM:DerivedFrom": "<rdf:Description stRef:filePath='C:/SYNTHETIC_PATH_EXCLUDE/source.psd'/>",
        })
    namespaces = {
        "dc": "http://purl.org/dc/elements/1.1/", "xmpRights": "http://ns.adobe.com/xap/1.0/rights/",
        "Iptc4xmpExt": "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
        "Iptc4xmpCore": "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
        "mwg-rs": "http://www.metadataworkinggroup.com/schemas/regions/",
        "xmpMM": "http://ns.adobe.com/xap/1.0/mm/", "stRef": "http://ns.adobe.com/xap/1.0/sType/ResourceRef#",
    }
    declarations = " ".join(f'xmlns:{key}="{value}"' for key, value in namespaces.items())
    body = "".join(f"<{key}>{value}</{key}>" for key, value in fields.items())
    return (f'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            f'<rdf:Description rdf:about="" {declarations}>{body}</rdf:Description>'
            '</rdf:RDF></x:xmpmeta>').encode()


def iptc_iim(*, stock=False):
    """Real IPTC-IIM record 2; ASCII values need no charset marker."""
    values = [(80, "SYNTHETIC byline"), (110, "SYNTHETIC Getty credit" if stock else "SYNTHETIC credit"),
              (116, "SYNTHETIC copyright"), (120, "SYNTHETIC caption"),
              (25, "SYNTHETIC_TAG"), (25, "SYNTHETIC_UNKNOWN_TAG")]
    return b"".join(b"\x1c\x02" + bytes([tag]) + struct.pack(">H", len(value)) + value.encode("ascii")
                    for tag, value in values)


def _jpeg_segment(marker, payload):
    if len(payload) > 65533:
        raise ValueError("JPEG APP segment too large")
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload


def jpeg_fixture(size=(96, 64), *, orientation=6, offset="+07:00", gps="near",
                 xmp=False, iptc=False, stock=False, ai=False, excluded=True,
                 software="SYNTHETIC camera software"):
    """Real EXIF DateTimeOriginal/OffsetTimeOriginal, IFD0 and GPS sub-IFDs.

    gps='near': (0,0), 'far': (1,1), None: missing. Compare to SYNTHETIC_PROJECT.
    XMP uses standard APP1; IPTC uses Photoshop APP13 IRB 0x0404. No thumbnail.
    """
    if gps not in {"near", "far", None}:
        raise ValueError("gps must be near, far or None")
    raw, expected = raster_fixture("JPEG", size)
    exif = Image.Exif()
    for key, value in {274: orientation, 306: "2026:01:02 03:04:05", 315: "SYNTHETIC Artist",
                       33432: "SYNTHETIC Copyright", 271: "SYNTHETIC Make",
                       272: "SYNTHETIC Model", 305: software}.items():
        exif[key] = value
    capture = {36867: "2026:01:02 03:04:05"}
    if offset is not None:
        capture[36881] = offset
    if excluded:
        capture.update({42033: EXCLUDED["serial"], 42032: EXCLUDED["owner"],
                        42037: "SYNTHETIC_LENS_SERIAL_EXCLUDE"})
    exif[34665] = capture
    if gps is not None:
        dms = (IFDRational(0 if gps == "near" else 1), IFDRational(0), IFDRational(0))
        exif[34853] = {1: "N", 2: dms, 3: "E", 4: dms}
    with Image.open(io.BytesIO(raw)) as image:
        content = _encode(image, "JPEG", quality="keep", exif=exif)
    segments = b""
    if xmp:
        segments += _jpeg_segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + xmp_packet(stock=stock, ai=ai, excluded=excluded))
    if iptc:
        iim = iptc_iim(stock=stock)
        irb = b"8BIM\x04\x04\x00\x00" + struct.pack(">I", len(iim)) + iim + (b"\x00" if len(iim) % 2 else b"")
        segments += _jpeg_segment(0xED, b"Photoshop 3.0\x00" + irb)
    expected.update({"orientation": orientation, "capture_date": "2026:01:02 03:04:05",
                     "offset": offset, "gps": gps, "project_coordinates": SYNTHETIC_PROJECT,
                     "containers": ["EXIF"] + (["XMP APP1"] if xmp else []) + (["IPTC-IIM APP13"] if iptc else [])})
    return content[:2] + segments + content[2:], expected


def dimension_header_bomb(size=(100_000, 100_000)):
    """Tiny inconsistent PNG: patched IHDR with original 1px IDAT. Never decode.

    Tests header/resource guards, not a valid huge raster; allocates only 1 pixel.
    """
    raw, _ = raster_fixture(size=(1, 1))
    ihdr = struct.pack(">II", *size) + raw[24:29]
    content = raw[:16] + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr)) + raw[33:]
    return content, {"format": "PNG", "mime_type": "image/png", "size": size,
                     "decode": False, "valid_full_raster": False}


def pdf_fixture(*, pages=1, embedded_raster=False, active=False, metadata=True, raster_size=(96, 64)):
    """Searchable PDF, optional JPEG XObject, Info/catalog XMP, JavaScript action.

    No viewer is opened. No incremental history, page/resource XMP, inline-image,
    attachment, form, or signature coverage. Large raster_size allocates pixels.
    """
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")}))
    for _ in range(pages):
        page = writer.add_blank_page(width=256, height=192)
        resources = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        commands = f"BT /F1 10 Tf 12 170 Td ({SYNTHETIC_TEXT}) Tj ET\n".encode()
        if embedded_raster:
            jpeg, _ = raster_fixture("JPEG", raster_size, noise=True)
            image = DecodedStreamObject()
            image.set_data(jpeg)
            image.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"),
                NameObject("/Width"): NumberObject(raster_size[0]), NameObject("/Height"): NumberObject(raster_size[1]),
                NameObject("/ColorSpace"): NameObject("/DeviceRGB"), NameObject("/BitsPerComponent"): NumberObject(8),
                NameObject("/Filter"): NameObject("/DCTDecode")})
            resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Im0"): writer._add_object(image)})
            commands += b"q 192 0 0 128 12 12 cm /Im0 Do Q\n"
        page[NameObject("/Resources")] = resources
        stream = DecodedStreamObject()
        stream.set_data(commands)
        page[NameObject("/Contents")] = writer._add_object(stream)
    if metadata:
        writer.add_metadata({"/Title": "SYNTHETIC document caption", "/Author": "SYNTHETIC_AUTHOR_EXCLUDE",
            "/Creator": "SYNTHETIC_CREATOR_EXCLUDE", "/Producer": "SYNTHETIC_PRODUCER_EXCLUDE",
            "/CreationDate": "D:20260102030405+07'00'", "/ModDate": "D:20260102030405+07'00'"})
        stream = DecodedStreamObject()
        stream.set_data(xmp_packet())
        stream.update({NameObject("/Type"): NameObject("/Metadata"), NameObject("/Subtype"): NameObject("/XML")})
        writer._root_object[NameObject("/Metadata")] = writer._add_object(stream)
    else:
        writer.metadata = None
    if active:
        writer._root_object[NameObject("/OpenAction")] = DictionaryObject({
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject("app.alert('SYNTHETIC_ACTIVE_CONTENT_REJECT');")})
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue(), {"mime_type": "application/pdf", "pages": pages, "text": SYNTHETIC_TEXT,
        "embedded_raster": embedded_raster, "active": active,
        "containers": ["PDF Info", "PDF catalog XMP"] if metadata else []}


def jpeg_thumbnail_fixture(size=(96, 64), *, thumbnail_size=(24, 16), **jpeg_options):
    """JPEG with real EXIF IFD1 JPEGInterchangeFormat/Length thumbnail tags.

    The main raster is existing blue/red line art; the thumbnail is bright green
    with a yellow rectangle, deliberately different content. Existing EXIF/GPS
    and optional XMP/IPTC stay intact. Sizes are opt-in; APP1 must fit 65533 bytes.
    """
    content, expected = jpeg_fixture(size, **jpeg_options)
    thumbnail = Image.new("RGB", thumbnail_size, "lime")
    ImageDraw.Draw(thumbnail).rectangle(
        (0, 0, thumbnail_size[0] // 2, thumbnail_size[1] // 2), fill="yellow")
    thumbnail_bytes = _encode(thumbnail, "JPEG", quality=85)
    # Walk actual JPEG segments rather than searching binary data for a marker.
    position = 2
    while content[position:position + 2] != b"\xff\xda":
        marker = content[position + 1]
        length = struct.unpack_from(">H", content, position + 2)[0]
        payload = content[position + 4:position + 2 + length]
        if marker == 0xE1 and payload.startswith(b"Exif\x00\x00"):
            tiff = bytearray(payload[6:])
            endian = "<" if tiff[:2] == b"II" else ">"
            ifd0 = struct.unpack_from(endian + "I", tiff, 4)[0]
            count = struct.unpack_from(endian + "H", tiff, ifd0)[0]
            next_pointer = ifd0 + 2 + 12 * count
            if struct.unpack_from(endian + "I", tiff, next_pointer)[0]:
                raise ValueError("Source already has a next IFD")
            if len(tiff) % 2:
                tiff.append(0)
            ifd1 = len(tiff)
            thumbnail_offset = ifd1 + 2 + 5 * 12 + 4
            struct.pack_into(endian + "I", tiff, next_pointer, ifd1)
            tiff.extend(struct.pack(endian + "H", 5))
            for tag, kind, value in [(256, 4, thumbnail_size[0]), (257, 4, thumbnail_size[1]),
                                     (259, 3, 6), (513, 4, thumbnail_offset),
                                     (514, 4, len(thumbnail_bytes))]:
                encoded_value = (struct.pack(endian + "H", value) + b"\x00\x00"
                                 if kind == 3 else struct.pack(endian + "I", value))
                tiff.extend(struct.pack(endian + "HHI", tag, kind, 1) + encoded_value)
            tiff.extend(struct.pack(endian + "I", 0))
            tiff.extend(thumbnail_bytes)
            content = (content[:position] + _jpeg_segment(0xE1, b"Exif\x00\x00" + tiff)
                       + content[position + 2 + length:])
            expected.update({"thumbnail_size": thumbnail_size,
                             "thumbnail_checksum": hashlib.sha256(thumbnail_bytes).hexdigest(),
                             "thumbnail_differs_from_main": True,
                             "thumbnail_container": "EXIF IFD1 JPEGInterchangeFormat"})
            return content, expected
        position += 2 + length
    raise ValueError("Source JPEG has no EXIF APP1")


def pdf_incremental_fixture(*, pages=1):
    """Two real PDF revisions: obsolete Info author bytes survive in history.

    Latest Info replaces the old synthetic author. No page/content modifications
    occur between revisions. base_revision_size lets callers independently parse
    the exact first revision from the returned byte prefix.
    """
    content, expected = pdf_fixture(pages=pages)
    old_author = "SYNTHETICOLDREVISIONAUTHOREXCLUDE"
    current_author = "SYNTHETICCURRENTREVISIONAUTHOREXCLUDE"
    writer = PdfWriter(io.BytesIO(content))
    writer.add_metadata({"/Author": old_author})
    base = io.BytesIO()
    writer.write(base)
    base_bytes = base.getvalue()
    writer = PdfWriter(io.BytesIO(base_bytes), incremental=True)
    writer.add_metadata({"/Author": current_author})
    output = io.BytesIO()
    writer.write(output)
    expected.update({"revisions": 2, "base_revision_size": len(base_bytes),
                     "old_revision_sentinel": old_author,
                     "current_revision_sentinel": current_author,
                     "history_container": "PDF incremental update with /Prev xref"})
    return output.getvalue(), expected


def pdf_nested_metadata_fixture(*, pages=1):
    """Actual XMP streams on each page and each JPEG resource XObject.

    Includes ordinary catalog XMP/Info as well. Separate excluded sentinels in
    page and image metadata distinguish these streams from document metadata.
    No fabricated /Metadata key is inserted directly in a /Resources dictionary.
    """
    content, expected = pdf_fixture(pages=pages, embedded_raster=True)
    writer = PdfWriter(io.BytesIO(content))
    sentinels = {"page": "SYNTHETIC_PAGE_XMP_EXCLUDE", "resource": "SYNTHETIC_RESOURCE_XMP_EXCLUDE"}
    for page in writer.pages:
        targets = [(page, sentinels["page"]),
                   (page["/Resources"]["/XObject"]["/Im0"], sentinels["resource"])]
        for target, sentinel in targets:
            stream = DecodedStreamObject()
            stream.set_data(xmp_packet().replace(b"SYNTHETIC caption", sentinel.encode("ascii")))
            stream.update({NameObject("/Type"): NameObject("/Metadata"),
                           NameObject("/Subtype"): NameObject("/XML")})
            target[NameObject("/Metadata")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    expected.update({"nested_xmp_sentinels": sentinels,
                     "nested_xmp_paths": ["page /Metadata", "page /Resources /XObject /Im0 /Metadata"]})
    return output.getvalue(), expected


def pdf_metadata_image_fixture(size=(96, 64), *, placement="direct", jpeg_options=None):
    """PDF containing a real metadata-rich JPEG, direct, nested-form or inline.

    A single composable builder keeps the same source JPEG across placements.
    Defaults include EXIF/GPS, XMP, IPTC and a differing IFD1 preview. placement
    'form' reuses one Form/image twice at two transformed point dimensions, with
    indirect /Resources and /XObject dictionaries at both page and Form levels.
    'inline' uses actual BI/ID/EI syntax with /DCTDecode, not an image XObject.
    Large size is opt-in; the thumbnail remains 24x16. No large defaults.
    """
    if placement not in {"direct", "form", "inline"}:
        raise ValueError("placement must be direct, form or inline")
    options = {"xmp": True, "iptc": True}
    options.update(jpeg_options or {})
    jpeg, image_expected = jpeg_thumbnail_fixture(size, **options)
    content, expected = pdf_fixture(metadata=False)
    writer = PdfWriter(io.BytesIO(content))
    page = writer.pages[0]
    resources = page["/Resources"]
    commands = page["/Contents"].get_data()
    image = DecodedStreamObject()
    image.set_data(jpeg)
    image.update({NameObject("/Type"): NameObject("/XObject"),
        NameObject("/Subtype"): NameObject("/Image"),
        NameObject("/Width"): NumberObject(size[0]), NameObject("/Height"): NumberObject(size[1]),
        NameObject("/ColorSpace"): NameObject("/DeviceRGB"), NameObject("/BitsPerComponent"): NumberObject(8),
        NameObject("/Filter"): NameObject("/DCTDecode")})
    drawn_dimensions = [(192, 128)]
    if placement == "direct":
        resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Im0"): writer._add_object(image)})
        commands += b"q 192 0 0 128 12 12 cm /Im0 Do Q\n"
    elif placement == "form":
        image_ref = writer._add_object(image)
        form = DecodedStreamObject()
        form.set_data(b"q 96 0 0 64 0 0 cm /Im0 Do Q\n")
        form_resources = DictionaryObject({NameObject("/XObject"): writer._add_object(
            DictionaryObject({NameObject("/Im0"): image_ref}))})
        form.update({NameObject("/Type"): NameObject("/XObject"),
            NameObject("/Subtype"): NameObject("/Form"), NameObject("/FormType"): NumberObject(1),
            NameObject("/BBox"): ArrayObject([NumberObject(n) for n in [0, 0, 96, 64]]),
            NameObject("/Resources"): writer._add_object(form_resources)})
        resources[NameObject("/XObject")] = writer._add_object(
            DictionaryObject({NameObject("/Fm0"): writer._add_object(form)}))
        page[NameObject("/Resources")] = writer._add_object(resources)
        commands += b"q 2 0 0 2 12 20 cm /Fm0 Do Q\nq 0 1 -1 0 220 20 cm /Fm0 Do Q\n"
        drawn_dimensions = [(192, 128), (64, 96)]
    else:
        commands += (f"q 192 0 0 128 12 12 cm\nBI /W {size[0]} /H {size[1]} "
                     "/CS /RGB /BPC 8 /F /DCTDecode ID\n").encode("ascii")
        commands += jpeg + b"\nEI\nQ\n"
    stream = DecodedStreamObject()
    stream.set_data(commands)
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    expected.update({"placement": placement, "embedded_raster": True,
        "main_jpeg_checksum": hashlib.sha256(jpeg).hexdigest(), "main_jpeg_size": size,
        "main_jpeg_containers": image_expected["containers"] + [image_expected["thumbnail_container"]],
        "thumbnail_checksum": image_expected["thumbnail_checksum"],
        "thumbnail_size": image_expected["thumbnail_size"], "drawn_point_dimensions": drawn_dimensions,
        "image_path": {"direct": "page /Resources /XObject /Im0",
                       "form": "page /Resources /XObject /Fm0 /Resources /XObject /Im0",
                       "inline": "page /Contents INLINE IMAGE"}[placement]})
    if placement == "form":
        expected.update({"form_image_matrix": [96, 0, 0, 64, 0, 0],
            "page_form_matrices": [[2, 0, 0, 2, 12, 20], [0, 1, -1, 0, 220, 20]],
            "image_axis_point_lengths": [(192, 128), (96, 64)],
            "same_form_draw_count": 2, "indirect_resources_and_xobjects": True})
    return output.getvalue(), expected


def xmp_image_fixture(field, value, *, attribute=False):
    """Small PNG with one actual XMP field and no competing EXIF date/credit."""
    from xml.sax.saxutils import escape, quoteattr
    namespaces = {"xmp": "http://ns.adobe.com/xap/1.0/",
                  "dc": "http://purl.org/dc/elements/1.1/",
                  "photoshop": "http://ns.adobe.com/photoshop/1.0/"}
    prefix = field.split(":")[0]
    declaration = f'xmlns:{prefix}="{namespaces[prefix]}"'
    xml = (f'<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" {declaration} {field}={quoteattr(value)}/>' if attribute else
           f'<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" {declaration}><{field}>{escape(value)}</{field}></rdf:Description>')
    info = PngImagePlugin.PngInfo()
    info.add_itxt("XML:com.adobe.xmp", xml)
    return _encode(Image.new("RGB", (8, 6), "white"), "PNG", pnginfo=info), {
        "field": field, "value": value, "attribute": attribute}


def user_computer_fixture():
    """Dedicated OS user and computer names in real PNG text metadata."""
    names = {"UserName": "SYNTHETIC_OS_USER_EXCLUDE",
             "ComputerName": "SYNTHETIC_COMPUTER_EXCLUDE"}
    info = PngImagePlugin.PngInfo()
    for key, value in names.items():
        info.add_text(key, value)
    return _encode(Image.new("RGB", (8, 6), "white"), "PNG", pnginfo=info), names


def pdf_unsupported_rewrite_fixture():
    """A real JPEG2000 XObject hits the unsupported metadata-safe rewrite path."""
    content, expected = pdf_fixture(embedded_raster=True, raster_size=(8, 6))
    writer = PdfWriter(io.BytesIO(content))
    image = writer.pages[0]["/Resources"]["/XObject"]["/Im0"]
    image._data = _encode(Image.new("RGB", (8, 6), "blue"), "JPEG2000")
    image[NameObject("/Filter")] = NameObject("/JPXDecode")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue(), expected


def png_sixteen_bit_alpha_fixture(*, color_type=6, size=(17, 9), filter_type=0,
                                  interlaced=False, last_alpha=65535, noise=False):
    """Synthetic 16-bit samples, with all PNG filters and Adam7 pass layouts."""
    width, height = size
    channels = {4: 2, 6: 4}[color_type]
    pixel_size = channels * 2
    passes = [(0, 0, 1, 1)] if not interlaced else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
        (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    filtered = bytearray()
    random_source = random.Random(914)
    for x0, y0, dx, dy in passes:
        xs = range(x0, width, dx)
        if not xs:
            continue
        previous = bytes(len(xs) * pixel_size)
        for row_index, y in enumerate(range(y0, height, dy)):
            row = bytearray()
            for x in xs:
                colors = (0x1201,) if color_type == 4 else (0x1201, 0x8000, 0xFE7E)
                if noise:
                    colors = tuple(random_source.getrandbits(16) for _ in range(channels - 1))
                alpha = last_alpha if (x, y) == (width - 1, height - 1) else 65535
                row.extend(struct.pack('>' + 'H' * channels, *colors, alpha))
            chosen = row_index % 5 if filter_type is None else filter_type
            filtered.append(chosen)
            for index, value in enumerate(row):
                left = row[index - pixel_size] if index >= pixel_size else 0
                above = previous[index]
                upper_left = previous[index - pixel_size] if index >= pixel_size else 0
                if chosen == 0:
                    predicted = 0
                elif chosen == 1:
                    predicted = left
                elif chosen == 2:
                    predicted = above
                elif chosen == 3:
                    predicted = (left + above) // 2
                else:
                    estimate = left + above - upper_left
                    # Independent forward encoding; select nearest in tie order.
                    predicted = min((left, above, upper_left), key=lambda item: abs(estimate - item))
                filtered.append((value - predicted) & 255)
            previous = row
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    header = struct.pack('>IIBBBBB', width, height, 16, color_type, 0, 0, int(interlaced))
    content = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
    content += chunk(b'tEXt', b'Comment\0SYNTHETIC_SERIAL_EXCLUDE')
    content += chunk(b'IDAT', zlib.compress(filtered)) + chunk(b'IEND', b'')
    return content, bytes(filtered)


def png_sixteen_bit_fixture(size, color_type, pixels, *, chunks=(), interlaced=False):
    """Tiny exact samples, independent of an image library's multichannel modes."""
    width, height = size
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    assert len(pixels) == width * height and all(len(pixel) == channels for pixel in pixels)
    passes = [(0, 0, 1, 1)] if not interlaced else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
        (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    raw = bytearray()
    for x0, y0, dx, dy in passes:
        if x0 >= width:
            continue
        for y in range(y0, height, dy):
            raw.append(0)
            for x in range(x0, width, dx):
                raw.extend(struct.pack('>' + 'H' * channels, *pixels[y * width + x]))
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    header = struct.pack('>IIBBBBB', width, height, 16, color_type, 0, 0, int(interlaced))
    result = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
    result += b''.join(chunk(kind, payload) for kind, payload in chunks)
    return result + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


# Independent scalar/60-digit neutral references: BT.2100, BT.2408 Annex 5,
# BT.2446-1 Method A; primary, transfer, range, source16 RGB, output16 sRGB.
HDR_SRGB16_REFERENCE = (
    (9, 16, 0, (4096, 4096, 4096), (0, 0, 0)),
    (9, 16, 0, (18112, 18112, 18112), (9152, 9152, 9152)),
    (9, 16, 0, (32128, 32128, 32128), (32613, 32613, 32613)),
    (9, 16, 0, (46144, 46144, 46144), (61598, 61598, 61598)),
    (9, 16, 0, (60160, 60160, 60160), (65535, 65535, 65535)),
    (9, 16, 0, (46144, 32128, 18112), (65535, 0, 0)),
    (9, 16, 0, (54554, 20915, 9702), (65535, 0, 0)),
    (9, 16, 0, (15309, 48947, 26522), (0, 65535, 0)),
    (9, 16, 0, (9702, 20915, 57357), (0, 8939, 65535)),
    (9, 16, 0, (51750, 48947, 15309), (65535, 62920, 0)),
    (9, 16, 0, (0, 32768, 65535), (0, 33557, 65535)),
    (9, 16, 0, (65535, 65535, 65535), (65535, 65535, 65535)),
    (9, 16, 0, (0, 0, 0), (0, 0, 0)),
    (9, 16, 1, (0, 0, 0), (0, 0, 0)),
    (9, 16, 1, (16384, 16384, 16384), (9153, 9153, 9153)),
    (9, 16, 1, (32768, 32768, 32768), (32614, 32614, 32614)),
    (9, 16, 1, (49151, 49151, 49151), (61598, 61598, 61598)),
    (9, 16, 1, (65535, 65535, 65535), (65535, 65535, 65535)),
    (9, 16, 1, (49151, 32768, 16384), (65535, 0, 0)),
    (9, 16, 1, (58982, 19660, 6554), (65535, 0, 0)),
    (9, 16, 1, (13107, 52428, 26214), (0, 65535, 0)),
    (9, 16, 1, (6554, 19660, 62258), (0, 8938, 65535)),
    (9, 16, 1, (55705, 52428, 13107), (65535, 62920, 0)),
    (9, 18, 0, (4096, 4096, 4096), (0, 0, 0)),
    (9, 18, 0, (18112, 18112, 18112), (12483, 12483, 12483)),
    (9, 18, 0, (32128, 32128, 32128), (25752, 25752, 25752)),
    (9, 18, 0, (46144, 46144, 46144), (43896, 43896, 43896)),
    (9, 18, 0, (60160, 60160, 60160), (65535, 65535, 65535)),
    (9, 18, 0, (46144, 32128, 18112), (49976, 22399, 10189)),
    (9, 18, 0, (54554, 20915, 9702), (65535, 0, 0)),
    (9, 18, 0, (15309, 48947, 26522), (0, 51888, 17434)),
    (9, 18, 0, (9702, 20915, 57357), (0, 15855, 65535)),
    (9, 18, 0, (51750, 48947, 15309), (58322, 47796, 0)),
    (9, 18, 0, (0, 32768, 65535), (0, 28074, 65535)),
    (9, 18, 0, (65535, 65535, 65535), (65535, 65535, 65535)),
    (9, 18, 0, (0, 0, 0), (0, 0, 0)),
    (9, 18, 1, (0, 0, 0), (0, 0, 0)),
    (9, 18, 1, (16384, 16384, 16384), (12483, 12483, 12483)),
    (9, 18, 1, (32768, 32768, 32768), (25752, 25752, 25752)),
    (9, 18, 1, (49151, 49151, 49151), (43895, 43895, 43895)),
    (9, 18, 1, (65535, 65535, 65535), (65535, 65535, 65535)),
    (9, 18, 1, (49151, 32768, 16384), (49975, 22399, 10189)),
    (9, 18, 1, (58982, 19660, 6554), (65535, 0, 0)),
    (9, 18, 1, (13107, 52428, 26214), (0, 51888, 17434)),
    (9, 18, 1, (6554, 19660, 62258), (0, 15854, 65535)),
    (9, 18, 1, (55705, 52428, 13107), (58323, 47796, 0)),
    (1, 16, 0, (49151, 32768, 16384), (65535, 30658, 9873)),
    (1, 16, 0, (32768, 49151, 6554), (27631, 65535, 14299)),
    (1, 16, 0, (16384, 32768, 55000), (43225, 35562, 65535)),
    (1, 16, 1, (49151, 32768, 16384), (65535, 30254, 10374)),
    (1, 16, 1, (32768, 49151, 6554), (28901, 65535, 13875)),
    (1, 16, 1, (16384, 32768, 55000), (30698, 33413, 65535)),
    (1, 18, 0, (49151, 32768, 16384), (47886, 26377, 12750)),
    (1, 18, 0, (32768, 49151, 6554), (28466, 49367, 9967)),
    (1, 18, 0, (16384, 32768, 55000), (14112, 26769, 60990)),
    (1, 18, 1, (49151, 32768, 16384), (42433, 25753, 14119)),
    (1, 18, 1, (32768, 49151, 6554), (27369, 43693, 10012)),
    (1, 18, 1, (16384, 32768, 55000), (14914, 26002, 51922)),
    (12, 16, 0, (49151, 32768, 16384), (65535, 25233, 0)),
    (12, 16, 0, (32768, 49151, 6554), (0, 65535, 0)),
    (12, 16, 0, (16384, 32768, 55000), (43057, 36114, 65535)),
    (12, 16, 1, (49151, 32768, 16384), (65535, 24268, 0)),
    (12, 16, 1, (32768, 49151, 6554), (0, 65535, 0)),
    (12, 16, 1, (16384, 32768, 55000), (29800, 34094, 65535)),
    (12, 18, 0, (49151, 32768, 16384), (51152, 24813, 7440)),
    (12, 18, 0, (32768, 49151, 6554), (19634, 50123, 0)),
    (12, 18, 0, (16384, 32768, 55000), (8453, 27211, 63260)),
    (12, 18, 1, (49151, 32768, 16384), (45085, 24640, 10764)),
    (12, 18, 1, (32768, 49151, 6554), (21334, 44249, 0)),
    (12, 18, 1, (16384, 32768, 55000), (10560, 26389, 53744)),
)
