import { spawn } from 'node:child_process';

// The dependency's initialise() writes a temporary plaintext password file.
// initdb -W accepts its two password prompts on stdin without a console.
// PostgreSQL 17 src/common/sprompt.c uses OSTYPE=msys for this Windows path.
export async function initialiseDisposableDb(directory, password) {
  if (typeof password !== 'string' || !password || /[\r\n\0]/.test(password)) {
    throw new Error('Invalid local database credential');
  }
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const { initdb } = await import(`@embedded-postgres/${platform}-${process.arch}`);
  await new Promise((resolve, reject) => {
    const child = spawn(initdb, ['--pgdata', directory, '--auth=scram-sha-256',
      '--username=postgres', '--encoding=UTF8', '--locale=C', '-W'], {
      windowsHide: true, detached: process.platform !== 'win32', timeout: 60000,
      env: { ...process.env, OSTYPE: 'msys' }, stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', () => reject(new Error('Disposable database initialization failed')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Disposable database initialization failed')));
    child.stdin.on('error', () => reject(new Error('Disposable database credential pipe failed')));
    child.stdin.end(`${password}\n${password}\n`);
  });
}
