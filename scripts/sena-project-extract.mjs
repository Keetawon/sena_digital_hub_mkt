// Executes in an offline DOM. Source strings are data; no page script runs.
export function extractSenaProject() {
  const root = document.querySelector('#wrapperProjectDetail') || document.querySelector('main') || document.body;
  const excluded = 'script,style,noscript,nav,header,footer,form,svg,select,button,#headerModal,#headerSearchModal,.navbar,.wrapper-footer,.site-footer,[role="navigation"],.elementor-location-header,.elementor-location-footer,.elementor-widget-nav-menu';
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title;
  const sections = [], refs = [], faqs = [], extraction_gaps = [];
  const cleanNode = node => {
    if (!node) return '';
    const copy = node.cloneNode(true);
    for (const child of copy.querySelectorAll(excluded)) child.remove();
    for (const child of copy.querySelectorAll('br')) child.replaceWith(' ');
    for (const child of copy.querySelectorAll('div,p,li,dt,dd,tr,h1,h2,h3,h4')) child.append(' ');
    return text(copy);
  };
  const lines = node => {
    if (!node) return [];
    const copy = node.cloneNode(true);
    for (const child of copy.querySelectorAll(excluded)) child.remove();
    for (const child of copy.querySelectorAll('br')) child.replaceWith('\n');
    for (const child of copy.querySelectorAll('p,li,dt,dd,tr,h1,h2,h3,h4,.elementor-widget')) child.append('\n');
    return copy.textContent.split(/\n+/).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const locale = value => typeof value === 'string' ? value : value && typeof value === 'object' ? value.th || value.en || '' : '';
  const tabLabel = node => {
    const panel = node.closest('[role="tabpanel"],.tab-pane');
    if (!panel) return '';
    const label = document.getElementById(panel.getAttribute('aria-labelledby'));
    if (label) return text(label);
    return text([...root.querySelectorAll('[data-bs-target],a[href]')].find(el =>
      (el.getAttribute('data-bs-target') || el.getAttribute('href')) === '#' + panel.id));
  };
  const block = node => node?.closest('.e-con.e-parent,section') || node?.parentElement;
  // Read only known public plan/type JSON and a rendered flipbook's PDF reference.
  // Never execute script, inspect window state, or ingest form/user/config objects.
  const literal = name => {
    const flipbook = /^option_df_\d+$/.test(name), empty = () => flipbook ? {} : [];
    if (!flipbook && !['dataFloorPlan','dataUnitType'].includes(name)) return empty();
    for (const script of document.querySelectorAll('script:not([src])')) {
      const source = script.textContent;
      const match = new RegExp((flipbook ? '\\bwindow\\.' : '\\b(?:var|let|const)\\s+') + name + '\\s*=\\s*').exec(source);
      if (!match) continue;
      const start = match.index + match[0].length;
      if (source[start] !== (flipbook ? '{' : '[')) { extraction_gaps.push({field:name, reason:'content_json_wrong_shape'}); continue; }
      let depth = 0, quoted = false, escaped = false;
      for (let i = start; i < Math.min(source.length, start + 2000000); i++) {
        const char = source[i];
        if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
        if (char === '"') quoted = true;
        else if (char === '[' || char === '{') depth++;
        else if (char === ']' || char === '}') {
          depth--;
          if (depth === 0) {
            try {
              const value = JSON.parse(source.slice(start, i + 1));
              if (flipbook ? !value || typeof value !== 'object' || Array.isArray(value) : !Array.isArray(value) || value.length > 1000) throw new Error();
              return value;
            } catch { extraction_gaps.push({field:name, reason:'content_json_invalid'}); return empty(); }
          }
        }
      }
      extraction_gaps.push({field:name, reason:'content_json_incomplete_or_too_large'});
    }
    return empty();
  };
  let current = { heading: title, locator: 'project', text: [] };
  const flush = () => { if (current.text.length) sections.push({ ...current, text: current.text.join('\n') }); };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el || el.closest(excluded)) continue;
    if (node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(el.tagName)) {
      flush(); current = { heading: text(el), locator: el.id ? `#${el.id}` : `heading:${sections.length}`, text: [] };
    } else if (node.nodeType === Node.TEXT_NODE && !el.closest('h1,h2,h3,h4,h5,h6')) {
      const value = text(node); if (value) current.text.push(value);
    }
  }
  flush();
  for (const el of root.querySelectorAll('.accordion-item, .elementor-accordion-item')) {
    const question = text(el.querySelector('.accordion-header,.elementor-tab-title'));
    const answer = text(el.querySelector('.accordion-body,.accordion-collapse,.elementor-tab-content'));
    if (question && answer) faqs.push({ question, answer, locator: el.querySelector('[id]')?.id || `faq:${faqs.length}` });
  }
  for (const el of root.querySelectorAll('.e-n-accordion-item,details')) {
    const question = text(el.querySelector('summary'));
    const answer = [...el.children].filter(node => node.tagName !== 'SUMMARY').map(cleanNode).filter(Boolean).join(' ');
    if (question && answer && (el.matches('.e-n-accordion-item') || /faq|คำถาม/i.test(el.closest('[id]')?.id || '')))
      faqs.push({question, answer, locator:el.id || `faq:${faqs.length}`});
  }
  const where = el => el.closest('[id]')?.id || el.closest('section')?.querySelector('h1,h2,h3')?.textContent?.trim() || 'project';
  for (const el of root.querySelectorAll('img,source,a,video,iframe,object,embed,[style],[data-background],[data-settings],[data-thumbnail]')) {
    if (el.closest(excluded)) continue;
    for (const attr of ['src','href','data-src','data-lazy-src','data-original','data-bg','poster','data','data-srcset','srcset','data-thumbnail']) {
      const value = el.getAttribute(attr); if (!value) continue;
      for (const url of /srcset/.test(attr) ? value.split(',').map(v => v.trim().split(/\s+/)[0]) : [value])
        refs.push({ url, section: where(el), label: el.getAttribute('alt') || text(el).slice(0,200), gallery_tab:tabLabel(el), tag: el.tagName, attribute: attr });
    }
    for (const match of (el.getAttribute('style') || '').matchAll(/url\(["']?([^)'"\s]+)["']?\)/g))
      refs.push({ url: match[1], section: where(el), tag: 'CSS', attribute: 'style' });
    if (el.getAttribute('data-background')) refs.push({ url: el.getAttribute('data-background'), section: where(el), tag: 'CSS' });
    if (el.hasAttribute('data-settings')) {
      try {
        const settings = JSON.parse(el.getAttribute('data-settings'));
        for (const key of ['youtube_url','vimeo_url','video_link']) if (typeof settings[key] === 'string')
          refs.push({url:settings[key], section:where(el), label:el.getAttribute('aria-label') || '', tag:'IFRAME', attribute:`data-settings.${key}`});
        for (const key of ['background_image','background_overlay_image']) if (typeof settings[key]?.url === 'string')
          refs.push({url:settings[key].url, section:where(el), label:settings[key].alt || '', gallery_tab:tabLabel(el), tag:'CSS', attribute:`data-settings.${key}.url`});
      } catch { /* Unrelated widget settings are not executable content. */ }
    }
  }
  for (const el of root.querySelectorAll('._df_thumb,._df_book')) {
    if (!/^df_\d+$/.test(el.id) || el.closest(excluded)) continue;
    const config = literal('option_' + el.id);
    if (typeof config.source === 'string') refs.push({url:config.source,section:'brochure',label:text(el),tag:'OBJECT',attribute:'public_flipbook_source'});
    else extraction_gaps.push({field:el.id,reason:'brochure_source_unavailable'});
  }
  const meta = key => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content') || null;
  const conceptNode = root.querySelector('#tab-project-detail-0') || block(root.querySelector('#concept'));
  const concept = cleanNode(conceptNode) || null;
  const address = [...root.querySelectorAll('.location-content h3,.location-content h4,.location-content .address')]
    .map(text).find(value => /ถนน|ซอย|ตำบล|แขวง|เขต|จังหวัด|\b(?:road|district|province)\b/i.test(value)) || null;
  const contacts = [...root.querySelectorAll('a[href^="tel:"],a[href^="mailto:"],a[href*="line.me"],a[href*="lin.ee"],a[href*="maps.google"],a[href*="google.com/maps"],a[href*="facebook.com"],a[href*="instagram.com"],a[href*="tiktok.com"]')]
    .filter(el => !el.closest(excluded)).map(el => ({ label: text(el), url: el.getAttribute('href') }));
  const project_information = [];
  for (const label of root.querySelectorAll('#tab-project-detail-1 .title-in-tab-data-project-detail')) {
    const value = label.parentElement.parentElement.querySelector('.text-tab-data-project-detail');
    if (value) project_information.push({label:text(label), value:cleanNode(value), lines:lines(value), locator:where(label)});
  }
  for (const row of root.querySelectorAll('#project-info tr,.project-information tr,.project-info tr')) {
    const cells = [...row.querySelectorAll('th,td')];
    if (cells.length >= 2) project_information.push({label:text(cells[0]), value:cleanNode(cells[1]), lines:lines(cells[1]), locator:where(row)});
  }
  const facilities = [];
  const wpHeading = root.querySelector('#project-info');
  const wpHeadingBlock = block(wpHeading);
  const wpInfo = wpHeadingBlock?.querySelector('.elementor-icon-list-text') ? wpHeadingBlock : wpHeadingBlock?.nextElementSibling;
  if (wpHeading && wpInfo) {
    for (const node of wpInfo.querySelectorAll('.elementor-icon-list-text')) {
      const raw = node.textContent.trim(), pair = /^(.+?)(?:\s{2,}|\s*:\s+)(.+)$/.exec(raw);
      if (pair) project_information.push({label:pair[1].trim(),value:pair[2].trim(),lines:[pair[2].trim()],locator:where(node)});
      else if (raw) facilities.push({name:text(node),location_label:'',evidence:cleanNode(node),locator:where(node)});
    }
    if (!project_information.length) extraction_gaps.push({field:'project_information',reason:'information_box_has_no_text_fields'});
  }
  const facilityList = (node, heading = '') => {
    let location_label = heading;
    for (const value of lines(node)) {
      if (/^(?:ชั้น\s*\d|floor\s*\d|\d+(?:st|nd|rd|th)?\s*floor|โซน|zone\b|ดาดฟ้า)/i.test(value)) {location_label=value; continue;}
      facilities.push({name:value, location_label, evidence:cleanNode(node), locator:where(node)});
    }
  };
  for (const field of project_information) if (/facilit|สิ่งอำนวย|ส่วนกลาง/i.test(field.label))
    for (const value of field.lines) facilities.push({name:value, location_label:'', evidence:field.value, locator:field.locator});
  for (const node of root.querySelectorAll('[data-facilities],.facility-list,#facilities ul,.facilities ul'))
    facilityList(node, text(node.closest('section,.e-con')?.querySelector('h2,h3,h4')));
  const floor_plans = [], unit_types = [], unit_plans = [];
  const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  for (const row of literal('dataFloorPlan')) {
    if (!row || typeof row !== 'object') continue;
    const label = locale(row.project_floor_plan), building_label = locale(row.project_floor_plan_building_name);
    for (const url of list(row.floor_plan_image_url)) {
      floor_plans.push({url,label,building_label,detail:locale(row.project_floor_plan_detail),locator:'dataFloorPlan'});
      refs.push({url,section:'floor_plan',label,floor_label:label,building_label,tag:'IMG',attribute:'dataFloorPlan'});
    }
  }
  for (const row of literal('dataUnitType')) {
    if (!row || typeof row !== 'object') continue;
    const label = locale(row.project_unit_type);
    const rooms = (Array.isArray(row.project_detail_unit_type_room_list) ? row.project_detail_unit_type_room_list : [])
      .filter(room => room && typeof room === 'object').map(room => ({label:locale(room.project_room_unit_type),count_text:String(room.project_room_unit_type_count ?? '')}));
    unit_types.push({label,size_text:typeof row.project_unit_type_size === 'string' ? row.project_unit_type_size : '',rooms,locator:'dataUnitType'});
    for (const url of list(row.unit_type_image_url)) {
      unit_plans.push({url,label,type_label:label,locator:'dataUnitType'});
      refs.push({url,section:'unit_plan',label,type_label:label,tag:'IMG',attribute:'dataUnitType.unit_type_image_url'});
    }
    for (const url of list(row.unit_type_left_image_url)) refs.push({url,section:'unit_type_gallery',label,type_label:label,tag:'IMG',attribute:'dataUnitType.unit_type_left_image_url'});
  }
  for (const panel of root.querySelectorAll('[role="tabpanel"],.unit-type-card')) {
    const heading = [...panel.querySelectorAll('h2,h3,h4')].find(node => /^TYPE\s*:/i.test(text(node)));
    if (!heading && !panel.matches('.unit-type-card')) continue;
    const label = text(heading || panel.querySelector('h2,h3,h4')) || tabLabel(panel);
    const rows = lines(panel), specs = rows.filter(value => /\bSQ\.?\s*M\.?|ตร\.?\s*ม\.?|\b(?:BED|BATH)\s*ROOM|ห้องนอน|ห้องน้ำ/i.test(value));
    unit_types.push({label,detail:cleanNode(panel),specification_text:specs,locator:where(panel)});
    for (const el of panel.querySelectorAll('img,a[href]')) {
      const url = el.getAttribute('href') || el.getAttribute('data-src') || el.getAttribute('src');
      if (!url || !/\.(?:jpe?g|png|webp|svg)(?:[?#]|$)/i.test(url)) continue;
      const imageLabel = el.getAttribute('alt') || text(el);
      if (/plan|floor|แปลน|ชั้น/i.test(url + ' ' + imageLabel)) {
        unit_plans.push({url,label:imageLabel || label,type_label:label,locator:where(el)});
        refs.push({url,section:'unit_plan',label:imageLabel || label,type_label:label,tag:'IMG',attribute:'unit_type_panel'});
      }
    }
  }
  const nearby = [];
  for (const group of root.querySelectorAll('.wrapper-near-location,.nearby-group,[data-nearby]')) {
    const heading = text(group.querySelector('h2,h3,h4,.nearby-heading')) || group.querySelector('img')?.getAttribute('alt') || '';
    const icon = group.querySelector('img')?.getAttribute('src') || '';
    for (const value of lines(group.querySelector('.near-location-detail') || group))
      if (value !== heading) nearby.push({heading,icon_hint:icon,text:value,locator:where(group)});
  }
  for (const heading of root.querySelectorAll('.elementor-heading-title')) {
    if (!/^(?:การเดินทาง|ไลฟ์สไตล์|สถานศึกษา|โรงพยาบาล|สถานที่ใกล้เคียง|Transportation|Nearby|Education|Hospitals)$/i.test(text(heading))) continue;
    const group = heading.closest('.e-con');
    if (!group) continue;
    for (const node of group.querySelectorAll('.elementor-icon-list-text,li,p')) {
      if (node.closest(excluded)) continue;
      for (const value of lines(node)) if (value !== text(heading))
        nearby.push({heading:text(heading),icon_hint:'',text:value,locator:where(node)});
    }
  }
  const construction = [];
  for (const row of root.querySelectorAll('.progress-detail > .row,[data-construction-component]')) {
    const value = cleanNode(row), percent = /(?:^|\s)(\d+(?:\.\d+)?)\s*%/.exec(value);
    if (percent) construction.push({component_label:value.slice(0,percent.index).trim(),percent_text:percent[1],source_text:value,as_of:null,locator:where(row)});
  }
  const disclosures = [], promotion_terms = [];
  for (const node of root.querySelectorAll('.condition-project,.project-disclosure,[data-disclosure],.promotion-terms,[data-promotion-terms]')) {
    if (node.closest('form')) continue;
    const item = {heading:text(node.querySelector('h1,h2,h3,h4')),text:cleanNode(node),locator:where(node)};
    if (!item.text) continue;
    (/โปรโมชั่น|โปรโมชัน|ส่งเสริมการขาย|promotion/i.test(item.heading) || node.matches('.promotion-terms,[data-promotion-terms]') ? promotion_terms : disclosures).push(item);
  }
  const gallery = [], tours = [], videos = [], brochures = [], maps = [];
  for (const ref of refs) {
    const hint = `${ref.section} ${ref.label || ''} ${ref.gallery_tab || ''} ${ref.url}`;
    if (/matterport\.com|kuula\.co|(?:^|[\W_])360(?:[\W_]|$)/i.test(ref.url)) tours.push({...ref,metadata_source:'manual'});
    else if (/youtu\.be|youtube(?:-nocookie)?\.com/i.test(ref.url)) videos.push(ref);
    else if (/\.pdf(?:[?#]|$)|brochure|โบรชัวร์/i.test(hint)) brochures.push(ref);
    else if (/\bmap\b|แผนที่/i.test(hint) && /\.(?:jpe?g|png|webp|svg)(?:[?#]|$)/i.test(ref.url)) maps.push(ref);
    else if (/gallery|แกลเลอรี/i.test(hint)) gallery.push(ref);
  }
  const call_centres = [...root.querySelectorAll('.location-content h3,.location-content h4,.call-center,[data-call-centre]')]
    .map(cleanNode).filter(value => /(?:call\s*cent(?:er|re)|โทร|1775)/i.test(value));
  return { title, sections, refs, stylesheets: [], visible_text_length: sections.reduce((n,s) => n+s.text.length,0),
    website: { source: 'sena_public_website', title, description: meta('description'), image: meta('og:image'), canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || meta('og:url'),
      concept, concept_name:text(conceptNode?.querySelector('h1,h2,h3,h4')) || null, address, contacts, call_centres, faqs,
      project_information, facilities, unit_types,
      nearby:nearby.filter((item,index,all)=>all.findIndex(other=>other.heading===item.heading&&other.text===item.text)===index),
      gallery, floor_plans, unit_plans, tours, videos, brochures, maps,
      construction, disclosures, promotion_terms, extraction_gaps } };
}
