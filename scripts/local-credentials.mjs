import { randomBytes } from 'node:crypto';
import { readFile, writeFile, appendFile } from 'node:fs/promises';

// Upgrade the generated local setup without replacing any existing credentials.
export async function ensureLocalAdminToken(config) {
  const tokens = {
    adminToken: 'HUB_DEMO_ADMIN_TOKEN',
    onlineStaffToken: 'HUB_DEMO_ONLINE_STAFF_TOKEN',
    agencyKinToken: 'HUB_DEMO_AGENCY_KIN_TOKEN',
    agencyCombayToken: 'HUB_DEMO_AGENCY_COMBAY_TOKEN',
    uatAdminToken: 'HUB_DEMO_UAT_ADMIN_TOKEN',
    uatSuspendedToken: 'HUB_DEMO_UAT_SUSPENDED_TOKEN',
    uatSomchaiToken: 'HUB_DEMO_UAT_SOMCHAI_TOKEN',
  };
  let changed = false;
  for (const key of Object.keys(tokens)) {
    if (!config[key]) {
      config[key] = randomBytes(32).toString('hex');
      changed = true;
    }
  }
  if (changed) {
    await writeFile(new URL('../.local/development.json', import.meta.url), JSON.stringify(config, null, 2), { mode: 0o600 });
  }
  for (const name of ['../apps/api/.env', '../apps/admin/.env.local']) {
    const target = new URL(name, import.meta.url);
    let content;
    try { content = await readFile(target, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const missing = Object.entries(tokens).filter(([, variable]) => !new RegExp(`^${variable}=`, 'm').test(content));
    if (missing.length) {
      await appendFile(target, `${content.endsWith('\n') ? '' : '\n'}${missing.map(([key, variable]) => `${variable}=${config[key]}`).join('\n')}\n`);
    }
  }
}
