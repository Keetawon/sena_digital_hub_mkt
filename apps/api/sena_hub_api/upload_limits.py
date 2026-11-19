"""Header-only resource admission for new uploads, including original reuse."""
from __future__ import annotations

import io
import struct

from PIL import Image
from pypdf import get_configuration
from pypdf.filters import decode_stream_data
from pypdf.generic import (ArrayObject, ContentStream, DictionaryObject, EncodedStreamObject,
                           IndirectObject, NameObject, NullObject, StreamObject)

from .upload_optimization import (
    IMAGE_INPUT_BYTES, MAX_PIXELS, PDF_INPUT_BYTES, RASTER_FORMATS,
    UploadProcessingError, _pdf_objects, _pdf_reader, _png_chunks, _private_decoding,
)

MAX_PNG_PIXELS = 24_000_000
MAX_WEBP_PIXELS = 24_000_000
MAX_PDF_SINGLE_IMAGE_PIXELS = 24_000_000
MAX_PDF_IMAGE_PIXELS = 240_000_000


def jpeg_header(content: bytes) -> tuple[int, int, int]:
    if content[:2] != b"\xff\xd8":
        raise ValueError("Invalid JPEG header")
    position, frame = 2, None
    while position + 4 <= len(content):
        if content[position] != 255:
            raise ValueError("Invalid JPEG marker")
        while position < len(content) and content[position] == 255:
            position += 1
        if position >= len(content):
            break
        marker = content[position]
        position += 1
        if marker in (0xDA, 0xD9):
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            continue
        length = int.from_bytes(content[position:position + 2], "big")
        if length < 2 or position + length > len(content):
            raise ValueError("Invalid JPEG segment")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if marker not in (0xC0, 0xC1, 0xC2) or length < 8 or frame is not None:
                raise ValueError("Invalid or duplicate JPEG frame")
            height, width = struct.unpack_from(">HH", content, position + 3)
            if width < 1 or height < 1:
                raise ValueError("Invalid JPEG dimensions")
            frame = width, height, content[position + 2]
        position += length
    if frame is None:
        raise ValueError("Missing JPEG frame")
    return frame


def jpeg_header_size(content: bytes) -> tuple[int, int]:
    return jpeg_header(content)[:2]


def _checked_png_chunks(content):
    header_seen = False
    for kind, payload in _png_chunks(content):
        if not header_seen:
            if kind != b"IHDR" or len(payload) != 13:
                raise ValueError("Invalid PNG header")
            header_seen = True
        elif kind == b"IHDR":
            raise ValueError("Duplicate PNG header")
        yield kind, payload


def _resolve(value):
    for _ in range(64):
        if not isinstance(value, IndirectObject):
            return value
        value = value.get_object()
    raise ValueError("PDF reference chain exceeds limits")


def _identity(item):
    reference = getattr(item, "indirect_reference", None)
    return (reference.idnum, reference.generation) if reference else id(item)


_FILTER_NAMES = {"/AHx": "/ASCIIHexDecode", "/A85": "/ASCII85Decode", "/LZW": "/LZWDecode",
                 "/Fl": "/FlateDecode", "/RL": "/RunLengthDecode", "/CCF": "/CCITTFaxDecode", "/DCT": "/DCTDecode"}
_TRANSPORT_FILTERS = {"/ASCIIHexDecode", "/ASCII85Decode", "/LZWDecode", "/FlateDecode", "/RunLengthDecode"}


