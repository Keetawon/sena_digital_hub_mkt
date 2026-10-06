// Analysis derivatives only; retained originals and their hashes are unchanged.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/admin/package.json', import.meta.url));
const sharp = require('sharp');
const folder = path.resolve(process.argv[2]);
if (!folder.startsWith(path.resolve('.local/knowledge-cleanup') + path.sep)) throw Error('local_cleanup_folder_required');
const records = JSON.parse(await fs.readFile(path.join(folder, 'records.json'), 'utf8'));
await fs.mkdir(path.join(folder, 'previews'), { recursive: true });
for (const row of records.filter(r => r.decision === 'candidate' && r.mime === 'image/svg+xml')) {
  const destination = path.join(folder, 'previews', row.sha256 + '.png');
  const source = path.join(row.locations[0].package, row.locations[0].blob);
  try { await sharp(source, { limitInputPixels: 40000000 }).resize({ width: 800, height: 800, fit: 'inside' }).png().toFile(destination); }
  catch { console.log(JSON.stringify({ sha256: row.sha256, reason: 'svg_render_failed' })); }
}
