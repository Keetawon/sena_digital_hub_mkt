/**
 * SENA Campaign Name Builder (Taxonomy V1) — one-time setup + edit trigger.
 *
 * Paste into: Google Sheet > Extensions > Apps Script, save, run `setupNameBuilder` once.
 * Creates tabs: How_To_Use (guide), Name_Builder (form), Builder_Lists (hidden months).
 * Reads option lists from the existing Naming_Options tab (single master, steward-owned).
 * Does NOT delete any existing tab; the old Campaign_Names tab is only hidden.
 */

const CFG = {
  BUILDER: 'Name_Builder',
  HELP: 'How_To_Use',
  LISTS: 'Builder_Lists',
  OPTIONS: 'Naming_Options',
  OLD_TAB: 'Campaign_Names',
  FIRST: 6,          // first data row
  LAST: 505,         // last prepared data row (500 campaigns)
  STALE_DAYS: 3,     // approved but no Campaign ID after N days -> red status
  // Emails allowed to tick "อนุมัติ" and edit protected columns (owner is always allowed).
  APPROVERS: [],
  // false: this internal file serves every agency (current, pre-approval template).
  // true: agencies move to their own files and this file keeps MASTER_AGENCIES only.
  SPLIT_AGENCY_FILES: false,
  MASTER_AGENCIES: ['INHOUSE'],
  SCOPE: 'Scope_Lists',            // hidden cascade lists derived from Naming_Options
  C_COMBO_MAX_MEMBERS: 4,          // scope C: readable combination list up to this group size; larger groups use the picker
  // Agency editors, e.g. { COMBAY: ['buyer@combay.co.th'] }; applied only by shareAgencyFiles.
  AGENCY_EDITORS: {},
  ALL: 'All_Requests',             // internal consolidated view (master file only)
  AGENCY_FILE_PREFIX: 'SENA Campaign Names — ',
  FILES_PROP: 'AGENCY_FILES',      // script property: {agency: spreadsheetId}
  SYNC_MINUTES: 30,
  // Official master (ProjectGroupMaster + Project tabs) for groups, phases and brands.
  MASTER_SOURCE_ID: '1BvPr9mjRt2hm2OUVS29HPIjGShZM8rbuRB77xExv-j4',
  APPROVED_BRANDS: ['COZI', 'SENA-KITH'],   // other master brands show as proposals
  SYNC_LOG: 'Master_Sync',
  DEFAULT_DEST: 'WEBSITE_FORM',
  EXAMPLE_NOTE: 'ตัวอย่างสำหรับนำเสนอ – ลบด้วย clearExampleRows ก่อนใช้งานจริง',
};

// Lead Destination choices (Builder_Lists!D); the first is the row default.
const DESTINATIONS = ['WEBSITE_FORM', 'PLATFORM_LEAD_FORM', 'LINE_OA', 'MESSENGER', 'CALL_ONLY'];

// Column map (1-indexed). Naming inputs are AGENCY..AUDIENCE; formulas use col_().
const C = {
  REQ_ID: 1, AGENCY: 2, MONTH: 3, SCOPE: 4, GROUP: 5, PHASE: 6, CHANNEL: 7, OBJECTIVE: 8,
  AUDIENCE: 9, DEST: 10, URL: 11, NOTE: 12, REQ_BY: 13, REQ_AT: 14, CHECK: 15, PREVIEW: 16,
  APPROVE: 17, NAME: 18, APPROVED_AT: 19, UTM: 20, TEST_URL: 21, ACCOUNT_ID: 22,
  CAMPAIGN_ID: 23, LAUNCH_DATE: 24, CANCEL: 25, STATUS: 26,
  H_IDENT: 27, H_BASE: 28, H_SEQ: 29, H_FBASE: 30, H_FSEQ: 31, H_PLATFORM: 32,
};
const LAST_COL = 32;

// Column letter for a C key, e.g. col_('NAME') -> 'Q'.
function col_(key) {
  let n = C[key], out = '';
  while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

// Scope choices (Scope_Lists!A). The first letter is the V1 scenario.
const SCOPES = [
  'A — Single Project Group (ทั้งกลุ่มโครงการ)',
  'B — Single Phase/Project (เจาะจงเฟส/ตึกเดียว)',
  'C — Multi-Phase (หลายเฟสในกลุ่มเดียวกัน)',
  'D — Multi-Group Cluster (รวมหลายกลุ่มโครงการ / Expo)',
  'E — Brand Awareness (ภาพรวมแบรนด์)',
  'F — Corporate / BU (องค์กร หรือ BU เช่น Solar, LivNex)',
];



const COLORS = {
  header: '#24576E', headerText: '#FFFFFF',
  requester: '#FFF8D6', auto: '#F1F3F4', approver: '#EDE3F7',
  name: '#D9F2E3', buyer: '#E3EEFB', status: '#FFFFFF',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// UTM template per platform (Naming_Options column I). {NAME} = approved name,
// {ACCOUNT} = returned Ad Account ID. Other {...}/__...__ tokens are platform macros.
const UTM_TEMPLATES = {
  META: 'utm_source=facebook&utm_medium=paid_social&utm_campaign={NAME}&utm_id={{campaign.id}}&sena_account_id={ACCOUNT}',
  GOOGLE: 'utm_source=google&utm_medium=cpc&utm_campaign={NAME}&utm_id={campaignid}&sena_account_id={ACCOUNT}',
  TIKTOK: 'utm_source=tiktok&utm_medium=paid_social&utm_campaign={NAME}&utm_id=__CAMPAIGN_ID__&sena_account_id={ACCOUNT}',
  CHATGPT: 'utm_source=chatgpt&utm_medium=cpc&utm_campaign={NAME}&utm_id={campaign_id}&sena_account_id={ad_account_id}',
};
// Platforms whose native account/campaign IDs are digits only.
const NUMERIC_ID_PLATFORMS = ['META', 'GOOGLE', 'TIKTOK'];

function setupNameBuilder() {
  const ss = SpreadsheetApp.getActive();
  let hadExamples = false;
  if (!ss.getSheetByName(CFG.OPTIONS)) throw new Error('ไม่พบแท็บ ' + CFG.OPTIONS);

  const existing = ss.getSheetByName(CFG.BUILDER);
  if (existing) {
    const note = existing.getRange(CFG.FIRST, C.NOTE, CFG.LAST - CFG.FIRST + 1, 1).getValues();
    const rowsIn = existing.getRange(CFG.FIRST, C.AGENCY, CFG.LAST - CFG.FIRST + 1, 8).getValues();
    hadExamples = note.some(r => r[0] === CFG.EXAMPLE_NOTE);
    const used = rowsIn.some((r, i) => note[i][0] !== CFG.EXAMPLE_NOTE && r.some(v => v !== ''));
    if (used) throw new Error('Name_Builder มีข้อมูลแล้ว — หยุดเพื่อป้องกันข้อมูลหาย (เปลี่ยนผู้อนุมัติใช้ updateApprovers)');
    // Never delete the sheet the editor session treats as active.
    const safe = ss.getSheets().find(s => !s.isSheetHidden() && s.getSheetId() !== existing.getSheetId());
    if (safe) ss.setActiveSheet(safe);
    ss.deleteSheet(existing);
  }

  ensureChannel_(ss, 'CHATGPT / CONVERSATIONAL', 'CHATGPT__CONVERSATIONAL');
  ensureUtmTemplates_(ss);
  if (CFG.MASTER_SOURCE_ID) syncMaster_(ss);
  buildLists_(ss, CFG.SPLIT_AGENCY_FILES ? CFG.MASTER_AGENCIES : allAgencies_(ss));
  buildScopeLists_(ss);
  const sh = ss.insertSheet(CFG.BUILDER, 0);
  buildBuilder_(sh);
  buildHelp_(ss);
  protect_(ss, sh);
  installEditTrigger_(ss);
  if (CFG.SPLIT_AGENCY_FILES) {
    installSyncTrigger_();
    buildAllRequests_(ss);
  } else {
    pauseAgencyFiles_(ss);
  }
  PropertiesService.getScriptProperties().setProperty('MASTER_ID', ss.getId());
  if (hadExamples) {
    PropertiesService.getScriptProperties().deleteProperty('REQ_SEQ');
    loadExampleRows_(ss);
  }

  const old = ss.getSheetByName(CFG.OLD_TAB);
  if (old) old.hideSheet();
  ss.setActiveSheet(ss.getSheetByName(CFG.HELP));
  ss.moveActiveSheet(1);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(2);
  SpreadsheetApp.flush();
  ss.toast('ตั้งค่า Name_Builder เรียบร้อย', 'SENA', 8);
}

// Appends a channel option (label in G, V1 token in H) to Naming_Options if missing.
function ensureChannel_(ss, label, token) {
  const opt = ss.getSheetByName(CFG.OPTIONS);
  const vals = opt.getRange('G6:H50').getValues();
  if (vals.some(v => v[1] === token)) return;
  const free = vals.findIndex(v => v[0] === '' && v[1] === '');
  if (free < 0) throw new Error('Naming_Options G6:H50 เต็ม — เพิ่มช่องทาง ' + token + ' ไม่ได้');
  opt.getRange(6 + free, 7, 1, 2).setValues([[label, token]]);
}

// Fills blank UTM templates (column I) for known platforms. A steward adding a new
// platform row (G label, H PLATFORM__TACTIC) writes its template in I; no code change.
function ensureUtmTemplates_(ss) {
  const opt = ss.getSheetByName(CFG.OPTIONS);
  opt.getRange('I5').setValue('UTM template ({NAME}, {ACCOUNT})')
    .setBackground(COLORS.header).setFontColor(COLORS.headerText).setFontWeight('bold').setWrap(true);
  const rng = opt.getRange('G6:I50');
  const vals = rng.getValues();
  vals.forEach(v => {
    const platform = String(v[1]).split('__')[0];
    if (v[1] !== '' && v[2] === '' && UTM_TEMPLATES[platform]) v[2] = UTM_TEMPLATES[platform];
  });
  opt.getRange('I6:I50').setValues(vals.map(v => [v[2]]));
  opt.setColumnWidth(9, 380);
}

// Re-applies protections after editing CFG.APPROVERS; safe when rows already exist.
function updateApprovers() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(CFG.BUILDER)) throw new Error('ไม่พบแท็บ ' + CFG.BUILDER);
  const files = [ss].concat(Object.values(agencyFiles_()).map(id => SpreadsheetApp.openById(id)));
  files.forEach(f => {
    if (f.getId() !== ss.getId() && CFG.APPROVERS.length) f.addEditors(CFG.APPROVERS);
    [CFG.BUILDER, CFG.OPTIONS, CFG.LISTS, CFG.ALL].forEach(name => {
      const s = f.getSheetByName(name);
      if (s) s.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(restrictEditors_);
    });
  });
  ss.toast('อัปเดตผู้อนุมัติแล้ว: ' + (CFG.APPROVERS.join(', ') || 'เจ้าของไฟล์เท่านั้น'), 'SENA', 8);
}

function buildLists_(ss, agencies) {
  let sh = ss.getSheetByName(CFG.LISTS);
  if (sh) sh.clear(); else sh = ss.insertSheet(CFG.LISTS);
  const months = [['flight_month (YYYYMM)']];
  for (let y = 2026; y <= 2029; y++) {
    for (let m = 1; m <= 12; m++) months.push([String(y) + String(m).padStart(2, '0')]);
  }
  sh.getRange(1, 1, months.length, 1).setNumberFormat('@').setValues(months);
  sh.getRange(1, 2, agencies.length + 1, 1).setValues([['agency (this file)']].concat(agencies.map(a => [a])));
  sh.getRange(1, 4, DESTINATIONS.length + 1, 1).setValues([['lead_destination']].concat(DESTINATIONS.map(d => [d])));
  sh.getRange('C1').setValue('หมายเหตุ: เพิ่มเดือนต่อท้ายคอลัมน์ A ได้ (dropdown อ่านถึง A200) • คอลัมน์ B = Agency ที่ใช้ได้ในไฟล์นี้');
  sh.hideSheet();
}

function allAgencies_(ss) {
  return ss.getSheetByName(CFG.OPTIONS).getRange('N6:N50').getValues()
    .map(r => String(r[0]).trim()).filter(String);
}

