"""Read captured failures only; never re-fetch or override robots."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import collections, csv, json

ROOT=Path(__file__).resolve().parents[1]
capture=ROOT/'.local/knowledge-intake/2026-10-06T04-13-14-334Z-250abbaf'
failures=json.loads((capture/'failures.json').read_text(encoding='utf-8'))
refs={r['url']:r for r in json.loads((capture/'file-references.json').read_text(encoding='utf-8'))}
out=ROOT/'.local/km-review/fetch-reports';out.mkdir(exist_ok=True)
file_failures=[f for f in failures if f['kind']=='file']
robots=[f for f in file_failures if f['reason']=='robots_disallowed']
groups=collections.defaultdict(list)
for f in robots:
    u=urlsplit(f['url']); parts=u.path.split('/')
    pattern='/'.join(parts[:5])+'/*'
    groups[(u.hostname,pattern)].append(f)
report=['# Web-team media export and broken links','', 'Captured 6 October 2026. Read-only report; robots restrictions were not bypassed.','', '## Robots exclusions (Q68)','', '| Host | Path pattern | URLs | Likely type (not verified) |','|---|---|---:|---|']
robot_groups=[]
for (host,pattern),rows in sorted(groups.items()):
    types=sorted({r.get('suggested_role','unclassified') for f in rows for r in f.get('references',[])})
    likely='images: '+', '.join(types)
    robot_groups.append({'host':host,'path_pattern':pattern,'count':len(rows),'likely_type':likely,'urls':[f['url'] for f in rows]})
    report.append(f'| {host} | `{unquote(pattern)}` | {len(rows)} | {likely} |')
off=[f for f in file_failures if 'allowlist' in f['reason']]
hosts=collections.Counter((urlsplit(f['url']).hostname,urlsplit(refs.get(f['url'],{}).get('final_url') or f['url']).hostname,urlsplit(refs.get(f['url'],{}).get('final_url') or f['url']).scheme) for f in off)
report+=['','## Allowlist / redirect exclusions','', '| Referenced host | Destination host | Scheme | Count |','|---|---|---|---:|']
for (host,dest,scheme),count in sorted(hosts.items()):report.append(f'| {host} | {dest} | {scheme} | {count} |')
report+=['','No host additions proposed: `www.sena.co.th` is already allowed over HTTPS; the 20 excluded redirects downgrade to HTTP at the website root and are not valid media targets. LINE and Facebook are third-party UI/tracking hosts. Keep them excluded. YouTube/Vimeo are stored only as video links.','', '## HTTP 404 broken-link occurrences','', '| Page URL | Broken URL | Section |','|---|---|---|']
broken=[]
for f in file_failures:
    if f['reason']!='http_404':continue
    seen=set()
    for ref in f.get('references',[]):
        key=(ref['page_url'],f['url'],ref.get('section','unknown'))
        if key in seen:continue
        seen.add(key);broken.append(dict(zip(['page_url','broken_url','section'],key)))
        report.append('| '+' | '.join(x.replace('|','\\|').replace('\n',' ') for x in key)+' |')
report+=['','The report preserves CSS/embedded-reference sections; a broken discovered reference is not proof that the project has no such content.','',f"Totals: {len(robots)} robots exclusions; {len(off)} allowlist/redirect exclusions; {sum(f['reason']=='http_404' for f in file_failures)} distinct HTTP 404 URLs, {len(broken)} page/section occurrences. One additional robots-unavailable failure remains recorded."]
(out/'web-team-report.md').write_text('\n'.join(report)+'\n',encoding='utf-8')
(out/'robots-exclusions.json').write_text(json.dumps(robot_groups,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(out/'allowlist-exclusions.json').write_text(json.dumps([{'url':f['url'],'reason':f['reason'],'final_url':refs.get(f['url'],{}).get('final_url'),'references':f.get('references',[])} for f in off],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
with (out/'broken-links.csv').open('w',encoding='utf-8-sig',newline='') as stream:
    writer=csv.DictWriter(stream,fieldnames=['page_url','broken_url','section']);writer.writeheader();writer.writerows(broken)
print(json.dumps({'robots':len(robots),'groups':len(groups),'excluded_hosts':list(hosts),'broken_urls':19,'broken_occurrences':len(broken),'report':str(out/'web-team-report.md')}))
