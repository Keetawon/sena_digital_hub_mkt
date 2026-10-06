/** A single isolated EKAMI render attempt. Retains the prior capture unchanged. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { Fetcher, allowedUrl, extractDocument, cleanText, sha256 } from './crawl-knowledge.mjs';

const url = 'https://nicheprideekkamai.sena.co.th/';
const out = path.resolve('.local/knowledge-intake', `ekami-retry-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(out, { recursive: false });
const fetcher = new Fetcher(), initial = await fetcher.fetch(url);
const result = { url, project_ids: ['EKAMI'], programme_ids: [], fetched_at: new Date().toISOString(),
  status: initial.status, coverage: 'partial_render_failed', render_attempts: 1, gap: 'EKAMI_RENDER_PARTIAL', sections: [] };
let browser;
try {
  if (!initial.ok) throw new Error(initial.reason);
  await fs.writeFile(path.join(out, 'initial.html'), initial.body);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || !allowedUrl(request.url()) || ['image', 'media', 'font'].includes(request.resourceType())) return route.abort();
    const response = await fetcher.fetch(request.url());
    if (!response.ok) return route.abort();
    return route.fulfill({ status: response.status, contentType: response.mime, body: response.body });
  });
  const page = await context.newPage();
  // DOM readiness is bounded; continuous analytics must not force networkidle timeouts.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 30000 });
  await page.evaluate(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 50000); y += 800) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } });
  const extracted = await page.evaluate(extractDocument);
  await fs.writeFile(path.join(out, 'rendered.html'), await page.content());
  Object.assign(result, { coverage: 'rendered', gap: null, title: extracted.title, sections: extracted.sections.map(s => ({ ...s, ...cleanText(s.text) })), references: extracted.refs });
} catch (error) { result.error_type = error.name; }
finally { if (browser) await browser.close(); }
await fs.writeFile(path.join(out, 'page.json'), JSON.stringify(result, null, 2));
await fs.writeFile(path.join(out, 'http-events.json'), JSON.stringify(fetcher.events, null, 2));
const manifest = { contract_version: 'sena-knowledge-render-retry-v1', created_at: result.fetched_at, files: {} };
for (const name of await fs.readdir(out)) { const data = await fs.readFile(path.join(out, name)); manifest.files[name] = { sha256: sha256(data), bytes: data.length }; }
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ folder: out, coverage: result.coverage, gap: result.gap, sections: result.sections.length, manifest_sha256: sha256(await fs.readFile(path.join(out, 'manifest.json'))) }));