// Rebuilds Naming_Options A:E groups (A), phases (B) and brands (E) from the official
// master spreadsheet. ProjectGroupMaster owns groups and member sets; the Project tab
// supplies phase names and brands. Corporate/BU rows (F) are kept. IDs that cannot be
// written in V1 grammar are excluded and, with tab mismatches, listed in Master_Sync.
function syncMaster_(ss) {
  const src = SpreadsheetApp.openById(CFG.MASTER_SOURCE_ID);
  const read = name => {
    const t = src.getSheetByName(name);
    if (!t) throw new Error('ไม่พบแท็บ ' + name + ' ในไฟล์ Master Data');
    return t.getDataRange().getDisplayValues();
  };
  const pgm = read('ProjectGroupMaster'), prj = read('Project');
  const col = (hdr, name) => {
    const i = hdr.findIndex(h => String(h).trim().toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error('ไม่พบคอลัมน์ ' + name);
    return i;
  };
  const gId = col(pgm[0], 'ProjectGroupID'), gSet = col(pgm[0], 'ProjectID_Set');
  const gTh = col(pgm[0], 'ProjectName_TH'), gEn = col(pgm[0], 'ProjectName_EN');
  const pId = col(prj[0], 'Project ID'), pTh = col(prj[0], 'Project'), pEn = col(prj[0], 'Project Name EN');
  const pBrand = col(prj[0], 'Brand'), pGroup = col(prj[0], 'Project Group ID');
  const v1 = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
  const source = 'Master Data sync ' + stamp;

  const projects = {};
  prj.slice(1).forEach(r => {
    const id = String(r[pId]).trim();
    if (id) projects[id] = { name: String(r[pTh]).trim() || String(r[pEn]).trim(), brand: String(r[pBrand]).trim(), group: String(r[pGroup]).trim() };
  });
  const groupRows = [], pairRows = [], excluded = [], members = {};
  pgm.slice(1).forEach(r => {
    const g = String(r[gId]).trim();
    if (!g) return;
    if (!v1.test(g)) { excluded.push(['group', g, '', 'รหัสกลุ่มเขียนในชื่อ V1 ไม่ได้']); return; }
    if (members[g]) { excluded.push(['group', g, '', 'ProjectGroupID ซ้ำ']); return; }
    const name = String(r[gTh]).trim() || String(r[gEn]).trim() || g;
    members[g] = [];
    groupRows.push(['โครงการ: ' + name + ' [' + g + ']', 'PG-' + g, 'A', g, source]);
    String(r[gSet]).split(/[,;\n]+/).map(x => x.trim()).filter(String).forEach(ph => {
      if (!v1.test(ph)) { excluded.push(['phase', g, ph, 'รหัสเฟสเขียนในชื่อ V1 ไม่ได้']); return; }
      if (members[g].indexOf(ph) >= 0) return;
      members[g].push(ph);
      const pn = projects[ph] && projects[ph].name ? projects[ph].name : name;
      pairRows.push(['เฟส/โครงการย่อย: ' + pn + ' [' + g + ' / ' + ph + ']', 'PH-' + g + '-' + ph, 'B', g + ' / ' + ph, source]);
    });
  });
  const mismatch = [];
  Object.keys(projects).forEach(ph => {
    const g = projects[ph].group;
    if (!g) mismatch.push([ph, '', 'Project tab ไม่ระบุ Project Group ID']);
    else if (!members[g]) mismatch.push([ph, g, 'กลุ่มนี้ไม่มีใน ProjectGroupMaster']);
    else if (members[g].indexOf(ph) < 0) mismatch.push([ph, g, 'ProjectID_Set ของกลุ่มนี้ไม่มีเฟสนี้']);
  });

  const slug = b => String(b).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const brands = {};
  Object.keys(projects).forEach(ph => { const b = projects[ph].brand; if (b && slug(b)) brands[slug(b)] = b; });
  CFG.APPROVED_BRANDS.forEach(b => { if (!brands[b]) brands[b] = b; });
  const brandRows = Object.keys(brands).sort().map(sl => {
    const approved = CFG.APPROVED_BRANDS.indexOf(sl) >= 0;
    return ['แบรนด์: ' + brands[sl] + (approved ? '' : ' (เสนอ รออนุมัติ)'), 'BRAND-' + sl + '-BRANDING', 'E', sl,
      approved ? 'Approved brand template' : source + ' (Project tab brand; pending approval)'];
  });

  const opt = ss.getSheetByName(CFG.OPTIONS);
  const last = Math.max(opt.getLastRow(), 6);
  const existing = opt.getRange(6, 1, last - 5, 5).getValues();
  const keep = existing.filter(r => r[2] === 'F');
  const rows = groupRows.concat(pairRows, brandRows, keep);
  opt.getRange(6, 1, Math.max(last - 5, rows.length), 5).clearContent();
  opt.getRange(6, 1, rows.length, 5).setNumberFormat('@').setValues(rows);

  let log = ss.getSheetByName(CFG.SYNC_LOG);
  if (log) log.clear(); else log = ss.insertSheet(CFG.SYNC_LOG);
  const summary = [
    ['Master sync', stamp],
    ['Source', src.getUrl()],
    ['Groups', groupRows.length],
    ['Phases (V1-compatible)', pairRows.length],
    ['Brands', Object.keys(brands).sort().join(', ')],
    ['Excluded IDs', excluded.length],
    ['Project tab mismatches', mismatch.length],
  ];
  log.getRange(1, 1, summary.length, 2).setValues(summary);
  let row = summary.length + 2;
  const table = (title, header, data) => {
    log.getRange(row, 1).setValue(title).setFontWeight('bold');
    log.getRange(row + 1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    if (data.length) log.getRange(row + 2, 1, data.length, header.length).setNumberFormat('@').setValues(data);
    row += data.length + 3;
  };
  table('ไม่นำมาใช้ (ชื่อ V1 ไม่รองรับ)', ['type', 'group', 'phase', 'reason'], excluded);
  table('Project tab ไม่ตรงกับ ProjectGroupMaster (ตรวจโดยผู้ดูแล)', ['project_id', 'group', 'issue'], mismatch);
  log.hideSheet();
  return { groups: groupRows.length, phases: pairRows.length, brands: Object.keys(brands).length, excluded: excluded.length, mismatch: mismatch.length };
}

// Steward refresh after the master changes: options, cascade lists and row dropdowns.
function syncMasterFromReference() {
  const ss = SpreadsheetApp.getActive();
  const res = syncMaster_(ss);
  buildScopeLists_(ss);
  const sh = ss.getSheetByName(CFG.BUILDER);
  if (sh) {
    const data = scopeData_(ss);
    const used = sh.getRange(CFG.FIRST, C.SCOPE, CFG.LAST - CFG.FIRST + 1, 1).getValues();
    used.forEach((r, i) => { if (r[0] !== '') applyRowValidation_(sh, CFG.FIRST + i, data); });
  }
  ss.toast('Master sync: ' + res.groups + ' กลุ่ม, ' + res.phases + ' เฟส, ' + res.brands + ' แบรนด์ • ไม่ใช้ ' + res.excluded + ' • ไม่ตรง ' + res.mismatch, 'SENA', 10);
  Logger.log(JSON.stringify(res));
}

// Hidden cascade lists, rebuilt from Naming_Options A:E (the steward-owned master):
// A scopes | B:C groups (display, id) | D:G pairs (key G-P, group, phase, display)
// H:I brands (display, slug) | J:K corporate/BU (display, token). Pair keys and group
// ids are sorted by code unit; their row order defines the canonical C/D ordering.
function buildScopeLists_(ss) {
  const opt = ss.getSheetByName(CFG.OPTIONS);
  const rows = opt.getRange(6, 1, Math.max(opt.getLastRow() - 5, 1), 5).getValues()
    .filter(r => r[0] !== '' && r[1] !== '');
  const nameOf = label => String(label).replace(/^[^:]*:\s*/, '').replace(/\s*\[[^\]]*\]\s*$/, '');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const groups = rows.filter(r => r[2] === 'A').map(r => [String(r[3]), nameOf(r[0])])
    .sort((a, b) => cmp(a[0], b[0]));
  const pairs = rows.filter(r => r[2] === 'B').map(r => {
    const parts = String(r[3]).split(' / ');
    return [parts[0] + '-' + parts[1], parts[0], parts[1], parts[1] + ' · ' + nameOf(r[0])];
  }).sort((a, b) => cmp(a[0], b[0]));
  const brands = rows.filter(r => r[2] === 'E').map(r => [String(r[3]) + ' · ' + nameOf(r[0]), String(r[3])]);
  const corp = rows.filter(r => r[2] === 'F').map(r => [String(r[1]) + ' · ' + String(r[0]), String(r[1])]);

  let sh = ss.getSheetByName(CFG.SCOPE);
  if (sh) sh.clear(); else sh = ss.insertSheet(CFG.SCOPE);
  const need = Math.max(groups.length, pairs.length, SCOPES.length) + 2;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  const put = (col, header, data) => {
    sh.getRange(1, col, 1, header.length).setValues([header]).setFontWeight('bold');
    if (data.length) sh.getRange(2, col, data.length, header.length).setNumberFormat('@').setValues(data);
  };
  put(1, ['scope'], SCOPES.map(x => [x]));
  put(2, ['group (display)', 'group_id'], groups.map(g => [g[0] + ' · ' + g[1], g[0]]));
  put(4, ['pair_key', 'group_id', 'phase_id', 'phase (display)'], pairs);
  put(8, ['brand (display)', 'slug'], brands);
  put(10, ['corporate/BU (display)', 'token'], corp);
  sh.getRange('M1').setValue('สร้างอัตโนมัติจาก Naming_Options — แก้ที่ Naming_Options แล้วรัน refreshScopeLists');
  sh.hideSheet();
  return sh;
}

// Rebuilds Scope_Lists after a steward edits Naming_Options (safe with existing rows).
function refreshScopeLists() {
  const ss = SpreadsheetApp.getActive();
  buildScopeLists_(ss);
  ss.toast('อัปเดต Scope_Lists แล้ว', 'SENA', 5);
}

function scopeData_(ss) {
  const sh = ss.getSheetByName(CFG.SCOPE);
  const v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 11).getValues();
  const col = i => v.map(r => r[i]).filter(x => x !== '');
  const nameOf = label => String(label).split(' · ').slice(1).join(' · ');
  const pairs = v.filter(r => r[3] !== '').map(r => ({ key: r[3], group: r[4], phase: r[5], label: r[6], name: nameOf(r[6]) }));
  const groups = v.filter(r => r[2] !== '').map(r => ({ id: r[2], label: r[1], name: nameOf(r[1]) }));
  return {
    sheet: sh,
    groupCount: col(2).length, brandCount: col(8).length, corpCount: col(10).length,
    groupIds: col(2),
    groups: groups,
    membersOf: g => pairs.filter(p => p.group === g),
  };
}

// Readable multi-value for column F; formulas keep only each part's leading code.
function joinChoices_(items) {
  return items.map(x => x.code + (x.name ? ' (' + x.name + ')' : '')).join(' + ');
}

// Sets the dependent dropdowns of one row from its scope (D) and group (E).
function applyRowValidation_(sh, row, data) {
  const s = String(sh.getRange(row, C.SCOPE).getValue()).charAt(0);
  const g = String(sh.getRange(row, C.GROUP).getValue()).split(' ')[0];
  const L = data.sheet;
  const dv = () => SpreadsheetApp.newDataValidation();
  const reject = help => dv().requireFormulaSatisfied('=LEN(' + col_('PHASE') + row + ')=0')
    .setAllowInvalid(false).setHelpText(help).build();
  const listRange = (c, n) => dv().requireValueInRange(L.getRange(2, c, Math.max(n, 1), 1), true)
    .setAllowInvalid(false);

  let groupDv;
  if (s && 'ABCD'.indexOf(s) >= 0) groupDv = listRange(2, data.groupCount).setHelpText('พิมพ์ชื่อหรือรหัสกลุ่มโครงการเพื่อค้นหา').build();
  else if (s === 'E') groupDv = listRange(8, data.brandCount).setHelpText('เลือกแบรนด์').build();
  else if (s === 'F') groupDv = listRange(10, data.corpCount).setHelpText('เลือกหัวข้อองค์กร หรือ BU').build();
  else groupDv = dv().requireFormulaSatisfied('=LEN(' + col_('SCOPE') + row + ')>0')
    .setAllowInvalid(false).setHelpText('เลือกขอบเขต (คอลัมน์ ' + col_('SCOPE') + ') ก่อน').build();
  sh.getRange(row, C.GROUP).setDataValidation(groupDv);

  let phaseDv;
  const members = data.membersOf(g);
  if (!s) phaseDv = reject('เลือกขอบเขต (คอลัมน์ ' + col_('SCOPE') + ') ก่อน');
  else if ('AEF'.indexOf(s) >= 0) phaseDv = reject('ไม่ต้องกรอกช่องนี้สำหรับขอบเขต A, E, F (ทั้งกลุ่ม / แบรนด์ / องค์กร-BU)');
  else if (s === 'D') phaseDv = dv().requireValueInList(data.groups.filter(x => x.id !== g).map(x => x.label), true)
    .setAllowInvalid(true).setHelpText('เลือกกลุ่มที่ 2 • ถ้ามีมากกว่า 2 กลุ่ม ใช้เมนู SENA ▸ เลือกหลายเฟส / หลายกลุ่ม').build();
  else if (data.groupIds.indexOf(g) < 0) phaseDv = reject('เลือกกลุ่มโครงการ (คอลัมน์ ' + col_('GROUP') + ') ก่อน');
  else if (s === 'B') phaseDv = members.length
    ? dv().requireValueInList(members.map(m => m.label), true).setAllowInvalid(false).setHelpText('เลือกเฟส/โครงการย่อยของกลุ่มนี้').build()
    : reject('กลุ่มนี้ไม่มีเฟสที่ใช้กับชื่อ V1 ได้ — ใช้ขอบเขต A');
  else if (members.length < 2) phaseDv = reject('กลุ่มนี้มีเฟสเดียว — ใช้ขอบเขต A หรือ B');
  else if (members.length <= CFG.C_COMBO_MAX_MEMBERS) {
    const combos = [];
    for (let mask = 1; mask < (1 << members.length); mask++) {
      const pick = members.filter((_, i) => mask & (1 << i));
      if (pick.length >= 2) combos.push([pick.length, joinChoices_(pick.map(m => ({ code: m.phase, name: m.name })))]);
    }
    combos.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    phaseDv = dv().requireValueInList(combos.map(x => x[1]), true).setAllowInvalid(false)
      .setHelpText('เลือกชุดเฟสที่โปรโมทพร้อมกัน (อย่างน้อย 2 เฟส) หรือใช้เมนู SENA ▸ เลือกหลายเฟส / หลายกลุ่ม').build();
  } else {
    phaseDv = dv().requireFormulaSatisfied('=TRUE').setAllowInvalid(true)
      .setHelpText('กลุ่มนี้มี ' + members.length + ' เฟส — ใช้เมนู SENA ▸ เลือกหลายเฟส / หลายกลุ่ม เพื่อติ๊กเลือกเฟส').build();
  }
  sh.getRange(row, C.PHASE).setDataValidation(phaseDv);
}

