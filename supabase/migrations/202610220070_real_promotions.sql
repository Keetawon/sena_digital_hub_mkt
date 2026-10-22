-- C5 real promotions retain the existing local/hosted-test environment guard,
-- DATA + LEGAL evidence, immutable versions, expiry and source-offer checks.
begin;
alter table hub.public_promotions drop constraint public_promotions_synthetic_check;
alter table hub.public_promotions
 add column audience text not null default 'general' check(audience in ('general','investor','livnex')),
 add column targets jsonb not null default '[]' check(jsonb_typeof(targets)='array' and jsonb_array_length(targets)<=100),
 add column booking_from date,add column booking_to date,add column transfer_from date,add column transfer_to date,
 add column editors uuid[] not null default '{}',
 add constraint promotion_booking_window check((booking_from is null and booking_to is null) or (booking_from is not null and booking_to is not null and booking_to>=booking_from)),
 add constraint promotion_transfer_window check((transfer_from is null and transfer_to is null) or (transfer_from is not null and transfer_to is not null and transfer_to>=transfer_from));

create function hub.promotion_references() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('promotions','view');
 return jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'public_id',public_project_id,'label',public_name) order by public_project_id) from hub.projects where deleted_at is null and hub.can('projects','view')),'[]'),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('id',id,'public_id',public_brand_id,'label',public_name) order by public_brand_id) from hub.brands where deleted_at is null and hub.can('brands','view')),'[]'),
  'commercial_types',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'public_id',c.public_commercial_type_id,'label',c.public_name,'project_id',p.public_project_id) order by c.public_commercial_type_id) from hub.commercial_types c join hub.projects p on p.id=c.project_id where c.deleted_at is null and p.deleted_at is null and hub.can('projects','view')),'[]'));
end $$;
create function hub.validate_promotion_targets(items jsonb) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare item jsonb;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>100 or
  (select count(*)<>count(distinct value) from jsonb_array_elements(items)) then raise exception 'Invalid promotion targets' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2 or not item?'type' or not item?'id' then raise exception 'Invalid promotion target' using errcode='23514';end if;
  if item->>'type'='project' then
   perform hub.require_permission('projects','view');
   if not exists(select 1 from hub.projects where id=(item->>'id')::uuid and deleted_at is null) then raise exception 'Project target not found' using errcode='23514';end if;
  elsif item->>'type'='brand' then
   perform hub.require_permission('brands','view');
   if not exists(select 1 from hub.brands where id=(item->>'id')::uuid and deleted_at is null) then raise exception 'Brand target not found' using errcode='23514';end if;
  elsif item->>'type'='commercial_type' then
   perform hub.require_permission('projects','view');
   if not exists(select 1 from hub.commercial_types c join hub.projects p on p.id=c.project_id where c.id=(item->>'id')::uuid and c.deleted_at is null and p.deleted_at is null) then raise exception 'Unit type target not found' using errcode='23514';end if;
  else raise exception 'Invalid promotion scope' using errcode='23514';end if;
 end loop;
end $$;
create function hub.promotion_target_projects(p_id uuid) returns table(id uuid,public_id text)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select distinct p.id,p.public_project_id from hub.public_promotions promo join hub.projects p on p.deleted_at is null and
 (p.id=promo.project_id or exists(select 1 from jsonb_array_elements(promo.targets) t where
  t->>'type'='project' and t->>'id'=p.id::text or t->>'type'='brand' and t->>'id'=p.brand_id::text
  or t->>'type'='commercial_type' and exists(select 1 from hub.commercial_types c where c.project_id=p.id and c.id::text=t->>'id' and c.deleted_at is null)))
 where promo.id=p_id
