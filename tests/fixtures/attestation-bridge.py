"""Disposable-only adapter contract. Connection input stays on private stdin."""
import asyncio
import json
from pathlib import Path
import sys

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from hosted_write_attestation import AttestedTransaction, OperatorTransaction


async def main():
    value = json.load(sys.stdin)
    assert value['connection']['host'] == '127.0.0.1' and value['connection']['port'] == 55436
    db = await asyncpg.connect(**value['connection'])
    try:
        async with AttestedTransaction(db, value['manifest']) as proof:
            await db.execute('insert into hub.allowed values(100)')
        assert proof.receipt and not db.is_in_transaction()
        count = await db.fetchval('select count(*) from hub.allowed')
        for sql in ('insert into hub.denied values(100)', "update auth.users set recovery_token='bridge-test'"):
            try:
                async with AttestedTransaction(db, value['manifest']):
                    await db.execute('insert into hub.allowed values(101)')
                    await db.execute(sql)
            except RuntimeError as error:
                assert str(error) == 'attestation_stopped'
            else:
                raise AssertionError('guard did not refuse')
            assert not db.is_in_transaction() and await db.fetchval('select count(*) from hub.allowed') == count
        try:
            async with OperatorTransaction(db):
                raise AssertionError('unattested connection admitted')
        except RuntimeError as error:
            assert str(error) == 'hosted_write_requires_disposable_rehearsal_manifest'
        print(json.dumps({'allowed': True, 'hub_rollback': True, 'auth_rollback': True, 'unguarded_refused': True}))
    finally:
        await db.close()


try:
    asyncio.run(main())
except Exception as error:
    print(json.dumps({'error_class': type(error).__name__, 'sqlstate': getattr(error, 'sqlstate', None)}))
    raise SystemExit(1) from None