// Pre-approval mode: stop agency-file triggers and the sync job; files stay in Drive.
function pauseAgencyFiles_(master) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAll' ||
      (t.getHandlerFunction() === 'onBuilderEdit' && t.getTriggerSourceId() !== master.getId()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  const all = master.getSheetByName(CFG.ALL);
  if (all) all.hideSheet();
}

function buildBuilder_(sh) {
  const n = CFG.LAST - CFG.FIRST + 1;
  if (sh.getMaxColumns() < LAST_COL) sh.insertColumnsAfter(sh.getMaxColumns(), LAST_COL - sh.getMaxColumns());
  if (sh.getMaxColumns() > LAST_COL) sh.deleteColumns(LAST_COL + 1, sh.getMaxColumns() - LAST_COL);
  if (sh.getMaxRows() > CFG.LAST) sh.deleteRows(CFG.LAST + 1, sh.getMaxRows() - CFG.LAST);
  sh.setHiddenGridlines(true);
  const $ = col_;
  const span = (a, b, row) => $(a) + row + ':' + $(b) + row;

  // --- Title rows ---------------------------------------------------------
  sh.getRange(span('REQ_ID', 'STATUS', 1)).merge().setValue('SENA Campaign Name Builder — ทะเบียนตั้งชื่อแคมเปญ (Taxonomy V1)')
    .setFontSize(15).setFontWeight('bold').setFontColor(COLORS.header);
  sh.getRange(span('REQ_ID', 'STATUS', 2)).merge().setValue(
    '① ผู้ขอ/Agency กรอกช่องสีเหลือง (ขอบเขต → กลุ่มโครงการ → เฟส)  →  ② ระบบตรวจและสร้างชื่อ  →  ③ SENA Idea ติ๊ก "อนุมัติ"  →  ' +
    '④ คัดลอกชื่อจากช่องสีเขียว (คอลัมน์ ' + $('NAME') + ') + UTM ไปตั้งในแพลตฟอร์ม  →  ⑤ ส่ง Ad Account ID + Campaign ID กลับมาภายใน 1 วันทำการ')
    .setFontSize(10).setWrap(true);
  sh.getRange(span('REQ_ID', 'STATUS', 3)).merge().setValue(
    'ห้ามพิมพ์ชื่อเอง • ห้ามแก้ชื่อหลังยิง • ห้ามลบแถว (ใช้ช่อง "ยกเลิก") • แคมเปญ always-on ใช้ชื่อเดิมข้ามเดือน • อ่านวิธีใช้ในแท็บ How_To_Use')
    .setFontSize(10).setFontColor('#B3261E').setFontWeight('bold');
  sh.setRowHeight(2, 34);

  // --- Section band (row 4) ----------------------------------------------
  const bands = [
    [span('REQ_ID', 'REQ_AT', 4), '① ผู้ขอ / Agency กรอก (สีเหลือง)', COLORS.requester],
    [span('CHECK', 'PREVIEW', 4), '② ระบบตรวจ + สร้างชื่อ (อัตโนมัติ)', COLORS.auto],
    [span('APPROVE', 'APPROVED_AT', 4), '③ SENA Idea อนุมัติ', COLORS.approver],
    [span('UTM', 'TEST_URL', 4), '④ UTM (อัตโนมัติหลังอนุมัติ)', COLORS.auto],
    [span('ACCOUNT_ID', 'CANCEL', 4), '⑤ ผู้ยิงแอดกรอกกลับ (สีฟ้า)', COLORS.buyer],
    [span('STATUS', 'STATUS', 4), 'สถานะ', COLORS.status],
  ];
  bands.forEach(([a1, label, bg]) => {
    const rg = sh.getRange(a1);
    if (rg.getNumColumns() > 1) rg.merge();
    rg.setValue(label).setBackground(bg).setFontWeight('bold')
      .setHorizontalAlignment('center').setBorder(true, true, true, true, false, false);
  });

  // --- Headers (row 5) ----------------------------------------------------
  const headers = [
    ['Request ID\n(อัตโนมัติ)', 'ระบบออกเลขให้อัตโนมัติเมื่อเริ่มกรอกแถว ใช้อ้างอิงคำขอ'],
    ['Agency ผู้ยิง *', 'บริษัทที่เป็นผู้ยิงแอดจริง (ใช้คิดค่า Fee) — INHOUSE = ทีม SENA ยิงเอง'],
    ['เดือนเริ่มยิง *\nYYYYMM', 'เดือนที่แคมเปญเริ่มยิงครั้งแรก เช่น 202610 — always-on ข้ามเดือนใช้ชื่อเดิม ไม่ต้องสร้างใหม่'],
    ['① ขอบเขต *\n(Scope)', 'A ทั้งกลุ่ม • B เฟสเดียว • C หลายเฟสในกลุ่มเดียว • D หลายกลุ่ม/Expo • E แบรนด์ • F องค์กร/BU — เลือกก่อน แล้วช่องถัดไปจะแสดงตัวเลือกที่ตรงกัน'],
    ['② กลุ่มโครงการ / แบรนด์ / องค์กร-BU *', 'A–D: กลุ่มโครงการ (พิมพ์ชื่อหรือรหัสเพื่อค้นหา) • E: แบรนด์ • F: หัวข้อองค์กร หรือ BU'],
    ['③ เฟส / กลุ่มเพิ่มเติม', 'A, E, F: เว้นว่าง • B: เลือก 1 เฟส • C: เลือกชุดเฟส (อย่างน้อย 2) • D: กลุ่มที่ 2 • เลือกหลายเฟส/หลายกลุ่ม: เมนู SENA ▸ เลือกหลายเฟส / หลายกลุ่ม'],
    ['ช่องทาง / รูปแบบ *', 'แพลตฟอร์ม / ประเภทแคมเปญ เช่น META / SOCIAL, GOOGLE / SEM, CHATGPT / CONVERSATIONAL'],
    ['วัตถุประสงค์ *', 'LEADS = หา Lead, AWARENESS = สร้างการรับรู้, TRAFFIC, ENGAGEMENT, SALES, CONVERSION'],
    ['กลุ่มผู้ชม *', 'PROSPECTING = คนใหม่, RETARGETING = คนเคยเห็น, MIXED, BROAD — KWBRAND/KWGENERIC/KWLOCATION ใช้กับ Google Search เท่านั้น'],
    ['Lead Destination *', 'ช่องทางที่ Lead เข้ามา (ระบบใส่ WEBSITE_FORM ให้อัตโนมัติ): WEBSITE_FORM = ฟอร์มบนเว็บไซต์ • PLATFORM_LEAD_FORM = Lead Form ใน Meta/Google/TikTok • LINE_OA • MESSENGER • CALL_ONLY = โทรอย่างเดียว'],
    ['Landing Page URL', 'หน้าเว็บปลายทาง (ขึ้นต้น https://) — ใช้สร้างลิงก์ทดสอบ UTM; ถ้าใช้ Lead Form ในแพลตฟอร์มเว้นว่างได้'],
    ['หมายเหตุ / ลิงก์บรีฟ', 'ชื่อเรียกภายใน เช่น "Promo 10.10", ลิงก์บรีฟ/ใบอนุมัติงบ (ไม่ถูกใส่ในชื่อแคมเปญ)'],
    ['ผู้กรอก\n(อัตโนมัติ)', 'อีเมลผู้เริ่มกรอกแถว (ระบบบันทึกให้ อาจว่างถ้าเป็นบัญชีนอกองค์กร)'],
    ['เวลาที่ขอ\n(อัตโนมัติ)', 'เวลาเริ่มกรอกแถว'],
    ['ผลตรวจ', '✅ OK = พร้อมส่งอนุมัติ, … = ยังกรอกไม่ครบ, ❌ = ต้องแก้, ⚠ = มีการแก้ข้อมูลหลังอนุมัติ, ✖ = ยกเลิกแล้ว'],
    ['ชื่อ (ร่าง / Preview)', 'ชื่อที่ระบบสร้าง — ยังห้ามใช้จนกว่าจะอนุมัติ (ลำดับอาจเปลี่ยนได้ก่อนอนุมัติ)'],
    ['อนุมัติ\n(SENA Idea)', 'เฉพาะ SENA Idea ติ๊กได้ — ติ๊กแล้วชื่อจะถูกล็อกถาวรในคอลัมน์ ' + $('NAME')],
    ['✅ ชื่อที่อนุมัติ — คัดลอกไปใช้', 'ชื่อทางการที่ถูกล็อกแล้ว คัดลอกไปตั้งเป็น Campaign name ในแพลตฟอร์มแบบตรงทุกตัวอักษร ห้ามแก้ไข'],
    ['อนุมัติเมื่อ', 'เวลาอนุมัติ (ดูผู้อนุมัติใน Note ของเซลล์)'],
    ['UTM Parameters', 'คัดลอกไปใส่: Meta = Ad > Tracking > URL parameters; Google = Campaign settings > Campaign URL options > Final URL suffix; TikTok = ต่อท้าย Destination URL; ChatGPT = Campaign > Landing page query parameters (อย่าใส่ utm ซ้ำที่ระดับ Ad)'],
    ['ลิงก์ทดสอบ', 'Landing URL + UTM — ใช้คลิกทดสอบว่าแท็กไม่หลุดระหว่าง redirect/ฟอร์ม'],
    ['Ad Account ID', 'ตัวเลขล้วน — Meta ไม่ต้องมี act_, Google ไม่ต้องมีขีด (123-456-7890 → 1234567890)'],
    ['Campaign ID', 'ตัวเลข ID ของแคมเปญที่แพลตฟอร์มออกให้ หลังสร้างแคมเปญแล้ว — ต้องกรอกภายใน 1 วันทำการ'],
    ['วันที่เริ่มยิงจริง', 'วันแรกที่แคมเปญเริ่ม delivery'],
    ['ยกเลิก', 'ติ๊กเมื่อยกเลิกคำขอ/แคมเปญ แทนการลบแถว — ชื่อที่อนุมัติแล้วจะไม่ถูกนำกลับมาใช้ซ้ำ'],
    ['สถานะ', 'DRAFT → WAITING → APPROVED → LIVE (มี Campaign ID) / OVERDUE / CANCELLED'],
    ['_identifier', 'helper'], ['_base', 'helper'], ['_seq', 'helper'], ['_frozen_base', 'helper'], ['_frozen_seq', 'helper'], ['_platform', 'helper'],
  ];
  const hdr = sh.getRange(5, 1, 1, LAST_COL);
  hdr.setValues([headers.map(h => h[0])]).setNotes([headers.map(h => h[1])])
    .setBackground(COLORS.header).setFontColor(COLORS.headerText).setFontWeight('bold')
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.getRange(5, C.NAME).setBackground('#137333');
  sh.getRange(5, C.SCOPE, 1, 3).setBackground('#8A4B00');
  sh.setRowHeight(5, 56);

  // --- Column widths ------------------------------------------------------
  const widths = {
    REQ_ID: 95, AGENCY: 120, MONTH: 85, SCOPE: 240, GROUP: 300, PHASE: 200, CHANNEL: 165,
    OBJECTIVE: 110, AUDIENCE: 115, DEST: 170, URL: 200, NOTE: 170, REQ_BY: 150, REQ_AT: 110, CHECK: 260,
    PREVIEW: 330, APPROVE: 70, NAME: 420, APPROVED_AT: 115, UTM: 380, TEST_URL: 220,
    ACCOUNT_ID: 120, CAMPAIGN_ID: 150, LAUNCH_DATE: 105, CANCEL: 60, STATUS: 230,
  };
  Object.keys(widths).forEach(k => sh.setColumnWidth(C[k], widths[k]));

  // --- Body colours & formats ----------------------------------------------
  const body = (key, cols) => sh.getRange(CFG.FIRST, C[key], n, cols || 1);
  body('REQ_ID').setBackground(COLORS.auto).setFontColor('#5F6368');
  body('AGENCY', C.NOTE - C.AGENCY + 1).setBackground(COLORS.requester);
  body('REQ_BY', 2).setBackground(COLORS.auto).setFontColor('#5F6368');
  body('CHECK', 2).setBackground(COLORS.auto);
  body('APPROVE').setBackground(COLORS.approver);
  body('NAME').setBackground(COLORS.name).setFontWeight('bold').setFontFamily('Roboto Mono');
  body('PREVIEW').setFontFamily('Roboto Mono').setFontColor('#80868B');
  body('APPROVED_AT').setBackground(COLORS.approver);
  body('UTM', 2).setBackground(COLORS.auto).setFontFamily('Roboto Mono').setFontSize(9);
  body('ACCOUNT_ID', C.CANCEL - C.ACCOUNT_ID + 1).setBackground(COLORS.buyer);
  body('MONTH').setNumberFormat('@');
  body('PHASE').setNumberFormat('@');
  body('ACCOUNT_ID', 2).setNumberFormat('@');
  body('REQ_AT').setNumberFormat('yyyy-mm-dd hh:mm');
  body('APPROVED_AT').setNumberFormat('yyyy-mm-dd hh:mm');
  body('LAUNCH_DATE').setNumberFormat('yyyy-mm-dd');
  sh.getRange(CFG.FIRST, 1, n, C.STATUS).setVerticalAlignment('middle')
    .setBorder(null, null, null, null, true, true, '#DADCE0', SpreadsheetApp.BorderStyle.SOLID);

  // --- Formulas (row FIRST, then copied down) ------------------------------
  const r = CFG.FIRST, L = CFG.LAST;
  const c = k => $(k) + r;                       // relative cell, e.g. Q6
  const colAbs = k => '$' + $(k) + '$' + r + ':$' + $(k) + '$' + L;
  const colRun = k => '$' + $(k) + '$' + r + ':' + $(k) + r;
  const NO = CFG.OPTIONS, SL = CFG.SCOPE;
  const scopes = `${SL}!$A$2:$A$20`, groups = `${SL}!$C$2:$C$1000`, pairs = `${SL}!$D$2:$D$2000`;
  const brands = `${SL}!$I$2:$I$200`, corp = `${SL}!$K$2:$K$200`;
  const chanL = `${NO}!$G$6:$G$50`, chanT = `${NO}!$H$6:$H$50`, chanU = `${NO}!$I$6:$I$50`;
  const g = `IFERROR(REGEXEXTRACT(${c('GROUP')}&" ","^[^ ]+"),"")`;
  // Column F may hold "CODE · name", "CODE (name) + CODE (name)" or plain "A.B": keep the codes.
  const pv = `IFERROR(TEXTJOIN(".",TRUE,ARRAYFORMULA(REGEXEXTRACT(TRIM(SPLIT(${c('PHASE')}&""," + ",FALSE,TRUE))&" ","^[^ ]+"))),"")`;
  const f = {};

  // Identifier token. C/D members are ordered by their Scope_Lists row (code-unit
  // order), so the result never depends on the spreadsheet's text collation.
  f.H_IDENT = `=IF(OR(${c('SCOPE')}="",${c('GROUP')}=""),"",LET(s,LEFT(${c('SCOPE')},1),g,${g},p,${pv},IFERROR(SWITCH(s,` +
    `"A","PG-"&g,` +
    `"B",IF(p="","","PH-"&g&"-"&p),` +
    `"C",IF(p="","",LET(u,UNIQUE(ARRAYFORMULA(g&"-"&TRANSPOSE(SPLIT(p,".")))),"MP-"&TEXTJOIN(".",TRUE,SORT(u,ARRAYFORMULA(MATCH(u,${pairs},0)),TRUE)))),` +
    `"D",IF(p="","",LET(u,UNIQUE(TRANSPOSE(SPLIT(g&"."&p,"."))),"CL-"&TEXTJOIN(".",TRUE,SORT(u,ARRAYFORMULA(MATCH(u,${groups},0)),TRUE)))),` +
    `"E","BRAND-"&g&"-BRANDING",` +
    `"F",g,""),"")))`;
  f.H_BASE = `=IF(OR(${c('H_IDENT')}="",COUNTA(${c('AGENCY')},${c('MONTH')},${c('CHANNEL')},${c('OBJECTIVE')},${c('AUDIENCE')})<5),"",` +
    `IFERROR(${c('H_IDENT')}&"__"&${c('OBJECTIVE')}&"__"&XLOOKUP(${c('CHANNEL')},${chanL},${chanT})&"__"&${c('AUDIENCE')}&"__"&${c('MONTH')}&"__"&${c('AGENCY')},""))`;
  f.H_FBASE = `=IF(${c('NAME')}="","",LEFT(${c('NAME')},LEN(${c('NAME')})-9))`;
  f.H_FSEQ = `=IF(${c('NAME')}="","",VALUE(MID(${c('NAME')},LEN(${c('NAME')})-6,3)))`;
  f.H_SEQ = `=IF(${c('H_BASE')}="","",IF(${c('NAME')}<>"",${c('H_FSEQ')},MAXIFS(${colAbs('H_FSEQ')},${colAbs('H_FBASE')},${c('H_BASE')})` +
    `+COUNTIFS(${colRun('H_BASE')},${c('H_BASE')},${colRun('NAME')},"",${colRun('CANCEL')},FALSE)))`;
  f.H_PLATFORM = `=IFERROR(IF(${c('NAME')}<>"",INDEX(SPLIT(${c('NAME')},"__",FALSE,TRUE),1,3),REGEXEXTRACT(XLOOKUP(${c('CHANNEL')},${chanL},${chanT},""),"^[A-Z]+")),"")`;
  f.PREVIEW = `=IF(${c('NAME')}<>"",${c('NAME')},IF(${c('H_BASE')}="","",${c('H_BASE')}&"__"&TEXT(${c('H_SEQ')},"000")&"__V1"))`;
  const numericIdPlatform = `OR(${NUMERIC_ID_PLATFORMS.map(x => `${c('H_PLATFORM')}="${x}"`).join(',')})`;
  const required = `COUNTA(${c('AGENCY')}:${c('GROUP')})+COUNTA(${c('CHANNEL')}:${c('AUDIENCE')})`;
  const nTok = x => `COUNTA(SPLIT(${x},"."))`;
  f.CHECK = `=IF(COUNTA(${c('AGENCY')}:${c('NOTE')})=0,"",LET(s,LEFT(${c('SCOPE')},1),g,${g},p,${pv},IFS(` +
    `${c('CANCEL')}=TRUE,"✖ ยกเลิกแล้ว (ไม่ใช้งาน)",` +
    `${required}<7,"… กรอกช่อง * ให้ครบ (ขาด "&(7-(${required}))&" ช่อง)",` +
    `ISNA(MATCH(${c('AGENCY')},${CFG.LISTS}!$B$2:$B$20,0)),"❌ Agency: เลือกจากรายการ",` +
    `NOT(REGEXMATCH(${c('MONTH')}&"","^20[0-9]{2}(0[1-9]|1[0-2])$")),"❌ เดือนต้องเป็น YYYYMM เช่น 202610",` +
    `ISNA(MATCH(${c('SCOPE')},${scopes},0)),"❌ ขอบเขต: เลือกจากรายการ",` +
    `AND(OR(s="A",s="B",s="C",s="D"),ISNA(MATCH(g,${groups},0))),"❌ กลุ่มโครงการ: เลือกจากรายการ (ขอบเขต "&s&")",` +
    `AND(s="E",ISNA(MATCH(g,${brands},0))),"❌ แบรนด์: เลือกจากรายการ",` +
    `AND(s="F",ISNA(MATCH(g,${corp},0))),"❌ องค์กร/BU: เลือกจากรายการ",` +
    `AND(OR(s="A",s="E",s="F"),${c('PHASE')}<>""),"❌ ช่องเฟส: ต้องเว้นว่างสำหรับขอบเขต "&s,` +
    `AND(OR(s="B",s="C",s="D"),${c('PHASE')}=""),"… เลือกเฟส/กลุ่มเพิ่มเติมในช่องเฟส (ขอบเขต "&s&")",` +
    `AND(s="B",ISNA(MATCH(g&"-"&p,${pairs},0))),"❌ เฟสนี้ไม่อยู่ในกลุ่มที่เลือก",` +
    `AND(s="C",IFERROR(COUNTUNIQUE(SPLIT(p,"."))<2,TRUE)),"❌ หลายเฟส: เลือกอย่างน้อย 2 เฟสที่ต่างกัน",` +
    `AND(s="C",IFERROR(SUMPRODUCT(--ISNUMBER(MATCH(g&"-"&SPLIT(p,"."),${pairs},0)))<${nTok('p')},TRUE)),"❌ หลายเฟส: มีรหัสเฟสที่ไม่อยู่ในกลุ่มนี้",` +
    `AND(s="D",IFERROR(SUMPRODUCT(--ISNUMBER(MATCH(SPLIT(p,"."),${groups},0)))<${nTok('p')},TRUE)),"❌ หลายกลุ่ม: มีรหัสกลุ่มที่ไม่อยู่ในรายการ",` +
    `AND(s="D",IFERROR(COUNTUNIQUE(SPLIT(g&"."&p,"."))<2,TRUE)),"❌ หลายกลุ่ม: ต้องมีอย่างน้อย 2 กลุ่มที่ต่างกัน",` +
    `${c('H_IDENT')}="","❌ สร้างรหัสขอบเขตไม่ได้ – ตรวจช่องขอบเขต/กลุ่ม/เฟส",` +
    `ISNA(MATCH(${c('CHANNEL')},${chanL},0)),"❌ ช่องทาง: เลือกจากรายการ",` +
    `ISNA(MATCH(${c('OBJECTIVE')},${NO}!$J$6:$J$50,0)),"❌ วัตถุประสงค์: เลือกจากรายการ",` +
    `ISNA(MATCH(${c('AUDIENCE')},${NO}!$L$6:$L$50,0)),"❌ กลุ่มผู้ชม: เลือกจากรายการ",` +
    `AND(LEFT(${c('AUDIENCE')},2)="KW",${c('CHANNEL')}<>"GOOGLE / SEM",${c('CHANNEL')}<>"GOOGLE / SEMMAXCLICK"),"❌ KW… ใช้กับ GOOGLE / SEM หรือ SEMMAXCLICK เท่านั้น",` +
    `${c('DEST')}="","… เลือก Lead Destination",` +
    `ISNA(MATCH(${c('DEST')},${CFG.LISTS}!$D$2:$D$10,0)),"❌ Lead Destination: เลือกจากรายการ",` +
    `AND(${c('NAME')}<>"",${c('H_FBASE')}<>${c('H_BASE')}),"⚠ ข้อมูลถูกแก้หลังอนุมัติ – แจ้ง SENA Idea",` +
    `AND(${c('NAME')}="",N(${c('H_SEQ')})>999),"❌ ลำดับเกิน 999 – แจ้งผู้ดูแล",` +
    `LEN(${c('PREVIEW')})>150,"❌ ชื่อยาวเกิน 150 ตัวอักษร – ลดจำนวนเฟส/กลุ่ม หรือแยกแคมเปญ",` +
    `NOT(REGEXMATCH(${c('PREVIEW')}&"","^[A-Z0-9._-]+$")),"❌ ชื่อมีอักขระต้องห้าม – แจ้งผู้ดูแล",` +
    `AND(${c('NAME')}="",COUNTIF(${colAbs('NAME')},${c('PREVIEW')})>0),"❌ ชื่อซ้ำกับที่อนุมัติแล้ว – แจ้งผู้ดูแล",` +
    `AND(${c('ACCOUNT_ID')}<>"",${numericIdPlatform},NOT(REGEXMATCH(${c('ACCOUNT_ID')}&"","^[0-9]{5,20}$"))),"❌ Ad Account ID ต้องเป็นตัวเลขล้วน (Meta ไม่มี act_, Google ไม่มีขีด)",` +
    `AND(${c('CAMPAIGN_ID')}<>"",${c('NAME')}=""),"❌ ยังไม่อนุมัติ – ห้ามยิงแอด",` +
    `AND(${c('CAMPAIGN_ID')}<>"",${numericIdPlatform},NOT(REGEXMATCH(${c('CAMPAIGN_ID')}&"","^[0-9]{6,20}$"))),"❌ Campaign ID ต้องเป็นตัวเลขล้วน",` +
    `AND(${c('CAMPAIGN_ID')}<>"",SUMPRODUCT(--(${colAbs('CAMPAIGN_ID')}&""=${c('CAMPAIGN_ID')}&""))>1),"❌ Campaign ID ซ้ำกับแถวอื่น",` +
    `TRUE,"✅ OK")))`;
  // Template comes from Naming_Options!I for the row's channel; drop the account
  // parameter until the buyer returns the Ad Account ID.
  const tpl = `XLOOKUP(${c('CHANNEL')},${chanL},${chanU},"")`;
  f.UTM = `=IF(${c('NAME')}="","",IF(${tpl}="","❌ ยังไม่มี UTM template ของช่องทางนี้ – แจ้งผู้ดูแล",` +
    `SUBSTITUTE(IF(${c('ACCOUNT_ID')}="",REGEXREPLACE(${tpl},"&?sena_account_id=\\{ACCOUNT\\}",""),SUBSTITUTE(${tpl},"{ACCOUNT}",${c('ACCOUNT_ID')})),"{NAME}",${c('NAME')})))`;
  f.TEST_URL = `=IF(OR(${c('URL')}="",${c('UTM')}="",LEFT(${c('UTM')},1)="❌"),"",${c('URL')}&IF(REGEXMATCH(${c('URL')},"\\?"),"&","?")&${c('UTM')})`;
  // Plain-text statuses: colour-emoji circles render as empty boxes in some fonts.
  f.STATUS = `=IF(COUNTA(${c('AGENCY')}:${c('NOTE')})=0,"",IFS(` +
    `${c('CANCEL')}=TRUE,"CANCELLED",` +
    `${c('CAMPAIGN_ID')}<>"","LIVE",` +
    `AND(${c('NAME')}<>"",N(${c('APPROVED_AT')})>0,NOW()-N(${c('APPROVED_AT')})>${CFG.STALE_DAYS}),"OVERDUE – อนุมัติเกิน ${CFG.STALE_DAYS} วัน ยังไม่ส่ง Campaign ID",` +
    `${c('NAME')}<>"","APPROVED – พร้อมยิง",` +
    `${c('CHECK')}="✅ OK","WAITING – รอ SENA Idea อนุมัติ",` +
    `TRUE,"DRAFT"))`;

  Object.keys(f).forEach(key => {
    const cell = sh.getRange(r, C[key]);
    cell.setFormula(f[key]);
    cell.copyTo(sh.getRange(r + 1, C[key], n - 1, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  });

  // --- Data validation ------------------------------------------------------
  const ss = sh.getParent();
  const opt = ss.getSheetByName(NO);
  const lists = ss.getSheetByName(CFG.LISTS);
  const scope = ss.getSheetByName(CFG.SCOPE);
  const listDv = (rng, help) => SpreadsheetApp.newDataValidation()
    .requireValueInRange(rng, true).setAllowInvalid(false).setHelpText(help).build();
  const needScope = (key, help) => SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(`=LEN($${$('SCOPE')}${r})>0`).setAllowInvalid(false).setHelpText(help).build();
  body('AGENCY').setDataValidation(listDv(lists.getRange('B2:B20'), 'เลือก Agency'));
  body('MONTH').setDataValidation(listDv(lists.getRange('A2:A200'), 'เลือกเดือนเริ่มยิง YYYYMM'));
  body('SCOPE').setDataValidation(listDv(scope.getRange(2, 1, SCOPES.length, 1), 'เลือกขอบเขตของแคมเปญ (A–F)'));
  // GROUP/PHASE get row-specific dropdowns from onBuilderEdit once the scope is chosen.
  body('GROUP').setDataValidation(needScope('GROUP', 'เลือกขอบเขต (คอลัมน์ ' + $('SCOPE') + ') ก่อน'));
  body('PHASE').setDataValidation(needScope('PHASE', 'เลือกขอบเขต (คอลัมน์ ' + $('SCOPE') + ') ก่อน'));
  body('CHANNEL').setDataValidation(listDv(opt.getRange('G6:G50'), 'เลือกช่องทาง / รูปแบบ'));
  body('OBJECTIVE').setDataValidation(listDv(opt.getRange('J6:J50'), 'เลือกวัตถุประสงค์'));
  body('AUDIENCE').setDataValidation(listDv(opt.getRange('L6:L50'), 'เลือกกลุ่มผู้ชม (KW… ใช้กับ Google Search เท่านั้น)'));
  body('DEST').setDataValidation(listDv(lists.getRange('D2:D10'), 'ช่องทางรับ Lead (ค่าเริ่มต้น WEBSITE_FORM)'));
  body('URL').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(`=OR(${c('URL')}="",REGEXMATCH(${c('URL')},"^https?://"))`)
    .setAllowInvalid(false).setHelpText('URL ต้องขึ้นต้นด้วย https://').build());
  body('ACCOUNT_ID').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(`=OR(${c('ACCOUNT_ID')}="",REGEXMATCH(${c('ACCOUNT_ID')}&"","^[A-Za-z0-9_-]{5,64}$"))`)
    .setAllowInvalid(false).setHelpText('Meta/Google/TikTok: ตัวเลขล้วน (Meta ไม่ต้องมี act_, Google ไม่ต้องมีขีด) • ChatGPT: คัดลอก ID จาก Ads Manager ตรงตัว').build());
  body('CAMPAIGN_ID').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(`=OR(${c('CAMPAIGN_ID')}="",REGEXMATCH(${c('CAMPAIGN_ID')}&"","^[A-Za-z0-9_-]{5,64}$"))`)
    .setAllowInvalid(false).setHelpText('Campaign ID จากแพลตฟอร์ม (Meta/Google/TikTok เป็นตัวเลขล้วน)').build());
  body('LAUNCH_DATE').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false).setHelpText('วันที่ เช่น 2026-10-01').build());
  body('APPROVE').insertCheckboxes();
  body('CANCEL').insertCheckboxes();

  // --- Conditional formatting ----------------------------------------------
  const rule = (a1, formula, bg, fc, strike) => {
    const b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula)
      .setRanges([sh.getRange(a1)]);
    if (bg) b.setBackground(bg);
    if (fc) b.setFontColor(fc);
    if (strike) b.setStrikethrough(true);
    return b.build();
  };
  const rows = k => $(k) + r + ':' + $(k) + L;
  const chk = '$' + c('CHECK'), st = '$' + c('STATUS');
  sh.setConditionalFormatRules([
    rule(`${$('AGENCY')}${r}:${$('STATUS')}${L}`, `=$${c('CANCEL')}=TRUE`, '#E8EAED', '#80868B', true),
    rule(rows('CHECK'), `=LEFT(${chk},1)="❌"`, '#FCE8E6', '#B3261E'),
    rule(rows('CHECK'), `=LEFT(${chk},1)="⚠"`, '#FEEFC3', '#8A4B00'),
    rule(rows('CHECK'), `=${chk}="✅ OK"`, null, '#137333'),
    rule(rows('STATUS'), `=REGEXMATCH(${st},"^OVERDUE")`, '#FCE8E6', '#B3261E'),
    rule(rows('STATUS'), `=${st}="LIVE"`, '#E6F4EA', '#137333'),
    rule(rows('STATUS'), `=REGEXMATCH(${st},"^APPROVED")`, '#F3E8FD', '#6A1B9A'),
    rule(rows('STATUS'), `=REGEXMATCH(${st},"^WAITING")`, '#FEF7E0', '#8A6D00'),
    rule(rows('PREVIEW'), `=$${c('NAME')}<>""`, null, '#BDC1C6'),
  ]);

  sh.setFrozenRows(5);
  sh.hideColumns(C.H_IDENT, LAST_COL - C.H_IDENT + 1);
  sh.setTabColor('#F9AB00');
}

