-- W3.1: owner-authorized defaults for new suggestion decisions and compact
-- private read projections. No existing content or history is rewritten.
begin;

do $migration$ declare d text:=pg_get_functiondef('hub.website_content_sources(text)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$'section_key',hub.website_text_key(k.evidence->>'website_item_kind'),$old$,$new$'default_ai_exposure',(select default_ai_exposure from hub.field_catalog where field_key=hub.website_text_key(k.evidence->>'website_item_kind') and status='active'),
  'section_key',hub.website_text_key(k.evidence->>'website_item_kind'),$new$);
 d:=hub.content_definition_replace(d,$old$and hub.website_text_key(k.evidence->>'website_item_kind') is not null$old$,$new$and exists(select 1 from hub.field_catalog where field_key=hub.website_text_key(k.evidence->>'website_item_kind') and status='active')$new$);
 execute d;
end $migration$;

do $migration$ declare d text:=pg_get_functiondef('hub.website_text_decide(text,uuid,bigint,text,integer,jsonb,text)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$event bigint;begin$old$,$new$event bigint;exposure text;begin$new$);
 d:=hub.content_definition_replace(d,$old$  select * into prior from hub.content_sections where scope_type='project' and scope_id=public_id and section_key=key;$old$,$new$  select default_ai_exposure into exposure from hub.field_catalog where field_key=key and status='active' for share;
  if exposure is null or exposure not in ('open','web_only','internal') then
   raise exception 'Active field exposure default required' using errcode='23514';end if;
  if changes ? 'ai_exposure' and (changes->>'ai_exposure' is null or changes->>'ai_exposure' not in ('open','web_only','internal')
   or array_position(array['internal','web_only','open'],changes->>'ai_exposure')>array_position(array['internal','web_only','open'],exposure)) then
   raise exception 'Suggestion exposure cannot exceed the field default' using errcode='23514';end if;
  select * into prior from hub.content_sections where scope_type='project' and scope_id=public_id and section_key=key;$new$);
 d:=hub.content_definition_replace(d,$old$'ai_exposure',coalesce((select ai_exposure from hub.content_section_versions where id=prior.draft_version_id),'internal')$old$,$new$'ai_exposure',exposure$new$);
 d:=hub.content_definition_replace(d,$old$  perform set_config('app.change_reason',coalesce(reason,''),true);$old$,$new$  body:=body||jsonb_build_object('ai_exposure',exposure);
  perform set_config('app.change_reason',coalesce(reason,''),true);$new$);
 execute d;
end $migration$;

-- Called only after the existing workspace source guard. Scope every name to
-- that resolved project; never expose raw UUIDs as human context labels.
create function hub.workspace_item_context(project uuid,item jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare target jsonb:=item->'target';label jsonb;kind text;key text;begin
 if project is null then return item;end if;
 if item->>'code' like 'selling_point.%' and target->>'item' is not null then
  select to_jsonb(n.ordinal::text) into label from (
   select point_key,row_number() over(order by sort,point_key) ordinal from (
    select distinct on(point_key) point_key,sort,state from hub.project_selling_points
    where project_id=project order by point_key,revision desc) latest where state<>'WITHDRAWN') n
   where n.point_key::text=target->>'item';kind:='selling_point';
 elsif target->>'building' is not null then
  select coalesce(nullif(name,'{}'),to_jsonb(building_key)) into label from hub.project_buildings
   where project_id=project and building_key=target->>'building';kind:='building';
 elsif target->>'unit_type' is not null then
  select coalesce(nullif(public_name,'{}'),to_jsonb(public_commercial_type_id)) into label from hub.commercial_types
   where project_id=project and public_commercial_type_id=target->>'unit_type' and deleted_at is null;
  kind:=case when item->>'code' like 'price.%' then 'price' else 'unit_type' end;
  if kind='price' then
   select jsonb_build_object('th',coalesce(label->>'th',label#>>'{}','')||' · '||concat_ws(' – ',valid_from,valid_to)) into label
    from hub.project_prices where project_id=project and id::text=target->>'item';
  end if;
 elsif target#>>'{media_slot,target_type}'='building' then
  select coalesce(nullif(name,'{}'),to_jsonb(building_key)) into label from hub.project_buildings
   where project_id=project and building_key=target#>>'{media_slot,target_key}';kind:='building';
 elsif target#>>'{media_slot,target_type}'='commercial_type' then
  select coalesce(nullif(public_name,'{}'),to_jsonb(public_commercial_type_id)) into label from hub.commercial_types
   where project_id=project and id::text=target#>>'{media_slot,target_key}' and deleted_at is null;kind:='unit_type';
 end if;
 if label is null or label='null'::jsonb then return item;end if;
 return item||jsonb_build_object('context',jsonb_build_object('kind',kind,'label',label));
end $$;
revoke all on function hub.workspace_item_context(uuid,jsonb) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;

-- Private presentation after the caller's source guard. Canonical bindings
-- inherit their parent setting; context links keep their independent setting.
-- A pinned publication caller supplies the exact dependency value itself.
create function hub.content_exposure(kind text,source jsonb,version jsonb default null,pinned boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare value text:=coalesce(version->>'ai_exposure',version#>>'{metadata,ai_exposure}',
 version#>>'{payload,ai_exposure}',source->>'ai_exposure');editor jsonb;begin
 if kind in ('project_asset','brand_asset','type_asset') then
  editor:=jsonb_build_object('kind','asset','identity',jsonb_build_object('id',source->>'asset_id'));
  if not pinned then select ai_exposure into value from hub.assets where id=(source->>'asset_id')::uuid and deleted_at is null;end if;
 elsif kind='media_target' then
  editor:=jsonb_build_object('kind','media_link','identity',jsonb_build_object('id',source->>'media_link_id'));
  if not pinned then select ai_exposure into value from hub.media_links where id=(source->>'media_link_id')::uuid;end if;
 elsif kind in ('asset','asset_context','media_link') then
  editor:=jsonb_build_object('kind',kind,'identity',jsonb_build_object('id',source->>'id'));
 end if;
 return jsonb_build_object('ai_exposure',case when value in ('open','web_only','internal') then value end,
  'exposure_policy',case when value in ('open','web_only','internal') then 'stored' else 'source' end,
  'exposure_editor',editor);
end $$;
revoke all on function hub.content_exposure(text,jsonb,jsonb,boolean) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;

do $migration$ declare d text:=pg_get_functiondef('hub.workspace_page(text,text,text)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$for r in select value data from jsonb_array_elements(s.records) loop$old$,$new$for r in select value data,ordinality display_number from jsonb_array_elements(s.records) with ordinality loop$new$);
 d:=hub.content_definition_replace(d,$old$'code',item->>'field_key','label',item->'label','state','missing','target',target));$old$,$new$'code',item->>'field_key','label',item->'label','state','missing','target',target,'context',jsonb_build_object('kind','record','label',r.display_number::text)));$new$);
 d:=hub.content_definition_replace(d,$old$for s in select cs.*,v.state version_state$old$,$new$for s in select cs.*,v.state version_state,v.ai_exposure version_exposure$new$);
 d:=hub.content_definition_replace(d,$old$entry:=jsonb_build_object('key',s.section_key,$old$,$new$entry:=jsonb_build_object('ai_exposure',s.version_exposure,'key',s.section_key,$new$);
 d:=hub.content_definition_replace(d,$old$jsonb_build_object('code',s.section_key,'state',$old$,$new$jsonb_build_object('code',s.section_key,'label',(select label from hub.field_catalog where field_key=s.section_key),'state',$new$);
 d:=hub.content_definition_replace(d,$old$hub.content_history(kind,ref,null,50)$old$,$new$hub.content_history(kind,ref,null,5)$new$);
 d:=hub.content_definition_replace(d,$old$ return jsonb_build_object('entity',jsonb_build_object('kind',kind,'ref',ref,'name',hub.workspace_name$old$,$new$ select coalesce(jsonb_agg(hub.workspace_item_context(p.id,x) order by n),'[]') into required from jsonb_array_elements(required) with ordinality rows(x,n);
 select coalesce(jsonb_agg(hub.workspace_item_context(p.id,x) order by n),'[]') into recommended from jsonb_array_elements(recommended) with ordinality rows(x,n);
 select coalesce(jsonb_agg(hub.workspace_item_context(p.id,x) order by n),'[]') into tasks from jsonb_array_elements(tasks) with ordinality rows(x,n);
 return jsonb_build_object('entity',jsonb_build_object('kind',kind,'ref',ref,'name',hub.workspace_name$new$);
 execute d;
end $migration$;

do $migration$ declare d text:=pg_get_functiondef('hub.content_workflow_read(text,jsonb)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$ return jsonb_build_object('kind',kind,'identity',identity,'source_tab'$old$,$new$ return hub.content_exposure(kind,source,case when kind in ('faq','section','article') then version end)||jsonb_build_object(
  'exposure_target',nullif(hub.publication_workflow_descriptor(kind,identity)->'target','null'::jsonb)-'version'||jsonb_build_object('field','ai_exposure'),
  'kind',kind,'identity',identity,'source_tab'$new$);
 execute d;
end $migration$;

do $migration$ declare d text:=pg_get_functiondef('hub.content_workflow_items(text,text,text,text,integer)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$'state',metadata->'state','can_submit'$old$,$new$'ai_exposure',metadata->'ai_exposure','exposure_policy',metadata->'exposure_policy','exposure_editor',metadata->'exposure_editor','exposure_target',metadata->'exposure_target',
    'state',metadata->'state','can_submit'$new$);
 execute d;
end $migration$;

do $migration$ declare d text:=pg_get_functiondef('hub.publication_workflow_descriptor(text,jsonb)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$ return jsonb_build_object('label',label,'target',target,'workflow'$old$,$new$ return hub.content_exposure(kind,source,case when kind in ('faq','section','article') then version end)||jsonb_build_object(
  'exposure_target',target-'version'||jsonb_build_object('field','ai_exposure'),
  'label',label,'target',target,'workflow'$new$);
 execute d;
end $migration$;

do $migration$ declare d text:=pg_get_functiondef('hub.publication_item_descriptor(jsonb)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$result jsonb;name text;begin$old$,$new$result jsonb;name text;included jsonb;exposure_row jsonb;begin$new$);
 d:=hub.content_definition_replace(d,$old$  return result||jsonb_build_object('item_key',$old$,$new$  exposure_row:=null;
  for included in select d from jsonb_array_elements(coalesce(value->'dependencies',value->'_page_dependencies','[]')) d
   order by case when d->>'table' like '%versions' then 0 else 1 end loop
   if included->>'table' is distinct from hub.content_workflow_table(kind) and included->>'table' is distinct from
    (case kind when 'faq' then 'faq_versions' when 'section' then 'content_section_versions' when 'article' then 'article_versions'
     when 'unit_type' then 'commercial_type_versions' when 'price' then 'project_price_versions'
     when 'disclosure' then 'project_commercial_versions' when 'sales_term' then 'project_commercial_versions'
     when 'programme' then 'project_commercial_versions' when 'progress' then 'project_commercial_versions' end) then continue;end if;
   row_data:=hub.publication_pinned_source(included);
   if row_data is null and included->>'table' like '%versions' then row_data:=hub.web_source(included->>'table',included->'identity');end if;
   if row_data is not null then exposure_row:=row_data;end if;
   if row_data ? 'ai_exposure' or row_data#>'{metadata,ai_exposure}' is not null or row_data#>'{payload,ai_exposure}' is not null then exit;end if;
  end loop;
  if kind in ('project_asset','brand_asset','type_asset','media_target') then
   exposure_row:=exposure_row||jsonb_build_object('ai_exposure',null);
   for included in select d from jsonb_array_elements(coalesce(value->'dependencies',value->'_page_dependencies','[]')) d where
    (kind in ('project_asset','brand_asset','type_asset') and d->>'table'='assets' and d#>>'{identity,id}'=exposure_row->>'asset_id')
    or (kind='media_target' and d->>'table'='media_links' and d#>>'{identity,id}'=exposure_row->>'media_link_id') loop
    row_data:=hub.publication_pinned_source(included);
    exposure_row:=exposure_row||jsonb_build_object('ai_exposure',row_data->'ai_exposure');exit;
   end loop;
  end if;
  result:=result||hub.content_exposure(kind,exposure_row,exposure_row,true);
  return result||jsonb_build_object('item_key',$new$);
 execute d;
end $migration$;

do $migration$ declare d text:=pg_get_functiondef('hub.workspace_faq(text,text,text,text,text,integer,text)'::regprocedure);begin
 d:=hub.content_definition_replace(d,$old$'version_id',v.id,'question',v.question$old$,$new$'version_id',v.id,'ai_exposure',v.ai_exposure,'question',v.question$new$);
 execute d;
end $migration$;

-- A normal, exact-revision draft save for the missing media exposure
-- controls. Keep the existing source conjunctions and frozen-review triggers.
create function hub.content_workflow_exposure_save(kind text,identity jsonb,expected_hash text,exposure text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;ref text;begin
 if kind is null or kind not in ('asset','asset_context','media_link') or exposure is null or exposure not in ('open','web_only','internal') then
  raise exception 'Invalid exposure edit' using errcode='23514';end if;
 source:=hub.content_workflow_lock(kind,identity,expected_hash,'edit');
 if kind='asset' then
  perform hub.media_require_asset_edit((identity->>'id')::uuid);
  if source->>'media_category'='legal_document' and exposure<>'internal' then
   raise exception 'Legal documents must remain internal' using errcode='23514';end if;
  if source->>'ai_exposure' is distinct from exposure then
   update hub.assets set ai_exposure=exposure,media_revision=media_revision+1 where id=(identity->>'id')::uuid;
  end if;
 else
  select public_project_id into strict ref from hub.projects where id=(source->>'project_id')::uuid and deleted_at is null;
  if kind='asset_context' then
   perform hub.media_link_save(ref,(identity->>'id')::uuid,(source->>'revision')::integer,jsonb_build_object('ai_exposure',exposure));
  else
   perform hub.media_clip_save(ref,(identity->>'id')::uuid,(source->>'revision')::integer,jsonb_build_object('ai_exposure',exposure));
  end if;
 end if;
 return hub.content_workflow_read(kind,identity);
end $$;
revoke all on function hub.content_workflow_exposure_save(text,jsonb,text,text) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
grant execute on function hub.content_workflow_exposure_save(text,jsonb,text,text) to hub_app;

commit;
