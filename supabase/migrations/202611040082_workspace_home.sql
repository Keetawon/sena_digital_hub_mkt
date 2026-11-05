-- W2: caller-scoped read projections. No source, account or grant is rewritten.
begin;

create function hub.content_scope_allowed(kind text,ref text,level text default 'view') returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if kind not in ('project','brand','corporate') or level not in ('view','edit','approve') or ref is null then return false;end if;
 if not hub.can(hub.content_scope_tab(kind),level) then return false;end if;
 perform hub.content_scope_access(kind,ref,level);return true;
 exception when insufficient_privilege or no_data_found then return false;
end $$;

create function hub.workspace_require() returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.permission_actor();begin
 if not exists(select 1 from hub.user_account where id=actor and status='ACTIVE'
  and hub_role in ('viewer','editor','publisher','admin','online_staff'))
  or not exists(select 1 from unnest(array['projects','brands','knowledge','promotions','releases']) t where hub.can(t,'view')) then
  raise exception 'Workspace permission required' using errcode='42501';end if;
 return actor;
end $$;

-- W6 replaces this private local-copy projection with its separate dated BU
-- membership tables. Exact IDs, codes and names are retained; no prefix mapping.
create function hub.workspace_project_bu() returns table(project_id uuid,rem_bu_id text,rem_bu_code text,rem_bu_name text,source_snapshot_at timestamptz)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select p.id,d.source_record->>'rem_bu_id',d.source_record->>'rem_bu_code',d.source_record->>'rem_bu_name',d.source_snapshot_at
 from hub.projects p join staging.dw_projects d using(rem_project_id)
 where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')
$$;

create function hub.workspace_search(query text,page_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare needle text:=lower(btrim(query));result jsonb;begin
 perform hub.workspace_require();
 if query is null or length(query)>120 or page_size is null or page_size not between 1 and 30 then raise exception 'Invalid workspace search' using errcode='23514';end if;
 if needle='' then return jsonb_build_object('items','[]'::jsonb);end if;
 with candidates as (
  select 'project' kind,p.public_project_id ref,p.public_name label,p.rem_project_id code,
   jsonb_build_object('project',p.public_project_id) context
  from hub.projects p where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')
   and position(needle in lower(p.public_name::text||' '||p.public_project_id||' '||p.rem_project_id))>0
  union all
  select 'brand',b.public_brand_id,b.public_name,b.rem_brand_id,jsonb_build_object('brand',b.public_brand_id)
  from hub.brands b where b.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view')
   and position(needle in lower(b.public_name::text||' '||b.public_brand_id||' '||b.rem_brand_id))>0
  union all
  select distinct 'bud',b.rem_bu_id,jsonb_build_object('th',coalesce(b.rem_bu_name,b.rem_bu_id)),b.rem_bu_code,jsonb_build_object('bud',b.rem_bu_id)
  from hub.workspace_project_bu() b where b.rem_bu_id is not null
   and position(needle in lower(concat_ws(' ',b.rem_bu_id,b.rem_bu_code,b.rem_bu_name)))>0
  union all
  select 'question',q.question_key,q.question_template,q.question_key,jsonb_build_object('tab','bank','question',q.question_key)
  from hub.faq_questions q where hub.can('knowledge','view') and q.status='approved'
   and position(needle in lower(q.question_key||' '||q.question_template::text||' '||q.alt_questions::text))>0
 ), ranked as (
  select *,row_number() over(partition by kind order by case when lower(ref)=needle or lower(code)=needle then 0
   when lower(label->>'th')=needle or lower(label->>'en')=needle then 1 else 2 end,ref) rank_in_kind,
   case kind when 'project' then 1 when 'brand' then 2 when 'bud' then 3 else 4 end kind_order from candidates
 ), bounded as (select * from ranked order by rank_in_kind,kind_order,ref limit page_size)
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'ref',ref,'label',label,'code',code,'context',context) order by rank_in_kind,kind_order,ref),'[]') into result from bounded;
 return jsonb_build_object('items',result);
end $$;

-- This wrapper never returns the FAQ body. The current guarded reader remains
-- the authority, including later object-scope restrictions from W6.
create function hub.workspace_faq_allowed(faq uuid) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.can('knowledge','view') then return false;end if;
 return hub.faq_read(faq) is not null;
 exception when insufficient_privilege or no_data_found then return false;
end $$;

-- Context is data, never a caller-provided URL. FAQ ownership remains Knowledge.
create function hub.workspace_context(kind text,ref text) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_strip_nulls(jsonb_build_object('scope_type',kind,'scope_id',ref,
  'project',case when kind='project' then coalesce((select public_project_id from hub.projects where ref in(public_project_id,rem_project_id,id::text) and deleted_at is null),ref)
   when kind='unit_type' then (select p.public_project_id from hub.commercial_types t join hub.projects p on p.id=t.project_id where t.id::text=ref and t.deleted_at is null and p.deleted_at is null) end,
  'phase',case when kind='project' then (select rem_project_id from hub.projects where ref in(public_project_id,rem_project_id,id::text) and deleted_at is null) end,
  'brand',case when kind='brand' then ref end,'unit_type',case when kind='unit_type' then (select public_commercial_type_id from hub.commercial_types where id::text=ref and deleted_at is null) end))
