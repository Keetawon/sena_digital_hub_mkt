"""Render only catalog-owned OPEN_QUESTIONS table rows; keep surrounding prose."""
import argparse
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
# The catalog validator deliberately uses only the standard library.
sys.path.insert(0, str(ROOT / "apps" / "api"))
from sena_hub_api.questions import DOC_FIELDS, load_catalog  # noqa: E402

DOCUMENT = ROOT / "docs" / "ads" / "OPEN_QUESTIONS.md"
ROW = re.compile(r"^\| (Q[1-9][0-9]*)(?:\s|\|)")


def render_document(source: str, catalog: dict) -> str:
    entries = {entry["id"]: entry for entry in catalog["questions"]}
    seen = set()
    result = []
    for line in source.splitlines(keepends=True):
        match = ROW.match(line)
        if not match:
            result.append(line)
            continue
        key = match.group(1)
        if key not in entries or key in seen:
            raise ValueError("Unknown or duplicate documentation question ID: " + key)
        seen.add(key)
        ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
        result.append("| " + " | ".join(entries[key]["doc"][field] for field in DOC_FIELDS) + " |" + ending)
    if seen != set(entries):
        raise ValueError("Documentation is missing question IDs: " + ", ".join(sorted(set(entries) - seen)))
    return "".join(result)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    try:
        catalog = load_catalog()
        original = DOCUMENT.read_bytes().decode("utf-8")
        rendered = render_document(original, catalog)
        if args.check and rendered != original:
            print("Question documentation differs from the catalog; run --write after reviewing the catalog.", file=sys.stderr)
            return 1
        if args.write and rendered != original:
            DOCUMENT.write_bytes(rendered.encode("utf-8"))
        print(f"Question catalog/document rows agree: {len(catalog['questions'])} IDs")
        return 0
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
