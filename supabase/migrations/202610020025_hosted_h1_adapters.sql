-- H1 adapters only. Local issuance/fixtures, archive and assistant guards stay unchanged.
begin;

create function hub.hosted_test_profile() returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare accepted boolean:=false;
begin
  if to_regclass('hub_deployment.target') is null then return false;end if;
  execute 'select exists(select 1 from hub_deployment.target where project_ref=$1 and environment=$2 and profile=$3 and source=$4)'
    into accepted using 'eqlrtevwpyboplljgowo','hosted-test','hosted-test-settings-v1','sena-hub-supabase-test-v2';
  return accepted;
end $$;
revoke all on function hub.hosted_test_profile() from public;

-- This helper is used ONLY by residential operations. Do not broaden the old
-- residential_local guard, which also protects deferred archive/assistant calls.
create function hub.residential_environment() returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if hub.hosted_test_profile() then return;end if;
  perform hub.residential_local();
end $$;
revoke all on function hub.residential_environment() from public;
grant execute on function hub.residential_environment() to editor,publisher,viewer,admin;

alter table hub.assets drop constraint assets_storage_bucket_check;
alter table hub.assets add constraint assets_storage_bucket_check check(storage_bucket in('local-originals','hub-test-assets'));
alter table hub.assets drop constraint assets_source_system_check;
alter table hub.assets add constraint assets_source_system_check check(source_system in('hub-local','hub-hosted-test'));

create or replace function hub.register_uploaded_asset(metadata jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; a hub.assets; asset_uuid uuid := gen_random_uuid(); extension text; reused boolean; hosted boolean := hub.hosted_test_profile();
begin
  actor := hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(metadata) is distinct from 'object' or exists (select 1 from jsonb_object_keys(metadata) k
    where k not in ('original_filename','mime_type','storage_path','checksum','file_size','asset_type','width','height','language','storage_bucket','storage_provider')) then
    raise exception 'Only validated upload metadata may be registered' using errcode='42501';
  end if;
  if hosted then
    if metadata->>'storage_bucket' is distinct from 'hub-test-assets' or metadata->>'storage_provider' is distinct from 'supabase' then
      raise exception 'Private hosted TEST storage required' using errcode='23514';
    end if;
  elsif metadata ? 'storage_bucket' or metadata ? 'storage_provider' then
    raise exception 'Hosted storage metadata is unavailable in this environment' using errcode='42501';
  end if;
  a := jsonb_populate_record(null::hub.assets,metadata);
  extension := case a.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'image/svg+xml' then 'svg' when 'application/pdf' then 'pdf' end;
  if extension is null or coalesce(btrim(a.original_filename),'')='' or length(a.original_filename)>255
    or a.checksum is null or a.checksum !~ '^[0-9a-f]{64}$'
    or a.storage_path is distinct from a.checksum || '.' || extension
    or a.file_size is null or a.file_size not between 1 and 10485760
    or a.asset_type is distinct from (case when extension='pdf' then 'document' else 'image' end)
    or (extension<>'pdf' and (a.width is null or a.height is null or a.width<=0 or a.height<=0))
    or (extension='pdf' and (a.width is not null or a.height is not null))
    or coalesce(a.language,'th')<>'th' then
    raise exception 'Invalid upload metadata' using errcode='23514';
  end if;
  -- The upload writer uses this same transaction lock while installing bytes.
  perform pg_advisory_xact_lock(hashtextextended(a.checksum,0));
  insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,asset_type,storage_bucket,
    storage_path,checksum,file_size,width,height,language,owner_id,provenance,source_system)
  values(asset_uuid,a.original_filename,a.mime_type,'/v1/assets/' || asset_uuid::text || '/file','pending',
    a.asset_type,case when hosted then 'hub-test-assets' else 'local-originals' end,a.storage_path,a.checksum,a.file_size,a.width,a.height,
    coalesce(a.language,'th'),actor,'upload',case when hosted then 'hub-hosted-test' else 'hub-local' end)
  on conflict (checksum) where deleted_at is null and checksum is not null do nothing
  returning * into a;
  reused := not found;
  if reused then
    -- A separate statement sees a concurrent uploader's committed winner under
    -- READ COMMITTED. Never UPDATE the winner: its rights and timestamps are intact.
    select * into a from hub.assets where checksum=metadata->>'checksum' and deleted_at is null;
  end if;
  return jsonb_build_object('asset',to_jsonb(a),'reused',reused);
