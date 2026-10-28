"""Scan source/bundles without opening a credential file or printing values."""
from pathlib import Path
import json
import re
import subprocess
import sys

KEY_NAMES = ('OPENAI_API_KEY', 'HUB_MEDIA_OPENAI_API_KEY', 'HUB_TRANSLATION_OPENAI_API_KEY')
TOKEN = re.compile(rb'\bsk-[A-Za-z0-9_-]{20,}')
ASSIGNMENT = re.compile(rb'(?:' + b'|'.join(k.encode() for k in KEY_NAMES) + rb')[\s"\x27]*[:=][\s"\x27]*([A-Za-z0-9_-]{16,})')


def contains_secret(raw):
    return bool(TOKEN.search(raw) or any(not m.group(1).startswith((b'synthetic', b'placeholder', b'process', b'os')) for m in ASSIGNMENT.finditer(raw)))


def main():
    root = Path.cwd()
    names = subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).splitlines()
    names += subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines()
    paths = {root / p for p in (sys.argv[1:] or names)}
    paths.update(p for p in (root/'apps/admin/.next/static').rglob('*') if p.is_file())
    # Explicitly refuse credential paths even when provided as CLI arguments.
    assert all(not p.name.startswith('.env') and p.suffix not in ('.pem','.key') and '.local' not in p.parts for p in paths)
    hits = [str(p.relative_to(root)) for p in sorted(paths) if p.is_file() and contains_secret(p.read_bytes())]
    print(json.dumps({'files_scanned':len(paths),'matches':len(hits),'paths':hits,'provider_variable_names':list(KEY_NAMES),'credential_files_read':False}))
    return bool(hits)


if __name__ == '__main__':
    raise SystemExit(main())