// ---------------------------------------------------------------------------
// Example rows (management walkthrough). Left unapproved so no sequence is issued.
// ---------------------------------------------------------------------------

function loadExampleRows() {
  loadExampleRows_(SpreadsheetApp.getActive());
}

function loadExampleRows_(ss) {
  const sh = ss.getSheetByName(CFG.BUILDER);
  const first = CFG.FIRST, n = 4;
  if (sh.getRange(first, C.AGENCY, n, C.NOTE - C.AGENCY + 1).getValues().some(r => r.some(v => v !== ''))) {
    throw new Error('แถว ' + first + '–' + (first + n - 1) + ' มีข้อมูลแล้ว — ใส่ตัวอย่างไม่ได้');
  }
  const data = scopeData_(ss);
  const L = ss.getSheetByName(CFG.SCOPE).getDataRange().getValues();
  const label = (idCol, labCol, id) => {
    const r = L.find(x => x[idCol] === id);
    if (!r) throw new Error('ไม่พบ ' + id + ' ใน Master — เลือกตัวอย่างใหม่');
    return r[labCol];
  };
  const urls = {};
  try {
    const prj = SpreadsheetApp.openById(CFG.MASTER_SOURCE_ID).getSheetByName('Project').getDataRange().getDisplayValues();
    const gi = prj[0].indexOf('Project Group ID'), ui = prj[0].indexOf('Website URL');
    prj.slice(1).forEach(r => { if (r[gi] && r[ui] && !urls[r[gi]]) urls[r[gi]] = r[ui]; });
  } catch (err) { /* URLs are optional */ }
  const flex = joinChoices_(data.membersOf('C-FLEX-STCRN').map(m => ({ code: m.phase, name: m.name })));
  const examples = [
    ['COMBAY', 0, label(2, 1, 'C-COZI-BTSSM'), '', 'META / SOCIAL', 'LEADS', 'PROSPECTING', 'WEBSITE_FORM', urls['C-COZI-BTSSM'] || ''],
    ['BRANDSTROM', 1, label(2, 1, 'C-FLEX-STCRN'), label(3, 6, 'C-FLEX-STCRN-HY2DE'), 'GOOGLE / SEM', 'LEADS', 'KWLOCATION', 'WEBSITE_FORM', urls['C-FLEX-STCRN'] || ''],
    ['BRANDSTROM', 2, label(2, 1, 'C-FLEX-STCRN'), flex, 'META / SOCIAL', 'LEADS', 'MIXED', 'PLATFORM_LEAD_FORM', ''],
    ['KIN', 3, label(2, 1, 'C-COZI-BTSSM'), label(2, 1, 'C-COZI-RITKB'), 'TIKTOK / VIDEO', 'AWARENESS', 'BROAD', 'LINE_OA', ''],
  ];
  const fire = (row, col) => onBuilderEdit({ range: sh.getRange(row, col), source: ss, oldValue: '', user: { getEmail: () => 'ตัวอย่าง' } });
  examples.forEach((x, i) => {
    const row = first + i;
    sh.getRange(row, C.AGENCY).setValue(x[0]);
    sh.getRange(row, C.MONTH).setValue('202610');
    sh.getRange(row, C.SCOPE).setValue(SCOPES[x[1]]);
    SpreadsheetApp.flush(); fire(row, C.SCOPE);
    sh.getRange(row, C.GROUP).setValue(x[2]);
    SpreadsheetApp.flush(); fire(row, C.GROUP);
    if (x[3]) sh.getRange(row, C.PHASE).setValue(x[3]);
    sh.getRange(row, C.CHANNEL, 1, 4).setValues([[x[4], x[5], x[6], x[7]]]);
    if (x[8]) sh.getRange(row, C.URL).setValue(x[8]);
    sh.getRange(row, C.NOTE).setValue(CFG.EXAMPLE_NOTE);
  });
  SpreadsheetApp.flush();
  ss.toast('ใส่ตัวอย่าง 4 แถวแล้ว (ยังไม่อนุมัติ) — ลบด้วย clearExampleRows ก่อนใช้งานจริง', 'SENA', 8);
}

