"""Real loopback H1 DB/R2 smoke; no hosted credentials or provider calls."""
import asyncio
import copy
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'scripts'), str(ROOT/'apps/api')]


class NoDevelopmentHttpx(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'httpx' or fullname.startswith('httpx.'):
            raise ModuleNotFoundError('Development-only import is forbidden in the production smoke')


sys.meta_path.insert(0, NoDevelopmentHttpx())
spec = importlib.util.spec_from_file_location('hosted_ai_state_smoke', ROOT/'scripts/hosted-ai-state-smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
from operator_diagnostics import diagnostic, forwarded_diagnostic
from fastapi import HTTPException
from sena_hub_api import r2_assets
from sena_hub_api.auth import Settings
import httpx2
import asyncpg

assert Settings.from_env().hosted_test_simulation
CONTEXT = json.loads(os.environ.pop('HUB_H1_SMOKE_CONTEXT'))
CONFIG = os.environ['HUB_H1_R2_CONFIG']


def configuration_path(value):
    assert value == 'memory:h1-r2'
    return Mock(read_text=Mock(return_value=CONFIG))


class SmokeTests(unittest.TestCase):
    def run_smoke(self, context=None):
        with patch.object(r2_assets, 'Path', side_effect=configuration_path):
            return asyncio.run(smoke.smoke(context or copy.deepcopy(CONTEXT)))

    def test_real_h1_lifespan_and_enveloped_response_without_dev_httpx(self):
        result = self.run_smoke()
        self.assertEqual(result['status'], 'passed', result)
        self.assertEqual(result['http_status'], 200)
        self.assertTrue(all(result['checks'].values()))
        self.assertNotIn('httpx', sys.modules)

    def test_checkout_is_read_only_when_pooler_ignores_startup_setting(self):
        original = asyncpg.create_pool
        async def pooler(*args, **kwargs):
            kwargs['server_settings'].pop('default_transaction_read_only', None)
            return await original(*args, **kwargs)
        with patch.object(asyncpg, 'create_pool', pooler):
            result = self.run_smoke()
        self.assertEqual(result['status'], 'passed', result)
        self.assertTrue(result['checks']['database_read_only'])

    def test_view_denial_has_status_and_api_code(self):
        context = copy.deepcopy(CONTEXT)
        context['capabilities']['tabs']['projects']['view'] = False
        result = self.run_smoke(context)
        self.assertEqual((result['status'], result['http_status'], result['api_error_code']), ('STOP', 403, 'forbidden'))

    def test_sql_permission_denial_keeps_sqlstate(self):
        context = copy.deepcopy(CONTEXT)
        context['actor_id'] = '00000000-0000-0000-0000-000000000000'
        result = self.run_smoke(context)
        self.assertEqual(result['sqlstate'], '42501', result)
        self.assertEqual(result['http_status'], 403)

    def test_accidental_broker_activation_is_named(self):
        with patch.dict(os.environ, {'HUB_MEDIA_BROKER_ENABLED': '1'}):
            result = self.run_smoke()
        self.assertEqual((result['status'], result['step'], result['exception_class']), ('STOP', 'lifespan', 'AssertionError'))
        self.assertNotIn('hosted_lifespan', result['checks'])

    def test_private_bucket_failure_keeps_status_without_message(self):
        with patch.object(r2_assets.R2Assets, 'require_private_bucket', side_effect=HTTPException(503, {'code':'storage_unavailable', 'message':'synthetic-private-value'})):
            result = self.run_smoke()
        self.assertEqual((result['step'], result['exception_class'], result['http_status'], result['api_error_code']), ('lifespan', 'HTTPException', 503, 'storage_unavailable'))
        self.assertNotIn('synthetic-private-value', json.dumps(result))

    def test_child_metadata_survives_without_raw_content(self):
        result = forwarded_diagnostic({'step':'response_check','exception_class':'InsufficientPrivilegeError',
            'sqlstate':'42501','http_status':403,'api_error_code':'forbidden','missing_response_keys':['data'],
            'message':'synthetic-private-value','headers':{'Authorization':'synthetic-private-value'}}, step='promotion')
        self.assertEqual((result['step'], result['exception_class'], result['sqlstate'], result['http_status']),
                         ('response_check', 'InsufficientPrivilegeError', '42501', 403))
        self.assertNotIn('synthetic-private-value', json.dumps(result))

    def test_response_keys_are_named_without_values(self):
        for body, missing in [({'cap_usd':0, 'spent_usd':0}, ['data']), ({'data':{'cap_usd':0, 'spent_usd':0}}, ['provider_configured'])]:
            responses = iter([httpx2.Response(401), httpx2.Response(200, json=body)])
            async def get(*args, **kwargs):
                return next(responses)
            with patch.object(httpx2.AsyncClient, 'get', get):
                result = self.run_smoke()
            self.assertEqual(result['missing_response_keys'], missing)
            self.assertEqual(result['step'], 'response_check')

    def test_worker_environment_is_refused(self):
        with patch.dict(os.environ, {'HUB_MEDIA_WORKER_DATABASE_URL':'synthetic-private-value'}):
            result = self.run_smoke()
        self.assertEqual(result['step'], 'environment')
        self.assertEqual(result['status'], 'STOP')
        self.assertNotIn('synthetic-private-value', json.dumps(result))

    def test_diagnostic_does_not_log_exception_values(self):
        error = RuntimeError('postgresql://synthetic-private-value')
        error.sqlstate = '42501'
        result = diagnostic(error, step='request', http_status=403, api_error_code='forbidden')
        self.assertEqual((result['exception_class'], result['sqlstate'], result['http_status']), ('RuntimeError', '42501', 403))
        self.assertNotIn('synthetic-private-value', json.dumps(result))


if __name__ == '__main__':
    unittest.main(verbosity=2)
