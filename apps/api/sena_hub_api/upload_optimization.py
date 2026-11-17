"""New-upload processing only; no storage, settings, provider or database access.

Context must come from the authorized upload route, never unverified client
claims. Suggestions are private and unconfirmed; callers must not flatten them
into the asset row or a public/assistant/provider projection.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
import hashlib
import io
import logging
import math
import re
import struct
from threading import Lock
import unicodedata
import warnings
import zlib
from xml.etree import ElementTree

from PIL import Image, ImageCms, ImageOps, IptcImagePlugin, JpegImagePlugin
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ContentStream, DictionaryObject, IndirectObject, NameObject

PIPELINE_VERSION = "upload-v1"
MIB = 1024 * 1024
IMAGE_INPUT_BYTES = 30 * MIB
IMAGE_OUTPUT_BYTES = 10 * MIB
PDF_INPUT_BYTES = 50 * MIB
PDF_OUTPUT_BYTES = 20 * MIB
MAX_PIXELS = 100_000_000
MAX_EDGE = 4096
MAX_METADATA_BYTES = 256 * 1024
MAX_ICC_BYTES = 4 * MIB
RASTER_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
MAX_PDF_PAGES = 200
ACTIVE_PDF_NAMES = {"/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/SubmitForm",
                    "/ImportData", "/EmbeddedFiles", "/EmbeddedFile", "/RichMedia", "/XFA",
                    "/AcroForm", "/URI"}

# The bomb guard stays enabled. Legacy validation also enforces its own 40M
# bound before decoding; this guard permits the owner's new 100M input limit.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
IMAGE_PROCESSING_LOCK = globals().get("IMAGE_PROCESSING_LOCK") or Lock()
# Reloads must not rebind this variable: an in-flight decoding context holds
# a reset token from this exact variable, and the suppression factory reads it
# by name, so preserving it keeps suppression and context exit valid.
_PRIVATE_DECODING = globals().get("_PRIVATE_DECODING") or ContextVar(
    "hub_private_upload_decoding", default=False)


def _private_decoder_record_factory(*args, _parent=logging.getLogRecordFactory(), **kwargs):
    record = _parent(*args, **kwargs)
    if (record.name == "pyvips" or record.name.startswith("pyvips.")
            or _PRIVATE_DECODING.get() and (record.name == "PIL" or record.name == "pypdf"
                                           or record.name.startswith(("PIL.", "pypdf.")))):
        # Third-party diagnostics can interpolate raw metadata into a message.
        # Native decoder workers do not inherit ContextVars. Redact their
        # dedicated logger unconditionally before any handler can format it.
        record.msg, record.args = "Private upload decoder diagnostic suppressed", ()
        record.exc_info = record.exc_text = record.stack_info = None
    return record


# The marker lets a reload recognize our already-installed wrapper instead of
# chaining another suppression factory around it.
_private_decoder_record_factory.hub_decoder_record_factory = True
if not getattr(logging.getLogRecordFactory(), "hub_decoder_record_factory", False):
    logging.setLogRecordFactory(_private_decoder_record_factory)


@contextmanager
def _private_decoding():
    token = _PRIVATE_DECODING.set(True)
    try:
        yield
    finally:
        _PRIVATE_DECODING.reset(token)


class UploadProcessingError(ValueError):
    """Only fixed error codes leave this module; never decoder/metadata text."""


@dataclass(frozen=True)
class UploadContext:
    # Unknown category is legal unless the route supplies a marketing processing class.
    category: str | None = None
    disclosure_evidence: bool = False
    project_coordinates: tuple[float, float] | None = field(default=None, repr=False)
    active_tags: tuple[tuple[str, str], ...] = ()  # (active vocabulary ID, label)
    processing_class: str | None = None  # Server-resolved authorization result, never HTTP input.

    @property
    def legal(self) -> bool:
        if self.category == "legal_document" or self.disclosure_evidence:
            return True
        if self.processing_class is not None:
            return self.processing_class not in ("marketing_raster", "marketing_pdf")
        return self.category is None


@dataclass(frozen=True)
class ProcessedUpload:
    content: bytes = field(repr=False)
    mime_type: str
    original: dict
    processing: dict
    suggestions: dict = field(repr=False)
    width: int | None = None
    height: int | None = None


def _plain(value: object, limit: int = 1000) -> str | None:
    """Bound before decode; reject contact/path text even in allowlisted fields."""
    if isinstance(value, bytes):
        if len(value) > 8192:
            return None
        value = value.decode("utf-8", errors="replace")
    if not isinstance(value, str) or len(value) > 8192:
        return None
    value = unicodedata.normalize("NFC", value)
    value = re.sub(r"<[^>]*>", " ", value)
    value = "".join(c for c in value if not unicodedata.category(c).startswith("C") or c in "\n\t")
    value = " ".join(value.split())
    # Do not truncate away a contact/path indicator before testing the value.
    if re.search(r"[\w.+-]+@[\w.-]+|(?:(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\)|(?:file:|(?<![\w:/])(?:~?/|\.\.?/)\S)|"
                 r"(?:\+?\d[\d ()-]{7,}\d)|(?:mailto:|tel:)|\b(?:phone|email|address)\s*:", value, re.I):
        return None
    return value[:limit] or None


def _stock_agencies(value: object) -> set[str]:
    # Keep fixed signals even when a credit also contains contact information
    # that makes its text ineligible. Never retain the identifier/URL/contact.
    if isinstance(value, bytes):
        value = value[:8192].decode("utf-8", errors="replace")
    if not isinstance(value, str):
        return set()
    patterns = {"shutterstock": "shutterstock", "getty": "getty(?:images)?",
                "istock": "istock(?:photo)?", "adobe stock": "adobe[ _-]*stock"}
    return {agency for agency, pattern in patterns.items()
            if re.search(r"(?<![a-z])" + pattern + r"(?![a-z])", value[:8192], re.I)}


def _xmp_fields(raw: object) -> dict[str, list[str]]:
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if not isinstance(raw, bytes) or len(raw) > MAX_METADATA_BYTES:
        return {}
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        return {}
    try:
        root = ElementTree.fromstring(raw)
    except (ElementTree.ParseError, ValueError):
        return {}
    namespaces = {
        "http://purl.org/dc/elements/1.1/": {"creator", "rights", "description", "subject", "identifier"},
        "http://ns.adobe.com/photoshop/1.0/": {"Source"},
        "http://ns.adobe.com/xap/1.0/rights/": {"UsageTerms"},
        "http://ns.adobe.com/xap/1.0/": {"CreateDate"},
        "http://ns.adobe.com/exif/1.0/": {"DateTimeOriginal"},
        "http://iptc.org/std/Iptc4xmpExt/2008-02-29/": {"DigitalSourceType"},
    }
    allowed = {f"{{{ns}}}{name}": name for ns, names in namespaces.items() for name in names}
    fields: dict[str, list[str]] = {}
    def clean_field(name, value):
        if allowed[name] in ("creator", "rights", "UsageTerms", "identifier", "Source"):
            fields.setdefault("stock_agencies", []).extend(sorted(_stock_agencies(value)))
        if allowed[name] in ("identifier", "Source"):
            return None  # Presence only; identifiers never become retained text.
        if allowed[name] in ("DateTimeOriginal", "CreateDate"):
            return value if isinstance(value, str) and len(value) <= 40 else None
        if allowed[name] == "DigitalSourceType":
            for signal in ("trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia"):
                if value in (signal, "http://cv.iptc.org/newscodes/digitalsourcetype/" + signal,
                             "https://cv.iptc.org/newscodes/digitalsourcetype/" + signal):
                    return signal
            return None
        return _plain(value)
    rdf = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
    if root.tag not in {rdf + "RDF", rdf + "Description", "{adobe:ns:meta/}xmpmeta", "xmpmeta"}:
        return {}
    # Only current top-level properties: history/regions cannot supply a value.
    if root.tag == rdf + "RDF":
        descriptions = [item for item in root if item.tag == rdf + "Description"]
    else:
        descriptions = [item for container in root if container.tag == rdf + "RDF"
                        for item in container if item.tag == rdf + "Description"]
        if not descriptions:
            descriptions = [root]
    elements = [element for description in descriptions
                for element in [description, *description] if element is description or element.tag in allowed]
    for element in elements:
        for name, value in element.attrib.items():
            if name in allowed and (clean := clean_field(name, value)):
                fields.setdefault(allowed[name], []).append(clean)
        if element.tag not in allowed:
            continue
        # RDF containers only: never recursively collect unknown nested fields.
        values = [element.text] if not len(element) else [
            item.text for child in element if child.tag in {
                "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Bag",
                "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Seq",
                "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Alt"}
            for item in child if item.tag == "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}li" and not len(item)]
        for value in values[:32]:
            if clean := clean_field(element.tag, value):
                fields.setdefault(allowed[element.tag], []).append(clean)
    return {key: list(dict.fromkeys(values))[:32] for key, values in fields.items()}


def _capture_date(exif: dict, xmp: dict) -> dict | None:
    for date_tag, offset_tag in ((36867, 36881), (36868, 36882)):
        raw = exif.get(date_tag)
        if not isinstance(raw, str) or not re.fullmatch(r"\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}", raw):
            continue
        try:
            parsed = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
            offset = exif.get(offset_tag)
            if isinstance(offset, str) and re.fullmatch(r"[+-](?:0\d|1[0-4]):[0-5]\d", offset):
                parsed = datetime.fromisoformat(parsed.isoformat() + offset)
            return {"value": parsed.isoformat(), "offset_known": parsed.tzinfo is not None}
        except ValueError:
            continue
    for key in ("DateTimeOriginal", "CreateDate"):
        for raw in xmp.get(key, []):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?", raw):
                continue
            try:
                parsed = datetime.fromisoformat(raw)
                return {"value": parsed.isoformat(), "offset_known": parsed.tzinfo is not None}
            except ValueError:
                continue
    return None


def _proximity(gps: dict, project: tuple[float, float] | None) -> str:
    if project is None:
        return "unknown"
    try:
        def coordinate(values, reference, positive, negative, bound):
            if len(values) != 3 or reference not in (positive, negative):
                raise ValueError
            d, m, s = (float(v) for v in values)
            if not (0 <= d <= bound and 0 <= m < 60 and 0 <= s < 60):
                raise ValueError
            value = d + m / 60 + s / 3600
            if value > bound:
                raise ValueError
            return -value if reference == negative else value
        lat = coordinate(gps[2], gps[1], "N", "S", 90)
        lon = coordinate(gps[4], gps[3], "E", "W", 180)
        p_lat, p_lon = project
        if not (-90 <= p_lat <= 90 and -180 <= p_lon <= 180):
            return "unknown"
        lat, lon, p_lat, p_lon = map(math.radians, (lat, lon, p_lat, p_lon))
        a = math.sin((lat - p_lat) / 2) ** 2 + math.cos(lat) * math.cos(p_lat) * math.sin((lon - p_lon) / 2) ** 2
        return "near" if 6371008.8 * 2 * math.asin(math.sqrt(min(1, a))) <= 1000 else "far"
    except (KeyError, TypeError, ValueError, ZeroDivisionError, OverflowError):
        return "unknown"


def _jumbf_store(raw: bytes) -> bool:
    # Presence only: do not parse/assert authenticity, claims or identities.
    def header(start):
        if start + 8 > len(raw):
            return None
        length = int.from_bytes(raw[start:start + 4], "big")
        payload = start + 8
        if length == 1:
            if start + 16 > len(raw):
                return None
            length, payload = int.from_bytes(raw[start + 8:start + 16], "big"), start + 16
        if length == 0:
            length = len(raw) - start
        return (raw[start + 4:start + 8], payload, start + length) if start + length >= payload else None
    outer = header(0)
    if outer is None or outer[0] != b"jumb":
        return False
    inner = header(outer[1])
    if inner is None or inner[0] != b"jumd" or inner[2] > min(outer[2], len(raw)):
        return False
    description = raw[inner[1]:inner[2]]
    return (len(description) >= 22 and description[:16] == bytes.fromhex("6332706100110010800000aa00389b71")
            and bool(description[16] & 2) and description[17:].split(b"\0", 1)[0] == b"c2pa")


def _has_c2pa(content: bytes, picture: Image.Image) -> bool:
    if picture.format == "JPEG":
        fragments: dict[bytes, tuple[int, bytes]] = {}
        total = 0
        for marker, raw in getattr(picture, "applist", []):
            if marker != "APP11" or raw[:2] != b"JP" or len(raw) < 8:
                continue
            instance, sequence = raw[2:4], int.from_bytes(raw[4:8], "big")
            previous, data = fragments.get(instance, (0, b""))
            if sequence != previous + 1:
                continue
            total += len(raw) - 8
            if total > MAX_METADATA_BYTES:
                raise ValueError("JUMBF metadata exceeds limits")
            data += raw[8:]
            if _jumbf_store(data):
                return True
            fragments[instance] = (sequence, data)
        return False
    position = 8 if picture.format == "PNG" else 12
    while position + 12 <= len(content):
        if picture.format == "PNG":
            size = int.from_bytes(content[position:position + 4], "big")
            kind = content[position + 4:position + 8]
            end = position + 12 + size
            target = b"caBX"
        else:
            kind = content[position:position + 4]
            size = int.from_bytes(content[position + 4:position + 8], "little")
            end = position + 8 + size + size % 2
            target = b"C2PA"
        if end > len(content):
            return False
        if kind == target:
            return _jumbf_store(content[position + 8:position + 8 + min(size, MAX_METADATA_BYTES)])
        position = end
    return False


def _suggestions(picture: Image.Image, content: bytes, context: UploadContext) -> dict:
    exif = picture.getexif()
    capture = exif.get_ifd(34665) if 34665 in exif else {}
    gps = exif.get_ifd(34853) if context.project_coordinates is not None and 34853 in exif else {}
    xmp = _xmp_fields(picture.info.get("xmp", picture.info.get("XML:com.adobe.xmp", b"")))
    iptc = IptcImagePlugin.getiptcinfo(picture) or {}
    values: dict = {"proximity": _proximity(gps, context.project_coordinates)}
    if taken := _capture_date(capture, xmp):
        values["taken_at"] = taken
    evidence = []
    stock = set(xmp.get("stock_agencies", []))
    source_values = iptc.get((2, 115), [])
    for item in source_values if isinstance(source_values, list) else [source_values]:
        stock.update(_stock_agencies(item))
    for source, items in (
        ("exif_artist", [exif.get(315)]), ("exif_copyright", [exif.get(33432)]),
        ("iptc_byline", iptc.get((2, 80), [])), ("iptc_credit", iptc.get((2, 110), [])),
        ("iptc_copyright", iptc.get((2, 116), [])), ("xmp_creator", xmp.get("creator", [])),
        ("xmp_rights", xmp.get("rights", [])), ("xmp_usage_terms", xmp.get("UsageTerms", [])),
    ):
        for item in items[:16] if isinstance(items, list) else [items]:
            stock.update(_stock_agencies(item))
            if clean := _plain(item, 500):
                evidence.append({"field": source, "text": clean})
    if evidence:
        values["credit_evidence"] = evidence[:32]
        values["credit"] = "; ".join(dict.fromkeys(item["text"] for item in evidence))[:1000]
    if stock:
        values["stock"] = "present"
        values["stock_evidence"] = sorted(stock)
    software = exif.get(305, "")
    rendered = isinstance(software, str) and bool(re.search(
        r"\b(?:blender|3ds max|3dsmax|v-ray|vray|lumion|enscape|twinmotion|unreal engine|cinema 4d|corona renderer|d5 render)\b",
        software[:2048], re.I))
    ai = any(value.rsplit("/", 1)[-1] in {"trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia"}
             for value in xmp.get("DigitalSourceType", []))
    if rendered or ai or _has_c2pa(content, picture):
        values["image_kind"] = "render"
    elif exif.get(271) and exif.get(272):
        values["image_kind"] = "photo"
    captions = iptc.get((2, 120), [])
    captions = (captions if isinstance(captions, list) else [captions]) + xmp.get("description", [])
    if caption := next((text for item in captions if (text := _plain(item))), None):
        values["caption"] = caption
    keywords = iptc.get((2, 25), [])
    keywords = (keywords if isinstance(keywords, list) else [keywords]) + xmp.get("subject", [])
    clean_keywords = list(dict.fromkeys(text for item in keywords[:64] if (text := _plain(item, 80))))
    # Ambiguous labels do not map to a vocabulary ID automatically.
    vocabulary: dict[str, set[str]] = {}
    for identity, label in context.active_tags:
        vocabulary.setdefault(unicodedata.normalize("NFC", label).casefold(), set()).add(identity)
    mapped, unmatched = [], []
    for keyword in clean_keywords:
        candidates = vocabulary.get(keyword.casefold(), set())
        if len(candidates) == 1:
            mapped.extend(candidates)
        else:
            unmatched.append(keyword)
    if mapped:
        values["tags"] = list(dict.fromkeys(mapped))
    if unmatched:
        values["unmapped_keywords"] = unmatched
    return {"source": "file_metadata", "pipeline_version": PIPELINE_VERSION,
            "confirmed": False, "values": values}


def _srgb(picture: Image.Image) -> Image.Image:
    # Avoid an unconditional full-size copy before the clean pixel buffer.
    ImageOps.exif_transpose(picture, in_place=True)
    oriented = picture
    if "transparency" in oriented.info and oriented.mode in ("P", "L", "RGB"):
        oriented = oriented.convert("RGBA")
    alpha = oriented.getchannel("A") if oriented.mode in ("RGBA", "LA") else None
    if oriented.mode == "P":
        oriented = oriented.convert("RGBA" if "transparency" in oriented.info else "RGB")
        alpha = oriented.getchannel("A") if oriented.mode == "RGBA" else None
    profile = picture.info.get("icc_profile")
    if profile:
        if len(profile) > MAX_ICC_BYTES:
            raise UploadProcessingError("invalid_color_profile")
        source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        profile_mode = source.profile.xcolor_space.strip()
        if profile_mode == "RGB" and oriented.mode in ("RGB", "RGBA", "L", "LA"):
            color = oriented.convert("RGB")
        elif profile_mode == "GRAY" and oriented.mode in ("L", "LA"):
            color = oriented.convert("L")
        else:
            color = oriented
        converted = ImageCms.profileToProfile(color, source, ImageCms.createProfile("sRGB"), outputMode="RGB")
        if alpha is not None:
            converted.putalpha(alpha)
        oriented = converted
    elif oriented.mode not in ("RGB", "RGBA", "L", "LA", "I", "I;16", "I;16B"):
        oriented = oriented.convert("RGB")
    # Copy pixels only. No inherited info, EXIF, XMP, comments or thumbnails.
    clean = Image.new(oriented.mode, oriented.size)
    clean.paste(oriented)
    return clean


def _encode(picture: Image.Image, format: str, **options) -> bytes:
    stream = io.BytesIO()
    picture.save(stream, format=format, **options)
    return stream.getvalue()


def _strip_webp_metadata(content: bytes) -> bytes:
    if content[:4] != b"RIFF" or content[8:12] != b"WEBP":
        raise ValueError("Invalid WebP")
    end = int.from_bytes(content[4:8], "little") + 8
    if end > len(content):
        raise ValueError("Truncated WebP")
    chunks, seen, position = bytearray(), set(), 12
    while position + 8 <= end:
        kind = content[position:position + 4]
        size = int.from_bytes(content[position + 4:position + 8], "little")
        stop = position + 8 + size
        if stop + size % 2 > end:
            raise ValueError("Truncated WebP chunk")
        if kind in (b"VP8X", b"ALPH", b"VP8 ", b"VP8L"):
            identity = b"pixels" if kind in (b"VP8 ", b"VP8L") else kind
            if identity in seen:
                raise ValueError("Duplicate WebP image chunk")
            seen.add(identity)
            payload = content[position + 8:stop]
            if kind == b"VP8X":
                if size != 10 or payload[0] & 2:
                    raise ValueError("Animated or invalid WebP")
                payload = bytes([payload[0] & 0x10]) + b"\0\0\0" + payload[4:]
            chunks.extend(kind + size.to_bytes(4, "little") + payload + (b"\0" if size % 2 else b""))
        position = stop + size % 2
    if position != end or b"pixels" not in seen:
        raise ValueError("Invalid WebP chunks")
    return b"RIFF" + (len(chunks) + 4).to_bytes(4, "little") + b"WEBP" + chunks


def _png_chunks(content: bytes):
    if content[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid PNG")
    position = 8
    while position + 12 <= len(content):
        size = int.from_bytes(content[position:position + 4], "big")
        kind = content[position + 4:position + 8]
        end = position + 12 + size
        if end > len(content):
            raise ValueError("Truncated PNG chunk")
        payload = content[position + 8:end - 4]
        if zlib.crc32(kind + payload) != int.from_bytes(content[end - 4:end], "big"):
            raise ValueError("Invalid PNG checksum")
        yield kind, payload
        position = end
        if kind == b"IEND":
            return
    raise ValueError("Missing PNG end")


def _strip_png_metadata(content: bytes) -> tuple[bytes, bool | None]:
    # Preserve the encoded samples, including all 16 bits in RGB/RGBA PNGs.
    # Only the rendering-critical palette/transparency and pixel chunks survive.
    chunks = list(_png_chunks(content))
    header = chunks[0][1]
    if chunks[0][0] != b"IHDR" or len(header) != 13:
        raise ValueError("Invalid PNG header")
    width, height = int.from_bytes(header[:4], "big"), int.from_bytes(header[4:8], "big")
    depth, channels = header[8], {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[header[9]]
    kinds = [kind for kind, _ in chunks]
    if any(kinds.count(kind) > 1 for kind in (b"IHDR", b"PLTE", b"tRNS", b"IEND")):
        raise ValueError("Duplicate PNG structural chunk")
    palette = next((payload for kind, payload in chunks if kind == b"PLTE"), b"")
    for kind, payload in chunks:
        if (kind[0] & 32) == 0 and kind not in (b"IHDR", b"PLTE", b"IDAT", b"IEND"):
            raise ValueError("Unknown critical PNG chunk")
        if kind == b"IEND" and payload or kind == b"PLTE" and (not payload or len(payload) > 768 or len(payload) % 3):
            raise ValueError("Invalid PNG structural payload")
        if kind == b"tRNS" and not (header[9] == 0 and len(payload) == 2
                or header[9] == 2 and len(payload) == 6 or header[9] == 3 and 0 < len(payload) <= len(palette) // 3):
            raise ValueError("Invalid PNG transparency")
    passes = [(0, 0, 1, 1)] if header[12] == 0 else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
        (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    expected = 0
    for x, y, dx, dy in passes:
        columns, rows = max(0, (width - x + dx - 1) // dx), max(0, (height - y + dy - 1) // dy)
        if columns and rows:
            expected += rows * (1 + (columns * channels * depth + 7) // 8)
    compressed = b"".join(payload for kind, payload in chunks if kind == b"IDAT")
    decoder = zlib.decompressobj()
    samples = decoder.decompress(compressed, expected + 1)
    if len(samples) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("Invalid PNG pixel stream")
    optimized = zlib.compress(samples, level=9)
    if len(optimized) < len(compressed):
        compressed = optimized
    output = bytearray(content[:8])
    written_pixels = False
    for kind, payload in chunks:
        if kind in (b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"):
            if kind == b"IDAT":
                if written_pixels:
                    continue
                payload, written_pixels = compressed, True
            output.extend(len(payload).to_bytes(4, "big") + kind + payload
                          + zlib.crc32(kind + payload).to_bytes(4, "big"))
    opaque_alpha = None
    if depth == 16 and header[9] in (4, 6) and len(output) > 4 * MIB:
        # Check original alpha bytes, not the decoder's rounded 8-bit channel.
        # An opaque channel is all 255 bytes. Its filtered representation is
        # known for each row boundary, so no second full pixel decode is needed.
        opaque_alpha, position = True, 0
        pixel_bytes = channels * 2
        for x, y, dx, dy in passes:
            columns, rows = max(0, (width - x + dx - 1) // dx), max(0, (height - y + dy - 1) // dy)
            if not columns or not rows:
                continue
            row_bytes = 1 + columns * pixel_bytes
            for row in range(rows):
                filter_type = samples[position]
                if filter_type > 4:
                    raise ValueError("Invalid PNG filter")
                # First-pixel/rest expectations for None, Sub, Up, Average,
                # and Paeth. Every Adam7 pass starts with a zero previous row.
                expected = ((255, 255), (255, 0), (255, 255) if row == 0 else (0, 0),
                            (255, 128) if row == 0 else (128, 0), (255, 0) if row == 0 else (0, 0))
                first, rest = expected[filter_type]
                alpha_bytes = bytes((first,)) + bytes((rest,)) * (columns - 1)
                for offset in (pixel_bytes - 2, pixel_bytes - 1):
                    actual = samples[position + 1 + offset:position + row_bytes:pixel_bytes]
                    if actual != alpha_bytes:
                        opaque_alpha = False
                        break
                position += row_bytes
                if not opaque_alpha:
                    break
            if not opaque_alpha:
                break
    return bytes(output), opaque_alpha


# H.273 RGB chromaticities: white, red, green, blue. XYZ is a separate model.
_PNG_CICP_PRIMARIES = {
    1: (.3127, .3290, .640, .330, .300, .600, .150, .060),
    4: (.310, .316, .670, .330, .210, .710, .140, .080),
    5: (.3127, .3290, .640, .330, .290, .600, .150, .060),
    6: (.3127, .3290, .630, .340, .310, .595, .155, .070),
    7: (.3127, .3290, .630, .340, .310, .595, .155, .070),
    8: (.310, .316, .681, .319, .243, .692, .145, .049),
    9: (.3127, .3290, .708, .292, .170, .797, .131, .046),
    11: (.314, .351, .680, .320, .265, .690, .150, .060),
    12: (.3127, .3290, .680, .320, .265, .690, .150, .060),
    22: (.3127, .3290, .630, .340, .295, .605, .155, .077),
}


def _png_sdr_profile(chromaticity: tuple | None, gamma: float | None, *, transfer: int = 13) -> bytes:
    """Describe PNG SDR samples to LittleCMS; it performs the pixel conversion.

    ICC.1:2022 XYZ/TRC tags and Bradford adaptation to D50. The generated
    profile contains no source metadata. PNG gAMA stores the encoding exponent.
    """
    template = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    count = int.from_bytes(template[128:132], "big")
    tags = {}
    for index in range(count):
        key, offset, size = struct.unpack_from(">4sII", template, 132 + 12 * index)
        tags[key] = template[offset:offset + size]
    fixed = lambda values: struct.pack(">" + "i" * len(values), *(round(v * 65536) for v in values))
    if transfer in (4, 5, 8):
        gamma = {4: 1 / 2.2, 5: 1 / 2.8, 8: 1}[transfer]
    curve = None
    if gamma is not None:
        if not math.isfinite(gamma) or not 0.01 <= gamma <= 100:
            raise UploadProcessingError("invalid_color_profile")
        curve = b"para" + b"\0" * 8 + fixed((1 / gamma,))
    elif transfer in (1, 6, 7, 11, 12, 14, 15):
        # Invert H.273's signal transfer, not a guessed display gamma.
        # Values follow continuity of value and slope at the linear join.
        alpha, beta, slope = ((1.111572195921731, .022821585529445, 4)
                              if transfer == 7 else (1.099296826809442, .018053968510807, 4.5))
        curve = (b"para" + b"\0" * 4 + struct.pack(">HH", 3, 0)
                 + fixed((1 / .45, 1 / alpha, (alpha - 1) / alpha, 1 / slope, slope * beta)))
    elif transfer != 13:
        raise UploadProcessingError("image_color_space_requires_export")
    if curve is not None:
        for key in (b"rTRC", b"gTRC", b"bTRC"):
            tags[key] = curve
    if chromaticity is not None:
        if len(chromaticity) != 8 or not all(math.isfinite(v) for v in chromaticity):
            raise UploadProcessingError("invalid_color_profile")
        def xyz(x, y):
            if not (0 <= x <= 1 and 0 < y <= 1 and x + y <= 1.00001):
                raise UploadProcessingError("invalid_color_profile")
            return (x / y, 1, (1 - x - y) / y)
        def multiply(matrix, vector):
            return tuple(sum(a * b for a, b in zip(row, vector)) for row in matrix)
        def solve(matrix, target):
            rows = [list(row) + [value] for row, value in zip(matrix, target)]
            for column in range(3):
                pivot = max(range(column, 3), key=lambda row: abs(rows[row][column]))
                rows[column], rows[pivot] = rows[pivot], rows[column]
                divisor = rows[column][column]
                if abs(divisor) < 1e-9:
                    raise UploadProcessingError("invalid_color_profile")
                rows[column] = [v / divisor for v in rows[column]]
                for row in range(3):
                    if row != column:
                        scale = rows[row][column]
                        rows[row] = [a - scale * b for a, b in zip(rows[row], rows[column])]
            return tuple(row[3] for row in rows)
        white = xyz(*chromaticity[:2])
        primaries = [xyz(*chromaticity[index:index + 2]) for index in (2, 4, 6)]
        scales = solve(tuple(zip(*primaries)), white)
        if min(scales) <= 0:
            raise UploadProcessingError("invalid_color_profile")
        bradford = ((0.8951, 0.2664, -0.1614), (-0.7502, 1.7135, 0.0367), (0.0389, -0.0685, 1.0296))
        source_cones, target_cones = multiply(bradford, white), multiply(bradford, (0.9642, 1, 0.8249))
        if min(source_cones) <= 0:
            raise UploadProcessingError("invalid_color_profile")
        def adapt(vector):
            cones = multiply(bradford, vector)
            return solve(bradford, tuple(v * target / source for v, target, source
                                         in zip(cones, target_cones, source_cones)))
        for key, primary, scale in zip((b"rXYZ", b"gXYZ", b"bXYZ"), primaries, scales):
            tags[key] = b"XYZ " + b"\0" * 4 + fixed(adapt(tuple(v * scale for v in primary)))
        adaptation = tuple(zip(*(adapt(axis) for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1)))))
        tags[b"chad"] = b"sf32" + b"\0" * 4 + fixed(tuple(v for row in adaptation for v in row))
    header = bytearray(template[:128])
    header[84:100] = b"\0" * 16  # Recomputed profile has no inherited profile ID.
    entries, payloads = bytearray(), bytearray()
    offset = 132 + 12 * len(tags)
    for key, payload in tags.items():
        entries.extend(struct.pack(">4sII", key, offset + len(payloads), len(payload)))
        payloads.extend(payload + b"\0" * (-len(payload) % 4))
    result = header + struct.pack(">I", len(tags)) + entries + payloads
    result[:4] = struct.pack(">I", len(result))
    return bytes(result)


def _png_color_description(content: bytes, picture: Image.Image) -> tuple[bool, int, bool, int]:
    depth, color_type, alpha, cicp, srgb = 8, 2, False, None, False
    for kind, payload in _png_chunks(content):
        if kind == b"IHDR":
            depth, color_type, alpha = payload[8], payload[9], payload[9] in (4, 6)
        elif kind == b"tRNS":
            alpha = True
        elif kind == b"acTL":
            raise UploadProcessingError("animated_image")
        elif kind == b"cICP":
            cicp = payload
        elif kind == b"sRGB":
            srgb = True
    unknown_cicp = False
    if cicp is not None:
        if len(cicp) != 4 or cicp[2] != 0 or cicp[3] not in (0, 1):
            raise UploadProcessingError("invalid_color_profile")
        primaries, transfer, _, full_range = cicp
        if primaries not in (*_PNG_CICP_PRIMARIES, 2, 10) or transfer not in (1, 2, *range(4, 19)):
            raise UploadProcessingError("invalid_color_profile")
        unknown_cicp = primaries == 2 or transfer == 2
        if not unknown_cicp:
            if cicp == bytes((1, 13, 0, 1)):
                return True, depth, alpha, color_type
            if full_range and primaries != 10 and transfer not in (9, 10, 16, 17, 18):
                picture.info["icc_profile"] = _png_sdr_profile(
                    _PNG_CICP_PRIMARIES[primaries], None, transfer=transfer)
            else:
                # A private instruction, not retained source metadata. Float
                # processing preserves narrow-range excursions through the matrix.
                picture.info["_hub_cicp"] = tuple(cicp)
            return False, depth, alpha, color_type
    if picture.info.get("icc_profile"):
        return False, depth, alpha, color_type
    if srgb:
        return True, depth, alpha, color_type
    if unknown_cicp and not ("gamma" in picture.info and "chromaticity" in picture.info):
        raise UploadProcessingError("image_color_space_requires_export")
    if "gamma" in picture.info or "chromaticity" in picture.info:
        picture.info["icc_profile"] = _png_sdr_profile(picture.info.get("chromaticity"), picture.info.get("gamma"))
        return False, depth, alpha, color_type
    return True, depth, alpha, color_type  # Untagged PNG uses the ordinary sRGB assumption.



def _png_native_image(clean: bytes):
    import pyvips

    # This backend is private to uploads. Disable input retention and tracing,
    # including operations performed by native threads without our ContextVar.
    pyvips.cache_set_max(0)
    pyvips.cache_set_trace(False)
    image = pyvips.Image.pngload_buffer(clean, memory=True, fail_on="warning")
    if image.format not in ("uchar", "ushort"):
        raise UploadProcessingError("invalid_image")
    return image



def _solve_color_matrix(matrix, vector):
    rows = [list(row) + [value] for row, value in zip(matrix, vector)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda row: abs(rows[row][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        divisor = rows[col][col]
        rows[col] = [v / divisor for v in rows[col]]
        for row in range(3):
            if row != col:
                scale = rows[row][col]
                rows[row] = [v - scale * p for v, p in zip(rows[row], rows[col])]
    return tuple(row[3] for row in rows)


def _png_cicp_matrix(source: int, target: int):
    # Derive floating matrices directly. Reading ICC fixed-point colorant tags
    # here would round the source space before the HDR/nonlinear calculations.
    def xyz(x, y):
        return (x / y, 1, (1 - x - y) / y)
    def multiply(matrix, vector):
        return tuple(sum(a * b for a, b in zip(row, vector)) for row in matrix)
    def columns(code):
        xy = _PNG_CICP_PRIMARIES[code]
        white = xyz(*xy[:2])
        primaries = [xyz(*xy[index:index + 2]) for index in (2, 4, 6)]
        scales = _solve_color_matrix(tuple(zip(*primaries)), white)
        return white, [tuple(v * scale for v in primary) for primary, scale in zip(primaries, scales)]
    target_white, target_columns = columns(target)
    if source == 10:
        # XYZ is absolute tristimulus data, without an inferred scene white.
        source_columns = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    else:
        source_white, source_columns = columns(source)
        if source_white != target_white:
            bradford = ((.8951, .2664, -.1614), (-.7502, 1.7135, .0367), (.0389, -.0685, 1.0296))
            ratios = tuple(t / s for t, s in zip(multiply(bradford, target_white), multiply(bradford, source_white)))
            source_columns = [_solve_color_matrix(bradford, tuple(v * scale for v, scale in
                              zip(multiply(bradford, column), ratios))) for column in source_columns]
    matrix = tuple(zip(*target_columns))
    return [list(row) for row in zip(*(_solve_color_matrix(matrix, column) for column in source_columns))]


def _hdr_pq_decode(signal):
    # BT.2100 Table 4. Signed extension retains PNG range excursions until
    # primary conversion and explicit reference-display gamut clipping.
    power = signal.abs() ** (32 / 2523)
    numerator = power - 3424 / 4096
    numerator = (numerator < 0).ifthenelse(0, numerator)
    linear = 10000 * (numerator / (2413 / 128 - 2392 / 128 * power)) ** (16384 / 2610)
    return (signal < 0).ifthenelse(-linear, linear)


def _hdr_pq_encode(linear):
    power = (linear.abs() / 10000) ** (2610 / 16384)
    signal = ((3424 / 4096 + 2413 / 128 * power) / (1 + 2392 / 128 * power)) ** (2523 / 32)
    return (linear < 0).ifthenelse(-signal, signal)


def _png_hdr_to_sdr(linear, transfer: int):
    """BT.2408 Annex 5 intensity bridge, then BT.2446-1 Method A.

    Input is signed BT.2020 float: PQ display nits, or HLG scene light.
    Output is linear BT.2020 relative to the 100-nit SDR reference display.
    Alpha is never passed here. No source mastering metadata is retained.
    """
    import pyvips

    if transfer == 18:
        # HLG reference display: 1000 cd/m2, zero black, system gamma 1.2.
        y = .2627 * linear[0] + .6780 * linear[1] + .0593 * linear[2]
        linear *= (y < 0).ifthenelse(0, y) ** .2 * 1000
    else:
        # Unknown mastering conditions use the standard 0..10000-nit defaults.
        # Constrain to the reference BT.2020 display only after primary conversion.
        linear = (linear < 0).ifthenelse(0, (linear > 10000).ifthenelse(10000, linear))
        lms_matrix = [[v / 4096 for v in row] for row in
                      ((1688, 2146, 262), (683, 2951, 462), (99, 309, 3688))]
        lms_prime = _hdr_pq_encode(linear.recomb(pyvips.Image.new_from_array(lms_matrix)))
        intensity = (lms_prime[0] + lms_prime[1]) / 2
        pq_black = (3424 / 4096) ** (2523 / 32)
        pq_target = ((3424 / 4096 + 2413 / 128 * .1 ** (2610 / 16384)) /
                     (1 + 2392 / 128 * .1 ** (2610 / 16384))) ** (2523 / 32)
        target = (pq_target - pq_black) / (1 - pq_black)
        knee = 1.5 * target - .5
        normalized = (intensity - pq_black) / (1 - pq_black)
        t = (normalized - knee) / (1 - knee)
        spline = ((2 * t ** 3 - 3 * t ** 2 + 1) * knee
                  + (t ** 3 - 2 * t ** 2 + t) * (1 - knee)
                  + (-2 * t ** 3 + 3 * t ** 2) * target)
        mapped = (normalized < knee).ifthenelse(normalized, spline) * (1 - pq_black) + pq_black
        # Adding the same delta to L', M', S' changes I and preserves Ct/Cp
        # exactly: both chroma-matrix row sums are zero (BT.2100 Table 7).
        lms = _hdr_pq_decode(lms_prime + (mapped - intensity))
        inverse = [list(row) for row in zip(*(_solve_color_matrix(lms_matrix, axis)
                   for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1))))]
        linear = lms.recomb(pyvips.Image.new_from_array(inverse))
    # The bridge/reference display is a 0..1000-nit BT.2020 color volume.
    # Clipping its gamut/headroom is explicit, after signed color conversion.
    linear = (linear < 0).ifthenelse(0, (linear > 1000).ifthenelse(1000, linear))
    encoded = (linear / 1000) ** (1 / 2.4)
    y = .2627 * encoded[0] + .6780 * encoded[1] + .0593 * encoded[2]
    rho_hdr, rho_sdr = 1 + 32 * .1 ** (1 / 2.4), 1 + 32 * .01 ** (1 / 2.4)
    perceptual = (1 + (rho_hdr - 1) * y).log() / math.log(rho_hdr)
    curved = (perceptual <= .7399).ifthenelse(1.077 * perceptual,
        (perceptual < .9909).ifthenelse(-1.151 * perceptual ** 2 + 2.7811 * perceptual - .6302,
                                       .5 * perceptual + .5))
    target_y = ((curved * math.log(rho_sdr)).exp() - 1) / (rho_sdr - 1)
    # Guard exact black without a threshold that would discard near-black detail.
    scale = (y == 0).ifthenelse(0, target_y / (1.1 * (y == 0).ifthenelse(1, y)))
    cb, cr = scale * (encoded[2] - y) / 1.8814, scale * (encoded[0] - y) / 1.4746
    corrected = target_y - (cr > 0).ifthenelse(.1 * cr, 0)
    red, blue = corrected + 1.4746 * cr, corrected + 1.8814 * cb
    green = (corrected - .2627 * red - .0593 * blue) / .6780
    color = red.bandjoin([green, blue])
    return (color < 0).ifthenelse(0, color) ** 2.4


def _png_cicp_float(image, cicp: tuple, source_depth: int):
    """H.273 decoding with signed PNG narrow-range extension and final sRGB clipping."""
    import pyvips

    primaries, transfer, _, full_range = cicp
    peak = 65535 if image.format == "ushort" else 255
    alpha = image[-1] if image.hasalpha() else None
    color = image.extract_band(0, n=image.bands - int(alpha is not None)).cast("double" if transfer in (16, 18) else "float")
    if color.bands == 1:
        color = color.bandjoin([color, color])
    signal = color / peak
    if not full_range:
        # Palette samples are 8-bit; expanded sub-byte gray samples are scaled
        # back to their original code depth before the range equation.
        signal = (color * (((1 << source_depth) - 1) / peak) / (2 ** (source_depth - 8)) - 16) / 219
    magnitude = signal.abs()
    if transfer == 16:
        linear = _hdr_pq_decode(magnitude)
    elif transfer == 18:
        a = .17883277
        b, c = 1 - 4 * a, .5 - a * math.log(4 * a)
        linear = (magnitude <= .5).ifthenelse(magnitude ** 2 / 3, (((magnitude - c) / a).exp() + b) / 12)
    elif transfer in (4, 5, 8, 17):
        linear = magnitude ** {4: 2.2, 5: 2.8, 8: 1, 17: 2.6}[transfer]
        if transfer == 17:
            linear *= 52.37 / 48  # ST 428 reference luminance, relative to 48 cd/m2.
    elif transfer in (9, 10):
        # The continuous inverse selects the upper end of the encoded-black
        # interval, as in the reference decoder; no lost shadow detail is invented.
        linear = ((magnitude - 1) * (2 if transfer == 9 else 2.5)).exp10()
    elif transfer == 13:
        linear = (magnitude <= .04045).ifthenelse(magnitude / 12.92, ((magnitude + .055) / 1.055) ** 2.4)
    else:
        a, b, slope = ((1.111572195921731, .022821585529445, 4)
                       if transfer == 7 else (1.099296826809442, .018053968510807, 4.5))
        linear = (magnitude < slope * b).ifthenelse(magnitude / slope, ((magnitude + a - 1) / a) ** (1 / .45))
        if transfer == 12:
            negative = (magnitude < slope * b / 4).ifthenelse(
                magnitude / slope, ((4 * magnitude + a - 1) / a) ** (1 / .45) / 4)
            linear = (signal < 0).ifthenelse(negative, linear)
    linear = (signal < 0).ifthenelse(-linear, linear)
    if not full_range and transfer in (9, 10):
        linear = (signal == 0).ifthenelse(0, linear)  # PNG sign(0) extension.

    target = 9 if transfer in (16, 18) else 1
    if primaries != target:
        linear = linear.recomb(pyvips.Image.new_from_array(_png_cicp_matrix(primaries, target)))
    if transfer in (16, 18):
        linear = _png_hdr_to_sdr(linear, transfer)
        linear = linear.recomb(pyvips.Image.new_from_array(_png_cicp_matrix(9, 1)))
    # Negative/over-range samples participate in the entire matrix before the
    # output gamut is clipped. Transfer and quantization never affect alpha.
    positive = (linear < 0).ifthenelse(0, linear)
    encoded = (positive <= .0031308).ifthenelse(positive * 12.92, 1.055 * positive ** (1 / 2.4) - .055)
    encoded = (encoded > 1).ifthenelse(1, encoded) * peak
    encoded = encoded.copy(interpretation="rgb16" if peak == 65535 else "srgb")
    return encoded.bandjoin(alpha) if alpha is not None else encoded


def _png_native_transform(content: bytes, *, profile: bytes | None, orientation: int,
                          force_jpeg: bool, cicp: tuple | None = None,
                          source_depth: int = 16, color_type: int = 2) -> tuple[bytes, str, int | None, int, int]:
    """Keep source PNG precision until the authorized opaque JPEG exception."""
    import pyvips

    clean, _ = _strip_png_metadata(content)
    image = _png_native_image(clean)
    output_depth = 16 if image.format == "ushort" else 8
    peak = (1 << output_depth) - 1
    source_opaque = not image.hasalpha() or image[-1].min() == peak
    if orientation != 1:
        image = image.copy()
        image.set_type(pyvips.GValue.gint_type, "orientation", orientation)
        image = image.autorot()
    if cicp is not None:
        image = _png_cicp_float(image, cicp, 8 if color_type == 3 else source_depth)
    elif profile:
        if len(profile) > MAX_ICC_BYTES:
            raise UploadProcessingError("invalid_color_profile")
        source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        source_space = source.profile.xcolor_space.strip()
        alpha = image[-1] if image.hasalpha() else None
        color = image.extract_band(0, n=image.bands - int(alpha is not None))
        if source_space == "RGB" and color.bands == 1:
            color = color.bandjoin([color, color]).copy(interpretation="rgb16")
        if (source_space, color.bands) not in (("RGB", 3), ("GRAY", 1)):
            raise UploadProcessingError("invalid_color_profile")
        color = color.copy()
        color.set_type(pyvips.GValue.blob_type, "icc-profile-data", profile)
        color = color.icc_transform("srgb", embedded=True, depth=16, intent="perceptual")
        image = color.bandjoin(alpha) if alpha is not None else color
    if max(image.width, image.height) > MAX_EDGE:
        scale = MAX_EDGE / max(image.width, image.height)
        if image.hasalpha():
            image = (image.premultiply(max_alpha=peak).resize(scale, kernel="lanczos3")
                     .unpremultiply(max_alpha=peak))
        else:
            # Integer resampling can lose low bits even on constant patches.
            image = image.cast("float").resize(scale, kernel="lanczos3")
    image = image.rint().cast("ushort" if output_depth == 16 else "uchar")
    encoded = image.pngsave_buffer(bitdepth=output_depth, compression=9, keep=0)
    encoded, _ = _strip_png_metadata(encoded)
    opaque = source_opaque and (not image.hasalpha() or image[-1].min() == peak)
    quality, mime = None, "image/png"
    if opaque and (force_jpeg or len(encoded) > 4 * MIB):
        # JPEG has an explicitly authorized 8-bit output; PNG never does.
        color = image.extract_band(0, n=image.bands - int(image.hasalpha()))
        color = (color * (255 / peak)).rint().cast("uchar")
        color = color.copy(interpretation="b-w" if color.bands == 1 else "srgb")
        encoded = color.jpegsave_buffer(Q=90, optimize_coding=True, keep=0)
        encoded = _strip_jpeg_metadata(encoded)
        quality, mime = 90, "image/jpeg"
    if len(encoded) > IMAGE_OUTPUT_BYTES:
        raise UploadProcessingError("image_output_too_large")
    return encoded, mime, quality, image.width, image.height


def optimize_image(content: bytes, mime: str, context: UploadContext) -> ProcessedUpload:
    """Marketing raster only. Legal/unknown files use existing byte-exact checks."""
    if context.legal or context.processing_class not in (None, "marketing_raster"):
        raise UploadProcessingError("legal_processing_forbidden")
    if mime not in RASTER_FORMATS or not content:
        raise UploadProcessingError("invalid_image")
    if len(content) > IMAGE_INPUT_BYTES:
        raise UploadProcessingError("image_input_too_large")
    try:
        with IMAGE_PROCESSING_LOCK, _private_decoding(), warnings.catch_warnings():
            warnings.simplefilter("error")
            with Image.open(io.BytesIO(content)) as check:
                if check.format != RASTER_FORMATS[mime] or not 0 < check.width * check.height <= MAX_PIXELS:
                    raise UploadProcessingError("invalid_image")
                if getattr(check, "n_frames", 1) != 1 or getattr(check, "is_animated", False):
                    raise UploadProcessingError("animated_image")
                check.verify()
            with Image.open(io.BytesIO(content)) as picture:
                picture.load()
                suggestions = _suggestions(picture, content, context)
                original = {"checksum": hashlib.sha256(content).hexdigest(), "size": len(content),
                            "mime_type": mime, "width": picture.width, "height": picture.height}
                small = max(picture.size) <= MAX_EDGE and len(content) <= 2 * MIB
                preserve_encoding = (small and picture.getexif().get(274, 1) == 1
                                     and not picture.info.get("icc_profile") and picture.mode in ("RGB", "RGBA", "L"))
                png_force_jpeg = False
                if picture.format == "PNG":
                    encoded_srgb, depth, has_alpha, color_type = _png_color_description(content, picture)
                    keep_pixels = encoded_srgb and max(picture.size) <= MAX_EDGE and picture.getexif().get(274, 1) == 1
                    if keep_pixels:
                        clean, opaque_alpha = _strip_png_metadata(content)
                        # An alpha channel need not contain transparent pixels.
                        if opaque_alpha is not None:
                            has_alpha = not opaque_alpha
                        elif len(clean) > 4 * MIB and has_alpha and depth <= 8:
                            alpha = picture.getchannel("A") if "A" in picture.getbands() else picture.convert("RGBA").getchannel("A")
                            has_alpha = alpha.getextrema()[0] < 255
                        elif len(clean) > 4 * MIB and has_alpha and color_type in (0, 2):
                            # A 16-bit transparency key may not match any pixel.
                            # Compare it before any sample rounding or conversion.
                            has_alpha = _png_native_image(clean)[-1].min() < 65535
                        # The explicit large opaque PNG exception still applies.
                        if len(clean) <= 4 * MIB or has_alpha:
                            if len(clean) > IMAGE_OUTPUT_BYTES:
                                raise UploadProcessingError("image_output_too_large")
                            return ProcessedUpload(clean, mime, original, {
                                "pipeline_version": PIPELINE_VERSION, "max_edge": MAX_EDGE, "quality": None,
                                "output_format": "png", "metadata_stripped": True,
                                "pdf_images_recompressed": False, "kept_original_because_no_gain": False,
                            }, suggestions, picture.width, picture.height)
                        png_force_jpeg = True  # Already losslessly optimized above the opaque PNG limit.
                    if depth > 8 or "_hub_cicp" in picture.info:
                        cicp = picture.info.get("_hub_cicp")
                        profile = None if encoded_srgb else picture.info.get("icc_profile")
                        orientation = picture.getexif().get(274, 1)
                        picture.close()  # Release the metadata reader's 8-bit pixel copy.
                        encoded, mime, quality, width, height = _png_native_transform(
                            content, profile=profile, orientation=orientation, force_jpeg=png_force_jpeg,
                            cicp=cicp, source_depth=depth, color_type=color_type)
                        return ProcessedUpload(encoded, mime, original, {
                            "pipeline_version": PIPELINE_VERSION, "max_edge": MAX_EDGE, "quality": quality,
                            "output_format": "png" if mime == "image/png" else "jpeg", "metadata_stripped": True,
                            "pdf_images_recompressed": False, "kept_original_because_no_gain": False,
                        }, suggestions, width, height)
                    if encoded_srgb:
                        picture.info.pop("icc_profile", None)  # Understood cICP takes precedence.
                output = _srgb(picture)
                output.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                format = picture.format
                quality: str | int | None = None
                if format == "JPEG":
                    if preserve_encoding:
                        quality, encoded = "keep", _strip_jpeg_metadata(content)
                    elif small:
                        quality = "keep"
                        encoded = _encode(output, format, qtables=picture.quantization,
                                          subsampling=JpegImagePlugin.get_sampling(picture), optimize=True)
                    else:
                        quality = 85
                        encoded = _encode(output, format, quality=quality, optimize=True)
                elif format == "WEBP":
                    if preserve_encoding:
                        quality, encoded = "keep", _strip_webp_metadata(content)
                    else:
                        quality = "lossless" if small else 85
                        encoded = _encode(output, format, lossless=small, quality=100 if small else 85, method=6)
                else:
                    encoded = b"" if png_force_jpeg else _encode(output, format, optimize=True)
                    opaque = "A" not in output.getbands() or output.getchannel("A").getextrema()[0] == 255
                    if png_force_jpeg or len(encoded) > 4 * MIB and opaque:
                        format, mime, quality = "JPEG", "image/jpeg", 90
                        if output.mode in ("I", "I;16", "I;16B"):
                            output = output.convert("I").point(lambda value: value * (255 / 65535) + 0.5).convert("L")
                        encoded = _encode(output.convert("RGB"), format, quality=quality, optimize=True)
                if len(encoded) > IMAGE_OUTPUT_BYTES:
                    raise UploadProcessingError("image_output_too_large")
                return ProcessedUpload(encoded, mime, original, {
                    "pipeline_version": PIPELINE_VERSION, "max_edge": MAX_EDGE, "quality": quality,
                    "output_format": format.lower(), "metadata_stripped": True,
                    "pdf_images_recompressed": False, "kept_original_because_no_gain": False,
                }, suggestions, output.width, output.height)
    except UploadProcessingError:
        raise
    except Exception:
        raise UploadProcessingError("invalid_image") from None



def extract_reused_suggestions(content: bytes, mime: str, context: UploadContext,
                               original_checksum: str) -> dict:
    """Fresh private evidence for an authorized, class-compatible original reuse.

    The caller resolves access and the immutable original mapping first. This
    helper neither retrieves nor writes storage, and never encodes an image/PDF.
    Legal callers retain their existing byte-exact validator and no suggestions.
    """
    expected_class = "marketing_pdf" if mime == "application/pdf" else "marketing_raster"
    if not context.legal and context.processing_class not in (None, expected_class):
        raise UploadProcessingError("legal_processing_forbidden")
    limit = 10 * MIB if context.legal else PDF_INPUT_BYTES if mime == "application/pdf" else IMAGE_INPUT_BYTES
    if not content or len(content) > limit:
        raise UploadProcessingError("legal_input_too_large" if context.legal else
                                    "pdf_input_too_large" if mime == "application/pdf" else "image_input_too_large")
    if hashlib.sha256(content).hexdigest() != original_checksum:
        raise UploadProcessingError("original_source_mismatch")
    if context.legal:
        return {}
    try:
        with IMAGE_PROCESSING_LOCK, _private_decoding(), warnings.catch_warnings():
            warnings.simplefilter("error")
            if mime == "application/pdf":
                reader = _pdf_reader(content)
                title = _plain(reader.metadata.get("/Title")) if reader.metadata else None
                return {"source": "file_metadata", "pipeline_version": PIPELINE_VERSION,
                        "confirmed": False, "values": {"caption": title} if title else {}}
            if mime not in RASTER_FORMATS:
                raise UploadProcessingError("invalid_image")
            with Image.open(io.BytesIO(content)) as check:
                if check.format != RASTER_FORMATS[mime] or not 0 < check.width * check.height <= MAX_PIXELS:
                    raise UploadProcessingError("invalid_image")
                if getattr(check, "n_frames", 1) != 1 or getattr(check, "is_animated", False):
                    raise UploadProcessingError("animated_image")
                check.verify()
            with Image.open(io.BytesIO(content)) as picture:
                picture.load()
                return _suggestions(picture, content, context)
    except UploadProcessingError:
        raise
    except Exception:
        raise UploadProcessingError("pdf_reexport_required" if mime == "application/pdf" else "invalid_image") from None


def _pdf_objects(root):
    stack, seen, visited = [(root, 0)], set(), 0
    while stack:
        item, depth = stack.pop()
        visited += 1
        if visited > 100000 or depth > 64:
            raise ValueError("PDF structure exceeds limits")
        if isinstance(item, IndirectObject):
            key = (item.idnum, item.generation)
            if key in seen:
                continue
            seen.add(key)
            item = item.get_object()
        yield item
        if isinstance(item, DictionaryObject):
            stack.extend((value, depth + 1) for value in item.values())
        elif isinstance(item, ArrayObject):
            stack.extend((value, depth + 1) for value in item)


def _pdf_reader(content: bytes) -> PdfReader:
    # Same active-content and graph/page limits as assets.validate_pdf. During
    # integration that entry point delegates here, avoiding two policy copies.
    if not content.startswith(b"%PDF-"):
        raise ValueError("Missing PDF header")
    reader = PdfReader(io.BytesIO(content), strict=True)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDF")
    for item in _pdf_objects(reader.trailer):
        if isinstance(item, NameObject) and str(item) in ACTIVE_PDF_NAMES:
            raise ValueError("Active PDF content")
        if isinstance(item, DictionaryObject) and ACTIVE_PDF_NAMES.intersection(item.keys()):
            raise ValueError("Active PDF content")
    if not 1 <= len(reader.pages) <= MAX_PDF_PAGES:
        raise ValueError("PDF page count exceeds limits")
    return reader


def validate_pdf(content: bytes) -> None:
    with _private_decoding():
        _pdf_reader(content)


def _strip_jpeg_metadata(content: bytes) -> bytes:
    """Remove metadata segments without changing any entropy-coded pixel data."""
    if content[:2] != b"\xff\xd8":
        raise ValueError("Invalid embedded JPEG")
    output = bytearray(content[:2])
    position = 2
    while position < len(content):
        start = position
        if content[position] != 255:
            raise ValueError("Invalid embedded JPEG marker")
        while position < len(content) and content[position] == 255:
            position += 1
        if position >= len(content):
            break
        marker = content[position]
        position += 1
        if marker == 0xD9:
            output.extend(b"\xff\xd9")
            return bytes(output)  # No trailing thumbnail or other appended bytes.
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            output.extend(content[start:position])
            continue
        if marker in (0, 0xD8) or position + 2 > len(content):
            raise ValueError("Invalid embedded JPEG marker")
        length = int.from_bytes(content[position:position + 2], "big")
        end = position + length
        if length < 2 or end > len(content):
            raise ValueError("Invalid embedded JPEG length")
        raw = content[position + 2:end]
        if marker == 0xEE and len(raw) == 12 and raw[:5] == b"Adobe":
            # Adobe transform byte is required to decode CMYK/YCCK correctly.
            # Emit only the standard fixed header and bounded color transform.
            if raw[-1] not in (0, 1, 2):
                raise ValueError("Invalid embedded JPEG color transform")
            output.extend(b"\xff\xee\x00\x0eAdobe\x00\x64\x00\x00\x00\x00" + raw[-1:])
        elif not (0xE0 <= marker <= 0xEF or marker == 0xFE):
            output.extend(content[start:end])
        position = end
        if marker == 0xDA:
            start = position
            while position < len(content):
                if content[position] != 255:
                    position += 1
                    continue
                following = position + 1
                while following < len(content) and content[following] == 255:
                    following += 1
                if following >= len(content):
                    raise ValueError("Truncated embedded JPEG")
                if content[following] == 0 or 0xD0 <= content[following] <= 0xD7:
                    position = following + 1
                    continue
                break
            output.extend(content[start:position])
    raise ValueError("Truncated embedded JPEG")


def _pdf_image_key(item) -> int:
    reference = getattr(item, "indirect_reference", None)
    return reference.idnum if reference else id(item)


def _clean_pdf_metadata(writer: PdfWriter) -> None:
    writer.metadata = None
    for item in _pdf_objects(writer.root_object):
        if not isinstance(item, DictionaryObject):
            continue
        for key in ("/Metadata", "/PieceInfo", "/LastModified"):
            item.pop(key, None)
        if item.get("/Type") == "/Page":
            item.pop("/Thumb", None)
        if item.get("/Type") == "/Annot":
            for key in ("/T", "/M", "/CreationDate"):
                item.pop(key, None)
        if item.get("/Subtype") != "/Image":
            continue
        if not 0 < int(item.get("/Width", 0)) * int(item.get("/Height", 0)) <= MAX_PIXELS:
            raise ValueError("Invalid embedded image dimensions")
        filters = item.get("/Filter", [])
        filters = filters if isinstance(filters, ArrayObject) else [filters]
        if "/JPXDecode" in filters:
            # Unknown embedded metadata cannot be preserved in marketing files.
            raise ValueError("Embedded metadata cannot be removed safely")
        if "/DCTDecode" in filters:
            clean = _strip_jpeg_metadata(item.get_data())
            item._data = clean
            item[NameObject("/Filter")] = NameObject("/DCTDecode")
            item.pop("/DecodeParms", None)
            item.decoded_self = None


def _matrix_product(a, b):
    return (a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5])


def _pdf_image_sizes(writer: PdfWriter) -> dict[int, tuple[int, int]]:
    sizes: dict[int, tuple[int, int]] = {}
    operations_seen = 0
    def visit(stream, resources, matrix, depth=0):
        nonlocal operations_seen
        if depth > 16:
            raise ValueError("PDF form nesting exceeds limits")
        content = ContentStream(stream, writer)
        if isinstance(resources, IndirectObject):
            resources = resources.get_object()
        stack, changed = [], False
        for operands, operator in content.operations:
            operations_seen += 1
            if operations_seen > 100000:
                raise ValueError("PDF content exceeds limits")
            if operator == b"q":
                stack.append(matrix)
            elif operator == b"Q":
                if not stack:
                    raise ValueError("Unbalanced PDF graphics state")
                matrix = stack.pop()
            elif operator == b"cm":
                transform = tuple(float(value) for value in operands)
                if len(transform) != 6 or not all(math.isfinite(value) for value in transform):
                    raise ValueError("Invalid PDF transform")
                matrix = _matrix_product(matrix, transform)
            elif operator == b"INLINE IMAGE":
                settings = operands["settings"]
                filters = settings.get("/Filter", settings.get("/F", []))
                filters = filters if isinstance(filters, ArrayObject) else [filters]
                # DCT bytes can be stripped without changing pixels. Other
                # compressed inline formats with opaque metadata need re-export.
                if filters in (["/DCTDecode"], ["/DCT"]):
                    operands["data"] = _strip_jpeg_metadata(operands["data"])
                    changed = True
                elif any(value in ("/JPXDecode", "/DCTDecode", "/DCT") for value in filters):
                    raise ValueError("Embedded metadata cannot be removed safely")
            elif operator == b"Do":
                xobjects = resources.get("/XObject", {})
                if isinstance(xobjects, IndirectObject):
                    xobjects = xobjects.get_object()
                item = xobjects.get(operands[0])
                if item is None:
                    raise ValueError("Missing PDF XObject")
                item = item.get_object()
                if item.get("/Subtype") == "/Form":
                    child_matrix = tuple(float(value) for value in item.get("/Matrix", (1, 0, 0, 1, 0, 0)))
                    if len(child_matrix) != 6 or not all(math.isfinite(value) for value in child_matrix):
                        raise ValueError("Invalid PDF form transform")
                    nested = visit(item, item.get("/Resources", resources), _matrix_product(matrix, child_matrix), depth + 1)
                    if nested is not None:
                        item.set_data(nested)
                elif item.get("/Subtype") == "/Image":
                    width = math.ceil(math.hypot(matrix[0], matrix[1]) * 200 / 72)
                    height = math.ceil(math.hypot(matrix[2], matrix[3]) * 200 / 72)
                    key = _pdf_image_key(item)
                    previous = sizes.get(key, (1, 1))
                    sizes[key] = (max(previous[0], width), max(previous[1], height))
        if changed:
            content.operations = content.operations
            return content.get_data()
        return None
    for page in writer.pages:
        unit = float(page.get("/UserUnit", 1))
        if not math.isfinite(unit) or unit <= 0:
            raise ValueError("Invalid PDF unit")
        clean = visit(page.get_contents(), page.get("/Resources", {}), (unit, 0, 0, unit, 0, 0))
        if clean is not None:
            stream = ContentStream(None, writer)
            stream.set_data(clean)
            page.replace_contents(stream)
    return sizes


def _write_pdf(writer: PdfWriter) -> bytes:
    writer.metadata = None
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    stream = io.BytesIO()
    writer.write(stream)
    result = stream.getvalue()
    reader = _pdf_reader(result)  # Output uses the same active-content checks.
    if reader.metadata or reader.trailer.get("/Prev"):
        raise ValueError("PDF metadata remains")
    if any(isinstance(item, DictionaryObject) and "/Metadata" in item for item in _pdf_objects(reader.trailer)):
        raise ValueError("PDF XMP remains")
    return result


def _same_pdf_text(content: bytes, original_text: list[str]) -> bool:
    reader = _pdf_reader(content)
    return len(reader.pages) == len(original_text) and [page.extract_text() or "" for page in reader.pages] == original_text


def optimize_pdf(content: bytes, context: UploadContext) -> ProcessedUpload:
    if not context.legal and context.processing_class not in (None, "marketing_pdf"):
        raise UploadProcessingError("legal_processing_forbidden")
    if not content or len(content) > (10 * MIB if context.legal else PDF_INPUT_BYTES):
        raise UploadProcessingError("legal_input_too_large" if context.legal else "pdf_input_too_large")
    try:
        with IMAGE_PROCESSING_LOCK, _private_decoding(), warnings.catch_warnings():
            warnings.simplefilter("error")
            reader = _pdf_reader(content)
            original = {"checksum": hashlib.sha256(content).hexdigest(), "size": len(content),
                        "mime_type": "application/pdf", "width": None, "height": None}
            if context.legal:
                return ProcessedUpload(content, "application/pdf", original, {
                    "pipeline_version": PIPELINE_VERSION, "max_edge": None, "quality": None,
                    "output_format": "pdf", "metadata_stripped": False,
                    "pdf_images_recompressed": False, "kept_original_because_no_gain": False,
                    "kept_unchanged_legal": True,
                }, {})
            values = {}
            title = _plain(reader.metadata.get("/Title")) if reader.metadata else None
            if title:
                values["caption"] = title
            suggestions = {"source": "file_metadata", "pipeline_version": PIPELINE_VERSION,
                           "confirmed": False, "values": values}
            original_text = [page.extract_text() or "" for page in reader.pages]
            writer = PdfWriter(clone_from=reader)
            _clean_pdf_metadata(writer)
            _pdf_image_sizes(writer)  # Also strips inline JPEG metadata.
            clean = _write_pdf(writer)
            if not _same_pdf_text(clean, original_text):
                raise ValueError("PDF text changed")
            writer = PdfWriter(clone_from=io.BytesIO(clean))
            sizes = _pdf_image_sizes(writer)
            replaced, seen = 0, set()
            for page in writer.pages:
                for key in page.images.keys():
                    if isinstance(key, str) and key.startswith("~"):
                        continue  # Inline bytes are sanitized; pypdf cannot replace them.
                    # Inspect the raw XObject before Pillow-backed extraction:
                    # pypdf cannot safely decode every high-bit-depth raster.
                    item = page
                    for name in [key] if isinstance(key, str) else key:
                        item = item["/Resources"]["/XObject"][name]
                    reference = getattr(item, "indirect_reference", None)
                    if reference is None or reference.idnum in seen:
                        continue
                    seen.add(reference.idnum)
                    if (int(item.get("/BitsPerComponent", 8)) != 8 or reference.idnum not in sizes
                            or any(name in item for name in ("/SMask", "/Mask", "/ImageMask", "/Decode"))):
                        continue
                    image = page.images[key]
                    if image.image is None or image.image.mode not in ("RGB", "L"):
                        continue
                    pixels = Image.new(image.image.mode, image.image.size)
                    pixels.paste(image.image)
                    pixels.thumbnail(sizes[reference.idnum], Image.Resampling.LANCZOS)
                    image.replace(pixels, quality=80)
                    replaced += 1
            candidate = _write_pdf(writer) if replaced else clean
            # Metadata removal is mandatory either way; require the image
            # recompression itself to earn the 20% saving before taking its loss.
            use_compressed = (replaced > 0 and len(candidate) <= min(len(content), len(clean)) * 0.8
                              and _same_pdf_text(candidate, original_text))
            stored = candidate if use_compressed else clean
            if len(stored) > PDF_OUTPUT_BYTES:
                raise UploadProcessingError("pdf_output_too_large")
            return ProcessedUpload(stored, "application/pdf", original, {
                "pipeline_version": PIPELINE_VERSION, "max_edge": None,
                "quality": 80 if use_compressed else None, "pdf_dpi": 200,
                "output_format": "pdf", "metadata_stripped": True,
                "pdf_images_recompressed": use_compressed,
                "kept_original_because_no_gain": False,
                "kept_image_encoding_because_no_gain": not use_compressed,
            }, suggestions)
    except UploadProcessingError:
        raise
    except Exception:
        raise UploadProcessingError("pdf_reexport_required") from None