function clearExampleRows() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(CFG.BUILDER);
  const n = CFG.LAST - CFG.FIRST + 1;
  const vals = sh.getRange(CFG.FIRST, 1, n, C.STATUS).getValues();
  const data = scopeData_(ss);
  let cleared = 0, kept = 0;
  vals.forEach((r, i) => {
    if (r[C.NOTE - 1] !== CFG.EXAMPLE_NOTE) return;
    if (r[C.NAME - 1] !== '') { kept++; return; }
    const row = CFG.FIRST + i;
    sh.getRange(row, C.AGENCY, 1, C.NOTE - C.AGENCY + 1).clearContent();
    sh.getRange(row, C.REQ_ID).clearContent();
    sh.getRange(row, C.REQ_BY, 1, 2).clearContent();
    sh.getRange(row, C.ACCOUNT_ID, 1, 3).clearContent();
    sh.getRange(row, C.APPROVE).uncheck();
    sh.getRange(row, C.CANCEL).uncheck();
    applyRowValidation_(sh, row, data);
    cleared++;
  });
  SpreadsheetApp.flush();
  const anyLeft = sh.getRange(CFG.FIRST, C.REQ_ID, n, 1).getValues().some(r => r[0] !== '');
  if (!anyLeft) PropertiesService.getScriptProperties().deleteProperty('REQ_SEQ');
  ss.toast('ลบตัวอย่าง ' + cleared + ' แถว' + (kept ? ' • ' + kept + ' แถวถูกอนุมัติแล้ว ต้องติ๊กยกเลิกแทน' : ''), 'SENA', 8);
}

// ---------------------------------------------------------------------------
// Multi-select picker (scope C phases / scope D groups) — SENA menu > sidebar
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SENA')
    .addItem('เลือกหลายเฟส / หลายกลุ่ม (ช่องเฟส)', 'openPicker')
    .addToUi();
}

// Options for the active Name_Builder row, in canonical (Scope_Lists) order.
function pickerContext_(row) {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(CFG.BUILDER);
  const s = String(sh.getRange(row, C.SCOPE).getValue()).charAt(0);
  const g = String(sh.getRange(row, C.GROUP).getValue()).split(' ')[0];
  const data = scopeData_(ss);
  if (sh.getRange(row, C.NAME).getValue() !== '') throw new Error('แถว ' + row + ' อนุมัติแล้ว แก้ไม่ได้');
  if (s !== 'C' && s !== 'D') throw new Error('ใช้ได้กับขอบเขต C (หลายเฟส) หรือ D (หลายกลุ่ม) เท่านั้น — แถว ' + row + ' เป็นขอบเขต ' + (s || '(ว่าง)'));
  if (data.groupIds.indexOf(g) < 0) throw new Error('เลือกกลุ่มโครงการในช่อง ' + col_('GROUP') + ' ก่อน');
  const options = s === 'C'
    ? data.membersOf(g).map(m => ({ code: m.phase, name: m.name }))
    : data.groups.filter(x => x.id !== g).map(x => ({ code: x.id, name: x.name }));
  const current = String(sh.getRange(row, C.PHASE).getValue()).split(' + ')
    .map(x => x.trim().split(' ')[0]).join('.').split('.').filter(String);
  const primary = data.groups.find(x => x.id === g);
  return { row: row, scope: s, group: g, groupName: primary ? primary.name : '', options: options, current: current, min: s === 'C' ? 2 : 1 };
}

function openPicker() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (sh.getName() !== CFG.BUILDER || sh.getActiveRange().getRow() < CFG.FIRST) {
    ui.alert('คลิกเลือกแถวคำขอในแท็บ ' + CFG.BUILDER + ' ก่อน แล้วเปิดเมนูนี้อีกครั้ง');
    return;
  }
  let ctx;
  try { ctx = pickerContext_(sh.getActiveRange().getRow()); } catch (err) { ui.alert(err.message); return; }
  if (ctx.scope === 'C' && ctx.options.length < 2) { ui.alert('กลุ่มนี้มีเฟสเดียว — ใช้ขอบเขต A หรือ B'); return; }
  const html = HtmlService.createHtmlOutput(PICKER_HTML.replace('__CTX__', JSON.stringify(ctx).replace(/</g, '\\u003c')))
    .setTitle(ctx.scope === 'C' ? 'เลือกหลายเฟส' : 'เลือกหลายกลุ่มโครงการ');
  ui.showSidebar(html);
}

