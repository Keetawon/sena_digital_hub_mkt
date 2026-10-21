-- Programme Phase 1 (D4). Project/brand versions and account state are unchanged.
begin;

create function hub.public_content_payload(kind text, payload jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare fields text[]; result jsonb; item jsonb; items jsonb; field text; public_digest text; stored boolean;
begin
 if payload is null or payload='null'::jsonb then return null; end if;
 fields:=case kind
  when 'project' then array['public_project_id','public_name','slug','address','latitude','longitude',
   'ad_disclaimer','meta_title','meta_description','effective_from','effective_to','model_catalogue_complete']
  when 'brand' then array['public_brand_id','public_name','description','slug','status','version_no','published_at']
  when 'model' then array['public_model_id','public_name','bedrooms','bathrooms','usable_area_sqm','parking_spaces']
  when 'asset' then array['asset_role','is_primary','alt_text','display_order','public_model_id','mime_type','effective_from','effective_to']
  when 'promotion' then array['code','public_project_id','title','summary','conditions_public','legal_terms','disclaimer',
   'benefit_type','benefit_value','benefit_unit','starts_at','ends_at','priority','stackable','rag_eligible','synthetic']
  else null end;
 if fields is null then raise exception 'Unknown public content kind' using errcode='22023'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into result from jsonb_each(payload) where key=any(fields);
 if payload?'demo_mode' or payload?'demo_fields' then
  result:=result||jsonb_build_object('synthetic',coalesce((payload->>'demo_mode')::boolean,false)
   or jsonb_array_length(coalesce(payload->'demo_fields','[]'))>0);
 end if;
 foreach field in array array['public_name','description','address','ad_disclaimer','meta_title','meta_description',
  'alt_text','title','summary','conditions_public','legal_terms','disclaimer'] loop
  if result?field then
   result:=jsonb_set(result,array[field],coalesce((select jsonb_object_agg(key,value)
    from jsonb_each(coalesce(nullif(result->field,'null'::jsonb),'{}')) where key in ('th','en')),'{}'));
  end if;
 end loop;
 if kind='asset' then
  select coalesce(a.checksum,encode(sha256(convert_to(a.id::text,'UTF8')),'hex')),a.storage_path is not null
   into public_digest,stored from hub.assets a where a.id=(payload->>'id')::uuid;
  if public_digest is null then return null; end if;
  result:=result||jsonb_build_object('public_asset_id','ast_'||public_digest,'public_url',
   case when stored then '/v1/assets/ast_'||public_digest||'/file'
    when payload->>'public_url' !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then payload->>'public_url' end);
 end if;
 if kind in ('project','brand') then
  items:='[]';
  for item in select value from jsonb_array_elements(coalesce(payload->'assets','[]')) loop
   item:=hub.public_content_payload('asset',item);
   if item is not null then items:=items||jsonb_build_array(item); end if;
  end loop;
  result:=result||jsonb_build_object('assets',items);
 end if;
 if kind='project' then
  select coalesce(jsonb_agg(hub.public_content_payload('model',value)),'[]') into items
   from jsonb_array_elements(coalesce(payload->'models','[]'));
  result:=result||jsonb_build_object('models',items,'brand',hub.public_content_payload('brand',payload->'brand'));
 end if;
 return result;
end $$;
revoke all on function hub.public_content_payload(text,jsonb) from public;

-- The raw views remain private eligibility/lineage inputs for staff and the DW
-- export owner. Consumers can only execute the guarded, projected readers.
revoke all on public_api.projects,public_api.brands,public_api.promotions from service_consumer,hub_app;
drop function public_api.read_projects();
drop function public_api.read_brands();
drop function public_api.read_promotions();
create function public_api.read_projects() returns table(public_project_id text,payload jsonb,version_no integer,published_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_public_reader();
 return query select p.public_project_id,hub.public_content_payload('project',p.payload),p.version_no,p.published_at from public_api.projects p;
end $$;
create function public_api.read_brands() returns table(public_brand_id text,payload jsonb,version_no integer,published_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_public_reader();
 return query select b.public_brand_id,hub.public_content_payload('brand',b.payload),b.version_no,b.published_at from public_api.brands b;
end $$;
create function public_api.read_promotions() returns table(code text,public_project_id text,payload jsonb,version_no integer,published_at timestamptz,priority integer)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_public_reader();
 return query select p.code,p.public_project_id,hub.public_content_payload('promotion',p.payload),v.version_no,p.published_at,p.priority
  from public_api.promotions p join hub.promotion_versions v on v.id=p.version_id;
end $$;
revoke all on function public_api.read_projects(),public_api.read_brands(),public_api.read_promotions() from public;
grant execute on function public_api.read_projects(),public_api.read_brands(),public_api.read_promotions() to hub_app,service_consumer;

create function hub.public_asset_file(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare asset_uuid uuid;
begin
 perform hub.require_public_reader();
 if public_id !~ '^ast_[a-f0-9]{64}$' then raise exception 'File not found' using errcode='P0002'; end if;
 select id into asset_uuid from hub.assets
  where coalesce(checksum,encode(sha256(convert_to(id::text,'UTF8')),'hex'))=substring(public_id from 5) and deleted_at is null;
 if asset_uuid is null then raise exception 'File not found' using errcode='P0002'; end if;
 return public_api.asset_file(asset_uuid);
end $$;
revoke all on function hub.public_asset_file(text) from public;
grant execute on function hub.public_asset_file(text) to hub_app;
-- Machine SQL consumers receive file metadata without storage keys or identity.
-- Only the HTTP server can execute the transport helper above.
create function public_api.asset_file(public_id text) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_object_agg(key,value),'{}')||jsonb_build_object('public_asset_id',public_id)
 from jsonb_each(hub.public_asset_file(public_id)) where key in ('mime_type','checksum','file_size')
$$;
revoke all on function public_api.asset_file(text) from public;
grant execute on function public_api.asset_file(text) to hub_app,service_consumer;
revoke all on function public_api.asset_file(uuid) from hub_app,service_consumer;

-- Draft previews apply exactly the catalogue/rights selection used on insertion.
create function hub.project_publication_preview(payload jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare models jsonb; media jsonb;
begin
 select coalesce(jsonb_agg(m),'[]') into models from jsonb_array_elements(coalesce(payload->'models','[]')) m
  where hub.model_publishable(payload,m);
 select coalesce(jsonb_agg(a),'[]') into media from jsonb_array_elements(coalesce(payload->'assets','[]')) a
  where hub.project_media_current(a) and (a->>'public_model_id' is null or exists(
   select 1 from jsonb_array_elements(models) m where m->>'public_model_id'=a->>'public_model_id'));
 return hub.public_content_payload('project',payload||jsonb_build_object('models',models,'assets',media,
  'model_catalogue_complete',hub.model_catalogue_complete(payload||jsonb_build_object('models',models))));
end $$;
revoke all on function hub.project_publication_preview(jsonb) from public;

-- Apply existing cross-tab and historical-file redactions before adding previews.
-- The UI must not confirm a review whose outgoing fields are partly hidden.
create function hub.publication_review(kind text,payload jsonb,freeze_draft boolean default false) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare visible jsonb; complete jsonb;
begin
 visible:=case when kind='project' then hub.project_permission_projection(payload) else hub.asset_permission_projection(payload) end;
 if kind='project' and freeze_draft then
  complete:=hub.project_publication_preview(payload); visible:=hub.project_publication_preview(visible);
 else
  complete:=hub.public_content_payload(kind,payload); visible:=hub.public_content_payload(kind,visible);
 end if;
 return jsonb_build_object('publication_preview',visible,'publication_preview_redacted',visible is distinct from complete);
end $$;
revoke all on function hub.publication_review(text,jsonb,boolean) from public;

-- Keep current permission redactions and write functions. Add only safe preview
-- data inside their existing guarded staff results; no extra public routes.
do $$ declare definition text; changed text;
begin
 definition:=pg_get_functiondef('hub.project_detail(text)'::regprocedure);
 changed:=replace(definition,'return hub.project_permission_projection(',
  'payload:=payload||hub.publication_review(''project'',hub.draft_payload((payload->>''id'')::uuid),true); return hub.project_permission_projection(');
 if changed=definition then raise exception 'Unexpected project detail'; end if; execute changed;
 definition:=pg_get_functiondef('hub.project_versions(uuid)'::regprocedure);
 changed:=replace(definition,'hub.project_permission_projection(payload)',
  'hub.project_permission_projection(payload)||hub.publication_review(''project'',payload)');
 if changed=definition then raise exception 'Unexpected project versions'; end if; execute changed;
 definition:=pg_get_functiondef('hub.brand_detail(text)'::regprocedure);
 changed:=replace(definition,'return result||',
  'return result||hub.publication_review(''brand'',hub.brand_draft_payload((result->>''id'')::uuid))||');
 if changed=definition then raise exception 'Unexpected brand detail'; end if; execute changed;
 definition:=pg_get_functiondef('hub.brand_versions(uuid)'::regprocedure);
 changed:=replace(definition,'hub.asset_permission_projection(payload)',
  'hub.asset_permission_projection(payload)||hub.publication_review(''brand'',payload)');
 if changed=definition then raise exception 'Unexpected brand versions'; end if; execute changed;

 definition:=pg_get_functiondef('hub.snapshot_readiness(jsonb)'::regprocedure);
 changed:=replace(definition,'a->>''asset_role'' in (''unit_plan'',''floor_plan'')','a->>''asset_role''=''floor_plan''');
 changed:=replace(changed,'a->>''asset_role''=role_name and a->>''public_model_id'' is null and hub.project_media_current(a)',
  '((role_name=''master_plan'' and a->>''asset_role''=''master_plan'') or (role_name=''gallery'' and a->>''asset_role'' in (''hero'',''thumbnail'') and not coalesce((a->>''is_primary'')::boolean,false))) and a->>''public_model_id'' is null and hub.project_media_current(a)');
 if changed=definition then raise exception 'Unexpected readiness'; end if; execute changed;
end $$;

-- Staff-only reference edits must not look like unpublished customer content.
-- Cache recomputation uses the corrected readiness and projected comparison.
create or replace function hub.progress_review_content(value jsonb) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
 select case when value?'model_catalogue_complete' then hub.public_content_payload('project',value)
  else hub.project_publication_preview(value) end
$$;
select hub.refresh_project_progress(array(select rem_project_id from staging.rem_projects));
commit;
