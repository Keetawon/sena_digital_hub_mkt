"""Runs inside the disposable --no-dev installation, using only the stdlib."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProductionRuntimeTests(unittest.TestCase):
    def test_dev_only_import_fails_before_any_service_starts(self):
        self.assertIsNone(importlib.util.find_spec('pytest'))
        target = ROOT/'apps/api/sena_hub_api/production_regression.py'
        self.assertFalse(target.exists())
        try:
            target.write_text('import pytest\n', encoding='utf-8')
            result = subprocess.run([sys.executable, '-B', 'scripts/production_runtime_check.py', 'imports'],
                                    cwd=ROOT, capture_output=True, text=True, timeout=45)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads(result.stdout)
            self.assertEqual(report['exception_class'], 'ModuleNotFoundError')
            self.assertEqual(report['step'], 'import/sena_hub_api.production_regression')
        finally:
            target.unlink(missing_ok=True)

    def test_self_check_blocks_network_writes_and_credential_reads(self):
        prefix = "import sys;sys.path.insert(0,'scripts');from production_runtime_check import read_only_audit;sys.addaudithook(read_only_audit);"
        for operation in ["import socket;socket.create_connection(('127.0.0.1',1))",
                          "open('forbidden-write','w')", "open('api.env','r')"]:
            result = subprocess.run([sys.executable, '-B', '-c', prefix+operation], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Self-check refused', result.stderr)
        self.assertFalse((ROOT/'forbidden-write').exists())

    def test_worker_self_check_validates_without_connecting(self):
        # Missing/foreign DSNs are rejected before any CA read or connection.
        for dsn in ['', 'postgresql://synthetic@127.0.0.1:6543/postgres?sslmode=disable']:
            env = {**os.environ, 'HUB_MEDIA_WORKER_DATABASE_URL': dsn}
            result = subprocess.run([sys.executable, '-B', 'scripts/run-hosted-media-worker.py', '--self-check'],
                                    cwd=ROOT, env=env, capture_output=True, text=True, timeout=45)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads(result.stdout)
            self.assertEqual(report['step'], 'configuration/worker')
            self.assertEqual(report['exception_class'], 'RuntimeError')
            self.assertNotIn('synthetic@', result.stdout)

    def test_valid_worker_self_check_has_no_side_effects(self):
        import certifi
        env = {**os.environ,
               'HUB_MEDIA_WORKER_DATABASE_URL': 'postgresql://hub_media_worker_login:synthetic-only@db.eqlrtevwpyboplljgowo.supabase.co:5432/postgres?sslmode=verify-full',
               'HUB_MEDIA_DATABASE_CA_FILE': certifi.where()}
        result = subprocess.run([sys.executable, '-B', 'scripts/run-hosted-media-worker.py', '--self-check'],
                                cwd=ROOT, env=env, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stdout)
        report = json.loads(result.stdout)
        self.assertEqual(report['status'], 'passed')
        for field in ('network_calls', 'database_connections', 'provider_calls', 'writes'):
            self.assertEqual(report[field], 0)
        self.assertNotIn('synthetic-only', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
