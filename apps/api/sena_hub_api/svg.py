"""Bounded, static SVG logos. Unsupported artwork is removed, never executed."""
from __future__ import annotations

from collections import Counter
import math
import re
import xml.etree.ElementTree as ET


SVG = "http://www.w3.org/2000/svg"
MAX_SVG_BYTES = 2 * 1024 * 1024
MAX_ELEMENTS = 5000
MAX_DEPTH = 32
ELEMENTS = {
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "linearGradient", "radialGradient", "stop", "clipPath", "text", "tspan", "title", "desc",
}
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
ID = r"[A-Za-z_][A-Za-z0-9_.:-]{0,127}"
NUMBERS = {"x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy",
           "width", "height", "stroke-width", "stroke-miterlimit", "stroke-dashoffset", "font-size",
           "opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "offset", "dx", "dy"}
ENUMS = {
    "fill-rule": {"nonzero", "evenodd"}, "clip-rule": {"nonzero", "evenodd"},
    "stroke-linecap": {"butt", "round", "square"}, "stroke-linejoin": {"miter", "round", "bevel"},
    "gradientUnits": {"userSpaceOnUse", "objectBoundingBox"},
    "clipPathUnits": {"userSpaceOnUse", "objectBoundingBox"},
    "spreadMethod": {"pad", "reflect", "repeat"},
    "text-anchor": {"start", "middle", "end"}, "font-style": {"normal", "italic", "oblique"},
    "font-weight": {"normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"},
    "vector-effect": {"none", "non-scaling-stroke"},
}
TEXT = {"text", "tspan", "title", "desc"}
PAINT = {"fill", "stroke", "color", "stop-color"}


def bounded_numbers(value: str) -> bool:
    return all(math.isfinite(float(number)) and abs(float(number)) <= 1_000_000
               for number in re.findall(NUMBER, value))


class BoundedTree(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.depth = self.count = self.characters = 0

    def doctype(self, name, pubid, system):
        # Called before the internal subset: reject entities in every XML encoding.
        raise ValueError("SVG DTDs and entities are not supported")

    def start(self, tag, attrs):
        self.depth += 1
        self.count += 1
        if (self.depth > MAX_DEPTH or self.count > MAX_ELEMENTS or len(attrs) > 48
                or any(len(value) > 65536 for value in attrs.values())):
            raise ValueError("SVG structure exceeds limits")
        return super().start(tag, attrs)

    def end(self, tag):
        result = super().end(tag)
        self.depth -= 1
        return result

    def data(self, data):
        self.characters += len(data)
        if self.characters > 262144:
            raise ValueError("SVG text exceeds limits")
        super().data(data)


def local_tag(tag: str) -> str | None:
    if tag.startswith("{" + SVG + "}"):
        return tag[len(SVG) + 2:]
    return tag if "{" not in tag and ":" not in tag else None


def safe_attribute(name: str, value: str) -> str | None:
    value = value.strip()
    if name == "id":
        return value if re.fullmatch(ID, value) else None
    if name in NUMBERS:
        if re.fullmatch(NUMBER + r"(?:px|%)?", value):
            numeric = float(re.sub(r"(?:px|%)$", "", value))
            return value if math.isfinite(numeric) and abs(numeric) <= 1_000_000 else None
    elif name in ENUMS:
        return value if value in ENUMS[name] else None
    elif name in PAINT:
        # No CSS parser, escapes, var(), imports, external/data URLs or fallback URLs.
        if (re.fullmatch(r"#[0-9A-Fa-f]{3,8}|[A-Za-z]{1,32}", value)
                or re.fullmatch(r"(?:rgb|rgba|hsl|hsla)\([0-9.,%+\s-]{1,100}\)", value)
                or (name in {"fill", "stroke"} and re.fullmatch(r"url\(#" + ID + r"\)", value))):
            return value
    elif name == "clip-path":
        return value if value == "none" or re.fullmatch(r"url\(#" + ID + r"\)", value) else None
    elif name in {"viewBox", "points", "stroke-dasharray"}:
        if re.fullmatch(r"[0-9eE.,+\s-]{1,65536}", value):
            values = re.split(r"[\s,]+", value)
            if all(re.fullmatch(NUMBER, item) and math.isfinite(float(item)) and abs(float(item)) <= 1_000_000 for item in values):
                return value
    elif name == "d":
        return value if re.fullmatch(r"[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\s-]{1,65536}", value) and bounded_numbers(value) else None
    elif name in {"transform", "gradientTransform"}:
        expression = r"(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([0-9eE.,+\s-]{1,256}\)[\s,]*)+"
        return value if len(value) <= 2048 and re.fullmatch(expression, value) and bounded_numbers(value) else None
    elif name == "preserveAspectRatio":
        return value if re.fullmatch(r"(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?: (?:meet|slice))?", value) else None
    elif name == "font-family":
        return value if re.fullmatch(r"[A-Za-z0-9 ,_-]{1,120}", value) else None
    return None


def dimension(value: str | None) -> float | None:
    if value and re.fullmatch(NUMBER + r"(?:px)?", value):
        number = float(value.removesuffix("px"))
        if math.isfinite(number) and number > 0:
            return number
    return None


def sanitize_svg(content: bytes) -> tuple[bytes, int, int]:
    if not content or len(content) > MAX_SVG_BYTES:
        raise ValueError("SVG must not exceed 2 MiB")
    root = ET.fromstring(content, parser=ET.XMLParser(target=BoundedTree()))
    if local_tag(root.tag) != "svg":
        raise ValueError("SVG root required")
    view_box = safe_attribute("viewBox", root.get("viewBox", ""))
    view_values = [float(item) for item in re.split(r"[\s,]+", view_box)] if view_box else []
    if view_values and (len(view_values) != 4 or view_values[2] <= 0 or view_values[3] <= 0):
        raise ValueError("Invalid SVG viewBox")
    width = dimension(root.get("width")) or (view_values[2] if view_values else None)
    height = dimension(root.get("height")) or (view_values[3] if view_values else None)
    if not width or not height or width * height > 40_000_000 or max(width, height) > 1_000_000:
        raise ValueError("SVG dimensions required and must not exceed 40 million pixels")

    def clean(node, inside_definition=False):
        tag = local_tag(node.tag)
        if tag not in ELEMENTS:
            return None  # Drop the entire unsupported subtree, never unwrap active content.
        result = ET.Element("{" + SVG + "}" + tag)
        inside_definition = inside_definition or tag in {"defs", "clipPath", "linearGradient", "radialGradient"}
        for name, value in sorted(node.attrib.items()):
            safe = safe_attribute(name, value)
            if safe is not None and not (inside_definition and safe.startswith("url(")):
                result.set(name, safe)
        if tag in TEXT:
            result.text = node.text
        for child in node:
            converted = clean(child, inside_definition)
            if converted is not None:
                result.append(converted)
                if tag in TEXT:
                    converted.tail = child.tail
        return result

    result = clean(root)
    ids = Counter(node.get("id") for node in result.iter() if node.get("id"))
    targets = {node.get("id"): local_tag(node.tag) for node in result.iter() if ids[node.get("id")] == 1}
    for node in result.iter():
        if node.get("id") and ids[node.get("id")] != 1:
            del node.attrib["id"]
        for name, value in list(node.attrib.items()):
            if value.startswith("url("):
                allowed = {"clipPath"} if name == "clip-path" else {"linearGradient", "radialGradient"}
                if targets.get(value[5:-1]) not in allowed:
                    del node.attrib[name]
    # Canonical dimensions make the stored image independently displayable.
    result.set("width", format(width, ".12g"))
    result.set("height", format(height, ".12g"))
    for node in result.iter():
        ordered = sorted(node.attrib.items())
        node.attrib.clear()
        node.attrib.update(ordered)
    ET.register_namespace("", SVG)
    sanitized = ET.tostring(result, encoding="utf-8", short_empty_elements=True)
    return sanitized, math.ceil(width), math.ceil(height)