$$;

-- Association is a filter after the owning content guard, not Projects authority.
-- W6 replaces the local BU lookup here together with workspace_project_bu().
create function hub.workspace_scope_matches(kind text,ref text,phases text[],bud text,brand text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select bud is null and brand is null
  or kind='brand' and ref=brand and bud is null
  or exists(select 1 from hub.projects p left join hub.brands b on b.id=p.brand_id and b.deleted_at is null
   left join staging.dw_projects d using(rem_project_id)
   where p.deleted_at is null and (kind='project' and ref in(p.public_project_id,p.rem_project_id,p.id::text)
    or kind='brand' and ref=b.public_brand_id
    or kind='unit_type' and exists(select 1 from hub.commercial_types t where t.project_id=p.id and t.id::text=ref and t.deleted_at is null)
    or p.rem_project_id=any(coalesce(phases,'{}')))
   and (bud is null or d.source_record->>'rem_bu_id'=bud) and (brand is null or b.public_brand_id=brand))
$$;

-- Private normalized native evidence. No workflow state is invented or saved.
create function hub.workspace_native_rows() returns setof jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with media(asset_id,binding_id,tab,kind,ref,expires_at,context,phases) as (
  select l.asset_id,l.id,'projects','project',p.public_project_id,l.effective_to,
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('target_type',l.target_type,'target_key',l.target_key,'usage',l.usage,'floor_from',l.floor_from,'floor_to',l.floor_to),array[p.rem_project_id]
  from hub.asset_links l join hub.projects p on p.id=l.project_id where l.deleted_at is null
   and hub.content_scope_allowed('project',p.public_project_id,'view') and hub.media_target(p.id,l.target_type,l.target_key,'view')
  union all
  select l.asset_id,l.id,'projects','project',p.public_project_id,l.effective_to,
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('usage',l.asset_role),array[p.rem_project_id]
  from hub.entity_assets l join hub.projects p on p.id=l.project_id where l.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')
  union all
  select l.asset_id,l.id,'brands','brand',b.public_brand_id,l.effective_to,
   hub.workspace_context('brand',b.public_brand_id)||jsonb_build_object('usage',l.asset_role),'{}'::text[]
  from hub.brand_assets l join hub.brands b on b.id=l.brand_id where l.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view')
  union all
  select l.asset_id,l.id,'projects','project',p.public_project_id,null::timestamptz,
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('unit_type',t.public_commercial_type_id,'usage',l.asset_role),array[p.rem_project_id]
  from hub.commercial_type_assets l join hub.projects p on p.id=l.project_id join hub.commercial_types t on t.id=l.commercial_type_id and t.deleted_at is null where l.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')

 ), rows(kind,item_id,source_tab,scope_type,scope_id,label,version,context,table_name,identity,owner_type,owner_key,ready,current_material,phases) as (
  select 'section',s.id::text,hub.content_scope_tab(s.scope_type),s.scope_type,s.scope_id,coalesce(f.label,s.title),to_jsonb(v),
   hub.workspace_context(s.scope_type,s.scope_id)||jsonb_build_object('tab','narrative','field',s.section_key,'item',s.id),
   'content_section_versions',jsonb_build_object('id',v.id),'section',s.id::text,true,true,v.applies_to_project_ids
  from hub.content_sections s join hub.content_section_versions v on v.id=s.draft_version_id left join hub.field_catalog f on f.field_key=s.section_key
  where s.state<>'WITHDRAWN' and hub.section_visible(s.id) and hub.content_scope_allowed(s.scope_type,s.scope_id,'view')
  union all
  select 'faq',f.id::text,'knowledge',f.scope_type,f.scope_id,v.question,to_jsonb(v),
   hub.workspace_context(f.scope_type,f.scope_id)||jsonb_build_object('tab','faq','faq',f.id,'question',v.question_key,'item',f.id),
   'faq_versions',jsonb_build_object('id',v.id),'faq',f.id::text,
   not exists(select 1 from hub.faq_sources fs join hub.knowledge_reviews kr on kr.candidate_id=fs.candidate_id where fs.faq_id=f.id and kr.decision<>'accepted'),
   true,case when v.applicability_rule<>'{}' then hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id) else v.applies_to_project_ids end
  from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id
  where f.state<>'WITHDRAWN' and hub.workspace_faq_allowed(f.id)
  union all
  select 'unit_type',t.id::text,'projects','project',p.public_project_id,v.payload->'public_name',to_jsonb(v),
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('tab','unit-types','unit_type',t.public_commercial_type_id,'item',t.id),
   'commercial_type_versions',jsonb_build_object('id',v.id),'commercial_type',t.id::text,
   (hub.unit_type_readiness(t.id)->>'ready')::boolean,v.payload=hub.unit_type_snapshot(t.id),array[p.rem_project_id]
  from hub.commercial_types t join hub.projects p on p.id=t.project_id
  join lateral(select x.* from hub.commercial_type_versions x where x.commercial_type_id=t.id order by revision desc limit 1) v on
   v.revision=t.revision or v.state='returned' and t.status='draft' and t.revision=v.revision+1
  where t.deleted_at is null and t.status<>'withdrawn' and hub.content_scope_allowed('project',p.public_project_id,'view')
  union all
  select 'price',r.id::text,'projects','project',p.public_project_id,coalesce(v.payload->'display_text',jsonb_build_object('th',v.payload->>'public_price_id')),to_jsonb(v),
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('tab','prices','unit_type',(select public_commercial_type_id from hub.commercial_types where id=r.commercial_type_id and deleted_at is null),'item',r.id,'field','price.amount'),
   'project_price_versions',jsonb_build_object('id',v.id),'price',r.id::text,
   (hub.project_price_readiness(r.id)->>'ready')::boolean,v.payload=hub.project_price_snapshot(r.id),array[p.rem_project_id]
  from hub.project_prices r join hub.projects p on p.id=r.project_id
  join lateral(select x.* from hub.project_price_versions x where x.price_id=r.id order by revision desc limit 1) v on
   v.revision=r.revision or v.state='returned' and r.state='draft' and r.revision=v.revision+1
  where r.state<>'withdrawn' and hub.content_scope_allowed('project',p.public_project_id,'view')
  union all
  select hub.project_commercial_entity(v.kind),v.record_id::text,'projects','project',p.public_project_id,
   coalesce(nullif(v.payload->'legal_project_name','{}'),nullif(v.payload->'conditions','{}'),nullif(v.payload->'basis','{}'),jsonb_build_object('th',coalesce(v.payload->>'programme_key',v.payload->>'component',v.payload->>'public_content_id'))),to_jsonb(v),
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('tab',v.kind,'item',v.record_id,'field',hub.project_commercial_entity(v.kind)||'.'||case v.kind when 'disclosures' then 'legal_project_name' when 'sales-terms' then 'conditions' when 'programmes' then 'programme_key' else 'percent' end),
   'project_commercial_versions',jsonb_build_object('id',v.id),hub.project_commercial_entity(v.kind),v.record_id::text,
   (hub.project_commercial_readiness(v.kind,v.record_id)->>'ready')::boolean,v.payload=hub.project_commercial_snapshot(v.kind,v.record_id),array[p.rem_project_id]
  from hub.project_commercial_versions v join hub.projects p on p.id=v.project_id
  cross join lateral(select hub.web_source(hub.project_commercial_table(v.kind),jsonb_build_object('id',v.record_id)) value) r
  where not exists(select 1 from hub.project_commercial_versions later where later.kind=v.kind and later.record_id=v.record_id and later.revision>v.revision)
   and r.value->>'state'<>'withdrawn' and ((r.value->>'revision')::integer=v.revision or v.state='returned' and r.value->>'state'='draft' and (r.value->>'revision')::integer=v.revision+1)
   and hub.content_scope_allowed('project',p.public_project_id,'view')
  union all
  select 'article',a.id::text,'knowledge','article',a.id::text,v.title,to_jsonb(v),jsonb_build_object('article',a.id,'item',a.id,'field','article.title'),
   'article_versions',jsonb_build_object('id',v.id),'article',a.id::text,hub.article_reference_issues(v.id)='[]',true,
   array(select p.rem_project_id from hub.article_links l join hub.projects p on l.kind='project' and p.public_project_id=l.ref where l.version_id=v.id and p.deleted_at is null)
  from hub.articles a join hub.article_versions v on v.id=a.draft_version_id
  where hub.can('knowledge','view') and a.state<>'WITHDRAWN'
   and not exists(select 1 from hub.article_links l where l.version_id=v.id and not hub.article_reference_allowed(l.kind,l.ref))
  union all
  select 'question',q.question_key,'knowledge','question',q.question_key,q.question_template,
   to_jsonb(q)||jsonb_build_object('version_no',q.revision,'state',upper(q.status),'editors',jsonb_build_array(q.version_author)),
   jsonb_build_object('tab','bank','question',q.question_key,'field','faq_question.question_template'),
   'faq_questions',jsonb_build_object('question_key',q.question_key),'faq_question',q.question_key,true,true,'{}'::text[]
  from hub.faq_questions q where q.status<>'retired' and hub.can('knowledge','view')
  union all
  select 'glossary',g.term_key,'knowledge','glossary',g.term_key,g.term,
   to_jsonb(g)||jsonb_build_object('version_no',g.revision,'state',upper(g.status),'editors',jsonb_build_array(g.version_author)),
   jsonb_build_object('tab','glossary','term',g.term_key,'item',g.term_key,'field','glossary.term'),
   null::text,null::jsonb,'glossary',g.term_key,true,true,'{}'::text[]
  from hub.translation_glossary g where g.status<>'retired' and hub.can('knowledge','view')
  union all
  select 'asset',a.id::text||':'||m.binding_id::text,m.tab,m.kind,m.ref,
   coalesce(nullif(a.caption,'{}'),nullif(a.alt_text,'{}'),jsonb_build_object('th',a.original_filename)),
   jsonb_build_object('state','MEDIA','version_no',a.updated_at::text,'effective_to',least(a.effective_to,m.expires_at)),
   m.context||jsonb_build_object('tab','media','item',a.id,'binding',m.binding_id,'field',case when a.effective_to is not null and (m.expires_at is null or a.effective_to<=m.expires_at) then 'asset.effective_to' else 'binding.effective_to' end,'media_category',a.media_category),
   'assets',jsonb_build_object('id',a.id),'asset',a.id::text,true,true,m.phases
  from media m join hub.assets a on a.id=m.asset_id where a.deleted_at is null and hub.can_read_asset(a.id) and least(a.effective_to,m.expires_at) is not null
  union all
  select 'solar',s.id::text,'projects','project',p.public_project_id,s.usage_profile,to_jsonb(s)||jsonb_build_object('version_no',s.revision),
   hub.workspace_context('project',p.public_project_id)||jsonb_build_object('tab','features','item',s.id,'field','solar_estimate.usage_profile'),
   'solar_estimates',jsonb_build_object('id',s.id),'solar_estimate',s.id::text,s.as_of<=(current_timestamp at time zone 'Asia/Bangkok')::date,true,array[p.rem_project_id]
  from hub.solar_estimates s join hub.projects p on p.id=s.project_id
  where s.state<>'withdrawn' and hub.content_scope_allowed('project',p.public_project_id,'view')
  union all
  select 'promotion',p.id::text,'promotions','project',pr.public_project_id,p.title,
   to_jsonb(p)||jsonb_build_object('version_no',p.draft_revision,'state',case when hub.promotion_approvals_ok(p.id,p.draft_revision) then 'APPROVED' else 'IN_REVIEW' end,
    'approved_by',null,'approvers',coalesce((select jsonb_agg(reviewed_by) from
     (select distinct on(review_type) reviewed_by,decision from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision order by review_type,event_seq desc) decisions where decision='APPROVED'),'[]')),
   hub.workspace_context('project',pr.public_project_id)||jsonb_build_object('promotion',p.id,'item',p.id,'tab','promotions','field','promotion.title'),
   null::text,null::jsonb,'promotion',p.id::text,(hub.promotion_readiness(hub.promotion_payload(p.id))->>'ready')::boolean,true,
   array(select target.rem_project_id from hub.promotion_target_projects(p.id) tp join hub.projects target on target.id=tp.id)
  from hub.public_promotions p join hub.projects pr on pr.id=p.project_id
  where hub.can('promotions','view') and pr.deleted_at is null
 )
 select to_jsonb(r)||jsonb_build_object('state',upper(r.version->>'state'),'version_id',case when r.kind in ('promotion','solar','question','glossary','asset') then null else r.version->>'id' end,
  'version_no',case when r.kind='asset' then null else coalesce(r.version->'version_no',r.version->'revision') end,'editors',coalesce(r.version->'editors','[]'),
  'reviewers',coalesce((select jsonb_agg(distinct x) from jsonb_path_query(r.version,'$.translations.**.reviewed_by') x where x<>'null'),'[]')||
   coalesce((select jsonb_agg(distinct t.reviewed_by) from hub.content_translations t where r.current_material
    and t.owner_type=r.owner_type and t.owner_key=r.owner_key and t.translation_state='reviewed'
    and t.en_from_th_version=t.th_version and t.reviewed_by is not null),'[]'),
  'approvers',coalesce(r.version->'approvers',case when r.version->>'approved_by' is not null then jsonb_build_array(r.version->'approved_by') else '[]'::jsonb end),
  'expires_on',case when r.kind<>'asset' then coalesce(r.version->'effective_to',r.version#>'{payload,valid_to}',r.version#>'{payload,effective_to}') end,
  'expires_at',case when r.kind='promotion' then r.version->'ends_at' when r.kind='asset' then r.version->'effective_to' end,'review_due',r.version->'review_due')
 from rows r
$$;

-- Keep the existing ten-column contract for the entity workspace reader.
create function hub.workspace_review_rows() returns table(kind text,item_id text,source_tab text,scope_type text,scope_id text,label jsonb,state text,editors uuid[],due date,context jsonb)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select r->>'kind',r->>'item_id',r->>'source_tab',r->>'scope_type',r->>'scope_id',r->'label',r->>'state',
  array(select x::uuid from jsonb_array_elements_text(r->'editors') x where x is not null),
  least((r->>'expires_on')::date,(r->>'review_due')::date,(nullif(r->>'expires_at','')::timestamptz at time zone 'Asia/Bangkok')::date),
  r->'context'||jsonb_strip_nulls(jsonb_build_object('version',r->'version_id','revision',r->'version_no'))
 from hub.workspace_native_rows() r
$$;

create function hub.workspace_native_publishable(row_data jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor text:=hub.permission_actor()::text;d jsonb;v jsonb:=row_data->'version';today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;
begin
 if row_data->>'state'<>'APPROVED' or not coalesce((row_data->>'ready')::boolean,false)
  or not coalesce((row_data->>'current_material')::boolean,false) or not hub.can_special('knowledge','knowledge.publish_web')
  or not hub.can(row_data->>'source_tab','view') or row_data->'editors'?actor or row_data->'reviewers'?actor or row_data->'approvers'?actor
  or jsonb_array_length(row_data->'approvers')=0 or row_data->>'kind' in ('question','glossary')
  or (row_data->>'expires_on')::date<today or (row_data->>'review_due')::date<today
  or (row_data->>'expires_at')::timestamptz<=current_timestamp
  or coalesce(v->>'ai_exposure',v#>>'{payload,ai_exposure}')='internal' then return false;end if;
 if row_data->>'kind'='promotion' then
  -- Before W4, this native dispatcher still requires Promotions Approve.
  if not hub.can('promotions','approve') or not hub.can('projects','view') then return false;end if;
  perform hub.validate_promotion_targets(coalesce(v->'targets','[]'));
  return not exists(select 1 from hub.public_promotions p join hub.promotion_versions pv on pv.id=p.published_version_id
   where p.id=(row_data->>'item_id')::uuid and pv.draft_revision=(row_data->>'version_no')::integer);
 end if;
 if row_data->>'kind'='article' and exists(select 1 from hub.article_links l where l.version_id=(row_data->>'version_id')::uuid
  and (l.kind='project' and not hub.content_scope_allowed('project',l.ref,'view') or l.kind='brand' and not hub.content_scope_allowed('brand',l.ref,'view')
   or l.kind='programme' and not hub.can('projects','view'))) then return false;end if;
 d:=hub.web_dependency(row_data->>'table_name',row_data->'identity',row_data->>'source_tab');
 if not hub.web_source_available(d) then return false;end if;
 -- Native payload/reference readiness above includes live rights and validity.
 -- The exact certificate, not the mutable parent state, identifies publication.
 return not exists(select 1 from hub.web_pages p join hub.entity_versions ev on ev.id=p.published_version_id
  cross join lateral hub.web_dependencies(ev.payload) used
  where used->>'table'=row_data->>'table_name' and used->'identity'=row_data->'identity' and used->>'hash'=d->>'hash');
 exception when insufficient_privilege or no_data_found then return false;
end $$;

-- W4 replaces this private projection with native + review-certificate tasks.
-- It owns eligibility and scope; home only combines, sorts and pages the result.
create function hub.workspace_content_tasks(bud text default null,brand text default null) returns setof jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor text:=hub.workspace_require()::text;r jsonb;base jsonb;category text;expiry date;review_date date;
 today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;can_review boolean;
begin
 for r in select * from hub.workspace_native_rows() loop
  if not hub.workspace_scope_matches(r->>'scope_type',r->>'scope_id',array(select jsonb_array_elements_text(r->'phases')),bud,brand) then continue;end if;
  can_review:=hub.can(r->>'source_tab','approve') and not(r->'editors'?actor or r->'reviewers'?actor);
  if r->>'source_tab' in ('projects','brands') then
   can_review:=can_review and hub.content_scope_allowed(r->>'scope_type',r->>'scope_id','approve');end if;
  category:=case when r->>'state'='RETURNED' and r->'editors'?actor then 'returned'
   when can_review and (r->>'state'='IN_REVIEW' or r->>'kind' in ('question','glossary') and r->>'state'='PROPOSED' or r->>'kind'='solar' and r->>'state'='DRAFT') then 'approval'
   when hub.workspace_native_publishable(r) then 'publish' end;
  base:=jsonb_build_object('kind',r->'kind','item_id',r->'item_id','version_id',r->'version_id','version_no',r->'version_no',
   'source_tab',r->'source_tab','scope_type',r->'scope_type','scope_id',r->'scope_id','label',r->'label','state',r->'state',
   'context',r->'context'||jsonb_strip_nulls(jsonb_build_object('version',r->'version_id','revision',r->'version_no')),
   'decision_reason',coalesce(r#>'{version,decision_reason}',r#>'{version,return_reason}',
    (select to_jsonb(a.reason) from audit.change_log a where r->>'state'='RETURNED' and a.table_name='hub.'||(r->>'table_name')
     and a.after_row @> (r->'identity') and upper(a.after_row->>'state')='RETURNED' order by a.id desc limit 1)));
  if category is not null then return next base||jsonb_build_object('id',category||':'||(r->>'kind')||':'||(r->>'item_id')||':'||coalesce(r->>'version_id',r->>'version_no',r->>'expires_at','current'), 'category',category);end if;
  expiry:=coalesce((r->>'expires_on')::date,((r->>'expires_at')::timestamptz at time zone 'Asia/Bangkok')::date);
  review_date:=(r->>'review_due')::date;
  if expiry<=today+30 then return next base||jsonb_build_object('id','expiring:'||(r->>'kind')||':'||(r->>'item_id')||':'||coalesce(r->>'version_id',r->>'version_no',r->>'expires_at','current'),
   'category','expiring','due',expiry,'overdue',expiry<today);end if;
  if review_date<=today+30 then return next base||jsonb_build_object('id','review_due:'||(r->>'kind')||':'||(r->>'item_id')||':'||coalesce(r->>'version_id',r->>'version_no',r->>'expires_at','current'),
   'category','review_due','due',review_date,'overdue',review_date<today);end if;
 end loop;
end $$;

create function hub.workspace_project_readiness(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;items jsonb:='[]';item jsonb;context jsonb;section text;media jsonb;
begin
 result:=hub.project_content_readiness(public_id);
 for item in select value from jsonb_array_elements(result->'items') where value->>'field_key' not like 'asset.%' loop
  select f.section into section from hub.field_catalog f where f.field_key=item->>'field_key';
  context:=hub.workspace_context('project',public_id)||jsonb_build_object('field',item->>'field_key','tab',coalesce(section,'narrative'));
  if item?'point_key' then context:=context||jsonb_build_object('tab','narrative','item',item->'point_key');end if;
  if item?'building_key' then context:=context||jsonb_build_object('tab','buildings','building',item->'building_key','item',item->'building_key');end if;
  items:=items||jsonb_build_array(item||jsonb_build_object('context',context));
 end loop;
 media:=hub.media_checklist(public_id);
 for item in select value from jsonb_array_elements(media->'items') loop
  context:=hub.workspace_context('project',public_id)||(item->'context')||jsonb_build_object('tab','media','rule_key',item->'rule_key',
   'field','asset.'||coalesce(item->>'media_category','media_category'));
  context:=context||case item#>>'{context,target_type}' when 'facility' then jsonb_build_object('facility',item#>'{context,target_key}')
   when 'commercial_type' then jsonb_build_object('unit_type',(select public_commercial_type_id from hub.commercial_types where id::text=item#>>'{context,target_key}' and deleted_at is null))
   when 'building_floor' then jsonb_build_object('building',item#>'{context,target_key}')
   when 'promotion' then jsonb_build_object('promotion',item#>'{context,target_key}') else '{}'::jsonb end;
  items:=items||jsonb_build_array(jsonb_build_object('field_key',context->'field','label',item->'label','context_label',item->'context_label',
   'required',item->'blocks_publish','complete',case when (item->>'blocks_publish')::boolean then item->'minimum_met' else item->'complete' end,'context',context));
 end loop;
 return result||jsonb_build_object('items',items);
end $$;

create function hub.workspace_brand_readiness(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare b hub.brands;native jsonb;items jsonb:='[]';item jsonb;key text;context jsonb;label jsonb;
begin
 perform hub.content_scope_access('brand',public_id,'view');
 select * into b from hub.brands where public_brand_id=public_id and deleted_at is null;
 native:=hub.brand_snapshot_readiness(hub.brand_draft_payload(b.id));
 for item in select value from jsonb_array_elements(native->'missing') loop
  key:=item->>'field';context:=hub.workspace_context('brand',public_id)||jsonb_build_object('field','brand.'||split_part(key,'.',1),'tab','identity');
  if key like 'assets.%' then
   context:=context||jsonb_build_object('tab','media','usage','logo_primary','field',key);
   if split_part(key,'.',2)~'^[0-9a-f-]{36}$' then context:=context||jsonb_build_object('item',split_part(key,'.',2),'field','asset.'||split_part(key,'.',3),
    'usage',(select ba.asset_role from hub.brand_assets ba where ba.brand_id=b.id and ba.asset_id=split_part(key,'.',2)::uuid and ba.deleted_at is null order by ba.is_primary desc,ba.id limit 1));end if;
  elsif key like 'description.%' then context:=context||jsonb_build_object('tab','narrative');end if;
  select f.label into label from hub.field_catalog f where f.field_key='brand.'||split_part(key,'.',1);
  items:=items||jsonb_build_array(jsonb_build_object('field_key',key,'label',coalesce(label,jsonb_build_object('th',item->>'message')),
   'complete',false,'required',true,'context',context));
 end loop;
 return jsonb_build_object('items',items,'required_missing',jsonb_array_length(items),'ready',native->'ready','mode','PRIVATE_DRAFT','published',false);
end $$;

create function hub.workspace_home(bud text default null,brand text default null,page_offset integer default 0,page_size integer default 25,task_kind text default null,selected_gap uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;projects jsonb:='[]';tasks jsonb:='[]';p record;r record;faq_scope record;item jsonb;readiness jsonb;preview jsonb;context jsonb;
 category text;task_id text;deadline date;today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;selected jsonb;
 total integer;task_total integer;brand_groups jsonb:='[]';bud_groups jsonb;begin
 actor:=hub.workspace_require();
 if page_offset is null or page_size is null or page_offset not between 0 and 100000 or page_size not between 1 and 100 or length(bud)>200 or length(brand)>128
  or task_kind is not null and task_kind not in ('returned','approval','publish','expiring','fact_missing','review_due','unanswered') then
  raise exception 'Invalid workspace filters' using errcode='23514';end if;
 for p in select x.*,b.public_brand_id,b.public_name brand_name,bu.rem_bu_id,bu.rem_bu_code,bu.rem_bu_name,bu.source_snapshot_at
  from hub.projects x left join hub.brands b on b.id=x.brand_id and hub.content_scope_allowed('brand',b.public_brand_id,'view')
  left join hub.workspace_project_bu() bu on bu.project_id=x.id
  where x.deleted_at is null and hub.content_scope_allowed('project',x.public_project_id,'view')
   and (bud is null or bu.rem_bu_id=bud) and (brand is null or b.public_brand_id=brand) order by x.public_project_id loop
  readiness:=hub.workspace_project_readiness(p.public_project_id);
  projects:=projects||jsonb_build_array(jsonb_build_object('ref',p.public_project_id,'name',p.public_name,'rem_project_id',p.rem_project_id,
   'brand',case when p.public_brand_id is not null then jsonb_build_object('ref',p.public_brand_id,'name',p.brand_name) end,
   'bud',case when p.rem_bu_id is not null then jsonb_build_object('id',p.rem_bu_id,'code',p.rem_bu_code,'name',p.rem_bu_name,'as_of',p.source_snapshot_at) end,'readiness',readiness));
  if hub.can('knowledge','view') then
   -- Inherited fact answers can still require a unit-specific price even when
   -- that unit has no override FAQ. Compose every current unit context.
   for faq_scope in select null::uuid id,null::text public_id union all
    select t.id,t.public_commercial_type_id from hub.commercial_types t
     where t.project_id=p.id and t.deleted_at is null and t.status<>'withdrawn' loop
   preview:=hub.compose_project_faq(p.id,'th',faq_scope.public_id,false,false);
   for item in select value from jsonb_array_elements(coalesce(preview->'cells','[]')) where value->>'state'='waiting_for_fact' loop
    for r in select value field_key from jsonb_array_elements_text(coalesce(item->'missing_fact_keys','[]')) loop
     context:=hub.workspace_context('project',p.public_project_id)||jsonb_build_object('tab',case when r.field_key='price.amount' then 'prices' else 'facts' end,'field',r.field_key,'question',item->>'question_key')||jsonb_strip_nulls(jsonb_build_object('unit_type',faq_scope.public_id));
     select context||jsonb_strip_nulls(jsonb_build_object('grain',f.grain,'item',f.id,'phase',case when f.grain like 'phase:%' then substr(f.grain,7) end)) into context
      from (select 1) seed left join lateral(select x.id,x.grain from hub.project_facts x where x.project_id=p.id and x.fact_key=r.field_key
       and x.grain in ('project','phase:'||p.rem_project_id) order by (x.grain<>'project') desc limit 1) f on true;
     -- Non-price slots share one project/phase fact across inherited unit
     -- answers. Keep separate targets only when the price belongs to a unit.
     task_id:='fact:'||p.public_project_id||':'||(item->>'question_key')||':'||r.field_key||':'||case when r.field_key='price.amount' then coalesce(faq_scope.id::text,'project') else 'project' end;
     if not exists(select 1 from jsonb_array_elements(tasks) existing where existing->>'id'=task_id) then
      tasks:=tasks||jsonb_build_array(jsonb_build_object('id',task_id,
       'category','fact_missing','kind',case when r.field_key='price.amount' then 'price' else 'fact' end,'label',jsonb_build_object('th',item->>'question_label'),
       'project',p.public_project_id,'project_name',p.public_name,'context',context));
     end if;
    end loop;
   end loop;
   end loop;
  end if;
  for r in select f.id,f.fact_key,f.grain,f.valid_to,f.as_of,c.review_every_days,c.label from hub.project_facts f join hub.field_catalog c on c.field_key=f.fact_key where f.project_id=p.id loop
   context:=hub.workspace_context('project',p.public_project_id)||jsonb_strip_nulls(jsonb_build_object('tab','facts','field',r.fact_key,'item',r.id,'grain',r.grain,
    'phase',case when r.grain like 'phase:%' then substr(r.grain,7) end,'building',case when r.grain like 'building:%' then substr(r.grain,10) end));
   for category,deadline in select 'expiring',r.valid_to union all select 'review_due',r.as_of+r.review_every_days loop
    if deadline<=today+30 then tasks:=tasks||jsonb_build_array(jsonb_build_object('id',category||':fact:'||r.id,'category',category,'kind','fact','item_id',r.id,
     'label',r.label,'project',p.public_project_id,'project_name',p.public_name,'due',deadline,'overdue',deadline<today,'context',context));end if;
   end loop;
  end loop;
 end loop;
 select tasks||coalesce(jsonb_agg(t),'[]') into tasks from hub.workspace_content_tasks(bud,brand) t;
 -- A gap contains no raw question text. Selected lookup uses the same owning
 -- permission/assignment/object guards, before task filtering and pagination.
 if hub.can('knowledge','view') then
  for r in select g.*,gp.public_project_id,gp.public_name from hub.content_gaps g join hub.projects gp on gp.rem_project_id=g.project_id
   where g.gap_code='NO_ANSWER' and g.state<>'resolved' and (g.assignee is null or g.assignee=actor)
    and gp.deleted_at is null and hub.content_scope_allowed('project',gp.public_project_id,'view')
    and (g.id=selected_gap or hub.workspace_scope_matches('project',gp.public_project_id,array[gp.rem_project_id],bud,brand)) loop
   item:=jsonb_build_object('id','gap:'||r.id,'category','unanswered','kind','gap','item_id',r.id,'label',r.public_name,'project',r.public_project_id,
    'question_text_available',false,'context',hub.workspace_context('project',r.public_project_id)||jsonb_strip_nulls(jsonb_build_object('tab','faq','gap',r.id,'question',r.question_key)),
    'occurrences',r.occurrences,'last_seen',r.last_seen);
   if r.id=selected_gap then selected:=item;end if;
   if hub.workspace_scope_matches('project',r.public_project_id,array[r.project_id],bud,brand) then tasks:=tasks||jsonb_build_array(item);end if;
  end loop;
 end if;
 for r in select b.* from hub.brands b where b.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view')
  and (brand is null or b.public_brand_id=brand) and (bud is null or exists(select 1 from jsonb_array_elements(projects) x where x#>>'{brand,ref}'=b.public_brand_id)) order by b.public_brand_id loop
  readiness:=hub.workspace_brand_readiness(r.public_brand_id);
  brand_groups:=brand_groups||jsonb_build_array(jsonb_build_object('ref',r.public_brand_id,'name',r.public_name,'readiness',readiness,
   'required_missing',readiness->'required_missing','projects',(select count(*) from jsonb_array_elements(projects) x where x#>>'{brand,ref}'=r.public_brand_id),
   'project_required_missing',(select coalesce(sum((x#>>'{readiness,required_missing}')::integer),0) from jsonb_array_elements(projects) x where x#>>'{brand,ref}'=r.public_brand_id)));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'projects',n,'required_missing',missing) order by id),'[]') into bud_groups
 from (select x#>>'{bud,id}' id,x#>>'{bud,code}' code,x#>>'{bud,name}' name,count(*) n,sum((x#>>'{readiness,required_missing}')::integer) missing
  from jsonb_array_elements(projects) x where x->'bud'<>'null'::jsonb group by x#>>'{bud,id}',x#>>'{bud,code}',x#>>'{bud,name}') grouped;
 total:=jsonb_array_length(projects);
 select coalesce(jsonb_agg(value),'[]') into projects from (select value from jsonb_array_elements(projects) with ordinality order by ordinality offset page_offset limit page_size) bounded;
 select count(*) into task_total from jsonb_array_elements(tasks) x where task_kind is null or x->>'category'=task_kind;
 select coalesce(jsonb_agg(value),'[]') into tasks from (select value from jsonb_array_elements(tasks) where task_kind is null or value->>'category'=task_kind
  order by case value->>'category' when 'returned' then 0 when 'approval' then 1 when 'publish' then 2 else 3 end,value->>'due',value->>'id' offset page_offset limit page_size) bounded;
 return jsonb_build_object('projects',projects,'project_total',total,'tasks',tasks,'task_total',task_total,'selected_gap',selected,
  'brands',brand_groups,'buds',bud_groups,'offset',page_offset,'limit',page_size,'as_of',current_timestamp);
end $$;

revoke all on function hub.content_scope_allowed(text,text,text),hub.workspace_require(),hub.workspace_project_bu(),
 hub.workspace_search(text,integer),hub.workspace_faq_allowed(uuid),hub.workspace_context(text,text),hub.workspace_scope_matches(text,text,text[],text,text),
 hub.workspace_native_rows(),hub.workspace_review_rows(),hub.workspace_native_publishable(jsonb),hub.workspace_content_tasks(text,text),
 hub.workspace_project_readiness(text),hub.workspace_brand_readiness(text),hub.workspace_home(text,text,integer,integer,text,uuid) from public;
grant execute on function hub.workspace_search(text,integer),hub.workspace_home(text,text,integer,integer,text,uuid) to hub_app;
commit;
