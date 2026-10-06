// Small fake server for navigation tests. Real cache/filter tests run against PostgreSQL/API.
export function progressFixture(url: string, input: Record<string, any>[]) {
  const q = new URL(url).searchParams;
  const rows = input.map(r => ({ ...r, group_status: r.group_status ?? (r.marketing_project_group_id ? 'marketing_reference' : 'missing'),
    source_review: r.source_review ?? { default_scope: true, status_raw: '2', status_label: 'พร้อมอยู่' } }));
  if (q.has('detail')) return rows.find(r => r.rem_project_id === q.get('detail'));
  const members = rows.filter(r => (!q.has('brand') || r.rem_brand_id === q.get('brand')) &&
    (!q.has('group') || r.marketing_project_group_id === q.get('group')) && (!q.has('group_state') || r.group_status === q.get('group_state')));
  const other = q.get('other') === 'true', status = q.get('status') || 'all';
  if (q.get('view') === 'counts') {
    const counts = Object.fromEntries(['all','new_from_rem','filling','awaiting_publisher','published','needs_attention'].map(key => [key,
      members.filter(r => (r.source_review.default_scope || key === 'needs_attention' || other && key !== 'new_from_rem') && (key === 'all' || r[key])).length]));
    const statuses: Record<string, { label: string; count: number }> = {};
    members.forEach(r => { const key=r.source_review.status_raw ?? 'null'; statuses[key] ??= {label:r.source_review.status_label,count:0}; statuses[key].count++; });
    return {counts,statuses,status_total:members.length,groups:[...new Map(rows.filter(r=>r.marketing_project_group_id).map(r=>[r.marketing_project_group_id,r.marketing_group_name_th])).entries()],brands:[...new Map(rows.filter(r=>r.rem_brand_id).map(r=>[r.rem_brand_id,r.brand_name])).entries()]};
  }
  let filtered: Record<string, any>[] = members.filter(r => (other || r.source_review.default_scope || status === 'needs_attention' && r.needs_attention) &&
    (status === 'all' || r[status]) && (status !== 'new_from_rem' || r.source_review.default_scope) &&
    (!q.has('rem_status') || q.get('rem_status') === 'all' || r.source_review.status_raw === q.get('rem_status')) &&
    `${r.name} ${r.rem_project_id}`.toLowerCase().includes((q.get('q') || '').toLowerCase()));
  if (q.get('view') === 'groups') {
    const groups = new Map<string, Record<string, any>>();
    filtered.forEach(r => { const state=r.group_status,id=state==='marketing_reference'?r.marketing_project_group_id:null,key=JSON.stringify([state,id]);
      if(!groups.has(key))groups.set(key,{state,id,name_th:r.marketing_group_name_th,count:0,published:0,filling:0,awaiting_publisher:0,names:[],brand_count:new Set(rows.filter(x=>x.marketing_project_group_id===id).map(x=>x.rem_brand_id)).size});
      const g=groups.get(key)!;g.count++; for(const k of ['published','filling','awaiting_publisher'])g[k]+=Number(Boolean(r[k]));if(g.names.length<2)g.names.push(r.name);
    });filtered=[...groups.values()];
  }
  const size=Number(q.get('size')||10),pages=Math.max(1,Math.ceil(filtered.length/size)),page=Math.min(Number(q.get('page')||1),pages);
  return {rows:filtered.slice((page-1)*size,page*size),total:filtered.length,page,pages,size};
}