def _filters(header):
    filters = _resolve(header.get("/Filter", header.get("/F", [])))
    filters = [] if isinstance(filters, NullObject) else filters if isinstance(filters, (list, tuple)) else [filters]
    filters = [_FILTER_NAMES.get(str(_resolve(value)), str(_resolve(value))) for value in filters]
    parameters = _resolve(header.get("/DecodeParms", header.get("/DP")))
    if parameters is None or isinstance(parameters, NullObject):
        parameters = [None] * len(filters)
    elif not isinstance(parameters, (list, tuple)):
        parameters = [parameters]
    if len(parameters) != len(filters):
        raise ValueError("Invalid PDF filter parameters")
    normalized = []
    for value in parameters:
        value = _resolve(value)
        if value is None or isinstance(value, NullObject):
            value = DictionaryObject()
        if not isinstance(value, DictionaryObject):
            raise ValueError("Invalid PDF filter parameters")
        normalized.append(DictionaryObject({key: _resolve(item) for key, item in value.items()}))
    return filters, normalized


def _transport_data(header, filters, parameters, data=None):
    """Unwrap bytes with existing expansion limits, without a decoded_self cache."""
    if any(name not in _TRANSPORT_FILTERS for name in filters):
        raise ValueError("Invalid image transport filter")
    if data is None:
        data = header._data
    if not filters:
        return data
    view = EncodedStreamObject()
    view._data = data
    view[NameObject("/Filter")] = ArrayObject([NameObject(name) for name in filters])
    view[NameObject("/DecodeParms")] = ArrayObject(parameters)
    return decode_stream_data(view)


def _jpx_header(data):
    def codestream(value):
        if value[:4] != b"\xff\x4f\xff\x51" or len(value) < 42:
            raise ValueError("Invalid JPEG2000 SIZ header")
        length, _, width, height, x, y, _, _, _, _, components = struct.unpack_from(">HHIIIIIIIIH", value, 4)
        if not components or length != 38 + 3 * components or 4 + length > len(value):
            raise ValueError("Invalid JPEG2000 components")
        precision = tuple((value[42 + 3 * index] & 127) + 1 for index in range(components))
        if width <= x or height <= y or max(precision) > 38:
            raise ValueError("Invalid JPEG2000 dimensions")
        return width - x, height - y, precision

    if data[:2] == b"\xff\x4f":
        width, height, precision = codestream(data)
        return width, height, max(precision)

    def boxes(start, end):
        count = 0
        while start < end:
            count += 1
            if count > 100000 or end - start < 8:
                raise ValueError("Invalid JPEG2000 boxes")
            length, kind = struct.unpack_from(">I4s", data, start)
            size = 8
            if length == 1:
                if end - start < 16:
                    raise ValueError("Truncated JPEG2000 box")
                length, size = struct.unpack_from(">Q", data, start + 8)[0], 16
            elif length == 0:
                length = end - start
            if length < size or start + length > end:
                raise ValueError("Invalid JPEG2000 box length")
            yield kind, start + size, start + length
            start += length

    if data[:12] != b"\0\0\0\x0cjP  \r\n\x87\n":
        raise ValueError("Invalid JPEG2000 container")
    facts, dimensions, header_depth, component_depth, palette_depth = None, None, None, None, 1
    for kind, start, end in boxes(0, len(data)):
        if kind == b"jp2h":
            for child, begin, stop in boxes(start, end):
                if child == b"ihdr":
                    if stop - begin != 14 or header_depth is not None:
                        raise ValueError("Invalid JPEG2000 image header")
                    height, width, components, depth = struct.unpack_from(">IIHB", data, begin)
                    dimensions, header_depth = (width, height), (components, depth)
                elif child == b"bpcc":
                    if component_depth is not None or header_depth is None or stop - begin != header_depth[0]:
                        raise ValueError("Duplicate JPEG2000 precision header")
                    component_depth = tuple((value & 127) + 1 for value in data[begin:stop])
                elif child == b"pclr":
                    if stop - begin < 3 or not data[begin + 2] or stop - begin < 3 + data[begin + 2]:
                        raise ValueError("Invalid JPEG2000 palette header")
                    palette_depth = max((value & 127) + 1 for value in data[begin + 3:begin + 3 + data[begin + 2]])
        elif kind == b"jp2c":
            current = codestream(memoryview(data)[start:end])
            if facts is not None and facts != current:
                raise ValueError("JPEG2000 codestream dimensions disagree")
            facts = current
    if facts is None or dimensions != facts[:2] or header_depth is None:
        raise ValueError("JPEG2000 container dimensions disagree")
    components, depth = header_depth
    expected = component_depth if depth == 255 else ((depth & 127) + 1,) * components
    if expected != facts[2] or palette_depth > 38:
        raise ValueError("JPEG2000 container precision disagrees")
    return facts[0], facts[1], max(max(facts[2]), palette_depth)


