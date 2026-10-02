// Public, deliberately fictional fixtures. These are not credentials for any real service.
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export const SIMULATION_PASSWORD = 'H1-synthetic-only!';
export const SIMULATION_PUBLIC_KEY = 'h1-simulation-public-key';
export const SIMULATION_STORAGE_KEY = 'h1-simulation-storage-key';
export const FIXTURE_SOURCE = 'SYNTHETIC-HOSTED-H1-v1';
export const IDENTITIES = [
  ['editor', 'editor'], ['publisher', 'publisher'], ['viewer', 'viewer'],
  ['admin', 'admin'], ['online', 'online_staff'], ['agency-kin', 'agency', 'KIN'],
  ['agency-combay', 'agency', 'COMBAY'],
].map(([label, role, agency], index) => ({
  id: `70000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
  email: `hub-test-${label}@example.test`, aud: 'authenticated', role: 'authenticated',
  app_metadata: { provider: 'email', providers: ['email'], hub_role: role, ...(agency ? { hub_agency: agency } : {}) },
  user_metadata: {}, created_at: '2026-10-02T00:00:00Z',
}));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const length = Buffer.alloc(4), crc = Buffer.alloc(4), data = Buffer.concat([Buffer.from(type), body]);
  length.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, crc]);
}
function gridPng(width, height, offset) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = y * (width * 3 + 1) + 1 + x * 3;
    const color = ((Math.floor(x / 48) + Math.floor(y / 48) + offset) % 2) ? [214, 188, 121] : [7, 61, 50];
    pixels.set(color, n);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function syntheticAssets() {
  return [['logo', 512, 512], ['hero', 960, 540], ['thumbnail', 480, 270]].map(([kind, width, height], i) => {
    const bytes = gridPng(width, height, i), checksum = createHash('sha256').update(bytes).digest('hex');
    return { id: `71000000-0000-0000-0000-${String(11 + i).padStart(12, '0')}`, kind, width, height, bytes,
      checksum, storage_path: `${checksum}.png`, original_filename: `synthetic-h1-${kind}.png`, mime_type: 'image/png', file_size: bytes.length };
  });
}