end $$;

create or replace function hub.residential_payload(kind text,entity_id uuid,demo_mode boolean default false) returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare p jsonb;selection hub.demo_release_selection;selected_assets jsonb;models jsonb;begin
 p:=case kind when 'brand' then hub.brand_draft_payload(entity_id) when 'project' then hub.draft_payload(entity_id) end;
 if not demo_mode or p is null then return p;end if;perform hub.residential_environment();
 select * into selection from hub.demo_release_selection s where s.entity_type=kind and s.entity_id=residential_payload.entity_id;
 if not found then raise exception 'ยังไม่ได้เตรียมชุดข้อมูลตัวอย่างสำหรับรายการนี้' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('id',a.id,'asset_role',e->>'asset_role','is_primary',true,'alt_text',e->'alt_text','display_order',n,
 'public_url',a.public_url,'original_filename',a.original_filename,'mime_type',a.mime_type,'rights_status',a.rights_status,'effective_from',a.effective_from,'effective_to',a.effective_to,'entity_scope',kind,'model_type_id',null,'public_model_id',null,'demo_fields',jsonb_build_array('asset')) order by n)
 into selected_assets from jsonb_array_elements(selection.assets) with ordinality x(e,n) join hub.demo_assets d on d.asset_id=(e->>'asset_id')::uuid join hub.assets a on a.id=d.asset_id and a.checksum=d.checksum;
 if selected_assets is null or jsonb_array_length(selected_assets)<>jsonb_array_length(selection.assets) then raise exception 'ชุดภาพตัวอย่างเปลี่ยนแล้ว' using errcode='23514';end if;
 p:=p||jsonb_build_object('demo_mode',true,'demo_excluded_asset_count',jsonb_array_length(p->'assets'),'assets',selected_assets,'demo_selection_evidence',selection.evidence);
 if kind='project' then
 if exists(select 1 from unnest(selection.model_ids) mid(value) left join hub.model_types m on m.id=mid.value left join staging.rem_models s on s.rem_project_id=m.rem_project_id and s.rem_model_id=m.rem_model_id where m.id is null or m.project_id<>entity_id or m.deleted_at is not null or m.match_status<>'CONFIRMED' or cardinality(m.demo_fields)=0 or s.source_record->>'synthetic_only' is distinct from 'true') then raise exception 'แบบตัวอย่างเปลี่ยนแล้ว' using errcode='23514';end if;
 select coalesce(jsonb_agg(e),'[]') into models from jsonb_array_elements(p->'models') e where(e->>'id')::uuid=any(selection.model_ids);
 p:=p||jsonb_build_object('demo_excluded_model_count',jsonb_array_length(p->'models')-jsonb_array_length(models),'models',models);end if;
 return p;
end $$;