def _jbig2_header(data, *, globals_stream=False):
    """T.88 §§7.2/7.4 headers; PDF §7.4.7 omits file/page-end segments."""
    position, segments, page, last_row, region_after_stripe = 0, 0, None, -1, False
    region_types = {4, 6, 7, 20, 22, 23, 36, 38, 39, 40, 42, 43}
    while position < len(data):
        segments += 1
        if segments > 100000 or len(data) - position < 6:
            raise ValueError("Invalid JBIG2 segment header")
        number, flags = struct.unpack_from(">IB", data, position)
        count = data[position + 5] >> 5
        position += 5
        if count == 7:
            if len(data) - position < 4:
                raise ValueError("Truncated JBIG2 references")
            count = struct.unpack_from(">I", data, position)[0] & 0x1FFFFFFF
            position += 4 + (count + 8) // 8
        elif count <= 4:
            position += 1
        else:
            raise ValueError("Invalid JBIG2 reference count")
        position += count * (1 if number <= 256 else 2 if number <= 65536 else 4)
        association_size = 4 if flags & 64 else 1
        if len(data) - position < association_size + 4:
            raise ValueError("Truncated JBIG2 segment")
        association = int.from_bytes(data[position:position + association_size], "big")
        position += association_size
        length = struct.unpack_from(">I", data, position)[0]
        position += 4
        kind = flags & 63
        if association != (0 if globals_stream else 1):
            raise ValueError("Invalid embedded JBIG2 page association")
        if globals_stream and kind in region_types | {48, 49, 50}:
            raise ValueError("Invalid JBIG2 global segment")
        if length == 0xFFFFFFFF:
            if kind != 38 or len(data) - position < 18:
                raise ValueError("Invalid unknown JBIG2 segment length")
            coding = data[position + 17]
            end = data.find(b"\0\0" if coding & 1 else b"\xff\xac", position + 18)
            if end < 0 or end + 6 > len(data):
                raise ValueError("Truncated JBIG2 region terminator")
            length = end + 6 - position
        end = position + length
        if end > len(data):
            raise ValueError("Truncated JBIG2 segment data")
        if kind == 48:
            if globals_stream or page is not None or length != 19:
                raise ValueError("Invalid JBIG2 page information")
            width, height = struct.unpack_from(">II", data, position)
            striping = struct.unpack_from(">H", data, position + 17)[0]
            if not width or not height or height == 0xFFFFFFFF and not striping & 0x8000:
                raise ValueError("Invalid JBIG2 page dimensions")
            page = width, height, striping
        elif kind == 50:
            if page is None or not page[2] & 0x8000 or length != 4:
                raise ValueError("Invalid JBIG2 stripe")
            row = struct.unpack_from(">I", data, position)[0]
            if row <= last_row or row - max(last_row, 0) > (page[2] & 0x7FFF):
                raise ValueError("Invalid JBIG2 stripe height")
            last_row = row
            region_after_stripe = False
        elif not globals_stream and page is None:
            raise ValueError("Missing JBIG2 page information")
        elif kind in region_types and last_row >= 0:
            region_after_stripe = True
        position = end
    if globals_stream:
        return None
    if page is None:
        raise ValueError("Missing JBIG2 page information")
    width, height, _ = page
    if height == 0xFFFFFFFF:
        if region_after_stripe or last_row < 0:
            raise ValueError("Missing final JBIG2 stripe")
        height = last_row + 1
    elif last_row >= height:
        raise ValueError("JBIG2 stripe exceeds page")
    return width, height, 1


