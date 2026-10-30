"""Run before promotion on Linux. Candidate identities, no service connections."""
import json
from pathlib import Path
import re
import stat
import subprocess
import sys

from operator_diagnostics import diagnostic, forwarded_diagnostic


def main():
    step = 'candidate/input'
    results = {}
    try:
        root = Path(sys.argv[1])
        assert len(sys.argv) == 2 and root.parent == Path('/srv/sena-hub-test/releases')
        assert re.fullmatch(r'[a-f0-9]{7}-media-[a-f0-9]{12}', root.name)
        assert root.resolve(strict=True) == root and not root.is_symlink()
        live = Path('/srv/sena-hub-test/current').resolve(strict=True)
        env = Path('/etc/sena-hub-test/media-worker.env')
        info = env.lstat()
        assert stat.S_ISREG(info.st_mode) and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (0, 0, 0o600)
        # Names only; never emit values or pass them in command arguments.
        assert [line.split('=', 1)[0] for line in env.read_text().splitlines()] == ['HUB_MEDIA_WORKER_DATABASE_URL']
        for mode, user in [('api', 'sena-hub-api'), ('worker', 'sena-hub-media')]:
            step = 'candidate/' + mode
            command = ['systemd-run', '--unit=sena-hub-test-' + mode + '-self-check-' + root.name,
                       '--collect', '--wait', '--pipe']
            properties = ['User=' + user, 'Group=' + user, 'WorkingDirectory=' + str(root/'apps/api'),
                          'ProtectSystem=strict', 'ProtectHome=true', 'NoNewPrivileges=true',
                          'PrivateTmp=true', 'PrivateNetwork=true', 'RuntimeMaxSec=60',
                          'Environment=PYTHONDONTWRITEBYTECODE=1', 'UMask=0077']
            if mode == 'worker':
                properties += ['EnvironmentFile=' + str(env),
                               'Environment=HUB_MEDIA_DATABASE_CA_FILE=/etc/sena-hub-test/supabase-ca.crt']
            for property_ in properties:
                command += ['-p', property_]
            entry = [str(root/'scripts/run-hosted-media-worker.py'), '--self-check'] if mode == 'worker' else [str(root/'scripts/production_runtime_check.py'), 'api']
            process = subprocess.run(command + [str(root/'apps/api/.venv/bin/python'), '-B', *entry],
                                     capture_output=True, text=True, timeout=75)
            try:
                report = json.loads(process.stdout)
            except ValueError:
                raise subprocess.CalledProcessError(process.returncode or 1, []) from None
            if process.returncode or report.get('status') != 'passed':
                print(json.dumps({'status': 'STOP', **forwarded_diagnostic(report, step=step)}))
                return 1
            assert all(report.get(key) == 0 for key in ('network_calls', 'database_connections', 'provider_calls', 'writes'))
            results[mode + '_self_check'] = {'user': user, **report}
        assert Path('/srv/sena-hub-test/current').resolve(strict=True) == live
        print(json.dumps({'status': 'passed', 'release': root.name, 'live_symlink_unchanged': True,
                          'media_key_present': False, **results}))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'STOP', **diagnostic(error, step=step)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
