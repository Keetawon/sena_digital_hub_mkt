/** Local, explicit public-website evidence collection. No DB, uploads or publication. */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { extractSenaProject } from './sena-project-extract.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function allowedUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && (u.hostname === 'sena.co.th' || u.hostname.endsWith('.sena.co.th') || u.hostname === 'rentnex.senxgroup.com');
  } catch { return false; }
}
export function publicIpv4(address) {
  const n = address.split('.').map(Number);
  return n.length === 4 && n.every(x => Number.isInteger(x) && x >= 0 && x <= 255)
    && ![0, 10, 127].includes(n[0]) && n[0] < 224
    && !(n[0] === 169 && n[1] === 254) && !(n[0] === 172 && n[1] >= 16 && n[1] <= 31)
    && !(n[0] === 192 && [0, 168].includes(n[1])) && !(n[0] === 100 && n[1] >= 64 && n[1] <= 127)
    && !(n[0] === 198 && [18, 19, 51].includes(n[1])) && !(n[0] === 203 && n[1] === 0 && n[2] === 113);
}
export function cleanText(text) {
  const flagged = [], kept = [];
  for (const line of text.split(/\n+/)) {
    if (/(?:ignore|disregard|override).{0,60}(?:instructions|system prompt|previous rules)|(?:system|assistant|developer)\s*:\s*|(?:reveal|send|print).{0,40}(?:api.?key|secret|token)|(?:ไม่ต้องทำตาม|ละเว้น|เพิกเฉย).{0,40}(?:คำสั่ง|กฎ)|(?:เปิดเผย|ส่ง).{0,30}(?:รหัสผ่าน|โทเคน)/iu.test(line)) flagged.push(line);
    else if (line.trim()) kept.push(line.trim());
  }
  return { text: kept.join('\n'), removed_instruction_like_text: flagged };
}
export function suggestedRole(url, section = '') {
  const text = `${url} ${section}`.trim().toLowerCase();
  const image = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url);
  if (!image && /youtube|youtu\.be|vimeo|matterport\.com|kuula\.co|\.mp4(?:[?#\s]|$)|video/.test(text)) return 'video_link';
  if (/master.?plan|ผังโครงการ/.test(text)) return 'master_plan';
  if (/floor.?plan|แปลนชั้น/.test(text)) return 'floor_plan';
  if (/unit.?plan|room.?plan|unit_types|แบบห้อง/.test(text)) return 'unit_plan';
  if (/\.pdf(?:[?#]|$)/i.test(url) || /brochure|โบรชัวร์/.test(text)) return 'brochure';
  if (/promo|promotion_banners|โปรโมชั่น/.test(text)) return 'promotion_banner';
  if (/hero|key.?visual/.test(text)) return 'hero';
  if (/gallery|แกลเลอรี/.test(text)) return 'gallery';
  return 'unclassified';
}
export function normalizeUrl(value, base) {
  try { const u = new URL(value, base); u.hash = ''; return u.href; } catch { return null; }
}
export function embeddedFileUrls(html) {
  const decoded = html.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&')
    .replace(/&quot;|&#34;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
  return [...decoded.matchAll(/(?:https?:\/\/|\/)[^\s"'<>\\]+?\.(?:webp|png|jpe?g|gif|svg|avif|pdf)(?:\?[^\s"'<>\\]*)?/gi)].map(m => m[0]);
}
export function robotsDisallows(text, url) {
  // Only the rules for this named agent, otherwise wildcard, apply. Longest match wins.
  const groups = []; let agents = [], rules = [];
  const flush = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(), match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') { if (rules.length) flush(); agents.push(value.toLowerCase()); }
    else if (agents.length && ['allow', 'disallow'].includes(key) && value) rules.push({ allow: key === 'allow', value });
  }
  flush();
  const specific = groups.filter(g => g.agents.includes('senahubpreaudit'));
  const selected = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const pathname = new URL(url).pathname + new URL(url).search;
  const matches = selected.flatMap(g => g.rules).filter(r => {
    const pattern = r.value.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pattern).test(pathname);
  }).sort((a, b) => b.value.length - a.value.length || Number(b.allow) - Number(a.allow));
  return matches.length > 0 && !matches[0].allow;
}

export class Fetcher {
  constructor() { this.cache = new Map(); this.next = new Map(); this.robots = new Map(); this.events = []; }
  async request(url) {
    if (!allowedUrl(url)) return { ok: false, reason: 'off_allowlist', url, status: null, attempts: [] };
    const host = new URL(url).hostname;
    const reserved = Math.max(Date.now(), this.next.get(host) || 0); this.next.set(host, reserved + 1000);
    await delay(Math.max(0, reserved - Date.now()));
    const addresses = await lookup(host, { family: 4, all: true });
    if (!addresses.length || addresses.some(a => !publicIpv4(a.address))) throw new Error('non_public_dns');
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'user-agent': 'SenaHubPreAudit/1.0 (one-time public content review)', accept: '*/*', 'accept-encoding': 'identity' },
        lookup: (_hostname, options, callback) => options.all ? callback(null, [addresses[0]]) : callback(null, addresses[0].address, 4),
      }, res => {
        const chunks = []; let size = 0;
        res.on('data', bytes => { size += bytes.length; if (size > 128 * 1024 * 1024) req.destroy(new Error('file_exceeds_128MiB')); else chunks.push(bytes); });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, mime: String(res.headers['content-type'] || '').split(';')[0].toLowerCase(), location: res.headers.location, body: Buffer.concat(chunks) }));
      });
      // Total deadline, not merely idle socket timeout.
      const timer = setTimeout(() => req.destroy(new Error('fetch_timeout_25s')), 25000);
      req.on('error', reject); req.on('close', () => clearTimeout(timer));
    });
  }
  async fetch(url, checkRobots = true) {
    if (!allowedUrl(url)) return { ok: false, reason: 'off_allowlist', url, status: null, attempts: [] };
    const key = `${checkRobots}:${url}`;
    if (!this.cache.has(key)) this.cache.set(key, this.fetchUncached(url, checkRobots));
    return this.cache.get(key);
  }
  async fetchUncached(original, checkRobots) {
    let url = original; const attempts = [], redirects = [];
    for (let hop = 0; hop < 8; hop++) {
      if (!allowedUrl(url)) return { ok: false, reason: 'redirect_off_allowlist', url: original, final_url: url, status: null, attempts, redirects };
      if (checkRobots) {
        const origin = new URL(url).origin;
        if (!this.robots.has(origin)) this.robots.set(origin, this.fetch(`${origin}/robots.txt`, false));
        const robots = await this.robots.get(origin);
        if (robots.ok && robotsDisallows(robots.body.toString('utf8'), url)) return { ok: false, reason: 'robots_disallowed', url: original, final_url: url, status: null, attempts, redirects };
        if (!robots.ok && robots.status !== 404 && robots.status !== 410) return { ok: false, reason: 'robots_unavailable', url: original, final_url: url, status: robots.status, attempts: robots.attempts, redirects };
      }
      let result;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const fetched_at = new Date().toISOString();
        try { result = await this.request(url); }
        catch (error) { result = { status: null, reason: error.message, body: Buffer.alloc(0) }; }
        attempts.push({ url, attempt, fetched_at, status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
        if (!(result.status === null || [408, 429, 500, 502, 503, 504].includes(result.status)) || attempt === 3) break;
        await delay(1000 * 2 ** attempt);
      }
      if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
        const next = normalizeUrl(result.location, url); redirects.push({ from: url, to: next, status: result.status }); url = next; continue;
      }
      const record = { ...result, url: original, final_url: url, attempts, redirects, fetched_at: attempts.at(-1).fetched_at,
        ok: result.status >= 200 && result.status < 300, reason: result.reason || (result.status >= 200 && result.status < 300 ? null : `http_${result.status}`) };
      this.events.push({ url: original, final_url: url, status: record.status, reason: record.reason, fetched_at: record.fetched_at, attempts, bytes: record.body?.length || 0 });
      return record;
    }
    return { ok: false, reason: 'redirect_limit', url: original, final_url: url, attempts, redirects, status: null };
  }
}