$$;
create function hub.promotion_banners(p_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'mime_type',a.mime_type,'public_url',a.public_url,'alt_text',a.alt_text,'caption',a.caption,
  'effective_from',greatest(l.effective_from,p.starts_at),'effective_to',least(l.effective_to,p.ends_at),
  'ai_exposure',case when 'web_only' in (l.ai_exposure,a.ai_exposure) then 'web_only' else 'open' end) order by l.sort,l.id),'[]')
 from hub.asset_links l join hub.assets a on a.id=l.asset_id join hub.public_promotions p on p.id=p_id
 where l.target_type='promotion' and l.target_key=p_id::text and l.deleted_at is null and l.usage='banner' and l.ai_exposure<>'internal'
  and a.media_category='promotion_ad' and a.metadata_state='confirmed' and a.marketing_publication and a.ai_exposure<>'internal'
  and a.deleted_at is null and a.rights_status='approved'
$$;
-- Preserve function OIDs and every prior dispatcher guard.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure);
 d:=replace(d,'''project_id'',''code'',''title''','''synthetic'',''project_id'',''code'',''title''');
 d:=replace(d,'''ends_at'',''source_offer_key'']','''ends_at'',''source_offer_key'',''audience'',''targets'',''booking_from'',''booking_to'',''transfer_from'',''transfer_to'']');
 d:=replace(d,'''Synthetic promotion draft''','''Promotion draft''');
 d:=replace(d,'perform hub.validate_promotion(merged);','perform hub.validate_promotion(merged); if p?''targets'' then perform hub.validate_promotion_targets(p->''targets'');end if;');
 d:=replace(d,'created_by,updated_by,demo_fields)', 'created_by,updated_by,demo_fields,synthetic,audience,targets,booking_from,booking_to,transfer_from,transfer_to,editors)');
 d:=replace(d,'actor,actor,array[''promotion'',''review_evidence''])',
  'actor,actor,case when coalesce((p->>''synthetic'')::boolean,true) then array[''promotion'',''review_evidence''] else array[]::text[] end,
   coalesce((p->>''synthetic'')::boolean,true),coalesce(p->>''audience'',''general''),coalesce(p->''targets'',''[]''),
   (p->>''booking_from'')::date,(p->>''booking_to'')::date,(p->>''transfer_from'')::date,(p->>''transfer_to'')::date,array[actor])');
 d:=replace(d,'source_offer_key=merged->>''source_offer_key'',draft_revision=draft_revision+1',
  'source_offer_key=merged->>''source_offer_key'',audience=merged->>''audience'',targets=merged->''targets'',
   booking_from=(merged->>''booking_from'')::date,booking_to=(merged->>''booking_to'')::date,transfer_from=(merged->>''transfer_from'')::date,transfer_to=(merged->>''transfer_to'')::date,
   editors=array(select distinct e from unnest(r.editors||array[r.created_by,actor]) e where e is not null),draft_revision=draft_revision+1');
 d:=replace(d,'elsif action=''review'' then',
  'elsif action=''review'' then
   if not r.synthetic and p->>''decision''=''APPROVED'' and actor=any(r.editors||array[r.created_by]) then raise exception ''Another person must review this revision'' using errcode=''42501'';end if;');
 d:=replace(d,'if action=''publish'' then',
  'if action=''publish'' then
   if not r.synthetic and actor=any(r.editors||array[r.created_by]) then raise exception ''Another person must publish this revision'' using errcode=''42501'';end if;');
 if strpos(d,'booking_from=(merged')=0 or strpos(d,'array[actor]) returning')=0 then raise exception 'Promotion dispatcher extension did not match';end if;
 execute d;
 d:=pg_get_functiondef('hub.promotion_payload(uuid)'::regprocedure);
 d:=replace(d,'''created_by'',''created_at'',''updated_by'',''updated_at'',''published_version_id''', '''created_by'',''created_at'',''updated_by'',''updated_at'',''published_version_id'',''editors''');
 d:=replace(d,'''applies_via'',jsonb_build_object',
  '''target_project_ids'',(select jsonb_agg(public_id order by public_id) from hub.promotion_target_projects(p.id)),
   ''public_targets'',coalesce((select jsonb_agg(jsonb_build_object(''type'',t->>''type'',''public_id'',case t->>''type''
    when ''project'' then (select public_project_id from hub.projects where id=(t->>''id'')::uuid and deleted_at is null)
    when ''brand'' then (select public_brand_id from hub.brands where id=(t->>''id'')::uuid and deleted_at is null)
    when ''commercial_type'' then (select public_commercial_type_id from hub.commercial_types where id=(t->>''id'')::uuid and deleted_at is null) end)) from jsonb_array_elements(p.targets) t),''[]''),
   ''banners'',hub.promotion_banners(p.id),''applies_via'',jsonb_build_object');execute d;
 d:=pg_get_functiondef('hub.promotion_readiness(jsonb)'::regprocedure);
 d:=replace(d,'return jsonb_build_object(''ready'',',
  'if payload->>''synthetic''=''false'' then
   foreach field in array array[''title'',''summary'',''conditions_public'',''legal_terms'',''disclaimer''] loop
    if not hub.translation_complete(''promotion'',payload->>''id'',''promotion.''||field,payload->field) then
     missing:=missing||jsonb_build_array(jsonb_build_object(''field'',field||''.en'',''message'',''ต้องตรวจภาษาอังกฤษของฉบับนี้ด้วยตนเอง''));end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(payload->''public_targets'') t where t->>''public_id'' is null) then
    missing:=missing||jsonb_build_array(jsonb_build_object(''field'',''targets'',''message'',''ขอบเขตโปรโมชันไม่พร้อมใช้งาน''));end if;
  end if;
  return jsonb_build_object(''ready'',');execute d;
 d:=pg_get_functiondef('hub.promotion_read(uuid,jsonb)'::regprocedure);
 d:=replace(d,'''reviews'',coalesce', '''translations'',hub.content_translation_list(''promotions'',p.id::text),''reviews'',coalesce');execute d;
end $$;

-- Freeze the resolved projects and public scope labels in each published version.
-- Existing versions without the new fields keep their original project scope.
create or replace view public_api.promotions with(security_barrier=true) as
with eligible as (
 select p.id promotion_id,project.id project_id,project.public_project_id,p.code,v.id version_id,
  v.payload||jsonb_build_object('public_project_id',project.public_project_id,'banners',
   coalesce((select jsonb_agg(b||jsonb_build_object('ai_exposure',case when a.ai_exposure='web_only' then 'web_only' else b->>'ai_exposure' end))
    from jsonb_array_elements(coalesce(v.payload->'banners','[]')) b join hub.assets a on a.id=(b->>'id')::uuid
    where a.deleted_at is null and a.rights_status='approved' and a.media_category='promotion_ad' and a.ai_exposure<>'internal' and a.marketing_publication
    and (a.effective_from is null or a.effective_from<=now()) and (a.effective_to is null or a.effective_to>now())
    and (b->>'effective_from' is null or (b->>'effective_from')::timestamptz<=now()) and (b->>'effective_to' is null or (b->>'effective_to')::timestamptz>now())),'[]')) payload,v.published_at,
  (v.payload->>'priority')::integer priority,(v.payload->>'stackable')::boolean stackable,v.payload->>'benefit_type' benefit_type
 from hub.public_promotions p join hub.promotion_versions v on v.id=p.published_version_id and v.promotion_id=p.id
 cross join lateral jsonb_array_elements_text(coalesce(v.payload->'target_project_ids',jsonb_build_array(v.payload->>'public_project_id'))) scope(public_id)
 join hub.projects project on project.public_project_id=scope.public_id join public_api.projects live on live.public_project_id=project.public_project_id
 where hub.promotion_approvals_ok(p.id,v.draft_revision) and (v.payload->>'starts_at')::timestamptz<=now() and now()<(v.payload->>'ends_at')::timestamptz
  and (v.payload->>'source_offer_key' is null or exists(select 1 from staging.source_offers s where s.source_offer_key=v.payload->>'source_offer_key' and s.source_active and not s.source_deleted))
), ranked as(select *,row_number() over(partition by project_id,benefit_type order by priority,promotion_id) position,
 first_value(stackable) over(partition by project_id,benefit_type order by priority,promotion_id) winner_stackable from eligible)
select promotion_id,project_id,public_project_id,code,version_id,payload,published_at,priority,stackable,benefit_type from ranked
 where(position=1 and not winner_stackable) or(winner_stackable and stackable);

do $$ declare d text;begin
 d:=pg_get_functiondef('hub.public_content_payload(text,jsonb)'::regprocedure);
 d:=replace(d,'''stackable'',''rag_eligible'',''synthetic'']','''stackable'',''rag_eligible'',''synthetic'',''audience'',''booking_from'',''booking_to'',''transfer_from'',''transfer_to'']');
 d:=replace(d,'if kind=''asset'' then',
  'if kind=''promotion'' and payload?''public_targets'' then
   result:=result||jsonb_build_object(''targets'',payload->''public_targets'',''banners'',coalesce((select jsonb_agg(hub.public_content_payload(''asset'',b)) from jsonb_array_elements(coalesce(payload->''banners'',''[]'')) b),''[]''));end if;
   if kind=''asset'' then');execute d;
 d:=pg_get_functiondef('public_api.asset_file(uuid)'::regprocedure);
 d:=replace(d,') eligible where eligible.asset_id=a.id::text)',
  'union all select item->>''id'' from public_api.promotions p,jsonb_array_elements(coalesce(p.payload->''banners'',''[]'')) item
   ) eligible where eligible.asset_id=a.id::text)');execute d;
end $$;

-- Banner edits invalidate review just like text/scope changes. A published
-- snapshot retains its own links until replaced or explicitly withdrawn.
create function hub.promotion_banner_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare target uuid;actor uuid;begin
 actor:=hub.permission_actor();
 for target in select distinct value::uuid from unnest(array[
  case when tg_op<>'INSERT' and old.target_type='promotion' then old.target_key end,
  case when tg_op<>'DELETE' and new.target_type='promotion' then new.target_key end]) value where value is not null loop
  perform hub.require_permission('promotions','edit');
  update hub.public_promotions set draft_revision=draft_revision+1,editors=array(select distinct e from unnest(editors||array[created_by,actor]) e where e is not null) where id=target;
 end loop;
 return coalesce(new,old);
end $$;
create trigger promotion_banner_revision after insert or update or delete on hub.asset_links for each row execute function hub.promotion_banner_changed();

update hub.field_catalog set status='active',help='{"th":"โปรโมชันจริงต้องผ่านการตรวจ DATA และ LEGAL ของรุ่นนี้ คำแปลกฎหมาย/เงื่อนไขกรอกและตรวจเอง ไม่ส่ง AI"}' where entity='promotion';
update hub.field_catalog set locales_required=array['th','en'],required_for='{"all":"required"}',validation='{"ai_translation":false,"max_length":20000}'
 where field_key in ('promotion.title','promotion.summary','promotion.conditions_public','promotion.legal_terms','promotion.disclaimer');
create function hub.track_promotion_translation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare key text;value jsonb:=to_jsonb(new);prior jsonb:='{}';begin
 if tg_op='UPDATE' then prior:=to_jsonb(old);end if;
 foreach key in array array['title','summary','conditions_public','legal_terms','disclaimer'] loop
  if value->key is distinct from prior->key then perform hub.sync_content_translation('promotion',new.id::text,'promotion.'||key,'promotions',new.id::text,jsonb_build_object('id',new.id,'project_id',new.project_id),value->key);end if;
 end loop;return new;
end $$;
create trigger promotion_translation after insert or update on hub.public_promotions for each row execute function hub.track_promotion_translation();
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.content_fields()'::regprocedure);
 d:=replace(d,'hub.can(''knowledge'',''view'')) then','hub.can(''knowledge'',''view'') or hub.can(''promotions'',''view'')) then');
 d:=replace(d,'where status<>''retired''','where status<>''retired'' and (hub.can(''projects'',''view'') or hub.can(''brands'',''view'') or hub.can(''knowledge'',''view'') or entity=''promotion'')');
 d:=replace(d,'where status=''active''','where status=''active'' and (hub.can(''projects'',''view'') or hub.can(''brands'',''view'') or hub.can(''knowledge'',''view''))');execute d;
 d:=pg_get_functiondef('hub.translation_editable(hub.content_translations)'::regprocedure);
 d:=replace(d,'return t.owner_type in','if t.owner_type=''promotion'' then return exists(select 1 from hub.public_promotions where id=t.owner_key::uuid);end if;return t.owner_type in');execute d;
 d:=pg_get_functiondef('hub.review_content_translation(uuid,integer,integer,text)'::regprocedure);
 d:=replace(d,'elsif t.owner_type=''brand'' then perform',
  'elsif t.owner_type=''promotion'' then
    perform 1 from hub.projects where id=(t.row_ref->>''project_id'')::uuid for update;
    perform 1 from hub.public_promotions where id=t.owner_key::uuid for update;
   elsif t.owner_type=''brand'' then perform');
 d:=replace(d,'else raise exception ''Unsupported translation target''',
  'elsif t.owner_type=''promotion'' then
   if col not in (''title'',''summary'',''conditions_public'',''legal_terms'',''disclaimer'') then raise exception ''Invalid promotion text'' using errcode=''23514'';end if;
   perform hub.residential_environment();
   execute format(''update hub.public_promotions set %I=jsonb_set(%I,''''{en}'''',to_jsonb($1::text),true),draft_revision=draft_revision+1,
    editors=array(select distinct e from unnest(editors||array[created_by,$3]) e where e is not null) where id=$2'',col,col) using english,t.owner_key::uuid,actor;
   else raise exception ''Unsupported translation target''');execute d;
end $$;

-- The existing price/media pickers use the same real target resolution.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.save_project_price(text,uuid,timestamptz,jsonb)'::regprocedure);
 d:=replace(d,'id=edited.promotion_id and project_id=p.id','id=edited.promotion_id and exists(select 1 from hub.promotion_target_projects(edited.promotion_id) scope where scope.id=p.id)');execute d;
 d:=pg_get_functiondef('hub.unit_type_workspace(text)'::regprocedure);
 d:=replace(d,'from hub.public_promotions where project_id=p.id','from hub.public_promotions promo where exists(select 1 from hub.promotion_target_projects(promo.id) scope where scope.id=p.id)');execute d;
 d:=pg_get_functiondef('hub.media_target(uuid,text,text,text)'::regprocedure);
 d:=replace(d,'from hub.public_promotions where project_id=project_uuid and id::text=key','from hub.public_promotions promo where id::text=key and exists(select 1 from hub.promotion_target_projects(promo.id) scope where scope.id=project_uuid)');execute d;
 d:=pg_get_functiondef('hub.project_media(text)'::regprocedure);
 d:=replace(d,'from hub.public_promotions where project_id=p.id and hub.can','from hub.public_promotions promo where exists(select 1 from hub.promotion_target_projects(promo.id) scope where scope.id=p.id) and hub.can');execute d;
 d:=pg_get_functiondef('hub.media_checklist(text)'::regprocedure);
 d:=replace(d,'from hub.public_promotions where project_id=project_uuid and starts_at','from hub.public_promotions promo where exists(select 1 from hub.promotion_target_projects(promo.id) scope where scope.id=project_uuid) and starts_at');
 d:=replace(d,'from hub.asset_links where project_id=project_uuid and deleted_at is null',
  'from hub.asset_links where (project_id=project_uuid or target_type=''promotion'' and exists(select 1 from hub.promotion_target_projects(case when target_type=''promotion'' then target_key::uuid end) scope where scope.id=project_uuid)) and deleted_at is null');execute d;
end $$;
revoke all on function hub.promotion_references(),hub.validate_promotion_targets(jsonb),hub.promotion_target_projects(uuid),hub.promotion_banners(uuid),hub.promotion_banner_changed(),hub.track_promotion_translation() from public;
grant execute on function hub.promotion_references() to hub_app;
comment on table hub.public_promotions is 'Real or explicitly synthetic local/hosted-test promotions. DATA and LEGAL review, immutable release snapshots. Never RAG.';
commit;
