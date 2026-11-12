"""Local BU fixture validator. This script never connects to Hub, DW or REM."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.bu_membership import InvalidSnapshot, utc_text, validate_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', choices=('valid', 'move', 'no-bu', 'invalid'), default='valid')
    parser.add_argument('--historical', action='store_true', help='Validate the attested offline October rows in valid.json')
    parser.add_argument('--at', required=True, help='Explicit fixture clock with timezone; never a runtime authorization clock')
    args = parser.parse_args()
    if args.historical and args.fixture != 'valid':
        parser.error('--historical belongs to the valid fixture only')
    fixture = json.loads((ROOT / 'supabase/tests/fixtures/bu_membership' / (args.fixture + '.json')).read_text(encoding='utf-8'))
    rows = fixture['historical']['rows'] if args.historical else fixture['rows']
    try:
        value = validate_snapshot(rows, now=datetime.fromisoformat(args.at))
    except (InvalidSnapshot, ValueError) as error:
        print(json.dumps({'status': 'REJECTED', 'failure_code': getattr(error, 'code', 'invalid_clock'), 'mode': 'fixture_only'}))
        return 1
    print(json.dumps({'status': 'VALID', 'row_count': len(value.rows), 'source_watermark': utc_text(value.source_watermark),
                      'digest': value.digest, 'mode': 'fixture_only'}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