def _embedded_header(header, width, height, data=None):
    filters, parameters = _filters(header)
    if not filters:
        return None  # Raw samples use the image dictionary's size and precision.
    last = filters[-1]
    if last == "/CCITTFaxDecode":
        params = parameters[-1]
        if int(params.get("/Columns", 1728)) != width or int(params.get("/Rows", 0)) not in (0, height):
            raise ValueError("CCITT dimensions disagree")
        return width, height, 1
    if last in ("/DCTDecode", "/JPXDecode", "/JBIG2Decode"):
        encoded = _transport_data(header, filters[:-1], parameters[:-1], data)
        if last == "/DCTDecode":
            return jpeg_header(encoded)
        if last == "/JPXDecode":
            return _jpx_header(encoded)
        globals_value = _resolve(parameters[-1].get("/JBIG2Globals"))
        if globals_value is not None and not isinstance(globals_value, NullObject):
            global_filters, global_params = _filters(globals_value)
            _jbig2_header(_transport_data(globals_value, global_filters, global_params), globals_stream=True)
        return _jbig2_header(encoded)
    if last in ("/LZWDecode", "/ASCII85Decode"):
        # These extraction paths accept encoded PNG/TIFF as well as raw samples.
        encoded = _transport_data(header, filters, parameters, data)
        if encoded[:8] == b"\x89PNG\r\n\x1a\n":
            intrinsic = None
            for kind, payload in _checked_png_chunks(encoded):
                if kind == b"IHDR":
                    intrinsic = *struct.unpack_from(">II", payload), payload[8]
            return intrinsic
        if encoded[:4] in (b"II*\0", b"MM\0*", b"II+\0", b"MM\0+"):
            with Image.open(io.BytesIO(encoded), formats=("TIFF",)) as image:
                depth = image.tag_v2.get(258, (1,))
                return *image.size, max(depth) if isinstance(depth, tuple) else int(depth)
    return None


class _AdmissionContentStream(ContentStream):
    def _read_inline_image(self, stream):
        start = stream.tell() - 2  # The parser has just consumed BI.
        value = super()._read_inline_image(stream)
        value["source_range"] = start, stream.tell()
        return value


def _content_stream(stream, reader):
    """Retain concatenated parsing, including images split across stream boundaries."""
    stream = _resolve(stream)
    parts = stream if isinstance(stream, ArrayObject) else [stream]
    chunks, ranges, length = [], [], 0
    maximum = get_configuration().array_based_stream_maximum_output_length
    if len(parts) > 10000:
        raise ValueError("PDF content array exceeds limits")
    for item in parts:
        item = _resolve(item)
        if isinstance(item, NullObject):
            continue
        filters, parameters = _filters(item)
        data = _transport_data(item, filters, parameters)
        ranges.append((length, length + len(data), _identity(item)))
        chunks.append(data)
        length += len(data)
        if isinstance(stream, ArrayObject) and not data.endswith(b"\n"):
            chunks.append(b"\n")
            length += 1
        if length > maximum:
            raise ValueError("PDF content expansion exceeds limits")
    parsed = _AdmissionContentStream(None, reader)
    parsed.set_data(b"".join(chunks))
    return parsed, ranges



