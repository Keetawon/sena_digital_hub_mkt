"""Fixture-only job wiring: no source driver, configuration or network access."""
import asyncio
from contextlib import asynccontextmanager
import json

import pytest

from sena_hub_api.bu_membership import COLUMNS, SOURCE_SELECT, maintain_membership, run_membership_job


@pytest.mark.parametrize('status', ['ACCEPTED', 'UNCHANGED', 'REJECTED'])
def test_job_captures_before_one_verified_read_and_one_atomic_result(status):
    events = []
    rows = [dict(zip(COLUMNS, ['0001', ' BU A ', ' BUD01 ', 'Synthetic', True, False,
                             '2031-01-01T00:00:00Z', 'ACTIVE']))]
    class Hub:
        def is_in_transaction(self):
            return False
        async def fetchval(self, sql, *args):
            if sql == 'select hub.content_bu_capture()':
                events.append('capture')
                return {'accepted_run_id': None, 'acceptance_epoch': 7}
            assert sql == 'select hub.content_bu_accept($1::text::jsonb,$2::uuid,$3::bigint)'
            assert json.loads(args[0]) == rows and args[1:] == (None, 7)
            events.append('accept')
            return {'status': status}
    class Source:
        @asynccontextmanager
        async def transaction(self, **options):
            assert options == {'readonly': True}
            events.append('begin')
            yield
            events.append('end')
        async def fetch(self, sql):
            assert sql == SOURCE_SELECT
            events.append('read')
            return rows
    @asynccontextmanager
    async def source(**options):
        assert options == {'sslmode': 'verify-full'}
        events.append('connect')
        yield Source()
        events.append('close')
    assert asyncio.run(run_membership_job(Hub(), source)) == {'status': status}
    assert events == ['capture', 'connect', 'begin', 'read', 'end', 'close', 'accept']


def test_job_source_failure_records_only_finite_code_and_does_not_retry():
    events = []
    class Hub:
        def is_in_transaction(self):
            return False
        async def fetchval(self, sql, *args):
            if sql == 'select hub.content_bu_capture()':
                events.append('capture')
                return {'accepted_run_id': None, 'acceptance_epoch': 7}
            assert sql == 'select hub.content_bu_reject($1::uuid,$2::bigint,$3::text,0)'
            assert args == (None, 7, 'read_failed')
            events.append('reject')
            return {'status': 'REJECTED', 'failure_code': 'read_failed'}
    @asynccontextmanager
    async def source(**options):
        assert options == {'sslmode': 'verify-full'}
        events.append('connect')
        raise RuntimeError('Synthetic private adapter diagnostic')
        yield  # Keeps this fixture an async context manager.
    assert asyncio.run(run_membership_job(Hub(), source)) == {'status': 'REJECTED', 'failure_code': 'read_failed'}
    assert events == ['capture', 'connect', 'reject']


def test_job_ambiguous_acceptance_is_not_retried_or_relabelled_a_source_failure():
    calls = []
    class Hub:
        def is_in_transaction(self):
            return False
        async def fetchval(self, sql, *args):
            calls.append(sql)
            if sql == 'select hub.content_bu_capture()':
                return {'accepted_run_id': None, 'acceptance_epoch': 7}
            assert 'content_bu_accept' in sql
            raise RuntimeError('Synthetic ambiguous write')
    class Source:
        @asynccontextmanager
        async def transaction(self, **options):
            yield
        async def fetch(self, sql):
            return []
    @asynccontextmanager
    async def source(**options):
        yield Source()
    with pytest.raises(RuntimeError, match='Synthetic ambiguous write'):
        asyncio.run(run_membership_job(Hub(), source))
    assert len(calls) == 2


def test_maintenance_records_boundaries_without_opening_any_source_connection():
    calls = []
    class Hub:
        def is_in_transaction(self):
            return False
        async def fetchval(self, sql):
            calls.append(sql)
            return {'changed': 2}
    assert asyncio.run(maintain_membership(Hub())) == {'changed': 2}
    assert calls == ['select hub.content_bu_maintain()']


def test_job_refuses_an_existing_hub_transaction_before_source_connection():
    class Hub:
        def is_in_transaction(self):
            return True
    def source(**options):
        pytest.fail('No source connection may be opened inside a Hub transaction')
    with pytest.raises(RuntimeError, match='independent Hub transactions'):
        asyncio.run(run_membership_job(Hub(), source))
