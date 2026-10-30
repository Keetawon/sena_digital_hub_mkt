"""Production imports and candidate self-checks. No listeners, writes or provider calls."""
import contextlib
import importlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
from unittest.mock import patch

from operator_diagnostics import diagnostic

ROOT = Path(__file__).resolve().parents[1]


def read_only_audit(event, args):
    if event in {'socket.connect', 'socket.bind', 'socket.getaddrinfo', 'socket.sendto',
                 'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.mkdir', 'os.remove',
                 'os.rmdir', 'os.rename', 'os.chmod', 'os.chown', 'os.truncate',
                 'os.link', 'os.symlink', 'shutil.copyfile'}:
        raise RuntimeError('Self-check refused side effect')
    if event == 'open':
        filename, mode, flags = args
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            raise RuntimeError('Self-check refused file write')
        if isinstance(filename, (str, bytes)):
            name = Path(os.fsdecode(filename)).name.lower()
            if name.startswith('.env') or name.endswith('.env') or name in {
                    'development.json', 'r2-test.json', 'credentials'}:
                raise RuntimeError('Self-check refused credential file read')


def check(mode):
    step = 'input'
    imported = []
    try:
        if mode not in {'imports', 'api', 'worker'}:
            raise ValueError('Expected imports, api or worker')
        sys.dont_write_bytecode = True
        # The worker needs only its existing DSN and public CA for validation.
        # API/import checks use synthetic settings, never process credentials.
        for name in list(os.environ):
            if name.startswith(('HUB_', 'OPENAI_', 'AWS_', 'AZURE_', 'GOOGLE_')):
                if mode != 'worker' or name not in {'HUB_MEDIA_WORKER_DATABASE_URL', 'HUB_MEDIA_DATABASE_CA_FILE', 'HUB_MEDIA_MODEL'}:
                    os.environ.pop(name, None)
        os.environ.update(PYTHAINLP_OFFLINE='1', PYTHAINLP_READ_ONLY='1', PYTHONDONTWRITEBYTECODE='1')
        sys.path.insert(0, str(ROOT/'apps/api'))
        sys.addaudithook(read_only_audit)
        modules = ['sena_hub_api.main', 'uvicorn'] if mode == 'api' else ['sena_hub_api.hosted_media_worker']
        if mode == 'imports':
            modules = sorted('sena_hub_api.' + '.'.join(p.relative_to(ROOT/'apps/api/sena_hub_api').with_suffix('').parts)
                             for p in (ROOT/'apps/api/sena_hub_api').rglob('*.py')
                             if p.name not in {'__init__.py', '__main__.py'})
            modules += ['uvicorn']
        for module in modules:
            step = 'import/' + module
            importlib.import_module(module)
            imported.append(module)
        if mode in {'imports', 'api'}:
            from sena_hub_api.auth import Settings
            from sena_hub_api.main import create_app
            settings = Settings(database_url='postgresql://127.0.0.1/import_only',
                                auth_mode='supabase', environment='local', supabase_url='https://synthetic.invalid')
            step = 'app_creation'
            create_app(settings)  # Deliberately never enter lifespan.
            step = 'import/sena_hub_api.__main__'
            with patch.object(Settings, 'from_env', return_value=settings), patch('uvicorn.run') as run:
                runpy.run_module('sena_hub_api.__main__', run_name='production_import_check')
                run.assert_called_once()
            imported.append('sena_hub_api.__main__')
        if mode in {'imports', 'worker'}:
            step = 'import/run-hosted-media-worker.py'
            runpy.run_path(str(ROOT/'scripts/run-hosted-media-worker.py'), run_name='production_import_check')
            imported.append('scripts/run-hosted-media-worker.py')
        if mode == 'worker':
            step = 'configuration/worker'
            from sena_hub_api.hosted_media_worker import connection_settings
            connection_settings()  # Includes TEST target, login, port, TLS and CA checks; no connect.
        return {'status': 'passed', 'mode': mode, 'imported': imported,
                'network_calls': 0, 'database_connections': 0, 'provider_calls': 0, 'writes': 0}
    except Exception as error:
        return {'status': 'STOP', 'mode': mode, **diagnostic(error, step=step)}


def main(args=None):
    args = sys.argv[1:] if args is None else args
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        result = check(args[0] if len(args) == 1 else '')
    print(json.dumps(result))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