def check_webp_headers(content: bytes) -> None:
    if content[:4] != b"RIFF" or content[8:12] != b"WEBP":
        raise ValueError("Invalid WebP container")
    end = int.from_bytes(content[4:8], "little") + 8
    if not 12 <= end <= len(content):
        raise ValueError("Invalid WebP size")
    position, found = 12, False
    while position + 8 <= end:
        kind = content[position:position + 4]
        length = int.from_bytes(content[position + 4:position + 8], "little")
        start, stop = position + 8, position + 8 + length
        if stop + length % 2 > end:
            raise ValueError("Truncated WebP chunk")
        header = content[start:min(stop, start + 10)]
        width = height = None
        if kind == b"VP8X":
            if length != 10:
                raise ValueError("Invalid WebP canvas")
            if header[0] & 2:
                raise UploadProcessingError("animated_image")
            width = int.from_bytes(header[4:7], "little") + 1
            height = int.from_bytes(header[7:10], "little") + 1
        elif kind == b"VP8L":
            if length < 5 or header[0] != 47:
                raise ValueError("Invalid lossless WebP header")
            bits = int.from_bytes(header[1:5], "little")
            width, height = (bits & 16383) + 1, ((bits >> 14) & 16383) + 1
        elif kind == b"VP8 ":
            if length < 10 or header[3:6] != b"\x9d\x01\x2a":
                raise ValueError("Invalid WebP frame")
            width, height = (value & 16383 for value in struct.unpack("<HH", header[6:10]))
        elif kind in (b"ANIM", b"ANMF"):
            raise UploadProcessingError("animated_image")
        if width is not None:
            if width < 1 or height < 1:
                raise ValueError("Invalid WebP dimensions")
            if width * height > MAX_WEBP_PIXELS:
                raise UploadProcessingError("webp_pixel_limit")
            found = True
        position = stop + length % 2
    if not found or position != end:
        raise ValueError("Missing WebP dimensions")

