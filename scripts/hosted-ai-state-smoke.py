"""Non-listening, read-only H1/TEST smoke. Context arrives on stdin, never in logs."""
import asyncio
import contextlib
import io
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from operator_diagnostics import diagnostic


async def smoke(context):
    step = 'import'
    status = None
    code = None
    missing = []
    database_error = None
    checks = {}
    try:
        step = 'environment'
        assert not any(name in os.environ for name in ('HUB_MEDIA_WORKER_DATABASE_URL', 'HUB_MEDIA_OPENAI_API_KEY'))
        for name in ('OPENAI_API_KEY', 'HUB_TRANSLATION_OPENAI_API_KEY'):
            os.environ.pop(name, None)
        # No dev dependencies: httpx2 is in the locked production dependency set.
        step = 'import/httpx2'
        import httpx2
        import asyncpg
        from fastapi import Request
        from sena_hub_api import main
        from sena_hub_api.auth import Actor, Settings

        step = 'app_creation'
        settings = Settings.from_env()
        assert settings.environment == 'hosted-test'
        app = main.create_app(settings)
        original_pool = asyncpg.create_pool

        async def read_only_connection(connection):
            # Session poolers can ignore startup GUCs; pool release also resets
            # settings. Enforce this before every application checkout.
            await connection.execute('set default_transaction_read_only = on')
            assert await connection.fetchval('show default_transaction_read_only') == 'on'

        async def readonly_pool(*args, **kwargs):
            kwargs['server_settings'] = {**kwargs.get('server_settings', {}),
                'default_transaction_read_only': 'on', 'application_name': 'h5e_read_only_api_smoke'}
            kwargs['setup'] = read_only_connection
            return await original_pool(*args, **kwargs)

        original_handler = app.exception_handlers[asyncpg.PostgresError]

        async def database_failure(request, error):
            nonlocal database_error
            database_error = error
            return await original_handler(request, error)

        app.exception_handlers[asyncpg.PostgresError] = database_failure

        async def existing_actor(request: Request):
            request.state.account = {'capabilities': context['capabilities']}
            return Actor(UUID(context['actor_id']), context['role'], None, True)

        step = 'lifespan'
        # A standalone smoke has no systemd activation descriptor. Refuse an
        # accidentally inherited broker flag instead of opening another socket.
        assert os.getenv('HUB_MEDIA_BROKER_ENABLED') != '1'
        with patch.object(asyncpg, 'create_pool', readonly_pool):
            async with app.router.lifespan_context(app):
                checks['hosted_lifespan'] = True
                async with app.state.pool.acquire() as connection:
                    step = 'lifespan/runtime_role'
                    assert await connection.fetchval('select session_user') == 'hub_runtime'
                    step = 'lifespan/read_only'
                    assert await connection.fetchval('show default_transaction_read_only') == 'on'
                checks['database_read_only'] = True
                route = '/v1/admin/projects/' + context['public_id'] + '/media/ai-state'
                step = 'request/anonymous'
                async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url='http://read-only-smoke') as client:
                    status = (await client.get(route)).status_code
                    assert status == 401
                    checks['anonymous_denied'] = True
                    app.dependency_overrides[app.state.authentication] = existing_actor
                    step = 'request/authenticated'
                    response = await client.get(route)
                    status = response.status_code
                    step = 'response_check'
                    payload = response.json()
                    error = payload.get('error', {}) if isinstance(payload, dict) else {}
                    code = error.get('code') if isinstance(error, dict) else None
                    if not isinstance(payload, dict) or 'data' not in payload:
                        missing = ['data']
                    elif isinstance(payload['data'], dict):
                        missing = [key for key in ('cap_usd', 'spent_usd', 'provider_configured') if key not in payload['data']]
                    assert status == 200 and not missing
                    state = payload['data']
                    assert float(state['cap_usd']) == (0 if settings.hosted_test_simulation else 5)
                    assert float(state['spent_usd']) == 0 and state['provider_configured'] is False
                    checks['expected_budget_and_disabled_provider'] = True
        return {'status': 'passed', **diagnostic(step=step, http_status=status), 'checks': checks, 'provider_calls': 0}
    except Exception as error:
        return {'status': 'STOP', **diagnostic(database_error or error, step=step,
                http_status=status, api_error_code=code, missing_response_keys=missing),
                'checks': checks, 'provider_calls': 0}


def cli():
    try:
        context = json.load(sys.stdin)
        # Keep library warnings/logs in memory. Only the metadata schema reaches
        # the operator; raw request/response bodies and exception text never do.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            report = asyncio.run(smoke(context))
    except Exception as error:
        report = {'status': 'STOP', **diagnostic(error, step='input')}
    print(json.dumps(report))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(cli())