// Called from the sidebar: re-validates against the live row and writes column F.
function pickerSave(row, codes) {
  const ctx = pickerContext_(row);
  const chosen = ctx.options.filter(o => codes.indexOf(o.code) >= 0);
  if (chosen.length < ctx.min) throw new Error(ctx.scope === 'C' ? 'เลือกอย่างน้อย 2 เฟส' : 'เลือกอย่างน้อย 1 กลุ่ม');
  const value = ctx.scope === 'D' && chosen.length === 1
    ? SpreadsheetApp.getActive().getSheetByName(CFG.SCOPE).getRange(2, 2, scopeData_(SpreadsheetApp.getActive()).groupCount, 1)
      .getValues().map(r => r[0]).find(l => String(l).split(' ')[0] === chosen[0].code)
    : joinChoices_(chosen);
  const cell = SpreadsheetApp.getActive().getSheetByName(CFG.BUILDER).getRange(row, C.PHASE);
  cell.setValue(value);
  return 'ใส่ในแถว ' + row + ' แล้ว: ' + chosen.map(o => o.code).join(', ');
}

const PICKER_HTML = `<!DOCTYPE html><html><head><base target="_top"><style>
body{font-family:Arial,sans-serif;font-size:13px;margin:12px;color:#202124}
h3{margin:0 0 4px;font-size:15px}.sub{color:#5f6368;margin-bottom:10px}
input[type=search]{width:100%;box-sizing:border-box;padding:6px;margin-bottom:8px;border:1px solid #dadce0;border-radius:4px}
.list{max-height:60vh;overflow:auto;border:1px solid #dadce0;border-radius:4px}
label{display:flex;gap:8px;padding:6px 8px;border-bottom:1px solid #f1f3f4;cursor:pointer}label:hover{background:#f8f9fa}
.code{font-family:monospace;font-weight:bold;min-width:96px}.name{color:#3c4043}
.bar{display:flex;gap:8px;align-items:center;margin-top:10px}
button{padding:7px 14px;border-radius:4px;border:1px solid #dadce0;background:#fff;cursor:pointer}
button.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}button:disabled{opacity:.5;cursor:default}
#msg{margin-top:8px;color:#137333}#msg.err{color:#b3261e}
</style></head><body>
<h3 id="title"></h3><div class="sub" id="sub"></div>
<input type="search" id="q" placeholder="ค้นหารหัสหรือชื่อ">
<div class="list" id="list"></div>
<div class="bar"><button class="primary" id="ok">ใส่ในแถว</button><button id="cancel">ปิด</button><span id="count"></span></div>
<div id="msg"></div>
<script>
const ctx = __CTX__;
const picked = new Set(ctx.current.filter(c => ctx.options.some(o => o.code === c)));
document.getElementById('title').textContent = ctx.scope === 'C' ? 'เลือกเฟสที่โปรโมท (อย่างน้อย 2)' : 'เลือกกลุ่มโครงการเพิ่มเติม';
document.getElementById('sub').textContent = 'แถว ' + ctx.row + ' • ' + ctx.group + (ctx.groupName ? ' · ' + ctx.groupName : '');
const list = document.getElementById('list');
ctx.options.forEach(o => {
  const l = document.createElement('label'); l.dataset.k = (o.code + ' ' + o.name).toLowerCase();
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = picked.has(o.code);
  cb.onchange = () => { cb.checked ? picked.add(o.code) : picked.delete(o.code); update(); };
  const c = document.createElement('span'); c.className = 'code'; c.textContent = o.code;
  const n = document.createElement('span'); n.className = 'name'; n.textContent = o.name;
  l.append(cb, c, n); list.append(l);
});
document.getElementById('q').oninput = e => { const q = e.target.value.toLowerCase();
  list.querySelectorAll('label').forEach(l => l.style.display = l.dataset.k.includes(q) ? '' : 'none'); };
const ok = document.getElementById('ok'), msg = document.getElementById('msg');
function update() { document.getElementById('count').textContent = 'เลือกแล้ว ' + picked.size; ok.disabled = picked.size < ctx.min; }
ok.onclick = () => { ok.disabled = true; msg.className = ''; msg.textContent = 'กำลังบันทึก…';
  google.script.run.withSuccessHandler(t => { msg.textContent = t; ok.disabled = false; })
    .withFailureHandler(e => { msg.className = 'err'; msg.textContent = e.message; ok.disabled = false; })
    .pickerSave(ctx.row, Array.from(picked)); };
document.getElementById('cancel').onclick = () => google.script.host.close();
update();
</script></body></html>`;

// ---------------------------------------------------------------------------
// How_To_Use guide
// ---------------------------------------------------------------------------