def pdf_image_pixels(reader) -> int:
    total, seen_images, seen_streams, seen_inline, weights = 0, set(), set(), set(), {}

    def weighted_pixels(header, data=None):
        key = _identity(header) if isinstance(header, StreamObject) else None
        if key in weights:
            return weights[key]
        width = int(_resolve(header.get("/Width", header.get("/W", 0))))
        height = int(_resolve(header.get("/Height", header.get("/H", 0))))
        masked = _resolve(header.get("/ImageMask", header.get("/IM", False)))
        masked = bool(getattr(masked, "value", masked))
        is_jpx = _filters(header)[0][-1:] == ["/JPXDecode"]
        # PDF 7.4.9/Table 89: JPX precision comes from the data; BPC is ignored.
        declared_depth = None if is_jpx else _resolve(header.get("/BitsPerComponent", header.get("/BPC")))
        depth = int(declared_depth) if declared_depth is not None else 1 if masked else 8
        if width < 1 or height < 1 or depth not in (1, 2, 4, 8, 16):
            raise ValueError("Invalid embedded image dimensions")
        if width * height * max(1, (depth + 7) // 8) > MAX_PDF_SINGLE_IMAGE_PIXELS:
            raise UploadProcessingError("pdf_image_pixel_limit")
        intrinsic = _embedded_header(header, width, height, data)
        if intrinsic is not None:
            if intrinsic[:2] != (width, height) or declared_depth is not None and intrinsic[2] != depth:
                raise ValueError("Embedded image dimensions or precision disagree")
            depth = intrinsic[2]
            if not 1 <= depth <= 38:
                raise ValueError("Invalid embedded image precision")
        weight = width * height * max(1, (depth + 7) // 8)
        # Embedded JPX opacity is one same-sized mask; use the maximum channel
        # precision conservatively, just as an attached mask is charged.
        if is_jpx and int(_resolve(header.get("/SMaskInData", 0))) in (1, 2):
            weight *= 2
        if weight > MAX_PDF_SINGLE_IMAGE_PIXELS:
            raise UploadProcessingError("pdf_image_pixel_limit")
        if key is not None:
            weights[key] = weight
        return weight

    def image_with_masks(header, seen=None, data=None):
        seen = set() if seen is None else seen
        key = _identity(header)
        if key in seen or len(seen) > 64:
            raise ValueError("Invalid PDF mask graph")
        seen.add(key)
        weight = weighted_pixels(header, data)
        for name in ("/SMask", "/Mask"):
            mask = _resolve(header.get(name))
            if isinstance(mask, DictionaryObject):
                weight += image_with_masks(mask, seen)
        return weight

    def count(header, data=None):
        nonlocal total
        if data is None:
            key = _identity(header)
            if key in seen_images:
                return
            seen_images.add(key)
        weight = weighted_pixels(header, data)
        if image_with_masks(header, data=data) > MAX_PDF_SINGLE_IMAGE_PIXELS:
            raise UploadProcessingError("pdf_image_pixel_limit")
        total += weight
        if total > MAX_PDF_IMAGE_PIXELS:
            raise UploadProcessingError("pdf_pixel_limit")
        for name in ("/SMask", "/Mask"):
            mask = _resolve(header.get(name))
            if isinstance(mask, DictionaryObject):
                count(mask)

    # Charge each reachable image/mask identity once. Only transport wrappers,
    # never raster codecs, are expanded to inspect self-describing headers.
    objects = list(_pdf_objects(reader.trailer))
    for item in objects:
        if isinstance(item, DictionaryObject) and _resolve(item.get("/Subtype")) == "/Image":
            count(item)
    operations = 0
    for item in objects:
        if not isinstance(item, DictionaryObject):
            continue
        if _resolve(item.get("/Type")) == "/Page":
            stream = item.get("/Contents")
        elif _resolve(item.get("/Subtype")) == "/Form":
            stream = item
        else:
            continue
        if stream is None or isinstance(_resolve(stream), NullObject):
            continue
        key = _identity(_resolve(stream))
        if key in seen_streams:
            continue
        seen_streams.add(key)
        parsed, ranges = _content_stream(stream, reader)
        for operands, operator in parsed.operations:
            operations += 1
            if operations > 100000:
                raise ValueError("PDF content exceeds limits")
            if operator == b"INLINE IMAGE":
                start, end = operands["source_range"]
                provenance = tuple((source, max(start, left) - left, min(end, right) - left)
                                   for left, right, source in ranges if left < end and start < right)
                if provenance not in seen_inline:
                    seen_inline.add(provenance)
                    count(operands["settings"], operands["data"])
    return total


def preflight_upload(content: bytes, mime: str) -> None:
    """Check new input before pixel decode; never modify an existing stored asset."""
    try:
        if not content:
            raise ValueError("Empty input")
        if mime == "application/pdf":
            if len(content) > PDF_INPUT_BYTES:
                raise UploadProcessingError("pdf_input_too_large")
            with _private_decoding():
                pdf_image_pixels(_pdf_reader(content))
            return
        if mime not in RASTER_FORMATS:
            return
        if len(content) > IMAGE_INPUT_BYTES:
            raise UploadProcessingError("image_input_too_large")
        if mime == "image/jpeg":
            width, height = jpeg_header_size(content)
            if width * height > MAX_PIXELS:
                raise UploadProcessingError("jpeg_pixel_limit")
        elif mime == "image/png":
            header_seen = False
            for kind, payload in _checked_png_chunks(content):
                if not header_seen:
                    if kind != b"IHDR" or len(payload) != 13:
                        raise ValueError("Invalid PNG header")
                    width, height = struct.unpack_from(">II", payload)
                    if width < 1 or height < 1:
                        raise ValueError("Invalid PNG dimensions")
                    if width * height > MAX_PNG_PIXELS:
                        raise UploadProcessingError("png_pixel_limit")
                    header_seen = True
                if kind == b"cICP":
                    if len(payload) != 4:
                        raise UploadProcessingError("invalid_color_profile")
                    if payload[1] in (16, 18):
                        raise UploadProcessingError("png_hdr_requires_export")
        else:
            check_webp_headers(content)
    except UploadProcessingError:
        raise
    except Exception:
        raise UploadProcessingError("pdf_reexport_required" if mime == "application/pdf" else "invalid_image") from None