create or replace function hub.promotion_command(action text,p_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;r hub.public_promotions;merged jsonb;field text;allowed text[];v uuid;review_revision integer;
begin
 perform hub.residential_environment();
 actor:=hub.require_actor(case when action in('create','update') then array['editor','admin'] else array['publisher'] end);
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'ข้อมูลไม่ถูกต้อง' using errcode='22023';end if;
 allowed:=case action
 when 'create' then array['project_id','code','title','summary','conditions_public','legal_terms','disclaimer','benefit_type','benefit_value','benefit_unit','stackable','priority','starts_at','ends_at','source_offer_key']
 when 'update' then array['expected_revision','title','summary','conditions_public','legal_terms','disclaimer','benefit_type','benefit_value','benefit_unit','stackable','priority','starts_at','ends_at','source_offer_key']
 when 'review' then array['expected_revision','review_revision','review_type','decision','evidence','change_reason']
 when 'publish' then array['expected_revision','expected_published_version_id','change_reason']
 when 'withdraw' then array['expected_revision','expected_published_version_id','change_reason'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then raise exception 'มีช่องข้อมูลที่ไม่ได้รับอนุญาต' using errcode='22023';end if;
 foreach field in array array['starts_at','ends_at'] loop
 if p?field and(jsonb_typeof(p->field) is distinct from 'string' or p->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'เวลาต้องระบุเขตเวลา' using errcode='22023';end if;end loop;
 perform set_config('app.change_reason',coalesce(nullif(btrim(p->>'change_reason'),''),'Synthetic promotion draft'),true);
 if action='create' then
 merged:=jsonb_build_object('title','{}'::jsonb,'summary','{}'::jsonb,'conditions_public','{}'::jsonb,'legal_terms','{}'::jsonb,'disclaimer','{}'::jsonb,'stackable',false,'priority',100)||p;
 perform hub.validate_promotion(merged);
 insert into hub.public_promotions(project_id,code,title,summary,conditions_public,legal_terms,disclaimer,benefit_type,benefit_value,benefit_unit,stackable,priority,starts_at,ends_at,source_offer_key,created_by,updated_by,demo_fields)
 values((p->>'project_id')::uuid,p->>'code',merged->'title',merged->'summary',merged->'conditions_public',merged->'legal_terms',merged->'disclaimer',p->>'benefit_type',(p->>'benefit_value')::numeric,p->>'benefit_unit',(merged->>'stackable')::boolean,(merged->>'priority')::integer,(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,p->>'source_offer_key',actor,actor,array['promotion','review_evidence']) returning * into r;
 return hub.promotion_read(r.id);
 end if;
 -- Parent first, matching release lock order; project withdrawal cannot race this publication.
 perform 1 from hub.projects where id=(select project_id from hub.public_promotions where id=p_id) for update;
 select * into r from hub.public_promotions where id=p_id for update;
 if not found then raise exception 'ไม่พบโปรโมชั่น' using errcode='P0002';end if;
 if (p->>'expected_revision')::integer is distinct from r.draft_revision then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
 if action='update' then
 merged:=hub.promotion_payload(r.id)||(p-'expected_revision');perform hub.validate_promotion(merged);
 update hub.public_promotions set title=merged->'title',summary=merged->'summary',conditions_public=merged->'conditions_public',legal_terms=merged->'legal_terms',disclaimer=merged->'disclaimer',benefit_type=merged->>'benefit_type',benefit_value=(merged->>'benefit_value')::numeric,benefit_unit=merged->>'benefit_unit',stackable=(merged->>'stackable')::boolean,priority=(merged->>'priority')::integer,starts_at=(merged->>'starts_at')::timestamptz,ends_at=(merged->>'ends_at')::timestamptz,source_offer_key=merged->>'source_offer_key',draft_revision=draft_revision+1 where id=r.id;
 elsif action='review' then
 if nullif(btrim(p->>'change_reason'),'') is null or nullif(btrim(p->>'evidence'),'') is null then raise exception 'ต้องระบุหลักฐานและเหตุผล' using errcode='23514';end if;
 review_revision:=coalesce((p->>'review_revision')::integer,r.draft_revision);
 if review_revision<>r.draft_revision and(p->>'decision'<>'REVOKED' or not exists(select 1 from hub.promotion_versions pv where pv.promotion_id=r.id and pv.draft_revision=review_revision)) then raise exception 'ตรวจทานได้เฉพาะฉบับปัจจุบัน หรือเพิกถอนฉบับที่เคยเผยแพร่' using errcode='23514';end if;
 insert into hub.promotion_reviews(promotion_id,review_revision,review_type,decision,evidence,change_reason,reviewed_by) values(r.id,review_revision,p->>'review_type',p->>'decision',p->>'evidence',p->>'change_reason',actor);
 else
 if not p?'expected_published_version_id' or (p->>'expected_published_version_id')::uuid is distinct from r.published_version_id then raise exception 'ฉบับเผยแพร่เปลี่ยนแล้ว' using errcode='40001';end if;
 if nullif(btrim(p->>'change_reason'),'') is null then raise exception 'ต้องระบุเหตุผล' using errcode='23514';end if;
 if action='publish' then
 merged:=hub.promotion_payload(r.id);
 if not(hub.promotion_readiness(merged)->>'ready')::boolean then raise exception 'โปรโมชั่นยังไม่พร้อมเผยแพร่' using errcode='23514',detail=hub.promotion_readiness(merged)::text;end if;
 insert into hub.promotion_versions(promotion_id,version_no,draft_revision,payload,published_by,change_reason) select r.id,coalesce(max(version_no),0)+1,r.draft_revision,merged,actor,p->>'change_reason' from hub.promotion_versions where promotion_id=r.id returning id into v;
 update hub.public_promotions set published_version_id=v where id=r.id;
 else update hub.public_promotions set published_version_id=null where id=r.id;end if;
 end if;
 return hub.promotion_read(r.id);
end $$;

create or replace function hub.release_candidates(demo_mode boolean default false) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare items jsonb:='[]';r record;p jsonb;readiness jsonb;begin
 perform hub.require_actor(array['editor','admin','publisher','viewer']);if demo_mode then perform hub.residential_environment();end if;
 for r in select 'brand'::text kind,id,public_brand_id public_id,updated_at,null::integer revision,published_version_id from hub.brands where deleted_at is null
 union all select 'project',id,public_project_id,updated_at,null,published_version_id from hub.projects where deleted_at is null
 union all select 'promotion',id,code,updated_at,draft_revision,published_version_id from hub.public_promotions order by kind,public_id loop
 if demo_mode and r.kind<>'promotion' and not exists(select 1 from hub.demo_release_selection where entity_type=r.kind and entity_id=r.id) then continue;end if;
 p:=case when r.kind='promotion' then hub.promotion_payload(r.id) else hub.residential_payload(r.kind,r.id,demo_mode) end;
 readiness:=case r.kind when 'brand' then hub.brand_snapshot_readiness(p) when 'project' then hub.snapshot_readiness(p) else hub.promotion_readiness(p) end;
 items:=items||jsonb_build_array(jsonb_build_object('entity_type',r.kind,'entity_id',r.id,'public_id',r.public_id,'title',coalesce(p->'title',p->'public_name'),'expected_updated_at',case when r.kind<>'promotion' then r.updated_at end,'expected_revision',r.revision,'expected_published_version_id',r.published_version_id,'readiness',readiness,'demo_fields',coalesce(p->'demo_fields','[]'),'demo_mode',coalesce((p->>'demo_mode')::boolean,false),'demo_excluded_asset_count',p->'demo_excluded_asset_count','demo_excluded_model_count',p->'demo_excluded_model_count'));
 end loop;return jsonb_build_object('items',items);
end $$;

create or replace function hub.release_publish(members jsonb,reason text,demo_mode boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;e jsonb;kind text;entity uuid;pointer uuid;stamp timestamptz;revision integer;public_id text;release_id uuid;version_id uuid;p jsonb;readiness jsonb;result jsonb;
begin
 perform hub.residential_environment();actor:=hub.require_actor(array['publisher']);
 if nullif(btrim(reason),'') is null or demo_mode is null or jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members) not between 1 and 100 then raise exception 'ต้องเลือกรายการและระบุเหตุผล' using errcode='22023';end if;
 if(select count(distinct (x.value->>'entity_type',x.value->>'entity_id')) from jsonb_array_elements(members) x(value))<>jsonb_array_length(members) then raise exception 'เลือกรายการซ้ำ' using errcode='22023';end if;
 for e in select value from jsonb_array_elements(members) loop
 if jsonb_typeof(e) is distinct from 'object' or e->>'entity_type' is null or e->>'entity_type' not in('brand','project','promotion') or e->>'entity_id' is null or not e?'expected_published_version_id'
 or exists(select 1 from jsonb_object_keys(e) k where k not in('entity_type','entity_id','expected_updated_at','expected_revision','expected_published_version_id')) then raise exception 'รายการเผยแพร่ไม่ถูกต้อง' using errcode='22023';end if;end loop;
 perform hub.lock_release_members(members);
 -- Check all expected state before writing any member.
 for e in select value from jsonb_array_elements(members) loop
 kind:=e->>'entity_type';entity:=(e->>'entity_id')::uuid;
 if kind='brand' then select b.published_version_id,b.updated_at into pointer,stamp from hub.brands b where b.id=entity and b.deleted_at is null;
 elsif kind='project' then select pr.published_version_id,pr.updated_at into pointer,stamp from hub.projects pr where pr.id=entity and pr.deleted_at is null;
 else select pr.published_version_id,pr.draft_revision into pointer,revision from hub.public_promotions pr where pr.id=entity;end if;
 if not found then raise exception 'ไม่พบรายการในชุดเผยแพร่' using errcode='P0002';end if;
 if pointer is distinct from(e->>'expected_published_version_id')::uuid or(kind='promotion' and revision is distinct from(e->>'expected_revision')::integer) or(kind<>'promotion' and stamp is distinct from(e->>'expected_updated_at')::timestamptz) then raise exception 'ข้อมูลในชุดเผยแพร่เปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;end loop;
 perform set_config('app.change_reason',reason,true);
 insert into hub.publication_releases(change_reason,demo_mode,published_by) values(reason,demo_mode,actor) returning id into release_id;
 for e in select value from jsonb_array_elements(members) order by case value->>'entity_type' when 'brand' then 1 when 'project' then 2 else 3 end,value->>'entity_id' loop
 kind:=e->>'entity_type';entity:=(e->>'entity_id')::uuid;
 if kind='promotion' then result:=hub.promotion_command('publish',entity,jsonb_build_object('expected_revision',e->'expected_revision','expected_published_version_id',e->'expected_published_version_id','change_reason',reason));version_id:=(result->>'published_version_id')::uuid;public_id:=result->>'code';
 else
 p:=hub.residential_payload(kind,entity,demo_mode);
 perform a.id from hub.assets a where a.id in(select(x->>'id')::uuid from jsonb_array_elements(coalesce(p->'assets','[]')) x union select(x->>'id')::uuid from jsonb_array_elements(coalesce(p#>'{brand,assets}','[]')) x) order by a.id for share;
 if not demo_mode then version_id:=case kind when 'brand' then hub.publish_brand(entity,reason) else hub.publish_project(entity,reason) end;
 else
 readiness:=case kind when 'brand' then hub.brand_snapshot_readiness(p) else hub.snapshot_readiness(p) end;
 if not(readiness->>'ready')::boolean then raise exception 'ข้อมูลตัวอย่างยังไม่พร้อมเผยแพร่' using errcode='23514',detail=readiness::text;end if;
 if kind='brand' then insert into hub.brand_versions(brand_id,version_no,payload,publisher,change_reason) select entity,coalesce(max(version_no),0)+1,p,actor,reason from hub.brand_versions where brand_id=entity returning id into version_id;update hub.brands set published_version_id=version_id where id=entity;
 else insert into hub.entity_versions(project_id,version_no,payload,publisher,change_reason) select entity,coalesce(max(version_no),0)+1,p,actor,reason from hub.entity_versions where project_id=entity returning id into version_id;update hub.projects set published_version_id=version_id where id=entity;end if;
 end if;public_id:=case kind when 'brand' then p->>'public_brand_id' else p->>'public_project_id' end;
 end if;
 insert into hub.publication_release_members values(release_id,kind,entity,public_id,(e->>'expected_published_version_id')::uuid,version_id);
 end loop;return hub.release_read(release_id);
end $$;

create or replace function hub.release_rollback(p_id uuid,reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;r hub.publication_releases;m hub.publication_release_members;members jsonb;pointer uuid;p jsonb;
begin
 perform hub.residential_environment();actor:=hub.require_actor(array['publisher']);if nullif(btrim(reason),'') is null then raise exception 'ต้องระบุเหตุผล' using errcode='23514';end if;
 select * into r from hub.publication_releases where id=p_id for update;
 if not found then raise exception 'ไม่พบชุดเผยแพร่' using errcode='P0002';end if;
 if r.status<>'PUBLISHED' then raise exception 'ชุดนี้ถูกย้อนกลับแล้ว' using errcode='40001';end if;
 select jsonb_agg(to_jsonb(x)) into members from hub.publication_release_members x where release_id=p_id;
 perform hub.lock_release_members(members);
 for m in select * from hub.publication_release_members where release_id=p_id loop
 if m.entity_type='brand' then select published_version_id into pointer from hub.brands where id=m.entity_id;
 elsif m.entity_type='project' then select published_version_id into pointer from hub.projects where id=m.entity_id;
 else select published_version_id into pointer from hub.public_promotions where id=m.entity_id;end if;
 if pointer is distinct from m.after_version_id then raise exception 'มีการเผยแพร่ภายหลัง ไม่สามารถทับฉบับใหม่' using errcode='40001';end if;
 end loop;
 perform set_config('app.change_reason',reason,true);
 for m in select * from hub.publication_release_members where release_id=p_id order by case entity_type when 'brand' then 1 when 'project' then 2 else 3 end,entity_id loop
 if m.entity_type='brand' then
 if m.before_version_id is null then perform hub.withdraw_brand(m.entity_id,reason);else perform hub.rollback_brand(m.entity_id,m.before_version_id,reason);end if;
 elsif m.entity_type='project' then
 if m.before_version_id is null then perform hub.withdraw_project(m.entity_id,reason);else perform hub.rollback_project(m.entity_id,m.before_version_id,reason);end if;
 else
 if m.before_version_id is not null then
 select payload into p from hub.promotion_versions where id=m.before_version_id and promotion_id=m.entity_id;
 if p is null or not(hub.promotion_readiness(p)->>'ready')::boolean then raise exception 'โปรโมชั่นฉบับเดิมไม่พร้อมใช้งานแล้ว' using errcode='23514';end if;
 end if;update hub.public_promotions set published_version_id=m.before_version_id where id=m.entity_id;
 end if;
 end loop;
 update hub.publication_releases set status='ROLLED_BACK',rolled_back_by=actor,rolled_back_at=clock_timestamp(),rollback_reason=reason where id=p_id;
 return hub.release_read(p_id);
end $$;

-- Managed migration owners do not bypass FORCE RLS. Only their guarded
-- SECURITY DEFINER residential functions need this policy, never actor roles.
do $$ declare item record;begin
 if hub.hosted_test_profile() then
  for item in select * from(values('hub','demo_assets'),('hub','demo_release_selection'),('staging','source_offers'),('hub','public_promotions'),('hub','promotion_reviews'),('hub','promotion_versions'),('hub','publication_releases'),('hub','publication_release_members')) x(schema_name,table_name) loop
   execute format('create policy hosted_residential_function_owner on %I.%I to %I using(true) with check(true)',item.schema_name,item.table_name,current_user);
  end loop;
 end if;
end $$;

create or replace function hub.asset_file(asset_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  select jsonb_build_object('id',a.id,'storage_bucket',a.storage_bucket,'source_system',a.source_system,'storage_path',a.storage_path,
    'mime_type',a.mime_type,'original_filename',a.original_filename,'checksum',a.checksum,'file_size',a.file_size)
    into result from hub.assets a where a.id=asset_uuid and a.deleted_at is null and a.storage_path is not null;
  if result is null then raise exception 'File not found' using errcode='P0002'; end if;
  return result;
end $$;

create or replace function public_api.asset_file(asset_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  perform hub.require_actor(array['service_consumer']);
  select jsonb_build_object('id',a.id,'storage_bucket',a.storage_bucket,'source_system',a.source_system,'storage_path',a.storage_path,
    'mime_type',a.mime_type,'original_filename',a.original_filename,'checksum',a.checksum,'file_size',a.file_size)
    into result from hub.assets a where a.id=asset_uuid and a.deleted_at is null and a.storage_path is not null
      and exists(select 1 from (
        select item->>'id' as asset_id from public_api.brands b,jsonb_array_elements(b.payload->'assets') item
        union all
        select item->>'id' from public_api.projects p,jsonb_array_elements(p.payload->'assets') item
        union all
        select item->>'id' from public_api.projects p,jsonb_array_elements(p.payload#>'{brand,assets}') item
      ) eligible where eligible.asset_id=a.id::text);
  if result is null then raise exception 'File not found' using errcode='P0002'; end if;
  return result;
end $$;

commit;