function buildHelp_(ss) {
  let sh = ss.getSheetByName(CFG.HELP);
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet(CFG.HELP, 0);
  sh.setHiddenGridlines(true);

  const S = 'section', T = 'table', P = 'para';
  const rows = [
    ['title', 'วิธีใช้ SENA Campaign Name Builder (ทะเบียนตั้งชื่อแคมเปญ)'],
    [P, 'เป้าหมาย: เงินค่าแอดทุกบาทและ Lead ทุกคน ต้องถูกนับเข้าโครงการที่ถูกต้องบน FHI Dashboard — ระบบนี้ออกชื่อแคมเปญมาตรฐาน V1 ให้ ห้ามตั้งชื่อเอง'],
    [P, 'ใช้แท็บเดียว: Name_Builder  •  1 แถว = 1 แคมเปญ บน 1 แพลตฟอร์ม (Meta 1 แคมเปญ + Google 1 แคมเปญ = 2 แถว)'],
    [''],
    [S, '5 ขั้นตอน (ใครทำอะไร)'],
    [T, 'ขั้นตอน', 'ใครทำ', 'ทำอะไร', 'ผลลัพธ์'],
    [T, '① ขอชื่อ', 'Agency / ทีมการตลาด', 'กรอกช่องสีเหลืองที่มี * : Agency, เดือน, ขอบเขต → กลุ่มโครงการ → เฟส (3 ขั้น ดูหัวข้อด้านล่าง), ช่องทาง, วัตถุประสงค์, กลุ่มผู้ชม, Lead Destination (ระบบใส่ WEBSITE_FORM ให้) + Landing URL + หมายเหตุ/ลิงก์บรีฟ', 'ระบบออก Request ID และแสดงชื่อร่างในคอลัมน์ ' + col_('PREVIEW') + ''],
    [T, '② ตรวจ', 'ระบบ (อัตโนมัติ)', 'ดูคอลัมน์ ' + col_('CHECK') + ' "ผลตรวจ" ต้องเป็น ✅ OK — ถ้าเป็น ❌ ให้แก้ตามข้อความ', 'สถานะ = WAITING'],
    [T, '③ อนุมัติ', 'SENA Idea', 'ตรวจบรีฟ/งบ แล้วติ๊กช่อง "อนุมัติ" (คอลัมน์ ' + col_('APPROVE') + ')', 'ชื่อถูกล็อกถาวรในช่องสีเขียว (คอลัมน์ ' + col_('NAME') + ') + สร้าง UTM ให้ • สถานะ = APPROVED'],
    [T, '④ ยิงแอด', 'Agency / ผู้ยิงแอด', 'คัดลอกชื่อจากคอลัมน์ ' + col_('NAME') + ' ไปวางเป็น Campaign name • คัดลอก UTM (คอลัมน์ ' + col_('UTM') + ') ไปใส่ตามแพลตฟอร์ม (ดูตารางด้านล่าง) • คลิกลิงก์ทดสอบ (' + col_('TEST_URL') + ')', 'แคมเปญในแพลตฟอร์มชื่อตรงกับทะเบียน 100%'],
    [T, '⑤ ส่ง ID กลับ', 'Agency / ผู้ยิงแอด', 'กรอก Ad Account ID + Campaign ID + วันที่เริ่มยิง ภายใน 1 วันทำการหลังสร้างแคมเปญ', 'สถานะ = LIVE • Data Warehouse ผูกยอดเงินกับโครงการอัตโนมัติ'],
    [''],
    [S, 'สีของช่อง'],
    [T, 'สี', 'ความหมาย', '', ''],
    [T, 'เหลือง', 'ผู้ขอ / Agency กรอก', '', ''],
    [T, 'เทา', 'ระบบคำนวณให้ — ห้ามแก้ (ถูกล็อกไว้)', '', ''],
    [T, 'ม่วง', 'SENA Idea อนุมัติเท่านั้น', '', ''],
    [T, 'เขียว', 'ชื่อทางการที่อนุมัติแล้ว — คัดลอกไปใช้จากช่องนี้เท่านั้น', '', ''],
    [T, 'ฟ้า', 'ผู้ยิงแอดกรอกกลับหลังสร้างแคมเปญ', '', ''],
    [''],
    [S, 'เลือกขอบเขตโครงการ 3 ขั้น (คอลัมน์ ' + col_('SCOPE') + ' → ' + col_('GROUP') + ' → ' + col_('PHASE') + ')'],
    [T, 'ขอบเขต (ขั้น ①)', 'ขั้น ② เลือก', 'ขั้น ③ เลือก', 'รหัสในชื่อ • ผลบน Dashboard'],
    [T, 'A — ทั้งกลุ่มโครงการ (กรณีส่วนใหญ่)', 'กลุ่มโครงการ เช่น C-COZI-BTSSM', 'เว้นว่าง', 'PG-C-COZI-BTSSM • งบเข้าโครงการ 100%'],
    [T, 'B — เจาะจงเฟส/ตึกเดียว', 'กลุ่มโครงการ เช่น C-FLEX-STCRN', 'เฟสของกลุ่มนั้น 1 เฟส เช่น HY2DE', 'PH-C-FLEX-STCRN-HY2DE • งบเข้าโครงการ 100% + สถิติระดับเฟส'],
    [T, 'C — หลายเฟสในกลุ่มเดียวกัน', 'กลุ่มโครงการ เช่น C-FLEX-STCRN', 'ชุดเฟส (อย่างน้อย 2) จาก dropdown หรือเมนู SENA ▸ เลือกหลายเฟส (กลุ่มที่มีมากกว่า 4 เฟส)', 'MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC • งบเข้าโครงการ 100%'],
    [T, 'D — รวมหลายกลุ่ม / Expo / โปรรวมทำเล', 'กลุ่มแรก เช่น C-COZI-BTSSM', 'กลุ่มที่ 2 จาก dropdown หรือหลายกลุ่มจากเมนู SENA ▸ เลือกหลายกลุ่ม', 'CL-C-COZI-BTSSM.C-COZI-RITKB • พักเป็น "งบกองกลาง" ยังไม่หารเข้าโครงการ'],
    [T, 'E — ภาพรวมแบรนด์', 'แบรนด์ เช่น COZI, SENA-KITH', 'เว้นว่าง', 'BRAND-COZI-BRANDING • งบแบรนดิ้งภาพรวม'],
    [T, 'F — องค์กร หรือ BU', 'หัวข้อ เช่น CORP-SENA-CSR, BU-SOLAR', 'เว้นว่าง', 'CORP-SENA-CSR / BU-SOLAR • งบองค์กร / งบ BU'],
    [P, 'ช่องที่ ② และ ③ จะแสดงเฉพาะตัวเลือกที่ตรงกับขั้นก่อนหน้า — เปลี่ยนขอบเขตหรือกลุ่ม ระบบจะล้างช่องถัดไปให้เลือกใหม่ • ลำดับเฟส/กลุ่มในชื่อระบบเรียงให้เอง • ไม่เจอกลุ่ม เฟส หรือแบรนด์ที่ต้องการ → แจ้งผู้ดูแล (SENA Idea) ห้ามเลือกตัวใกล้เคียงแทน'],
    [P, 'เลือกหลายเฟส (C) หรือหลายกลุ่ม (D): คลิกช่องเฟสของแถวนั้น แล้วไปที่เมนู SENA ▸ เลือกหลายเฟส / หลายกลุ่ม — ติ๊กเลือกจากรายการที่มีชื่อโครงการ แล้วกด ใส่ในแถว (ไม่ต้องพิมพ์รหัสเอง)'],
    [P, 'แบรนด์ที่มีป้าย "(เสนอ รออนุมัติ)" เป็นรหัสที่เสนอจากฐานข้อมูลแบรนด์ REM — ใช้ได้หลังผู้บริหารอนุมัติรายการ'],
    [''],
    [S, 'Lead Destination (คอลัมน์ ' + col_('DEST') + ') — Lead เข้ามาทางไหน'],
    [T, 'ค่า', 'ใช้เมื่อ', 'การติดตาม Lead', ''],
    [T, 'WEBSITE_FORM (ค่าเริ่มต้น)', 'แอดพาไปหน้าเว็บ แล้วกรอกฟอร์มบนเว็บไซต์', 'ใช้ UTM + ลิงก์ทดสอบ (ต้องใส่ Landing Page URL)', ''],
    [T, 'PLATFORM_LEAD_FORM', 'ใช้ Lead Form ใน Meta / Google / TikTok', 'Lead มาจากข้อมูลของแพลตฟอร์ม — ต้องส่ง Campaign ID กลับ', ''],
    [T, 'LINE_OA', 'แอดพาไปทัก/เพิ่มเพื่อน LINE OA', 'ติดตามผ่าน LINE OA tag ของโครงการ', ''],
    [T, 'MESSENGER', 'แอดพาไปคุยใน Messenger', 'ติดตามจากแพลตฟอร์ม Meta', ''],
    [T, 'CALL_ONLY', 'แอดให้โทรหาโครงการโดยตรง', 'ติดตามจากสถิติการโทรของแพลตฟอร์ม', ''],
    [''],
    [S, 'ใส่ UTM ที่ไหนในแต่ละแพลตฟอร์ม'],
    [T, 'แพลตฟอร์ม', 'ใส่ชื่อแคมเปญ', 'ใส่ UTM (คอลัมน์ ' + col_('UTM') + ')', 'หมายเหตุ'],
    [T, 'Meta (Facebook/IG)', 'Campaign name', 'ระดับ Ad > Tracking > URL parameters (ทุก Ad)', '{{campaign.id}} Meta แทนค่าเอง ห้ามแก้'],
    [T, 'Google Ads', 'Campaign name', 'Campaign settings > Campaign URL options > Final URL suffix', '{campaignid} Google แทนค่าเอง • เปิด Auto-tagging ไว้ตามปกติ'],
    [T, 'TikTok', 'Campaign name', 'ต่อท้าย Destination URL ของทุก Ad (หรือช่อง URL parameters)', '__CAMPAIGN_ID__ TikTok แทนค่าเอง'],
    [T, 'ChatGPT Ads', 'Campaign name', 'ระดับ Campaign: Landing page query parameters (ถ้าใส่ที่ Ad/Ad group จะทับของ Campaign — ใส่ที่เดียว)', '{campaign_id} / {ad_account_id} ChatGPT แทนค่าเอง • oppref ระบบเติมเอง ห้ามใส่ • ยังไม่มีการดึงข้อมูลเข้า DW'],
    [P, 'ใช้ Lead Form ในแพลตฟอร์ม (ไม่มีเว็บปลายทาง) ก็ยังต้องใช้ชื่อจากทะเบียนและส่ง Campaign ID กลับ — UTM ใช้เฉพาะแอดที่ลิงก์ออกไปเว็บไซต์'],
    [''],
    [S, 'กฎเหล็ก 8 ข้อ'],
    [T, '1', 'ห้ามพิมพ์หรือดัดแปลงชื่อเอง — คัดลอกจากคอลัมน์ ' + col_('NAME') + ' เท่านั้น (รวมห้ามเติมคำ เช่น "_copy", "- New")', '', ''],
    [T, '2', 'ห้ามเปลี่ยนชื่อแคมเปญหลังเริ่มยิง — Data Warehouse ใช้ชื่อล่าสุดจัดประวัติย้อนหลังทั้งหมด แก้ชื่อ = ตัวเลขเดือนก่อน ๆ เพี้ยน', '', ''],
    [T, '3', 'ห้ามยิงก่อนได้รับอนุมัติ (ช่อง ' + col_('NAME') + ' ยังว่าง = ยังใช้ไม่ได้ แม้คอลัมน์ ' + col_('PREVIEW') + ' จะมีชื่อร่าง)', '', ''],
    [T, '4', 'แคมเปญ always-on ข้ามเดือนใช้ชื่อเดิมต่อไป ไม่ต้องขอชื่อใหม่ทุกเดือน — ขอชื่อใหม่เมื่อสร้างแคมเปญใหม่ในแพลตฟอร์มเท่านั้น', '', ''],
    [T, '5', 'รีลอนช์: เปิดแคมเปญเดิม (Campaign ID เดิม) อีกครั้ง = ใช้ชื่อเดิม ไม่ต้องขอใหม่ • Duplicate / สร้างแคมเปญใหม่ (ได้ Campaign ID ใหม่) = ต้องขอชื่อใหม่ ห้ามใช้ชื่อซ้ำ — ใส่ "Relaunch of NB-xxxxx" ในหมายเหตุ', '', ''],
    [T, '6', 'เปลี่ยนโครงการเป้าหมายกลางทาง → หยุดแคมเปญเดิม แล้วขอชื่อใหม่ ห้ามแก้ชื่อเดิม', '', ''],
    [T, '7', 'ห้ามลบแถว — ถ้ายกเลิกให้ติ๊กช่อง "ยกเลิก" (คอลัมน์ ' + col_('CANCEL') + ')', '', ''],
    [T, '8', 'ส่ง Campaign ID กลับภายใน 1 วันทำการ — ถ้าเกิน 3 วันสถานะจะขึ้น OVERDUE (สีแดง) และงบจะไม่เข้า Dashboard', '', ''],
    [''],
    [S, 'ความหมายของสถานะ (คอลัมน์ ' + col_('STATUS') + ')'],
    [T, 'สถานะ', 'ความหมาย', 'ต้องทำอะไรต่อ', ''],
    [T, 'DRAFT', 'ยังกรอกไม่ครบ หรือมีข้อผิดพลาด', 'ดูคอลัมน์ ' + col_('CHECK') + ' แล้วแก้', ''],
    [T, 'WAITING – รอ SENA Idea อนุมัติ', 'ข้อมูลครบและถูกต้อง', 'SENA Idea ตรวจและติ๊กอนุมัติ', ''],
    [T, 'APPROVED – พร้อมยิง', 'ชื่อถูกล็อกแล้ว', 'Agency สร้างแคมเปญแล้วส่ง Campaign ID กลับ', ''],
    [T, 'OVERDUE – อนุมัติเกิน 3 วัน…', 'ยังไม่ได้รับ Campaign ID', 'Agency ส่ง ID ทันที หรือติ๊กยกเลิกถ้าไม่ได้ยิง', ''],
    [T, 'LIVE', 'มี Campaign ID แล้ว', 'ไม่ต้องทำอะไร DW ดึงยอดอัตโนมัติ', ''],
    [T, 'CANCELLED', 'ยกเลิก', 'ชื่อนี้จะไม่ถูกนำกลับมาใช้ซ้ำ', ''],
    [''],
    [S, 'ตัวอย่างการกรอก'],
    [T, 'กรอก (Agency • เดือน • ขอบเขต • กลุ่ม • เฟส • ช่องทาง • วัตถุประสงค์ • กลุ่มผู้ชม)', 'ชื่อที่ได้', '', ''],
    [T, 'COMBAY • 202610 • A • C-COZI-BTSSM • (ว่าง) • META / SOCIAL • LEADS • PROSPECTING', 'PG-C-COZI-BTSSM__LEADS__META__SOCIAL__PROSPECTING__202610__COMBAY__001__V1', '', ''],
    [T, 'BRANDSTROM • 202610 • B • C-FLEX-STCRN • HY2DE • GOOGLE / SEM • LEADS • KWLOCATION', 'PH-C-FLEX-STCRN-HY2DE__LEADS__GOOGLE__SEM__KWLOCATION__202610__BRANDSTROM__001__V1', '', ''],
    [T, 'BRANDSTROM • 202610 • C • C-FLEX-STCRN • HY2DE.HYABC • META / SOCIAL • LEADS • MIXED', 'MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC__LEADS__META__SOCIAL__MIXED__202610__BRANDSTROM__001__V1', '', ''],
    [T, 'KIN • 202610 • D • C-COZI-BTSSM • C-COZI-RITKB • META / SOCIAL • LEADS • PROSPECTING', 'CL-C-COZI-BTSSM.C-COZI-RITKB__LEADS__META__SOCIAL__PROSPECTING__202610__KIN__001__V1', '', ''],
    [T, 'MEDIAOPTION • 202610 • E • COZI • (ว่าง) • META / SOCIAL • AWARENESS • BROAD', 'BRAND-COZI-BRANDING__AWARENESS__META__SOCIAL__BROAD__202610__MEDIAOPTION__001__V1', '', ''],
    [P, 'โครงสร้างชื่อ: รหัสโครงการ__วัตถุประสงค์__แพลตฟอร์ม__รูปแบบ__กลุ่มผู้ชม__เดือน__Agency__ลำดับ__V1 (ลำดับ 001–999 ระบบนับให้เอง)'],
    [''],
    [S, 'คำถามที่พบบ่อย'],
    [T, 'แก้ข้อมูลหลังอนุมัติได้ไหม?', 'ไม่ได้ ระบบจะคืนค่าเดิม ถ้าจำเป็นให้ติ๊กยกเลิกแถวเดิมแล้วขอแถวใหม่ (ถ้ายังไม่ได้ยิง) หรือแจ้ง SENA Idea', '', ''],
    [T, 'ชื่อร่างในคอลัมน์ ' + col_('PREVIEW') + ' เปลี่ยนเลขลำดับเอง?', 'ปกติ — ลำดับจะถูกล็อกตอนอนุมัติ ใช้เฉพาะชื่อในคอลัมน์ ' + col_('NAME') + '', '', ''],
    [T, 'Campaign ID หาได้ที่ไหน?', 'Meta: Ads Manager เปิดคอลัมน์ Campaign ID • Google: Campaigns > คอลัมน์ Campaign ID • TikTok: Campaign list แสดง ID ใต้ชื่อ', '', ''],
    [T, 'ยิงแคมเปญเดียวให้หลายโครงการได้ไหม?', 'ได้ เลือกขอบเขต D แต่งบจะพักเป็นงบกองกลาง ไม่หารเข้าโครงการจนกว่าจะมีเกณฑ์ปันส่วน — ถ้าต้องการให้งบเข้าโครงการ ให้แยกแคมเปญต่อโครงการ', '', ''],
    [T, 'อยากนำแอดเก่ากลับมายิงใหม่?', 'ถ้า Resume แคมเปญเดิมในแพลตฟอร์ม → ใช้ชื่อเดิม แค่แจ้งงบเดือนใหม่กับ SENA Idea • ถ้าสร้างแคมเปญใหม่ (Duplicate / แคมเปญเดิมถูกลบ) → เพิ่มแถวใหม่ เลือกค่าเดิม ใส่เดือนที่ยิงใหม่ ระบบจะออกชื่อใหม่ให้ แล้วคัดลอกชิ้นงานโฆษณาเดิมไปใช้ได้', '', ''],
    [T, 'อนุมัติผิดแถว ถอนได้ไหม?', 'ไม่ได้ ชื่อที่อนุมัติแล้วอาจถูกใช้ในแพลตฟอร์มไปแล้ว — ติ๊ก "ยกเลิก" แถวนั้น แล้วขอแถวใหม่ (เลขลำดับเดิมจะไม่ถูกใช้ซ้ำ)', '', ''],
    [T, 'จะลงแอดแพลตฟอร์มใหม่ (เช่น ChatGPT หรือแพลตฟอร์มอื่นในอนาคต)?', 'แจ้งผู้ดูแล SENA Idea เพิ่มช่องทางในแท็บ Naming_Options (ชื่อที่แสดง / PLATFORM__TACTIC / UTM template) — ไม่ต้องแก้สูตร', '', ''],
    [T, 'ติดต่อใคร?', 'ผู้ดูแลทะเบียน: SENA Idea Marketing', '', ''],
  ];

  let row = 1;
  const width = 4;
  rows.forEach(item => {
    const kind = item[0];
    if (kind === 'title') {
      sh.getRange(row, 1, 1, width).merge().setValue(item[1]).setFontSize(16).setFontWeight('bold')
        .setFontColor(COLORS.header);
      sh.setRowHeight(row, 36);
    } else if (kind === S) {
      sh.getRange(row, 1, 1, width).merge().setValue(item[1]).setFontSize(12).setFontWeight('bold')
        .setBackground(COLORS.header).setFontColor(COLORS.headerText);
    } else if (kind === P) {
      sh.getRange(row, 1, 1, width).merge().setValue(item[1]).setWrap(true);
      sh.setRowHeight(row, 30);
    } else if (kind === T) {
      const vals = item.slice(1);
      const filled = vals.filter(v => v !== '').length;
      const rng = sh.getRange(row, 1, 1, width);
      if (filled <= 2 && vals[2] === '' && vals[3] === '') {
        sh.getRange(row, 1).setValue(vals[0]);
        sh.getRange(row, 2, 1, 3).merge().setValue(vals[1]);
      } else {
        rng.setValues([vals]);
      }
      rng.setWrap(true).setVerticalAlignment('top')
        .setBorder(true, true, true, true, true, true, '#DADCE0', SpreadsheetApp.BorderStyle.SOLID);
      const prev = rows[rows.indexOf(item) - 1];
      if (prev && prev[0] === S) rng.setBackground('#E8F0FE').setFontWeight('bold');
    }
    row++;
  });

  [260, 330, 330, 260].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  const colorRows = { 'เหลือง': COLORS.requester, 'เทา': COLORS.auto, 'ม่วง': COLORS.approver, 'เขียว': COLORS.name, 'ฟ้า': COLORS.buyer };
  const colA = sh.getRange(1, 1, row, 1).getValues();
  colA.forEach((v, i) => { if (colorRows[v[0]]) sh.getRange(i + 1, 1).setBackground(colorRows[v[0]]); });
  if (sh.getMaxColumns() > width) sh.deleteColumns(width + 1, sh.getMaxColumns() - width);
  sh.setTabColor('#24576E');
}

// ---------------------------------------------------------------------------
// Protection & trigger
// ---------------------------------------------------------------------------

// Keep only the running user (cannot be removed) plus approvers on a protection.
function restrictEditors_(p) {
  p.getEditors().forEach(u => { try { p.removeEditor(u); } catch (err) { /* self / owner */ } });
  if (CFG.APPROVERS.length) p.addEditors(CFG.APPROVERS);
}

