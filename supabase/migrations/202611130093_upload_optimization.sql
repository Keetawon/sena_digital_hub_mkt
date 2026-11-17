-- W9: future-upload provenance. No historical asset or account rows are rewritten.
-- Permission card: docs/36, recorded before this migration was authored.
begin;

-- The recorder enforces class-specific limits; legacy registration stays at
-- 10 MiB. The shared row must also admit a validated 20 MiB marketing PDF.
alter table hub.assets drop constraint assets_file_size_check,
 add constraint assets_file_size_check check
 (file_size between 1 and (case when mime_type='application/pdf' then 20971520 else 10485760 end));

create table hub.asset_upload_sources (
 id uuid primary key default gen_random_uuid(),
 original_checksum text not null check(original_checksum ~ '^[0-9a-f]{64}$'),
 processing_class text not null check(processing_class in ('private_exact','marketing_raster','marketing_pdf','sanitized_svg')),
 original_size bigint not null check(original_size between 1 and 52428800),
 original_mime text not null check(original_mime in ('image/png','image/jpeg','image/webp','image/svg+xml','application/pdf')),
 original_width integer,original_height integer,
 asset_id uuid not null references hub.assets(id) on delete restrict,
 pipeline_version text not null check(pipeline_version ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
 processing jsonb not null check(jsonb_typeof(processing)='object' and octet_length(processing::text)<=2048),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 unique(original_checksum,processing_class),
 check((original_width is null)=(original_height is null)),
 check(original_width is null or original_width>0 and original_height>0),
 check((original_mime='application/pdf')=(original_width is null))
);
create index asset_upload_source_asset on hub.asset_upload_sources(asset_id);
create table hub.asset_upload_evidence (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references hub.asset_upload_sources(id) on delete restrict,
 context jsonb not null check(jsonb_typeof(context)='object' and octet_length(context::text)<=2048),
 extraction_version text not null check(extraction_version ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
 proximity text not null check(proximity in ('near','far','unknown')),
 suggestions jsonb not null check(jsonb_typeof(suggestions)='object' and octet_length(suggestions::text)<=32768),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null
);
create index asset_upload_evidence_source on hub.asset_upload_evidence(source_id,created_at desc,id desc);

do $$ declare relation_name text;begin
 foreach relation_name in array array['asset_upload_sources','asset_upload_evidence'] loop
  execute format('alter table hub.%I enable row level security',relation_name);
  execute format('alter table hub.%I force row level security',relation_name);
  execute format('revoke all on hub.%I from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer,hub_media_worker,hub_translation_worker',relation_name);
  execute format('create policy upload_owner on hub.%I to %I using(true) with check(true)',relation_name,current_user);
  execute format('create trigger upload_immutable before update or delete on hub.%I for each row execute function hub.reject_version_change()',relation_name);
 end loop;
end $$;

-- Only this finite resolver handles untrusted context. Coordinates never leave
-- the internal SQL/API boundary or enter either private relation.
create function hub.asset_upload_resolve_context(context jsonb,action text,mime text) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;kind text;required text[];canonical jsonb;category text;purpose text;
 p hub.projects;b hub.brands;c staging.knowledge_candidates;subject uuid;refs text[];
 required_level text:=case when action='upload' then 'edit' else 'view' end;
 coordinates jsonb:='null';tags jsonb:='[]';class_name text;facts jsonb;item record;
begin
 perform hub.content_scope_lock();
 if action is null or action not in ('upload','view','rights') or mime is null
  or mime not in ('image/png','image/jpeg','image/webp','image/svg+xml','application/pdf') then
  raise exception 'invalid_upload_context' using errcode='23514';end if;
 if action='upload' then actor:=hub.require_asset_upload();
 else actor:=hub.permission_actor();end if;
 if jsonb_typeof(context) is distinct from 'object' or octet_length(context::text)>2048
  or context->'v' is distinct from '1'::jsonb or jsonb_typeof(context->'kind') is distinct from 'string' then
  raise exception 'invalid_upload_context' using errcode='23514';end if;
 kind:=context->>'kind';
 required:=case kind
  when 'intake' then array['v','kind']
  when 'project' then array['v','kind','ref','category','purpose']
  when 'brand' then array['v','kind','ref','purpose']
  when 'model' then array['v','kind','project_ref','ref','category','purpose']
  when 'commercial_type' then array['v','kind','project_ref','ref','category','purpose']
  when 'media_target' then array['v','kind','project_ref','target_type','target_key','category','usage']
  when 'disclosure' then array['v','kind','project_ref','ref']
  when 'knowledge' then array['v','kind','candidate_id'] end;
 if required is null or not(context ?& required) or context-required<>'{}' then
  raise exception 'invalid_upload_context' using errcode='23514';end if;
 for item in select key,value from jsonb_each(context) where key<>'v' loop
  if item.value='null'::jsonb and (item.key='category' or kind='disclosure' and item.key='ref') then continue;end if;
  if jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}') not between 1 and 200
   or (item.value#>>'{}') !~ '^[ -~]+$' then
   raise exception 'invalid_upload_context' using errcode='23514';end if;
 end loop;
 category:=context->>'category';purpose:=context->>'purpose';
 if category is not null and not(category=any(hub.media_categories())) then
  raise exception 'invalid_upload_category' using errcode='23514';end if;
 if kind='intake' then
  perform hub.require_asset_upload();
  canonical:=jsonb_build_object('v',1,'kind',kind,'actor_id',actor);
 elsif kind='brand' then
  if purpose not in ('logo_primary','logo_white','logo_mono','favicon') or mime='application/pdf' then
   raise exception 'invalid_upload_purpose' using errcode='23514';end if;
  select * into b from hub.brands where public_brand_id=context->>'ref' and deleted_at is null for share;
  if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
  if action='rights' then
   perform hub.require_content_project_set('knowledge','approve',hub.content_scope_projects('brand',b.public_brand_id));
  else perform hub.content_scope_access('brand',b.public_brand_id,required_level);end if;
  canonical:=jsonb_build_object('v',1,'kind',kind,'owner_id',b.id,'purpose',purpose);
 elsif kind='knowledge' then
  select candidate.* into c from staging.knowledge_candidates candidate where candidate.id=(context->>'candidate_id')::uuid and candidate.kind='asset' for share;
  if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
  select coalesce((select r.applies_to_project_ids from hub.knowledge_reviews r where r.candidate_id=c.id),c.project_ids) into refs;
  if action='rights' then perform hub.require_content_project_set('knowledge','approve',refs);
  elsif action='view' then perform hub.require_content_project_set('knowledge','view',refs);
  elsif hub.content_project_set_allowed('knowledge','edit',refs) then null;
  else perform hub.require_content_project_set('knowledge','approve',refs);end if;
  -- The legacy evidence is not altered or interpreted as W9 provenance.
  category:=c.evidence#>>'{validated_metadata,media_category}';
  if category is not null and not(category=any(hub.media_categories())) then category:=null;end if;
  canonical:=jsonb_build_object('v',1,'kind',kind,'candidate_id',c.id,'category',category);
 else
  select project.id into subject from hub.projects project
   where project.public_project_id=case when kind='project' then context->>'ref' else context->>'project_ref' end
   and project.deleted_at is null;
  if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
  if action='rights' then perform hub.require_content_project(subject,'knowledge','approve');
  else perform hub.content_scope_access('project',case when kind='project' then context->>'ref' else context->>'project_ref' end,required_level);end if;
  -- Read coordinates only after the owning-object check succeeds.
  select * into p from hub.projects where id=subject and deleted_at is null for share;
  if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
  subject:=null;
  canonical:=jsonb_build_object('v',1,'kind',kind,'project_id',p.id);
  if kind='project' then
   if purpose not in ('media','hero','thumbnail','master_plan','floor_plan','brochure') then
    raise exception 'invalid_upload_purpose' using errcode='23514';end if;
  elsif kind='model' then
   if purpose not in ('model_image','floor_plan','structural_plan') then raise exception 'invalid_upload_purpose' using errcode='23514';end if;
   select id into subject from hub.model_types where project_id=p.id and public_model_id=context->>'ref' and deleted_at is null for share;
   if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
   canonical:=canonical||jsonb_build_object('owner_id',subject);
  elsif kind='commercial_type' then
   if purpose not in ('media','floor_plan','unit_plan','structural_plan') then raise exception 'invalid_upload_purpose' using errcode='23514';end if;
   select id into subject from hub.commercial_types where project_id=p.id and public_commercial_type_id=context->>'ref' and deleted_at is null for share;
   if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
   canonical:=canonical||jsonb_build_object('owner_id',subject);
  elsif kind='disclosure' then
   if context->>'ref' is not null then
    select id into subject from hub.project_disclosures where project_id=p.id and id=(context->>'ref')::uuid for share;
    if not found then raise exception 'upload_context_unavailable' using errcode='P0002';end if;
   end if;
   canonical:=canonical||jsonb_build_object('owner_id',subject);category:='legal_document';
  elsif kind='media_target' then
   if context->>'target_type' not in ('project','commercial_type','facility','feature','place','promotion','article','building_floor','selling_point','disclosure')
    or context->>'usage' not in ('hero','thumbnail','gallery','card','banner','evidence') then
    raise exception 'invalid_upload_purpose' using errcode='23514';end if;
   -- These short transaction locks prevent a validated target changing before
   -- registration. They are released before decoding, never held while waiting.
   case context->>'target_type'
    when 'commercial_type' then perform 1 from hub.commercial_types where id::text=context->>'target_key' and project_id=p.id for share;
    when 'facility' then perform 1 from hub.project_facilities where project_id=p.id and facility_code=context->>'target_key' for share;
    when 'feature' then perform 1 from hub.project_features where id::text=context->>'target_key' and project_id=p.id for share;
    when 'place' then perform 1 from hub.project_places where id::text=context->>'target_key' and project_id=p.id for share;
    when 'promotion' then
     perform 1 from hub.public_promotions where id::text=context->>'target_key' for share;
     if action<>'rights' then perform hub.promotion_scope_access((context->>'target_key')::uuid,required_level);end if;
     if category is distinct from 'promotion_ad' or context->>'usage'<>'banner' then raise exception 'invalid_upload_purpose' using errcode='23514';end if;
    when 'building_floor' then perform 1 from hub.project_buildings where project_id=p.id and building_key=context->>'target_key' for share;
    when 'selling_point' then perform 1 from hub.project_selling_points where project_id=p.id and point_key::text=context->>'target_key' for share;
    when 'disclosure' then
     perform 1 from hub.project_disclosures where id::text=context->>'target_key' and project_id=p.id for share;
     category:='legal_document';
    when 'article' then perform 1 from hub.articles where id::text=context->>'target_key' for share;
    else null;
   end case;
   if action='rights' then
    -- Rights evidence cannot make a new binding. Check membership through the
    -- existing resolver using the reviewer's ordinary owning-context View.
    if not hub.media_target(p.id,context->>'target_type',context->>'target_key','view') then
     raise exception 'upload_context_unavailable' using errcode='P0002';end if;
   elsif not hub.media_target(p.id,context->>'target_type',context->>'target_key',required_level) then
    raise exception 'upload_context_unavailable' using errcode='P0002';end if;
   canonical:=canonical||jsonb_build_object('target_type',context->>'target_type','target_key',context->>'target_key','usage',context->>'usage');
  end if;
  canonical:=canonical||jsonb_build_object('purpose',purpose,'category',category);
  if p.latitude is not null and p.longitude is not null then coordinates:=jsonb_build_array(p.latitude,p.longitude);end if;
 end if;
 if kind='intake' or kind<>'brand' and category is null or category='legal_document' or purpose='structural_plan' then
  class_name:='private_exact';
 elsif mime='application/pdf' then class_name:='marketing_pdf';
 elsif mime='image/svg+xml' then class_name:='sanitized_svg';
 else class_name:='marketing_raster';end if;
 if action='upload' and class_name='private_exact' and mime='image/svg+xml' then raise exception 'invalid_upload_legal_svg' using errcode='23514';end if;
 if action='upload' and (purpose='brochure' and mime<>'application/pdf' or purpose in ('hero','thumbnail') and mime='application/pdf') then
  raise exception 'invalid_upload_purpose' using errcode='23514';end if;
 if class_name<>'marketing_raster' then coordinates:='null';end if;
 if class_name in ('marketing_raster','marketing_pdf') then
  -- ponytail: small controlled vocabulary; a short SHARE lock prevents
  -- concurrent retirement/insertion without a new version/state relation.
  lock table hub.media_tags in share mode;
  select coalesce(jsonb_agg(jsonb_build_array(code,label->>'th') order by code),'[]') into tags
   from hub.media_tags where status='active';
 end if;
 canonical:=jsonb_strip_nulls(canonical);
 facts:=jsonb_build_object('context',canonical,'processing_class',class_name,
  'input_limit',case class_name when 'marketing_raster' then 31457280 when 'marketing_pdf' then 52428800 when 'sanitized_svg' then 2097152 else 10485760 end,
  'stored_limit',case class_name when 'marketing_pdf' then 20971520 when 'sanitized_svg' then 2097152 else 10485760 end,
  'pixel_limit',case class_name when 'marketing_raster' then 100000000 else 40000000 end,
  'coordinates',coordinates,'active_tags',tags);
 return facts||jsonb_build_object('context_stamp',encode(sha256(convert_to(facts::text,'UTF8')),'hex'));
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'invalid_upload_context' using errcode='23514';
end $$;

create function hub.asset_upload_context(context jsonb,mime text) returns jsonb
language sql volatile security definer set search_path=pg_catalog,pg_temp as $$
 select hub.asset_upload_resolve_context(context,'upload',mime)
$$;

create function hub.find_uploaded_asset_source(original_checksum text,original_mime text,context jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare resolved jsonb;s hub.asset_upload_sources;a hub.assets;begin
 resolved:=hub.asset_upload_resolve_context(context,'upload',original_mime);
 if original_checksum is null or original_checksum !~ '^[0-9a-f]{64}$' then raise exception 'invalid_upload_original' using errcode='23514';end if;
 select * into s from hub.asset_upload_sources x where x.original_checksum=find_uploaded_asset_source.original_checksum
  and x.processing_class=resolved->>'processing_class';
 if not found then return null;end if;
 perform hub.require_asset_access(s.asset_id);
 select * into a from hub.assets where id=s.asset_id and deleted_at is null;
 if not found then raise exception 'upload_asset_unavailable' using errcode='P0002';end if;
 if s.original_mime is distinct from original_mime then raise exception 'invalid_upload_original' using errcode='23514';end if;
 return jsonb_build_object('source_id',s.id,'asset',to_jsonb(a),'pipeline_version',s.pipeline_version,'processing',s.processing,
  'original',jsonb_build_object('checksum',s.original_checksum,'size',s.original_size,'mime_type',s.original_mime,'width',s.original_width,'height',s.original_height));
end $$;


-- Reuse current guarded registration without changing the legacy entry or ACL.
do $$ declare definition text;begin
 definition:=replace(pg_get_functiondef('hub.register_uploaded_asset(jsonb)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'FUNCTION hub.register_uploaded_asset(','FUNCTION hub.register_uploaded_asset_for_upload(');
 definition:=hub.content_definition_replace(definition,'a.file_size not between 1 and 10485760',
  'a.file_size not between 1 and (case when a.mime_type=''application/pdf'' then 20971520 else 10485760 end)');
 execute definition;
end $$;

create function hub.asset_upload_has_stock(asset_uuid uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.asset_upload_sources s join hub.asset_upload_evidence e on e.source_id=s.id
  where s.asset_id=asset_uuid and e.suggestions#>>'{values,stock}'='present')
$$;

create function hub.require_asset_upload_use(asset_uuid uuid,use_kind text,category text,external_use boolean) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare class_name text;begin
 if use_kind is null or use_kind not in ('metadata','binding','disclosure','public','job') or external_use is null then
  raise exception 'invalid_upload_use' using errcode='23514';end if;
 -- No provenance means the pre-W9 behavior, including retained publications.
 select s.processing_class into class_name from hub.asset_upload_sources s where s.asset_id=asset_uuid limit 1;
 if not found then return;end if;
 if class_name='private_exact' and (external_use or use_kind in ('public','job'))
  or class_name<>'private_exact' and (use_kind='disclosure' or category='legal_document') then
  raise exception 'upload_class_conflict' using errcode='23514';end if;
end $$;

create function hub.asset_upload_audit() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare value jsonb;begin
 if tg_table_name='asset_upload_sources' then
  value:=jsonb_build_object('id',new.id,'asset_id',new.asset_id,'processing_class',new.processing_class,
   'pipeline_version',new.pipeline_version,'original_size',new.original_size,
   'original_width',new.original_width,'original_height',new.original_height);
 elsif tg_table_name='asset_upload_evidence' then
  value:=jsonb_build_object('id',new.id,'source_id',new.source_id,'extraction_version',new.extraction_version,
   'proximity',new.proximity,'stock_present',coalesce(new.suggestions#>>'{values,stock}'='present',false),
   'owner',new.context-array['category','purpose','usage']);
 else raise exception 'invalid_upload_audit' using errcode='23514';end if;
 insert into audit.change_log(actor,database_role,table_name,operation,before_row,after_row,reason)
 values(new.created_by,current_setting('role'),tg_table_schema||'.'||tg_table_name,'INSERT',null,value,
  case when tg_table_name='asset_upload_sources' then 'upload_recorded' else 'file_evidence_extracted' end);
 return new;
end $$;
create trigger upload_audit after insert on hub.asset_upload_sources for each row execute function hub.asset_upload_audit();
create trigger upload_audit after insert on hub.asset_upload_evidence for each row execute function hub.asset_upload_audit();

create function hub.asset_upload_evidence(asset_uuid uuid,context jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.assets;s hub.asset_upload_sources;e hub.asset_upload_evidence;resolved jsonb;values_json jsonb;matched boolean:=false;stored_project uuid;begin
 perform hub.require_asset_access(asset_uuid);
 select * into a from hub.assets where id=asset_uuid and deleted_at is null;
 if not found then raise exception 'upload_asset_unavailable' using errcode='P0002';end if;
 -- MIME is required for resolution, but the file's original MIME can differ
 -- after PNG conversion. Each candidate stays inside this private function.
 for e in select evidence.* from hub.asset_upload_evidence evidence
  join hub.asset_upload_sources source on source.id=evidence.source_id
  where source.asset_id=asset_uuid order by evidence.created_at desc,evidence.id desc loop
  select * into s from hub.asset_upload_sources where id=e.source_id;
  begin resolved:=hub.asset_upload_resolve_context(context,'view',s.original_mime);
  exception when insufficient_privilege then
   resolved:=hub.asset_upload_resolve_context(context,'rights',s.original_mime);
   perform hub.require_content_project_set('knowledge','approve',
    array(select distinct unnest(project_ids) from hub.content_asset_bindings(asset_uuid)));
  end;
  if context->>'kind'='intake' and (a.owner_id is distinct from hub.permission_actor() or a.first_bound_at is not null) then
   raise exception 'upload_asset_unavailable' using errcode='P0002';end if;
  -- Purpose, category and usage can change after upload. Evidence follows its
  -- stable owning object, while the current request and original target both
  -- remain authorized. In particular, never carry proximity across projects.
  if resolved#>>'{context,kind}'='intake' then
   if e.context is distinct from resolved->'context' then continue;end if;
  elsif resolved#>>'{context,kind}'='brand' then
   if e.context->>'kind' is distinct from 'brand'
    or e.context->>'owner_id' is distinct from resolved#>>'{context,owner_id}' then continue;end if;
  elsif resolved#>>'{context,kind}'='knowledge' then
   if e.context->>'kind' is distinct from 'knowledge'
    or e.context->>'candidate_id' is distinct from resolved#>>'{context,candidate_id}' then continue;end if;
  else
   if e.context->>'kind' not in ('project','model','commercial_type','media_target','disclosure')
    or e.context->>'project_id' is distinct from resolved#>>'{context,project_id}' then continue;end if;
   stored_project:=(e.context->>'project_id')::uuid;
   begin
    case e.context->>'kind'
     when 'model' then
      if not exists(select 1 from hub.model_types where id=(e.context->>'owner_id')::uuid
       and project_id=stored_project and deleted_at is null) then continue;end if;
     when 'commercial_type' then
      if not exists(select 1 from hub.commercial_types where id=(e.context->>'owner_id')::uuid
       and project_id=stored_project and deleted_at is null) then continue;end if;
     when 'disclosure' then
      if e.context ? 'owner_id' and not exists(select 1 from hub.project_disclosures
       where id=(e.context->>'owner_id')::uuid and project_id=stored_project) then continue;end if;
     when 'media_target' then
      if not hub.media_target(stored_project,e.context->>'target_type',e.context->>'target_key','view') then continue;end if;
      if e.context->>'target_type'='promotion' then
       perform hub.promotion_scope_access((e.context->>'target_key')::uuid,'view');end if;
     else null;
    end case;
   exception when insufficient_privilege or no_data_found then continue;
   end;
  end if;
  matched:=true;exit;
 end loop;
 if not matched then return null;end if;
 values_json:=e.suggestions->'values';
 if values_json ? 'tags' then
  values_json:=jsonb_set(values_json,'{tags}',coalesce((select jsonb_agg(code order by code)
   from hub.media_tags where status='active' and values_json->'tags' ? code),'[]'));
 end if;
 return jsonb_build_object('source_id',s.id,'evidence_id',e.id,
  'original',jsonb_build_object('size',s.original_size,'mime_type',s.original_mime,'width',s.original_width,'height',s.original_height),
  'stored',jsonb_build_object('size',a.file_size,'mime_type',a.mime_type,'width',a.width,'height',a.height),
  'pipeline_version',s.pipeline_version,'extraction_version',e.extraction_version,'processing',s.processing,
  'suggestions',jsonb_build_object('source','file_metadata','confirmed',false,'values',values_json||jsonb_build_object('proximity',e.proximity)));
end $$;

create function hub.record_asset_upload_source(stored_metadata jsonb,original jsonb,processing jsonb,
 suggestions jsonb,context jsonb,expected_context_stamp text) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare resolved jsonb;actor uuid;s hub.asset_upload_sources;a hub.assets;recorded jsonb;class_name text;
 original_size bigint;original_width integer;original_height integer;pipeline text;extraction text;format_name text;
 processing_record jsonb;file_suggestions jsonb;values_json jsonb;proximity text;item record;part jsonb;
 reuse_kind text:='none';safe_text text;metadata hub.assets;evidence_uuid uuid;
begin
 resolved:=hub.asset_upload_resolve_context(context,'upload',original->>'mime_type');actor:=hub.permission_actor();
 if expected_context_stamp is null or expected_context_stamp is distinct from resolved->>'context_stamp' then
  raise exception 'upload_context_changed' using errcode='40001';end if;
 class_name:=resolved->>'processing_class';
 if jsonb_typeof(original) is distinct from 'object' or original-array['checksum','size','mime_type','width','height']<>'{}'
  or not(original ?& array['checksum','size','mime_type','width','height'])
  or jsonb_typeof(original->'checksum') is distinct from 'string' or original->>'checksum' !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(original->'size') is distinct from 'number' or original->>'size' !~ '^[1-9][0-9]{0,8}$' then
  raise exception 'invalid_upload_original' using errcode='23514';end if;
 original_size:=(original->>'size')::bigint;
 if original_size>(resolved->>'input_limit')::bigint then raise exception 'invalid_upload_original' using errcode='23514';end if;
 if original->>'mime_type'='application/pdf' then
  if original->'width'<>'null'::jsonb or original->'height'<>'null'::jsonb then raise exception 'invalid_upload_original' using errcode='23514';end if;
 else
  if jsonb_typeof(original->'width') is distinct from 'number' or jsonb_typeof(original->'height') is distinct from 'number'
   or original->>'width' !~ '^[1-9][0-9]{0,8}$' or original->>'height' !~ '^[1-9][0-9]{0,8}$' then
   raise exception 'invalid_upload_original' using errcode='23514';end if;
  original_width:=(original->>'width')::integer;original_height:=(original->>'height')::integer;
  if original->>'mime_type'<>'image/svg+xml' and original_width::bigint*original_height>(resolved->>'pixel_limit')::bigint then
   raise exception 'invalid_upload_original' using errcode='23514';end if;
 end if;
 if jsonb_typeof(processing) is distinct from 'object' or octet_length(processing::text)>2048
  or processing-array['pipeline_version','max_edge','quality','output_format','metadata_stripped','pdf_images_recompressed',
   'kept_original_because_no_gain','kept_unchanged_legal','kept_image_encoding_because_no_gain','pdf_dpi']<>'{}'
  or not(processing ?& array['pipeline_version','output_format','metadata_stripped'])
  or jsonb_typeof(processing->'pipeline_version') is distinct from 'string'
  or processing->>'pipeline_version' !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
  or processing->>'output_format' not in ('png','jpeg','webp','pdf','svg') then
  raise exception 'invalid_upload_processing' using errcode='23514';end if;
 for item in select key,value from jsonb_each(processing) where key not in ('pipeline_version','output_format') loop
  if item.key='quality' then
   if item.value<>'null'::jsonb and item.value not in ('"keep"'::jsonb,'"lossless"'::jsonb)
    and (jsonb_typeof(item.value)<>'number' or item.value::text !~ '^(100|[1-9][0-9]?)$') then
    raise exception 'invalid_upload_processing' using errcode='23514';end if;
  elsif item.key in ('max_edge','pdf_dpi') then
   if item.value<>'null'::jsonb and item.value is distinct from
    (case when item.key='max_edge' then '4096'::jsonb else '200'::jsonb end) then
    raise exception 'invalid_upload_processing' using errcode='23514';end if;
  elsif jsonb_typeof(item.value)<>'boolean' then raise exception 'invalid_upload_processing' using errcode='23514';end if;
 end loop;
 pipeline:=processing->>'pipeline_version';processing_record:=processing-'pipeline_version';
 if jsonb_typeof(stored_metadata) is distinct from 'object' or octet_length(stored_metadata::text)>4096
  or stored_metadata-array['original_filename','mime_type','storage_path','checksum','file_size','asset_type','width','height','language','storage_bucket','storage_provider']<>'{}' then
  raise exception 'invalid_upload_stored' using errcode='23514';end if;
 metadata:=jsonb_populate_record(null::hub.assets,stored_metadata);
 format_name:=case metadata.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpeg'
  when 'image/webp' then 'webp' when 'image/svg+xml' then 'svg' when 'application/pdf' then 'pdf' end;
 if metadata.file_size is null or metadata.file_size not between 1 and (resolved->>'stored_limit')::bigint
  or metadata.checksum is null or metadata.checksum !~ '^[0-9a-f]{64}$'
  or format_name is null or format_name is distinct from processing->>'output_format' then
  raise exception 'invalid_upload_stored' using errcode='23514';end if;
 if class_name='private_exact' then
  if metadata.checksum is distinct from original->>'checksum' or metadata.file_size<>original_size
   or metadata.mime_type is distinct from original->>'mime_type' or metadata.width is distinct from original_width
   or metadata.height is distinct from original_height or processing->'metadata_stripped' is distinct from 'false'::jsonb
   or processing->'kept_unchanged_legal' is distinct from 'true'::jsonb then
   raise exception 'invalid_upload_private_exact' using errcode='23514';end if;
 elsif class_name='marketing_raster' then
  if metadata.mime_type not in ('image/png','image/jpeg','image/webp') or metadata.width not between 1 and 4096
   or metadata.height not between 1 and 4096
   or greatest(metadata.width,metadata.height)>greatest(original_width,original_height)
   or original->>'mime_type' in ('image/jpeg','image/webp') and metadata.mime_type<>original->>'mime_type'
   or processing->'metadata_stripped' is distinct from 'true'::jsonb then
   raise exception 'invalid_upload_processing' using errcode='23514';end if;
 elsif class_name='marketing_pdf' then
  if metadata.mime_type<>'application/pdf' or metadata.width is not null or metadata.height is not null
   or processing->'metadata_stripped' is distinct from 'true'::jsonb
   or coalesce((processing->>'kept_original_because_no_gain')::boolean,false) then
   raise exception 'invalid_upload_processing' using errcode='23514';end if;
 elsif metadata.mime_type<>'image/svg+xml' then raise exception 'invalid_upload_processing' using errcode='23514';
 end if;


 if jsonb_typeof(suggestions) is distinct from 'object' or octet_length(suggestions::text)>32768
  or suggestions-array['source','confirmed','pipeline_version','values']<>'{}'
  or suggestions->>'source' is distinct from 'file_metadata' or suggestions->'confirmed' is distinct from 'false'::jsonb
  or jsonb_typeof(suggestions->'values') is distinct from 'object' or suggestions->>'pipeline_version' is null
  or suggestions->>'pipeline_version' !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' then
  raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
 extraction:=suggestions->>'pipeline_version';values_json:=suggestions->'values';
 if values_json-array['taken_at','credit','credit_evidence','stock','stock_evidence','image_kind','caption','tags','unmapped_keywords','proximity']<>'{}' then
  raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
 proximity:=coalesce(values_json->>'proximity','unknown');
 if proximity not in ('near','far','unknown') or (resolved->'coordinates'='null'::jsonb and proximity<>'unknown') then
  raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
 values_json:=values_json-'proximity';
 if class_name in ('private_exact','sanitized_svg') and values_json<>'{}' or class_name='marketing_pdf' and values_json-array['caption']<>'{}' then
  raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
 for item in select key,value from jsonb_each(values_json) loop
  if item.key in ('credit','caption') then
   if jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}') not between 1 and 1000 then
    raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
  elsif item.key='stock' then
   if item.value<>'"present"'::jsonb then raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
  elsif item.key='image_kind' then
   if item.value not in ('"photo"'::jsonb,'"render"'::jsonb) then raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
  elsif item.key='taken_at' then
   if jsonb_typeof(item.value)<>'object' or item.value-array['value','offset_known']<>'{}'
    or jsonb_typeof(item.value->'value') is distinct from 'string' or jsonb_typeof(item.value->'offset_known') is distinct from 'boolean'
    or item.value->>'value' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})?$'
    or (item.value->>'offset_known')::boolean is distinct from (item.value->>'value' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
   perform (item.value->>'value')::timestamp;
  elsif item.key in ('tags','unmapped_keywords','stock_evidence','credit_evidence') then
   if jsonb_typeof(item.value)<>'array' or jsonb_array_length(item.value)>(case item.key when 'tags' then 30 when 'credit_evidence' then 32 when 'stock_evidence' then 4 else 64 end) then
    raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
   for part in select value from jsonb_array_elements(item.value) loop
    if item.key='credit_evidence' then
     if jsonb_typeof(part)<>'object' or part-array['field','text']<>'{}' or not(part ?& array['field','text'])
      or part->>'field' not in ('exif_artist','exif_copyright','iptc_byline','iptc_credit','iptc_copyright','xmp_creator','xmp_rights','xmp_usage_terms')
      or jsonb_typeof(part->'text') is distinct from 'string' or length(part->>'text') not between 1 and 500 then
      raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
    else
     if jsonb_typeof(part)<>'string' or length(part#>>'{}') not between 1 and 80 then raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
     if item.key='tags' and not exists(select 1 from hub.media_tags where code=part#>>'{}' and status='active')
      or item.key='stock_evidence' and part#>>'{}' not in ('stock_1','stock_2','stock_3','stock_4') then
      raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
    end if;
   end loop;
  end if;
 end loop;
 if values_json ? 'stock_evidence' and values_json->>'stock' is distinct from 'present' then raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
 -- Backend decoding performs the detailed allowlist. SQL also rejects basic
 -- contact/path/markup/control patterns in every retained free-text field.
 for safe_text in
  select values_json->>'credit' union all select values_json->>'caption'
  union all select value->>'text' from jsonb_array_elements(coalesce(values_json->'credit_evidence','[]'))
  union all select value from jsonb_array_elements_text(coalesce(values_json->'unmapped_keywords','[]'))
 loop
  if safe_text ~ '[<>[:cntrl:]]' or safe_text ~* '([[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|https?://|[A-Za-z]:[\\/]|\\\\|[0-9][0-9 ()+.-]{8,}[0-9])' then
   raise exception 'invalid_upload_suggestions' using errcode='23514';end if;
 end loop;
 file_suggestions:=jsonb_build_object('source','file_metadata','confirmed',false,'values',values_json);

 -- Lock order is actor/scope + resolved context, source, then stored identity.
 perform pg_advisory_xact_lock(hashtextextended('upload-source:'||class_name||':'||(original->>'checksum'),0));
 select * into s from hub.asset_upload_sources x where x.original_checksum=original->>'checksum' and x.processing_class=class_name;
 if found then
  perform hub.require_asset_access(s.asset_id);
  if s.original_size<>original_size or s.original_mime<>original->>'mime_type'
   or s.original_width is distinct from original_width or s.original_height is distinct from original_height then
   raise exception 'invalid_upload_original' using errcode='23514';end if;
  select * into a from hub.assets where id=s.asset_id and deleted_at is null;
  if not found then raise exception 'upload_asset_unavailable' using errcode='P0002';end if;
  perform pg_advisory_xact_lock(hashtextextended(a.checksum,0));
  reuse_kind:='original';
 else
  perform pg_advisory_xact_lock(hashtextextended(metadata.checksum,0));
  select * into a from hub.assets where checksum=metadata.checksum and deleted_at is null;
  if found then
   perform hub.require_asset_access(a.id);
   if not exists(select 1 from hub.asset_upload_sources where asset_id=a.id) then
    raise exception 'legacy_provenance_collision' using errcode='P0092';end if;
   if exists(select 1 from hub.asset_upload_sources where asset_id=a.id and processing_class<>class_name) then
    raise exception 'upload_class_conflict' using errcode='P0091';end if;
   if a.file_size is distinct from metadata.file_size or a.mime_type is distinct from metadata.mime_type
    or a.width is distinct from metadata.width or a.height is distinct from metadata.height then
    raise exception 'invalid_upload_stored' using errcode='23514';end if;
   reuse_kind:='stored';
  else
   recorded:=hub.register_uploaded_asset_for_upload(stored_metadata);
   if (recorded->>'reused')::boolean then raise exception 'upload_context_changed' using errcode='40001';end if;
   select * into a from hub.assets where id=(recorded#>>'{asset,id}')::uuid;
  end if;
  insert into hub.asset_upload_sources(original_checksum,processing_class,original_size,original_mime,original_width,original_height,
   asset_id,pipeline_version,processing,created_by)
  values(original->>'checksum',class_name,original_size,original->>'mime_type',original_width,original_height,a.id,pipeline,processing_record,actor)
  returning * into s;
 end if;
 perform hub.require_asset_access(a.id);
 perform hub.require_asset_upload_use(a.id,'metadata',a.media_category,a.ai_exposure<>'internal' or a.marketing_publication);
 insert into hub.asset_upload_evidence(source_id,context,extraction_version,proximity,suggestions,created_by)
 values(s.id,resolved->'context',extraction,proximity,file_suggestions,actor) returning id into evidence_uuid;
 return jsonb_build_object('asset',to_jsonb(a),'reused',reuse_kind<>'none','reuse_kind',reuse_kind,
  'upload',hub.asset_upload_evidence(a.id,context));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
 raise exception 'invalid_upload_metadata' using errcode='23514';
end $$;


-- Shared storage guards add class restrictions; existing command/RLS scope
-- authorization remains in place. Legacy rows without W9 sources are unchanged.
create function hub.asset_upload_use_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare row_data jsonb:=to_jsonb(new);asset_uuid uuid;kind text:='binding';category text;external_use boolean;begin
 if tg_table_name='assets' then
  asset_uuid:=new.id;
  if not exists(select 1 from hub.asset_upload_sources where asset_id=asset_uuid) then return new;end if;
  if new.checksum is distinct from old.checksum or new.file_size is distinct from old.file_size
   or new.mime_type is distinct from old.mime_type or new.width is distinct from old.width or new.height is distinct from old.height
   or new.storage_path is distinct from old.storage_path or new.storage_bucket is distinct from old.storage_bucket then
   raise exception 'upload_stored_identity_immutable' using errcode='23514';end if;
  perform hub.require_asset_upload_use(asset_uuid,'metadata',new.media_category,new.ai_exposure<>'internal' or new.marketing_publication);
  return new;
 elsif tg_table_name='project_disclosures' then
  asset_uuid:=new.legal_document_asset_id;kind:='disclosure';category:='legal_document';external_use:=false;
 elsif tg_table_name='media_links' then
  asset_uuid:=new.thumbnail_asset_id;external_use:=new.ai_exposure<>'internal' or new.state='PUBLISHED';
 elsif tg_table_name in ('entity_assets','brand_assets','commercial_type_assets','asset_links','knowledge_asset_links') then
  asset_uuid:=(row_data->>'asset_id')::uuid;
  if tg_table_name='knowledge_asset_links' then
   external_use:=true;
   if hub.asset_upload_has_stock(asset_uuid) then raise exception 'file_stock_ineligible' using errcode='23514';end if;
  else
   external_use:=coalesce(row_data->>'ai_exposure','open')<>'internal';
   if row_data->>'asset_role'='structural_plan' or row_data->>'target_type'='disclosure' then
    kind:='disclosure';category:='legal_document';external_use:=false;
   end if;
  end if;
 else raise exception 'invalid_upload_use' using errcode='23514';
 end if;
 if asset_uuid is not null then perform hub.require_asset_upload_use(asset_uuid,kind,category,external_use);end if;
 return new;
end $$;
create trigger upload_class_guard before update on hub.assets for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.entity_assets for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.brand_assets for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.commercial_type_assets for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.asset_links for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.media_links for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.project_disclosures for each row execute function hub.asset_upload_use_guard();
create trigger upload_class_guard before insert or update on hub.knowledge_asset_links for each row execute function hub.asset_upload_use_guard();

-- Exact reviewed replacements fail migration if predecessor shape changes.
do $$ declare definition text;begin
 definition:=replace(pg_get_functiondef('hub.can_read_asset(uuid)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'where a.id=asset_uuid and a.deleted_at is null',
  $new$where a.id=asset_uuid and a.deleted_at is null and
   (not exists(select 1 from hub.asset_upload_sources where asset_id=a.id and processing_class='private_exact')
    or a.provenance='upload' and a.owner_id=hub.permission_actor() and a.first_bound_at is null and hub.can_upload_asset()
    or exists(select 1 from hub.content_asset_bindings(a.id) binding where binding.tab='projects'
     and (hub.content_project_set_allowed('projects','edit',binding.project_ids)
      or hub.content_project_set_allowed('projects','approve',binding.project_ids))))$new$);
 execute definition;
 definition:=replace(pg_get_functiondef('hub.public_asset_file(text)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'begin return public_api.asset_file(a.id);',
  $new$if exists(select 1 from hub.asset_upload_sources where asset_id=a.id and processing_class='private_exact') then
   raise exception 'File not found' using errcode='P0002';end if;
  begin return public_api.asset_file(a.id);$new$);execute definition;

 definition:=replace(pg_get_functiondef('public_api.asset_file(uuid)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'where a.id=asset_uuid and',
  'where a.id=asset_uuid and not exists(select 1 from hub.asset_upload_sources where asset_id=a.id and processing_class=''private_exact'') and');execute definition;

 -- This existing projection is owner-only and stays an invoker function;
 -- caller grants/security mode are not broadened.
 definition:=replace(pg_get_functiondef('hub.public_content_payload(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'if kind=''asset'' then',
  $new$if kind='asset' then
  if exists(select 1 from hub.asset_upload_sources where asset_id=(payload->>'id')::uuid and processing_class='private_exact') then return null;end if;$new$);
 execute definition;

 definition:=replace(pg_get_functiondef('hub.publication_dependency_check(jsonb,boolean,boolean)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,
  'if source is null or not coalesce(available,false) then raise exception ''Source is withdrawn, expired or unavailable'' using errcode=''23514'';end if;',
  $new$if source is null or not coalesce(available,false) then raise exception 'Source is withdrawn, expired or unavailable' using errcode='23514';end if;
  if dependency->>'table'='assets' then perform hub.require_asset_upload_use((source->>'id')::uuid,'public',source->>'media_category',true);end if;$new$);
 execute definition;

 definition:=replace(pg_get_functiondef('hub.media_job_allowed(hub.media_jobs)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'and mime_type in (',
  'and not exists(select 1 from hub.asset_upload_sources where asset_id=job.subject_id and processing_class=''private_exact'') and mime_type in (');
 execute definition;

 -- Both delegates already sit behind W6's object-aware wrapper. Keep original
 -- scope/rights checks; permit future optimized installations only by a proven
 -- W9 original mapping while retaining historical byte-exact evidence.
 definition:=replace(pg_get_functiondef('hub.knowledge_link_approved_asset_before_scopes(uuid,uuid,integer)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'a.checksum=c.evidence->>''sha256''',
  '(a.checksum=c.evidence->>''sha256'' or exists(select 1 from hub.asset_upload_sources s where s.asset_id=a.id and s.original_checksum=c.evidence->>''sha256'' and s.processing_class<>''private_exact''))');
 definition:=hub.content_definition_replace(definition,'if c.kind<>''asset'' or',
  'if hub.asset_upload_has_stock(asset) or c.kind<>''asset'' or');execute definition;

 definition:=replace(pg_get_functiondef('hub.lock_knowledge_asset_before_scopes(uuid)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'return to_jsonb(c)||jsonb_build_object(',
  $new$return to_jsonb(c)||jsonb_build_object('file_stock_present',
   exists(select 1 from hub.asset_upload_sources s where s.original_checksum=c.evidence->>'sha256' and hub.asset_upload_has_stock(s.asset_id))
   or exists(select 1 from hub.knowledge_asset_links l where l.candidate_id=c.id and hub.asset_upload_has_stock(l.asset_id)))||jsonb_build_object($new$);
 execute definition;

 -- These rows never appear in generic activity/history or source projections.
 definition:=replace(pg_get_functiondef('hub.workspace_history_contexts(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'if row_data is null or table_name not like ''hub.%'' then return;end if;',
  'if row_data is null or table_name not like ''hub.%'' or table_name in (''hub.asset_upload_sources'',''hub.asset_upload_evidence'') then return;end if;');execute definition;
 definition:=replace(pg_get_functiondef('hub.content_row_visible(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 definition:=hub.content_definition_replace(definition,'if row_data is null then return false;end if;',
  'if row_data is null or table_name in (''asset_upload_sources'',''asset_upload_evidence'') then return false;end if;');execute definition;
end $$;

-- Close PUBLIC/default ACLs and every non-owner role, including any historical
-- grants copied with a delegate. Only four finite entries reach hub_app.
do $$ declare signature text;entry record;begin
 foreach signature in array array[
  'hub.asset_upload_resolve_context(jsonb,text,text)','hub.asset_upload_context(jsonb,text)',
  'hub.find_uploaded_asset_source(text,text,jsonb)',
  'hub.record_asset_upload_source(jsonb,jsonb,jsonb,jsonb,jsonb,text)',
  'hub.asset_upload_evidence(uuid,jsonb)','hub.asset_upload_has_stock(uuid)',
  'hub.require_asset_upload_use(uuid,text,text,boolean)','hub.asset_upload_audit()',
  'hub.asset_upload_use_guard()','hub.register_uploaded_asset_for_upload(jsonb)'
 ] loop
  execute format('revoke all on function %s from public',signature);
  for entry in select distinct role_name from (
   select r.rolname role_name from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   join pg_roles r on r.oid=a.grantee where p.oid=signature::regprocedure and a.grantee<>p.proowner
  ) roles loop execute format('revoke all on function %s from %I',signature,entry.role_name);end loop;
 end loop;
end $$;
grant execute on function hub.asset_upload_context(jsonb,text),
 hub.find_uploaded_asset_source(text,text,jsonb),
 hub.record_asset_upload_source(jsonb,jsonb,jsonb,jsonb,jsonb,text),
 hub.asset_upload_evidence(uuid,jsonb) to hub_app;
commit;

