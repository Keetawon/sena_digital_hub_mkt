// Executes in an offline DOM. Source strings are data; no page script runs.
export function extractSenaProject() {
  const root = document.querySelector('#wrapperProjectDetail') || document.querySelector('main') || document.body;
  const excluded = 'script,style,noscript,nav,header,footer,form,svg,select,button,#headerModal,#headerSearchModal,.navbar,.wrapper-footer,.site-footer,[role="navigation"]';
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title;
  const sections = [], refs = [], faqs = [];
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
  const where = el => el.closest('[id]')?.id || el.closest('section')?.querySelector('h1,h2,h3')?.textContent?.trim() || 'project';
  for (const el of root.querySelectorAll('img,source,a,video,iframe,object,embed,[style],[data-background]')) {
    if (el.closest(excluded)) continue;
    for (const attr of ['src','href','data-src','data-lazy-src','data-original','data-bg','poster','data','data-srcset','srcset']) {
      const value = el.getAttribute(attr); if (!value) continue;
      for (const url of /srcset/.test(attr) ? value.split(',').map(v => v.trim().split(/\s+/)[0]) : [value])
        refs.push({ url, section: where(el), label: el.getAttribute('alt') || text(el).slice(0,200), tag: el.tagName, attribute: attr });
    }
    for (const match of (el.getAttribute('style') || '').matchAll(/url\(["']?([^)'"\s]+)["']?\)/g))
      refs.push({ url: match[1], section: where(el), tag: 'CSS', attribute: 'style' });
    if (el.getAttribute('data-background')) refs.push({ url: el.getAttribute('data-background'), section: where(el), tag: 'CSS' });
  }
  const meta = key => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content') || null;
  const concept = text(root.querySelector('#tab-project-detail-0')) || null;
  const address = [...root.querySelectorAll('.location-content h3,.location-content h4,.location-content .address')]
    .map(text).find(value => /ถนน|ซอย|ตำบล|แขวง|เขต|จังหวัด|\b(?:road|district|province)\b/i.test(value)) || null;
  const contacts = [...root.querySelectorAll('a[href^="tel:"],a[href*="line.me"],a[href*="maps.google"],a[href*="google.com/maps"]')]
    .filter(el => !el.closest(excluded)).map(el => ({ label: text(el), url: el.getAttribute('href') }));
  return { title, sections, refs, stylesheets: [], visible_text_length: sections.reduce((n,s) => n+s.text.length,0),
    website: { source: 'sena_public_website', title, description: meta('description'), image: meta('og:image'), canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || meta('og:url'), concept, address, contacts, faqs } };
}
