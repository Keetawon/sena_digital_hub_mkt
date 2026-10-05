"""Fail before collection if an API test could reach the working database."""
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]


def pytest_sessionstart(session):
    if session.config.option.collectonly:
        return
    # The shared guard verifies PostgreSQL's actual data_directory and a unique
    # database marker; setting an environment flag alone cannot authorize it.
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {assertDisposableTestDatabase} from './scripts/disposable-test-guard.mjs'; await assertDisposableTestDatabase();"],
        cwd=ROOT, env=os.environ, capture_output=True, text=True,
    )
    if result.returncode:
        raise pytest.UsageError("API tests require the disposable runner: npm run test:api -- [pytest arguments]. No tests were executed.")