function protect_(ss, sh) {
  const n = CFG.LAST - CFG.FIRST + 1;
  const p = sh.protect().setDescription('Name_Builder: formula/approval columns');
  p.setUnprotectedRanges([
    sh.getRange(CFG.FIRST, C.AGENCY, n, C.NOTE - C.AGENCY + 1),         // requester inputs
    sh.getRange(CFG.FIRST, C.ACCOUNT_ID, n, C.CANCEL - C.ACCOUNT_ID + 1), // buyer + cancel
  ]);
  restrictEditors_(p);
  if (p.canDomainEdit()) p.setDomainEdit(false);

  [CFG.OPTIONS, CFG.LISTS, CFG.SCOPE].forEach(name => {
    const s = ss.getSheetByName(name);
    if (!s || s.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
    const ps = s.protect().setDescription(name + ': steward only');
    restrictEditors_(ps);
    if (ps.canDomainEdit()) ps.setDomainEdit(false);
  });
}

// One installable onEdit per watched file; this project serves the master and all agency files.
function installEditTrigger_(ss) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onBuilderEdit' && t.getTriggerSourceId() === ss.getId())
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onBuilderEdit').forSpreadsheet(ss).onEdit().create();
}

function installSyncTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAll')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(CFG.SYNC_MINUTES).create();
}

// ---------------------------------------------------------------------------
// Installable onEdit: request stamping, approval lock, post-approval guard
// ---------------------------------------------------------------------------

function onBuilderEdit(e) {
  const rng = e.range;
  const sh = rng.getSheet();
  if (sh.getName() !== CFG.BUILDER) return;
  const r0 = Math.max(rng.getRow(), CFG.FIRST);
  const r1 = Math.min(rng.getLastRow(), CFG.LAST);
  if (r1 < r0) return;
  const c0 = rng.getColumn();
  const c1 = rng.getLastColumn();
  const user = (e.user && e.user.getEmail && e.user.getEmail()) || '';
  const book = e.source || sh.getParent();
  // Script lock: Request IDs are shared by the master and every agency file.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Guard: single-cell edit of a naming input on an approved row -> revert.
    if (rng.getNumRows() === 1 && c0 === c1 && c0 >= C.AGENCY && c0 <= C.AUDIENCE) {
      const approvedName = sh.getRange(r0, C.NAME).getValue();
      if (approvedName !== '') {
        rng.setValue(e.oldValue === undefined ? '' : e.oldValue);
        book.toast('แถวนี้อนุมัติแล้ว แก้ข้อมูลตั้งชื่อไม่ได้ — ติ๊กยกเลิกแล้วขอแถวใหม่ หรือแจ้ง SENA Idea', 'ล็อกแล้ว', 8);
        return;
      }
    }

    // Cascade: scope (D) -> group (E) -> phase (F). A single-cell change clears the
    // dependent cells of an unapproved row; pastes keep values and are validated by CHECK.
    if (c1 >= C.SCOPE && c0 <= C.GROUP) {
      const data = scopeData_(book);
      const single = rng.getNumRows() === 1 && c0 === c1;
      for (let row = r0; row <= r1; row++) {
        if (single && sh.getRange(row, C.NAME).getValue() === '') {
          if (c0 === C.SCOPE) {
            const was = String(e.oldValue || '').charAt(0), now = String(rng.getValue()).charAt(0);
            const family = x => ('ABCD'.indexOf(x) >= 0 && x ? 'G' : x);
            if (family(was) !== family(now)) sh.getRange(row, C.GROUP).clearContent();
            sh.getRange(row, C.PHASE).clearContent();
          } else if (c0 === C.GROUP) {
            sh.getRange(row, C.PHASE).clearContent();
          }
        }
        applyRowValidation_(sh, row, data);
      }
    }

    // Stamp Request ID / requester / time when a row is first filled.
    if (c1 >= C.AGENCY && c0 <= C.NOTE) {
      const block = sh.getRange(r0, 1, r1 - r0 + 1, C.REQ_AT).getValues();
      const props = PropertiesService.getScriptProperties();
      let seq = Number(props.getProperty('REQ_SEQ') || 0);
      let changed = false, destChanged = false;
      block.forEach(row => {
        const hasInput = row.slice(C.AGENCY - 1, C.NOTE).some(v => v !== '');
        if (hasInput && row[C.DEST - 1] === '') {
          row[C.DEST - 1] = CFG.DEFAULT_DEST;
          destChanged = true;
        }
        if (hasInput && row[C.REQ_ID - 1] === '') {
          seq++;
          row[C.REQ_ID - 1] = 'NB-' + String(seq).padStart(5, '0');
          row[C.REQ_BY - 1] = user;
          row[C.REQ_AT - 1] = new Date();
          changed = true;
        }
      });
      if (changed) {
        props.setProperty('REQ_SEQ', String(seq));
        sh.getRange(r0, C.REQ_ID, block.length, 1).setValues(block.map(r => [r[C.REQ_ID - 1]]));
        sh.getRange(r0, C.REQ_BY, block.length, 2).setValues(block.map(r => [r[C.REQ_BY - 1], r[C.REQ_AT - 1]]));
      }
      if (destChanged) sh.getRange(r0, C.DEST, block.length, 1).setValues(block.map(r => [r[C.DEST - 1]]));
    }

    // Approval checkbox: freeze or release the name.
    if (c0 <= C.APPROVE && c1 >= C.APPROVE) {
      SpreadsheetApp.flush();
      const width = C.CAMPAIGN_ID - C.CHECK + 1; // L..T
      const vals = sh.getRange(r0, C.CHECK, r1 - r0 + 1, width).getValues();
      const msgs = [];
      vals.forEach((v, i) => {
        const row = r0 + i;
        const check = v[0], preview = v[C.PREVIEW - C.CHECK], approve = v[C.APPROVE - C.CHECK];
        const name = v[C.NAME - C.CHECK], campaignId = v[C.CAMPAIGN_ID - C.CHECK];
        if (approve === true && name === '') {
          if (check === '✅ OK' && preview !== '') {
            sh.getRange(row, C.NAME).setValue(preview);
            sh.getRange(row, C.APPROVED_AT).setValue(new Date()).setNote('อนุมัติโดย: ' + (user || 'unknown'));
          } else {
            sh.getRange(row, C.APPROVE).setValue(false);
            msgs.push('แถว ' + row + ': ยังอนุมัติไม่ได้ (' + (check || 'ว่าง') + ')');
          }
        } else if (approve === false && name !== '') {
          // An issued name may already exist in a platform even without a returned
          // Campaign ID; releasing it would let its sequence be issued twice.
          sh.getRange(row, C.APPROVE).setValue(true);
          msgs.push('แถว ' + row + ': ชื่อที่อนุมัติแล้วถอนไม่ได้ — ติ๊กช่อง "ยกเลิก" แล้วขอแถวใหม่');
        }
      });
      if (msgs.length) book.toast(msgs.join('\n'), 'อนุมัติ', 10);
    }
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Agency files: one Name_Builder file per agency, managed from this master
// ---------------------------------------------------------------------------

function agencyFiles_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty(CFG.FILES_PROP) || '{}');
}

function masterAgencies_(master) {
  return master.getSheetByName(CFG.OPTIONS).getRange('N6:N50').getValues()
    .map(r => String(r[0]).trim()).filter(a => a && CFG.MASTER_AGENCIES.indexOf(a) < 0);
}

// Creates (or completes) one file per agency listed in Naming_Options!N, except
// MASTER_AGENCIES. Idempotent: existing files are kept; files are not shared here.
function setupAgencyFiles() {
  const master = SpreadsheetApp.getActive();
  const files = agencyFiles_();
  const out = [];
  masterAgencies_(master).forEach(agency => {
    let ss = null;
    if (files[agency]) {
      try { ss = SpreadsheetApp.openById(files[agency]); } catch (err) { ss = null; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create(CFG.AGENCY_FILE_PREFIX + agency);
      files[agency] = ss.getId();
      PropertiesService.getScriptProperties().setProperty(CFG.FILES_PROP, JSON.stringify(files));
    }
    if (!ss.getSheetByName(CFG.BUILDER)) buildAgencyFile_(master, ss, agency);
    installEditTrigger_(ss);
    out.push(agency + ': ' + ss.getUrl());
  });
  syncAll();
  Logger.log(out.join('\n'));
  master.toast('ไฟล์ Agency พร้อมแล้ว ' + out.length + ' ไฟล์ (ยังไม่ได้แชร์)', 'SENA', 10);
}

function buildAgencyFile_(master, ss, agency) {
  const placeholder = ss.getSheets();
  copyOptions_(master, ss);
  buildLists_(ss, [agency]);
  buildScopeLists_(ss);
  const sh = ss.insertSheet(CFG.BUILDER, 0);
  buildBuilder_(sh);
  sh.getRange('A1').setValue('SENA Campaign Name Builder — ' + agency + ' (Taxonomy V1)');
  buildHelp_(ss);
  placeholder.forEach(p => { if (ss.getSheets().length > 1) ss.deleteSheet(p); });
  protect_(ss, sh);
  ss.setActiveSheet(ss.getSheetByName(CFG.HELP));
  ss.moveActiveSheet(1);
}

// Master option list -> agency file (values only; the master remains the one editable list).
function copyOptions_(master, ss) {
  const src = master.getSheetByName(CFG.OPTIONS);
  const rows = src.getLastRow(), cols = Math.max(src.getLastColumn(), 14);
  const vals = src.getRange(1, 1, rows, cols).getValues();
  let dst = ss.getSheetByName(CFG.OPTIONS);
  if (!dst) {
    dst = ss.insertSheet(CFG.OPTIONS);
    dst.hideSheet();
  }
  if (dst.getMaxRows() < rows) dst.insertRowsAfter(dst.getMaxRows(), rows - dst.getMaxRows());
  if (dst.getMaxColumns() < cols) dst.insertColumnsAfter(dst.getMaxColumns(), cols - dst.getMaxColumns());
  dst.getRange(1, 1, dst.getMaxRows(), cols).clearContent();
  dst.getRange(1, 1, rows, cols).setNumberFormat('@').setValues(vals);
}

// Time-driven (every CFG.SYNC_MINUTES): push options out, pull every request in.
function syncAll() {
  const master = SpreadsheetApp.getActive() ||
    SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('MASTER_ID'));
  const files = agencyFiles_();
  const sources = [['MASTER', master]];
  Object.keys(files).forEach(agency => {
    try {
      const ss = SpreadsheetApp.openById(files[agency]);
      copyOptions_(master, ss);
      buildScopeLists_(ss);
      sources.push([agency, ss]);
    } catch (err) {
      sources.push([agency, null]);
    }
  });
  writeAllRequests_(master, sources);
}

function buildAllRequests_(master) {
  let sh = master.getSheetByName(CFG.ALL);
  if (!sh) sh = master.insertSheet(CFG.ALL);
  sh.clear();
  const p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] ||
    sh.protect().setDescription(CFG.ALL + ': script output, internal only');
  restrictEditors_(p);
  sh.setTabColor('#7D8D97');
  return sh;
}

function writeAllRequests_(master, sources) {
  const sh = master.getSheetByName(CFG.ALL) || buildAllRequests_(master);
  const n = CFG.LAST - CFG.FIRST + 1;
  const header = ['source_file', 'cross_file_check'].concat(
    master.getSheetByName(CFG.BUILDER).getRange(5, 1, 1, C.STATUS).getValues()[0].map(h => String(h).replace(/\n/g, ' ')));
  const rows = [];
  const errors = [];
  sources.forEach(([label, ss]) => {
    if (!ss) { errors.push(label + ': เปิดไฟล์ไม่ได้'); return; }
    const b = ss.getSheetByName(CFG.BUILDER);
    if (!b) { errors.push(label + ': ไม่มี ' + CFG.BUILDER); return; }
    b.getRange(CFG.FIRST, 1, n, C.STATUS).getValues()
      .filter(r => r.slice(C.AGENCY - 1, C.NOTE).some(v => v !== ''))
      .forEach(r => rows.push([label, ''].concat(r)));
  });
  // Campaign IDs must be unique across files (same platform account namespace).
  const idCol = 2 + C.CAMPAIGN_ID - 1, nameCol = 2 + C.NAME - 1;
  const count = (col) => rows.reduce((m, r) => { const k = String(r[col]); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const ids = count(idCol), names = count(nameCol);
  rows.forEach(r => {
    const issues = [];
    if (r[idCol] !== '' && ids[String(r[idCol])] > 1) issues.push('Campaign ID ซ้ำข้ามไฟล์');
    if (r[nameCol] !== '' && names[String(r[nameCol])] > 1) issues.push('ชื่อซ้ำข้ามไฟล์');
    r[1] = issues.join(', ') || 'OK';
  });
  sh.clearContents();
  const stamp = 'อัปเดตล่าสุด ' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm') +
    ' (อ่านอย่างเดียว — แก้ไขในไฟล์ต้นทาง)' + (errors.length ? ' • ' + errors.join(' • ') : '');
  sh.getRange(1, 1).setValue(stamp).setFontWeight('bold');
  sh.getRange(2, 1, 1, header.length).setValues([header])
    .setBackground(COLORS.header).setFontColor(COLORS.headerText).setFontWeight('bold').setWrap(true);
  if (rows.length) {
    sh.getRange(3, 1, rows.length, header.length).setNumberFormat('@').setValues(
      rows.map(r => r.map(v => v instanceof Date ? Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm') : v)));
  }
  sh.setFrozenRows(2);
}

// Shares each agency file with CFG.AGENCY_EDITORS[agency] only. Run manually after review.
function shareAgencyFiles() {
  const files = agencyFiles_();
  const done = [];
  Object.keys(CFG.AGENCY_EDITORS).forEach(agency => {
    const emails = CFG.AGENCY_EDITORS[agency] || [];
    if (!files[agency] || !emails.length) return;
    SpreadsheetApp.openById(files[agency]).addEditors(emails);
    done.push(agency + ' → ' + emails.join(', '));
  });
  Logger.log(done.join('\n') || 'ไม่มีรายชื่อใน CFG.AGENCY_EDITORS');
}