// This function executes only in an isolated page. Page strings remain data.
export function extractDocument() {
  const refs = [], sections = []; let section = { heading: document.title || 'หน้าโครงการ', locator: 'body', text: [] };
  const push = () => { if (section.text.length) sections.push({ ...section, text: section.text.join('\n') }); };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.closest('script,style,noscript,nav,footer,form,button')) continue;
    if (/^H[1-6]$/.test(el.tagName)) { push(); section = { heading: el.textContent.trim(), locator: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}:${sections.length}`, text: [] }; }
    else if (['P', 'LI', 'TD', 'DD', 'DT'].includes(el.tagName) || (!el.children.length && ['DIV','SPAN'].includes(el.tagName))) {
      const value = el.textContent.trim(); if (value) section.text.push(value);
    }
  }
  push();
  const where = el => (el.closest('section,[id]')?.id || el.closest('section')?.querySelector('h1,h2,h3')?.textContent || 'unclassified').trim();
  for (const el of document.querySelectorAll('img,source,a,video,iframe,object,embed,input[type="image"]')) {
    for (const attr of ['src','href','data-src','data-lazy-src','data-original','data-bg','poster','data','data-srcset','srcset']) {
      const value = el.getAttribute(attr); if (!value) continue;
      const values = /srcset/.test(attr) ? value.split(',').map(x => x.trim().split(/\s+/)[0]) : [value];
      for (const url of values) refs.push({ url, section: where(el), label: el.getAttribute('alt') || el.textContent?.trim().slice(0, 200) || '', tag: el.tagName, attribute: attr });
    }
  }
  for (const el of document.querySelectorAll('[style], [data-background]')) {
    for (const match of `${el.getAttribute('style') || ''}`.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) refs.push({ url: match[1], section: where(el), tag: 'CSS', attribute: 'style' });
    if (el.getAttribute('data-background')) refs.push({ url: el.getAttribute('data-background'), section: where(el), tag: 'CSS', attribute: 'data-background' });
  }
  const stylesheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map(x => x.getAttribute('href'));
  return { title: document.title, sections, refs, stylesheets, visible_text_length: document.body.innerText.length };
}

export async function verifyPackage(folder) {
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('unsafe_manifest_path');
    const bytes = await fs.readFile(path.join(folder, relative));
    if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error(`integrity_failed:${relative}`);
    if (expected.rows !== undefined && JSON.parse(bytes).length !== expected.rows) throw new Error(`row_count_failed:${relative}`);
  }
  return manifest;
}

export async function crawl(inputPath, inputHash, channel = 'msedge') {
  const collectorSha256 = sha256(await fs.readFile(fileURLToPath(import.meta.url)));
  const inputBytes = await fs.readFile(inputPath);
  if (sha256(inputBytes) !== inputHash) throw new Error('input_hash_mismatch');
  const input = JSON.parse(inputBytes);
  if (input.schema_version !== 1 || !Array.isArray(input.pages) || !Array.isArray(input.file_refs)) throw new Error('invalid_input');
  const maxPages = input.max_pages ?? 80;
  if (!Number.isInteger(maxPages) || maxPages < input.pages.length || maxPages > 500) throw new Error('invalid_page_limit');
  for (const row of input.pages) if (!allowedUrl(row.url) || !Array.isArray(row.project_ids) || !Array.isArray(row.programme_ids)) throw new Error('invalid_page_scope_or_url');
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel, headless: true });
  const require = createRequire(new URL('../apps/admin/package.json', import.meta.url));
  let sharp; try { sharp = require('sharp'); } catch { /* Recorded per file if unavailable. */ }
  const base = path.join(ROOT, '.local/knowledge-intake'); await fs.mkdir(base, { recursive: true });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${inputHash.slice(0, 8)}`;
  const work = path.join(base, `.incomplete-${runId}`), final = path.join(base, runId);
  await fs.mkdir(work); await fs.mkdir(path.join(work, 'blobs'));
  const manifestFiles = {}, fetcher = new Fetcher(), pageRows = [], refs = [], failures = [], renderRequests = [];
  const savedBlobs = new Set();
  const save = async (name, bytes, rows) => {
    await fs.writeFile(path.join(work, name), bytes, { flag: 'wx' });
    manifestFiles[name] = { sha256: sha256(bytes), bytes: bytes.length, ...(rows === undefined ? {} : { rows }) };
  };
  const saveJson = (name, value) => save(name, Buffer.from(JSON.stringify(value, null, 2) + '\n'), Array.isArray(value) ? value.length : undefined);
  const blob = async bytes => { const hash = sha256(bytes), name = `blobs/${hash}`; if (!savedBlobs.has(hash)) { await save(name, bytes); savedBlobs.add(hash); } return name; };
  const failure = (kind, record, result) => failures.push({ kind, ...record, status: result.status ?? null, reason: result.reason || 'fetch_failed', attempts: result.attempts || [], fetched_at: result.fetched_at || new Date().toISOString() });
  const pageQueue = [...input.pages], knownPages = new Set(input.pages.map(p => p.url)), visitedCss = new Set();
  const addRef = (ref, page) => {
    const url = normalizeUrl(ref.url, page.final_url || page.url); if (!url || !/^https?:/.test(url)) return;
    const record = { ...ref, url, page_url: page.url, project_ids: page.project_ids, programme_ids: page.programme_ids,
      applicability_status: 'needs_scope_review', suggested_role: suggestedRole(url, `${ref.section || ''} ${ref.label || ''}`) };
    const file = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|pdf)(?:[?#]|$)/i.test(url) || ['IMG','SOURCE','CSS','OBJECT','EMBED'].includes(ref.tag);
    if (file || record.suggested_role === 'video_link' || ref.kind === 'file') refs.push(record);
    else if (ref.tag === 'A' && allowedUrl(url)) {
      const seed = new URL(page.url), target = new URL(url);
      const root = seed.pathname.replace(/\/$/, '');
      const scoped = seed.origin === target.origin && (root ? target.pathname.startsWith(root + '/') : seed.hostname !== 'www.sena.co.th' && seed.hostname !== 'sena.co.th' && seed.hostname !== 'brands.sena.co.th');
      const programmePage = !page.programme_ids.length || /^\/(?:faq|terms|conditions?|benefit-program|invest|livnex-gold|about|privacy|contact)(?:\/|$)/i.test(target.pathname);
      if (scoped && programmePage && !/logout|login|cart|checkout|wp-admin|wp-json|feed|\.(?:css|js|xml|zip)$/i.test(target.pathname) && !target.search && !knownPages.has(url)) {
        knownPages.add(url);
        if (pageQueue.length < maxPages) pageQueue.push({ url, project_ids: page.project_ids, programme_ids: page.programme_ids, discovered_from: page.url, extractor: page.extractor });
        else failure('page', { url, page_url: page.url }, { reason: `page_limit_${maxPages}_requires_followup` });
      }
    }
  };
  const cssAssets = async (url, page) => {
    const key = `${page.url}:${url}`;
    if (!url || visitedCss.has(key)) return; visitedCss.add(key);
    const result = await fetcher.fetch(url);
    if (!result.ok) { failure('stylesheet', { url, page_url: page.url }, result); return; }
    await blob(result.body);
    for (const match of result.body.toString('utf8').matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) {
      const child = normalizeUrl(match[1], result.final_url);
      if (child && /\.(?:avif|gif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(child)) addRef({ url: child, section: `stylesheet:${url}`, tag: 'CSS' }, page);
    }
  };
  try {
    await save('input.json', inputBytes);
    const parser = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await parser.route('**/*', route => route.abort());
    const parsePage = await parser.newPage();
    for (let index = 0; index < pageQueue.length; index++) {
      const source = pageQueue[index], result = await fetcher.fetch(source.url);
      console.log(`page ${index + 1}/${pageQueue.length}: ${result.status || result.reason} ${source.url}`);
      const row = { ...source, final_url: result.final_url, status: result.status, fetched_at: result.fetched_at, attempts: result.attempts, sections: [], coverage: 'fetch_failed' };
      pageRows.push(row);
      if (!result.ok) { failure('page', source, result); if (result.body?.length) row.failure_body = await blob(result.body); continue; }
      row.original_blob = await blob(result.body);
      if (!/html/.test(result.mime)) { failure('page', source, { ...result, reason: 'unexpected_page_mime' }); continue; }
      await parsePage.setContent(result.body.toString('utf8'), { waitUntil: 'domcontentloaded' });
      const extractor = source.extractor === 'sena_project_v1' ? extractSenaProject : extractDocument;
      let extracted = await parsePage.evaluate(extractor);
      // Render JS-dependent pages when static extraction has little content or a hydration shell.
      if (extracted.visible_text_length < 1200 || /id=["'](?:app|root)["'][^>]*>\s*<\//.test(result.body.toString('utf8')) || source.render === true) {
        const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
        const pending = new Set();
        await context.route('**/*', route => {
          const task = (async () => {
            const request = route.request(), url = request.url();
            if (request.method() !== 'GET' || !allowedUrl(url) || ['image','media','font'].includes(request.resourceType())) {
              renderRequests.push({ page_url: source.url, url, method: request.method(), disposition: 'blocked_or_deferred_file' });
              return route.abort();
            }
            const got = await fetcher.fetch(url);
            if (!got.ok) { failure('render_resource', { url, page_url: source.url }, got); return route.abort(); }
            await blob(got.body);
            return route.fulfill({ status: got.status, contentType: got.mime || 'application/octet-stream', body: got.body });
          })().catch(() => {});
          pending.add(task); task.finally(() => pending.delete(task)); return task;
        });
        const rendered = await context.newPage();
        try {
          await rendered.goto(source.url, { waitUntil: 'networkidle', timeout: 90000 });
          // Trigger lazy content without clicking forms or accepting any consent.
          for (let y = 0; y < Math.min(await rendered.evaluate(() => document.body.scrollHeight), 50000); y += 1000) { await rendered.evaluate(y => window.scrollTo(0, y), y); await delay(80); }
          const dynamic = await rendered.evaluate(extractor);
          extracted = { ...dynamic, refs: [...extracted.refs, ...dynamic.refs], stylesheets: [...extracted.stylesheets, ...dynamic.stylesheets] };
          row.rendered_blob = await blob(Buffer.from(await rendered.content())); row.render_status = 'ok';
        } catch (error) { row.render_status = 'failed'; failure('render', source, { reason: error.name || 'render_failed' }); }
        finally { await context.close(); await Promise.allSettled([...pending]); }
      } else row.render_status = 'not_needed_static_content';
      row.title = extracted.title; row.coverage = row.render_status === 'failed' ? 'partial_render_failed' : 'fetched';
      if (extracted.website) {
        row.website = extracted.website;
        for (const gap of extracted.website.extraction_gaps ?? [])
          failure('extraction', {url:source.url,page_url:source.url,field:gap.field}, {...result,reason:gap.reason});
      }
      row.sections = extracted.sections.map(section => ({ ...section, ...cleanText(section.text), applicability_status: 'needs_scope_review' }));
      if (!row.sections.length) { row.coverage = 'empty_extraction'; failure('page', source, { ...result, reason: 'empty_extraction_not_missing_content' }); }
      for (const ref of extracted.refs) addRef(ref, row);
      // Escaped JSON/lazy-image URLs can sit in data attributes or hydration script data.
      if (source.extractor !== 'sena_project_v1') for (const url of embeddedFileUrls(result.body.toString('utf8'))) addRef({ url, section: 'embedded_url_reference', kind: 'file' }, row);
      for (const css of new Set(extracted.stylesheets.map(u => normalizeUrl(u, row.final_url)))) await cssAssets(css, row);
      await saveJson(`page-${String(index + 1).padStart(3,'0')}.json`, row);
    }
    await parser.close();
    for (const ref of input.file_refs) addRef({ ...ref, kind: 'file' }, { url: ref.page_url, project_ids: ref.project_ids, programme_ids: ref.programme_ids });
    const grouped = new Map();
    for (const ref of refs) { if (!grouped.has(ref.url)) grouped.set(ref.url, []); grouped.get(ref.url).push(ref); }
    const files = [], videoLinks = [], fileRows = [];
    let count = 0;
    for (const [url, references] of grouped) {
      if (references.every(r => r.suggested_role === 'video_link')) { videoLinks.push({ url, references, status: 'link_only_not_fetched' }); continue; }
      const result = await fetcher.fetch(url); count++;
      console.log(`file ${count}/${grouped.size}: ${result.status || result.reason} ${url}`);
      const row = { url, final_url: result.final_url || url, references, http_status: result.status ?? null, fetched_at: result.fetched_at || new Date().toISOString(), attempts: result.attempts || [], status: result.ok ? 'downloaded' : 'fetch_failed' };
      fileRows.push(row);
      if (!result.ok) { failure('file', { url, references }, result); continue; }
      if (!/^(image\/|application\/pdf)/.test(result.mime)) { row.status = 'fetch_failed'; failure('file', { url, references }, { ...result, reason: 'unexpected_file_mime' }); continue; }
      Object.assign(row, { blob: await blob(result.body), sha256: sha256(result.body), bytes: result.body.length, mime: result.mime, dimensions: null, dimensions_status: result.mime === 'application/pdf' ? 'not_applicable' : 'unknown' });
      if (result.mime.startsWith('image/') && sharp) {
        try { const meta = await sharp(result.body, { limitInputPixels: 268402689 }).metadata(); row.dimensions = { width: meta.width, height: meta.height }; row.dimensions_status = 'measured'; }
        catch { row.dimensions_status = 'inspection_failed'; }
      }
      files.push(row);
    }
    const uniqueFiles = new Map();
    for (const file of files) {
      if (!uniqueFiles.has(file.sha256)) uniqueFiles.set(file.sha256, { sha256: file.sha256, bytes: file.bytes, mime: file.mime, blob: file.blob, roles: new Set(), urls: [] });
      const unique = uniqueFiles.get(file.sha256); unique.urls.push(file.url); for (const ref of file.references) unique.roles.add(ref.suggested_role);
    }
    const roles = {};
    for (const file of uniqueFiles.values()) {
      const candidates = [...file.roles].filter(r => r !== 'unclassified'); file.primary_suggested_role = candidates.length === 1 ? candidates[0] : candidates.length ? 'multiple_roles_review' : 'unclassified';
      file.roles = [...file.roles]; roles[file.primary_suggested_role] ||= { files: 0, bytes: 0 }; roles[file.primary_suggested_role].files++; roles[file.primary_suggested_role].bytes += file.bytes;
    }
    const summary = { run_id: runId, local_only: true, staging_performed: false, pages: { total: pageRows.length, fetched: pageRows.filter(r => r.coverage === 'fetched').length, incomplete_or_failed: pageRows.filter(r => r.coverage !== 'fetched').length },
      unique_files: uniqueFiles.size, file_urls_downloaded: files.length, file_urls_failed: fileRows.filter(f => f.status === 'fetch_failed').length, file_bytes: [...uniqueFiles.values()].reduce((n,f) => n + f.bytes, 0), files_by_role: roles, video_links: videoLinks.length,
      failures_by_kind: Object.fromEntries([...new Set(failures.map(f => f.kind))].map(kind => [kind, failures.filter(f => f.kind === kind).length])),
      coverage_note: 'Measured bytes are a lower bound when fetches failed. Roles and applicability require review; no Hub candidates or rights approvals created.' };
    await saveJson('pages.json', pageRows); await saveJson('file-references.json', fileRows); await saveJson('unique-files.json', [...uniqueFiles.values()]); await saveJson('video-links.json', videoLinks);
    await saveJson('failures.json', failures); await saveJson('http-events.json', fetcher.events); await saveJson('render-requests.json', renderRequests);
    summary.evidence_bytes_before_summary_and_manifest = Object.values(manifestFiles).reduce((n,f) => n + f.bytes, 0);
    await saveJson('summary.json', summary);
    const manifest = { contract_version: 'sena-knowledge-preaudit-v1', created_at: new Date().toISOString(), collector_sha256: collectorSha256,
      project_extractor_sha256: sha256(await fs.readFile(new URL('./sena-project-extract.mjs', import.meta.url))), input_sha256: inputHash, source_evidence: input.source_evidence, files: manifestFiles, summary };
    await fs.writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await verifyPackage(work); await fs.rename(work, final);
    const manifestHash = sha256(await fs.readFile(path.join(final, 'manifest.json')));
    console.log(JSON.stringify({ package: final, manifest_sha256: manifestHash, summary }, null, 2));
    return { folder: final, manifestHash, summary };
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args[1]) {
    const m = await verifyPackage(args[1]); console.log(`Verified ${Object.keys(m.files).length} immutable package members.`);
  } else {
    const arg = key => args[args.indexOf(key) + 1];
    if (!args.includes('--input') || !args.includes('--input-sha256')) throw new Error('Usage: node scripts/crawl-knowledge.mjs --input .local/input.json --input-sha256 <reviewed-hash> [--channel msedge]');
    await crawl(arg('--input'), arg('--input-sha256'), args.includes('--channel') ? arg('--channel') : 'msedge');
  }
}
