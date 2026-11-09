-- W3.2 additive ownership and reviewed scope. No existing rows are rewritten.
begin;
alter table hub.public_promotions
 add column owning_brand_id uuid references hub.brands,
 add column excluded_project_ids uuid[] not null default '{}',
 alter column project_id drop not null,
 add constraint promotion_exact_owner check((project_id is null)<>(owning_brand_id is null)),
 add constraint promotion_exclusions_bound check(cardinality(excluded_project_ids)<=100 and array_position(excluded_project_ids,null) is null);
alter table hub.promotion_reviews add column resolved_project_ids text[];

create function hub.promotion_owner_guard() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
 if new.project_id is distinct from old.project_id or new.owning_brand_id is distinct from old.owning_brand_id then
  raise exception 'Promotion ownership is immutable' using errcode='23514';end if;
 return new;
end $$;
create trigger promotion_exact_owner before update on hub.public_promotions
for each row execute function hub.promotion_owner_guard();

create function hub.promotion_scope_projects(owner_project uuid,owner_brand uuid,targets jsonb,excluded uuid[])
returns table(id uuid,public_id text) language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select p.id,p.public_project_id from hub.projects p where p.deleted_at is null
 and not(p.id=any(coalesce(excluded,'{}'))) and (p.id=owner_project or p.brand_id=owner_brand or exists(
  select 1 from jsonb_array_elements(targets) t where
  t->>'type'='project' and t->>'id'=p.id::text or t->>'type'='brand' and t->>'id'=p.brand_id::text
  or t->>'type'='commercial_type' and exists(select 1 from hub.commercial_types c
   where c.id::text=t->>'id' and c.project_id=p.id and c.deleted_at is null)))
$$;

create function hub.validate_promotion_scope(owner_project uuid,owner_brand uuid,targets jsonb,excluded uuid[])
returns void language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if (owner_project is null)=(owner_brand is null) or excluded is null
 or cardinality(excluded)>100 or array_position(excluded,null) is not null
 or cardinality(excluded)<>(select count(distinct x) from unnest(excluded) x) then
  raise exception 'Invalid promotion ownership or exclusions' using errcode='22023';end if;
 perform hub.require_permission('projects','view');
 if owner_project is not null and not exists(select 1 from hub.projects where id=owner_project and deleted_at is null) then
  raise exception 'Project owner not found' using errcode='23514';end if;
 if owner_brand is not null then
  perform hub.require_permission('brands','view');
  if not exists(select 1 from hub.brands where id=owner_brand and deleted_at is null) then
   raise exception 'Brand owner not found' using errcode='23514';end if;
 end if;
 perform hub.validate_promotion_targets(targets);
 if exists(select 1 from unnest(excluded) x where not exists(select 1 from hub.projects where id=x and deleted_at is null)) then
  raise exception 'Excluded project not found' using errcode='23514';end if;
end $$;

create or replace function hub.promotion_target_projects(p_id uuid) returns table(id uuid,public_id text)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select scope.* from hub.public_promotions p cross join lateral
 hub.promotion_scope_projects(p.project_id,p.owning_brand_id,p.targets,p.excluded_project_ids) scope where p.id=p_id
$$;

create function hub.promotion_scope_snapshot(p_id uuid) returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('project_ids',ids,'hash',hub.web_hash(ids)) from (
  select coalesce(jsonb_agg(public_id order by public_id),'[]') ids from hub.promotion_target_projects(p_id)) scope
$$;

create function hub.promotion_scope_access(p_id uuid,level text) returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.require_permission('promotions',level);p hub.public_promotions;begin
 select * into p from hub.public_promotions where id=p_id;
 if not found then raise exception 'Promotion not found' using errcode='P0002';end if;
 perform hub.require_permission('projects','view');
 if p.owning_brand_id is not null or exists(select 1 from jsonb_array_elements(p.targets) t where t->>'type'='brand') then
  perform hub.require_permission('brands','view');end if;
 return actor;
end $$;

create function hub.promotion_scope_visible(p_id uuid) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select coalesce((select hub.can('promotions','view') and hub.can('projects','view') and
  (p.owning_brand_id is null and not exists(select 1 from jsonb_array_elements(p.targets) t where t->>'type'='brand')
   or hub.can('brands','view')) from hub.public_promotions p where p.id=p_id),false)
$$;

create function hub.promotion_resolve(scope jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare excluded uuid[];rows jsonb;ids jsonb;begin
 perform hub.require_permission('promotions','view');
 if jsonb_typeof(scope) is distinct from 'object'
 or scope-array['project_id','owning_brand_id','targets','excluded_project_ids']<>'{}'
 or scope?'excluded_project_ids' and jsonb_typeof(scope->'excluded_project_ids') is distinct from 'array' then
  raise exception 'Invalid promotion scope' using errcode='22023';end if;
 excluded:=array(select x::uuid from jsonb_array_elements_text(coalesce(scope->'excluded_project_ids','[]')) x);
 perform hub.validate_promotion_scope((scope->>'project_id')::uuid,(scope->>'owning_brand_id')::uuid,
  coalesce(scope->'targets','[]'),excluded);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'public_id',p.public_project_id,'label',p.public_name) order by p.public_project_id),'[]'),
  coalesce(jsonb_agg(p.public_project_id order by p.public_project_id),'[]') into rows,ids
 from hub.promotion_scope_projects((scope->>'project_id')::uuid,(scope->>'owning_brand_id')::uuid,
  coalesce(scope->'targets','[]'),excluded) s join hub.projects p on p.id=s.id;
 return jsonb_build_object('items',rows,'count',jsonb_array_length(rows),'scope_hash',hub.web_hash(ids));
end $$;
CREATE OR REPLACE FUNCTION hub.promotion_payload(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 select (to_jsonb(p)-array['created_by','created_at','updated_by','updated_at','published_version_id','editors','returned_revision','return_reason','returned_by','returned_at'])||jsonb_build_object('benefit_value',p.benefit_value::text,'public_project_id',project.public_project_id,'source_snapshot_at',s.source_snapshot_at,'target_project_ids',(select coalesce(jsonb_agg(public_id order by public_id),'[]') from hub.promotion_target_projects(p.id)),
   'public_targets',coalesce((select jsonb_agg(jsonb_build_object('type',t->>'type','public_id',case t->>'type'
    when 'project' then (select public_project_id from hub.projects where id=(t->>'id')::uuid and deleted_at is null)
    when 'brand' then (select public_brand_id from hub.brands where id=(t->>'id')::uuid and deleted_at is null)
    when 'commercial_type' then (select public_commercial_type_id from hub.commercial_types where id=(t->>'id')::uuid and deleted_at is null) end)) from jsonb_array_elements(p.targets) t),'[]'),
   'banners',hub.promotion_banners(p.id),'public_owning_brand_id',owner_brand.public_brand_id,'applies_via',case when p.owning_brand_id is not null then jsonb_build_object('scope_level','brand','brand_id',owner_brand.public_brand_id) else jsonb_build_object('scope_level','project','project_id',project.public_project_id) end)
 from hub.public_promotions p left join hub.projects project on project.id=p.project_id left join hub.brands owner_brand on owner_brand.id=p.owning_brand_id left join staging.source_offers s on s.source_offer_key=p.source_offer_key where p.id=p_id
$function$;
CREATE OR REPLACE FUNCTION hub.promotion_command(action text, p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare actor uuid;r hub.public_promotions;merged jsonb;field text;allowed text[];v uuid;review_revision integer;
begin
 perform hub.residential_environment();
 actor:=hub.require_permission('promotions',case when action in('create','update') then 'edit' when action in('publish','withdraw') then 'view' else 'approve' end);
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'ข้อมูลไม่ถูกต้อง' using errcode='22023';end if;
 allowed:=case action
 when 'create' then array['synthetic','project_id','owning_brand_id','code','suggestion','title','summary','conditions_public','legal_terms','disclaimer','benefit_type','benefit_value','benefit_unit','stackable','priority','starts_at','ends_at','source_offer_key','audience','targets','booking_from','booking_to','transfer_from','transfer_to','excluded_project_ids']
 when 'update' then array['expected_revision','title','summary','conditions_public','legal_terms','disclaimer','benefit_type','benefit_value','benefit_unit','stackable','priority','starts_at','ends_at','source_offer_key','audience','targets','booking_from','booking_to','transfer_from','transfer_to','excluded_project_ids']
 when 'review' then array['expected_revision','review_revision','review_type','decision','evidence','change_reason','expected_scope_hash']
 when 'publish' then array['expected_revision','expected_published_version_id','change_reason']
 when 'withdraw' then array['expected_revision','expected_published_version_id','change_reason'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then raise exception 'มีช่องข้อมูลที่ไม่ได้รับอนุญาต' using errcode='22023';end if;
 foreach field in array array['starts_at','ends_at'] loop
 if p?field and(jsonb_typeof(p->field) is distinct from 'string' or p->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'เวลาต้องระบุเขตเวลา' using errcode='22023';end if;end loop;
 perform set_config('app.change_reason',coalesce(nullif(btrim(p->>'change_reason'),''),'Promotion draft'),true);
 if action in('publish','withdraw') then perform hub.publication_actor(); perform hub.publication_write_lock();end if; if action='create' then
 merged:=jsonb_build_object('title','{}'::jsonb,'summary','{}'::jsonb,'conditions_public','{}'::jsonb,'legal_terms','{}'::jsonb,'disclaimer','{}'::jsonb,'stackable',false,'priority',100)||p;
 perform hub.validate_promotion(merged);
 perform hub.validate_promotion_scope((merged->>'project_id')::uuid,(merged->>'owning_brand_id')::uuid,
  coalesce(merged->'targets','[]'),array(select x::uuid from jsonb_array_elements_text(coalesce(merged->'excluded_project_ids','[]')) x)); if p?'targets' then perform hub.validate_promotion_targets(p->'targets');end if;
 if p->>'suggestion' is not null then
  if jsonb_typeof(p->'suggestion')<>'object' or (p->'suggestion')-array['kind','ref','phase','candidate_id','source']<>'{}'
   or p#>>'{suggestion,candidate_id}' is null or p#>>'{suggestion,source}' is null or p#>>'{suggestion,source}' not in ('website','km') then
   raise exception 'Invalid promotion suggestion identity' using errcode='22023';end if;
  perform hub.workspace_promotion_suggestions(p#>>'{suggestion,kind}',p#>>'{suggestion,ref}',p#>>'{suggestion,phase}',
   1,0,(p#>>'{suggestion,candidate_id}')::uuid,p#>>'{suggestion,source}');
  if (p#>>'{suggestion,kind}'='project' and (p->>'project_id')::uuid=(hub.workspace_phase('project',p#>>'{suggestion,ref}',p#>>'{suggestion,phase}')).id
   or p#>>'{suggestion,kind}'='brand' and exists(select 1 from hub.brands where id=(p->>'owning_brand_id')::uuid and public_brand_id=p#>>'{suggestion,ref}')) is not true then
   raise exception 'Suggestion and promotion owner must match' using errcode='23514';end if;
  perform set_config('app.change_reason','Promotion draft from '||(p#>>'{suggestion,source}')||' suggestion '||(p#>>'{suggestion,candidate_id}'),true);
 end if;
 insert into hub.public_promotions(project_id,owning_brand_id,excluded_project_ids,code,title,summary,conditions_public,legal_terms,disclaimer,benefit_type,benefit_value,benefit_unit,stackable,priority,starts_at,ends_at,source_offer_key,created_by,updated_by,demo_fields,synthetic,audience,targets,booking_from,booking_to,transfer_from,transfer_to,editors)
 values((p->>'project_id')::uuid,(p->>'owning_brand_id')::uuid,array(select x::uuid from jsonb_array_elements_text(coalesce(p->'excluded_project_ids','[]')) x),p->>'code',merged->'title',merged->'summary',merged->'conditions_public',merged->'legal_terms',merged->'disclaimer',p->>'benefit_type',(p->>'benefit_value')::numeric,p->>'benefit_unit',(merged->>'stackable')::boolean,(merged->>'priority')::integer,(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,p->>'source_offer_key',actor,actor,case when coalesce((p->>'synthetic')::boolean,true) then array['promotion','review_evidence'] else array[]::text[] end,
   coalesce((p->>'synthetic')::boolean,true),coalesce(p->>'audience','general'),coalesce(p->'targets','[]'),
   (p->>'booking_from')::date,(p->>'booking_to')::date,(p->>'transfer_from')::date,(p->>'transfer_to')::date,array[actor]) returning * into r;
 return hub.promotion_read(r.id);
 end if;
 -- Parent first, matching release lock order; project withdrawal cannot race this publication.
 perform hub.lock_release_members(jsonb_build_array(jsonb_build_object('entity_type','promotion','entity_id',p_id)));
 select * into r from hub.public_promotions where id=p_id for update;
 if not found then raise exception 'ไม่พบโปรโมชั่น' using errcode='P0002';end if;
 if (p->>'expected_revision')::integer is distinct from r.draft_revision then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
 perform hub.promotion_scope_access(r.id,case when action='update' then 'edit' when action='review' then 'approve' else 'view' end);
 if action='update' then
 merged:=hub.promotion_payload(r.id)||(p-'expected_revision');perform hub.validate_promotion(merged);
 perform hub.validate_promotion_scope((merged->>'project_id')::uuid,(merged->>'owning_brand_id')::uuid,
  coalesce(merged->'targets','[]'),array(select x::uuid from jsonb_array_elements_text(coalesce(merged->'excluded_project_ids','[]')) x)); if p?'targets' then perform hub.validate_promotion_targets(p->'targets');end if;
 update hub.public_promotions set title=merged->'title',summary=merged->'summary',conditions_public=merged->'conditions_public',legal_terms=merged->'legal_terms',disclaimer=merged->'disclaimer',benefit_type=merged->>'benefit_type',benefit_value=(merged->>'benefit_value')::numeric,benefit_unit=merged->>'benefit_unit',stackable=(merged->>'stackable')::boolean,priority=(merged->>'priority')::integer,starts_at=(merged->>'starts_at')::timestamptz,ends_at=(merged->>'ends_at')::timestamptz,source_offer_key=merged->>'source_offer_key',audience=merged->>'audience',targets=merged->'targets',excluded_project_ids=array(select x::uuid from jsonb_array_elements_text(merged->'excluded_project_ids') x),
   booking_from=(merged->>'booking_from')::date,booking_to=(merged->>'booking_to')::date,transfer_from=(merged->>'transfer_from')::date,transfer_to=(merged->>'transfer_to')::date,
   editors=array(select distinct e from unnest(r.editors||array[r.created_by,actor]) e where e is not null),draft_revision=draft_revision+1 where id=r.id;
 elsif action='review' then
   if not r.synthetic and p->>'decision'='APPROVED' and actor=any(r.editors||array[r.created_by]) then raise exception 'Another person must review this revision' using errcode='42501';end if;
 if nullif(btrim(p->>'change_reason'),'') is null or nullif(btrim(p->>'evidence'),'') is null then raise exception 'ต้องระบุหลักฐานและเหตุผล' using errcode='23514';end if;
 review_revision:=coalesce((p->>'review_revision')::integer,r.draft_revision);
 if review_revision<>r.draft_revision and(p->>'decision'<>'REVOKED' or not exists(select 1 from hub.promotion_versions pv where pv.promotion_id=r.id and pv.draft_revision=review_revision)) then raise exception 'ตรวจทานได้เฉพาะฉบับปัจจุบัน หรือเพิกถอนฉบับที่เคยเผยแพร่' using errcode='23514';end if;
 if p->>'decision'='APPROVED' and (p->>'expected_scope_hash' is distinct from hub.promotion_scope_snapshot(r.id)->>'hash'
  or not exists(select 1 from hub.promotion_target_projects(r.id))) then
  raise exception 'ขอบเขตโครงการเปลี่ยนแล้ว กรุณาตรวจรายชื่อโครงการอีกครั้ง' using errcode='40001';end if;
 insert into hub.promotion_reviews(promotion_id,review_revision,review_type,decision,evidence,change_reason,reviewed_by,resolved_project_ids)
 values(r.id,review_revision,p->>'review_type',p->>'decision',p->>'evidence',p->>'change_reason',actor,
  case when p->>'decision'='APPROVED' then array(select public_id from hub.promotion_target_projects(r.id) order by public_id) end);
 else
 if not p?'expected_published_version_id' or (p->>'expected_published_version_id')::uuid is distinct from r.published_version_id then raise exception 'ฉบับเผยแพร่เปลี่ยนแล้ว' using errcode='40001';end if;
 if nullif(btrim(p->>'change_reason'),'') is null then raise exception 'ต้องระบุเหตุผล' using errcode='23514';end if;
 if action='publish' then
   if not r.synthetic and actor=any(r.editors||array[r.created_by]) then raise exception 'Another person must publish this revision' using errcode='42501';end if;
 merged:=hub.promotion_payload(r.id);
 if not(hub.promotion_readiness(merged)->>'ready')::boolean then raise exception 'โปรโมชั่นยังไม่พร้อมเผยแพร่' using errcode='23514',detail=hub.promotion_readiness(merged)::text;end if;
 insert into hub.promotion_versions(promotion_id,version_no,draft_revision,payload,published_by,change_reason) select r.id,coalesce(max(version_no),0)+1,r.draft_revision,merged,actor,p->>'change_reason' from hub.promotion_versions where promotion_id=r.id returning id into v;
 update hub.public_promotions set published_version_id=v where id=r.id;
 else update hub.public_promotions set published_version_id=null where id=r.id;end if;
 end if;
 return hub.promotion_read(r.id);
end $function$;
CREATE OR REPLACE FUNCTION hub.promotion_read(p_id uuid DEFAULT NULL::uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare result jsonb;begin perform hub.require_permission('promotions','view');
 if p_id is null then return jsonb_build_object('items',coalesce((select jsonb_agg(hub.promotion_read(p.id) order by p.updated_at desc,p.id) from(select * from hub.public_promotions where hub.promotion_scope_visible(public_promotions.id) and (p_filters->>'project_id' is null or exists(select 1 from hub.promotion_target_projects(public_promotions.id) scope where scope.id=(p_filters->>'project_id')::uuid)) order by updated_at desc,id limit least(coalesce((p_filters->>'limit')::int,50),100) offset coalesce((p_filters->>'offset')::int,0)) p),'[]'),'total',(select count(*) from hub.public_promotions where hub.promotion_scope_visible(public_promotions.id) and (p_filters->>'project_id' is null or exists(select 1 from hub.promotion_target_projects(public_promotions.id) scope where scope.id=(p_filters->>'project_id')::uuid))));end if;
 perform hub.promotion_scope_access(p_id,'view');
 select hub.promotion_payload(p.id)||jsonb_build_object('scope',jsonb_build_object('scope_hash',hub.promotion_scope_snapshot(p.id)->>'hash',
  'count',(select count(*) from hub.promotion_target_projects(p.id)),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'public_id',s.public_id,'label',x.public_name) order by s.public_id),'[]')
   from hub.promotion_target_projects(p.id) s join hub.projects x on x.id=s.id)),
 'updated_at',p.updated_at,'published_version_id',p.published_version_id,'publication_available',exists(select 1 from public_api.promotions live where live.promotion_id=p.id),'readiness',hub.promotion_readiness(hub.promotion_payload(p.id)),
 'translations',hub.content_translation_list('promotions',p.id::text),'reviews',coalesce((select jsonb_agg(to_jsonb(r)-'event_seq'-'promotion_id' order by r.review_type) from(select distinct on(review_type) * from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision order by review_type,event_seq desc) r),'[]'),
 'review_history',coalesce((select jsonb_agg(to_jsonb(r)-'event_seq'-'promotion_id' order by r.event_seq desc) from hub.promotion_reviews r where r.promotion_id=p.id),'[]'),
 'published',(select jsonb_build_object('id',v.id,'version_no',v.version_no,'payload',v.payload,'published_at',v.published_at) from hub.promotion_versions v where v.id=p.published_version_id),
 'versions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'version_no',v.version_no,'draft_revision',v.draft_revision,'published_at',v.published_at) order by v.version_no desc) from hub.promotion_versions v where v.promotion_id=p.id),'[]')) into result from hub.public_promotions p where p.id=p_id;
 if result is null then raise exception 'ไม่พบโปรโมชั่นที่มีสิทธิ์เข้าถึง' using errcode='P0002';end if;return result;
end $function$;
CREATE OR REPLACE FUNCTION hub.promotion_readiness(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare missing jsonb:='[]';field text;begin
 foreach field in array array['title','summary','conditions_public','legal_terms','disclaimer'] loop
 if jsonb_typeof(payload#>array[field,'th']) is distinct from 'string' or nullif(btrim(payload#>>array[field,'th']),'') is null then missing:=missing||jsonb_build_array(jsonb_build_object('field',field||'.th','message','กรุณากรอกข้อความภาษาไทยและเงื่อนไขให้ครบ'));end if;end loop;
 if not hub.promotion_approvals_ok((payload->>'id')::uuid,(payload->>'draft_revision')::integer) then missing:=missing||jsonb_build_array(jsonb_build_object('field','reviews','message','ต้องมีหลักฐานตรวจข้อมูลและเงื่อนไขทางกฎหมายของฉบับนี้'));end if;
 if (payload->>'ends_at')::timestamptz<=now() then missing:=missing||jsonb_build_array(jsonb_build_object('field','ends_at','message','โปรโมชั่นหมดอายุแล้ว'));end if;
 if payload->>'owning_brand_id' is null and not exists(select 1 from public_api.projects where public_project_id=promotion_readiness.payload->>'public_project_id') then missing:=missing||jsonb_build_array(jsonb_build_object('field','project','message','โครงการต้องมีฉบับเผยแพร่ที่ใช้งานได้'));end if;
 if payload->>'source_offer_key' is not null and not exists(select 1 from staging.source_offers where source_offer_key=payload->>'source_offer_key' and source_active and not source_deleted) then missing:=missing||jsonb_build_array(jsonb_build_object('field','source_offer_key','message','สิทธิ์อ้างอิงต้นทางไม่พร้อมใช้งาน'));end if;
 if payload->>'synthetic'='false' then
   foreach field in array array['title','summary','conditions_public','legal_terms','disclaimer'] loop
    if not hub.translation_complete('promotion',payload->>'id','promotion.'||field,payload->field) then
     missing:=missing||jsonb_build_array(jsonb_build_object('field',field||'.en','message','ต้องตรวจภาษาอังกฤษของฉบับนี้ด้วยตนเอง'));end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(payload->'public_targets') t where t->>'public_id' is null) then
    missing:=missing||jsonb_build_array(jsonb_build_object('field','targets','message','ขอบเขตโปรโมชันไม่พร้อมใช้งาน'));end if;
  end if;
  if coalesce(jsonb_array_length(payload->'target_project_ids'),0)=0 then
   missing:=missing||jsonb_build_array(jsonb_build_object('field','targets','message','กรุณาเลือกอย่างน้อยหนึ่งโครงการที่ใช้โปรโมชั่นนี้'));
  elsif payload->>'owning_brand_id' is not null and exists(select 1 from jsonb_array_elements_text(payload->'target_project_ids') x
   where not exists(select 1 from public_api.projects where public_project_id=x)) then
   missing:=missing||jsonb_build_array(jsonb_build_object('field','targets','message','ขอบเขตโครงการยังไม่พร้อมเผยแพร่'));
  end if;
  if (select count(*)<>2 or not coalesce(bool_and(resolved_project_ids is not null
    and to_jsonb(resolved_project_ids)=payload->'target_project_ids'),false) from (
     select distinct on(review_type) resolved_project_ids from hub.promotion_reviews
     where promotion_id=(payload->>'id')::uuid and review_revision=(payload->>'draft_revision')::integer
     order by review_type,event_seq desc) latest) then
   missing:=missing||jsonb_build_array(jsonb_build_object('field','review_scope','message','ขอบเขตโครงการเปลี่ยนแล้ว กรุณาตรวจรายชื่อโครงการอีกครั้ง'));
  end if;
  return jsonb_build_object('ready',jsonb_array_length(missing)=0,'missing',missing);
end $function$;

create or replace function hub.lock_release_members(members jsonb) returns void language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
 perform b.id from hub.brands b where b.id in (
  select (e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='brand'
  union select p.brand_id from hub.projects p where p.id in (
   select (e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='project')
  union select pr.owning_brand_id from hub.public_promotions pr join jsonb_array_elements(members) e
   on e->>'entity_type'='promotion' and pr.id=(e->>'entity_id')::uuid
  union select (t->>'id')::uuid from hub.public_promotions pr join jsonb_array_elements(members) e
   on e->>'entity_type'='promotion' and pr.id=(e->>'entity_id')::uuid
   cross join lateral jsonb_array_elements(pr.targets) t where t->>'type'='brand'
  union select p.brand_id from hub.public_promotions pr join jsonb_array_elements(members) e
   on e->>'entity_type'='promotion' and pr.id=(e->>'entity_id')::uuid
   cross join lateral hub.promotion_scope_projects(pr.project_id,pr.owning_brand_id,pr.targets,'{}') s
   join hub.projects p on p.id=s.id) order by b.id for update;
 perform p.id from hub.projects p where p.id in (
  select (e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='project'
  union select s.id from hub.public_promotions pr join jsonb_array_elements(members) e
   on e->>'entity_type'='promotion' and pr.id=(e->>'entity_id')::uuid
   cross join lateral hub.promotion_scope_projects(pr.project_id,pr.owning_brand_id,pr.targets,'{}') s)
  order by p.id for update;
 perform pr.id from hub.public_promotions pr join jsonb_array_elements(members) e
  on e->>'entity_type'='promotion' and pr.id=(e->>'entity_id')::uuid order by pr.id for update;
end $$;
CREATE OR REPLACE FUNCTION hub.track_promotion_translation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare key text;value jsonb:=to_jsonb(new);prior jsonb:='{}';begin
 if tg_op='UPDATE' then prior:=to_jsonb(old);end if;
 foreach key in array array['title','summary','conditions_public','legal_terms','disclaimer'] loop
  if value->key is distinct from prior->key then perform hub.sync_content_translation('promotion',new.id::text,'promotion.'||key,'promotions',new.id::text,jsonb_build_object('id',new.id,'project_id',new.project_id,'owning_brand_id',new.owning_brand_id),value->key);end if;
 end loop;return new;
end $function$;
CREATE OR REPLACE FUNCTION hub.review_content_translation(translation uuid, expected integer, source_version integer, english text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare t hub.content_translations; actor uuid; col text; table_name text; condition text; limit_chars integer; point hub.project_selling_points;
begin
 select * into t from hub.content_translations where id=translation;
 if not found then raise exception 'Translation not found' using errcode='P0002'; end if;
 actor:=hub.require_permission(t.source_tab,'edit');
 -- Lock the same identity/row first as ordinary saves. This avoids reversing
 -- the editor's row -> translation lock order during a concurrent EN review.
 if t.owner_type='article' then
   perform 1 from hub.articles where id=(t.row_ref->>'article_id')::uuid for update;
   perform 1 from hub.article_versions where id=(t.row_ref->>'id')::uuid for update;
   elsif t.owner_type='project' then perform 1 from hub.projects where id=t.owner_key::uuid for update;
 elsif t.owner_type='promotion' then
    perform hub.lock_release_members(jsonb_build_array(jsonb_build_object('entity_type','promotion','entity_id',t.owner_key)));
    perform hub.promotion_scope_access(t.owner_key::uuid,'edit');
   elsif t.owner_type='brand' then perform 1 from hub.brands where id=t.owner_key::uuid for update;
 elsif t.owner_type='faq' then
  perform 1 from hub.faqs where id=t.owner_key::uuid for update;
  perform 1 from hub.faq_versions where id=(t.row_ref->>'id')::uuid for update;
 elsif t.owner_type='section' then
  perform 1 from hub.content_sections where id=t.owner_key::uuid for update;
  perform 1 from hub.content_section_versions where id=(t.row_ref->>'id')::uuid for update;
 elsif t.owner_type in ('facility','building','selling_point','commercial_type','price','disclosure','sales_term','programme','feature','place','solar_estimate') then
  perform 1 from hub.projects where id=(t.row_ref->>'project_id')::uuid for update;
 elsif t.owner_type='question' then perform 1 from hub.faq_questions where question_key=t.owner_key for update;
 end if;
 select * into t from hub.content_translations where id=translation for update;
 if t.revision is distinct from expected or t.th_version is distinct from source_version then raise exception 'Thai source or translation changed' using errcode='40001'; end if;
 if not hub.translation_editable(t) then raise exception 'Submitted translation is immutable; create another draft' using errcode='23514'; end if;
 select coalesce((validation->>'max_length')::integer,12000) into limit_chars from hub.field_catalog where field_key=t.field_key;
 if btrim(coalesce(english,''))='' or char_length(english)>limit_chars then raise exception 'Invalid English translation' using errcode='23514'; end if;
 -- The same placeholder/number multiset must survive manual review as well as
 -- provider validation. No invented financial values can enter via translation.
 if (select coalesce(array_agg(m[1] order by m[1]),'{}') from regexp_matches(t.th_text,'(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)','g') m)
  is distinct from (select coalesce(array_agg(m[1] order by m[1]),'{}') from regexp_matches(english,'(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)','g') m) then
  raise exception 'Placeholders and numbers must be preserved' using errcode='23514'; end if;
 col:=case when t.owner_type='section' then 'body' else split_part(t.field_key,'.',2) end;
 if t.owner_type='article' then
   perform hub.article_translation_write(t,english,actor);
   elsif t.owner_type in ('project','brand','faq','section') then
  table_name:=case t.owner_type when 'project' then 'projects' when 'brand' then 'brands' when 'faq' then 'faq_versions' else 'content_section_versions' end;
  execute format('update hub.%I set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where id=$2',table_name,col,col) using english,(t.row_ref->>'id')::uuid;
  if t.owner_type in ('faq','section') then
   execute format('update hub.%I set editors=array(select distinct unnest(editors||$1::uuid[])) where id=$2',table_name) using array[actor],(t.row_ref->>'id')::uuid;
   if t.owner_type='faq' then update hub.faqs set revision=revision+1 where id=t.owner_key::uuid;
   else update hub.content_sections set revision=revision+1 where id=t.owner_key::uuid; end if;
  end if;
 elsif t.owner_type='facility' then
   if col not in ('description','display_name','location_label','opening_hours') then raise exception 'Invalid facility text' using errcode='23514';end if;
   execute format('update hub.project_facilities set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where project_id=$2 and facility_code=$3',col,col)
    using english,(t.row_ref->>'project_id')::uuid,t.row_ref->>'facility_code';
 elsif t.owner_type='building' then update hub.project_buildings set name=jsonb_set(name,'{en}',to_jsonb(english),true),revision=revision+1
  where project_id=(t.row_ref->>'project_id')::uuid and building_key=t.row_ref->>'building_key';
 elsif t.owner_type='selling_point' then
  select * into point from hub.project_selling_points where project_id=(t.row_ref->>'project_id')::uuid and point_key=t.owner_key::uuid
   order by revision desc limit 1;
  if point.revision is distinct from (t.row_ref->>'revision')::integer then raise exception 'Selling point changed' using errcode='40001'; end if;
  point:=jsonb_populate_record(point,jsonb_build_object(col,jsonb_set(to_jsonb(point)->col,'{en}',to_jsonb(english),true)));
  insert into hub.project_selling_points(project_id,point_key,revision,title,detail,icon_code,linked_feature_code,linked_fact_keys,sort,state,ai_exposure,editors)
   values(point.project_id,point.point_key,point.revision+1,point.title,point.detail,point.icon_code,point.linked_feature_code,point.linked_fact_keys,point.sort,'DRAFT',point.ai_exposure,
    array(select distinct e from unnest(point.editors||array[point.created_by,actor]) e where e is not null));
 elsif t.owner_type='question' then
  execute format('update hub.faq_questions set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true),revision=revision+1,version_author=$2 where question_key=$3',col,col) using english,actor,t.owner_key;
  insert into hub.faq_question_versions(question_key,revision,payload) select question_key,revision,to_jsonb(q) from hub.faq_questions q where question_key=t.owner_key;
 elsif t.owner_type='commercial_type' then
   if col not in ('public_name','description','highlights') then raise exception 'Invalid type text' using errcode='23514';end if;
   execute format('update hub.commercial_types set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where id=$2',col,col) using english,t.owner_key::uuid;
   update hub.projects set updated_at=clock_timestamp() where id=(t.row_ref->>'project_id')::uuid;
   elsif t.owner_type='price' then
   if col not in ('display_text','basis','condition_text') then raise exception 'Invalid price text' using errcode='23514';end if;
   execute format('update hub.project_prices set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true),state=''draft'',revision=revision+1,approved_by=null,approved_at=null,
    editors=array(select distinct e from unnest(editors||array[$3]) e where e is not null) where id=$2',col,col) using english,t.owner_key::uuid,actor;
   update hub.projects set updated_at=clock_timestamp() where id=(t.row_ref->>'project_id')::uuid;
   elsif t.owner_type in ('disclosure','sales_term','programme') then
   table_name:=case t.owner_type when 'disclosure' then 'project_disclosures' when 'sales_term' then 'project_sales_terms' else 'project_programmes' end;
   if not exists(select 1 from hub.field_catalog where field_key=t.field_key and entity=t.owner_type and 'en'=any(locales_required)) then raise exception 'Invalid project translation' using errcode='23514';end if;
   execute format('update hub.%I set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true),state=''draft'',revision=revision+1,approved_by=null,approved_at=null,
    editors=array(select distinct e from unnest(editors||array[created_by,$3]) e where e is not null) where id=$2',table_name,col,col) using english,t.owner_key::uuid,actor;
   update hub.projects set updated_at=clock_timestamp() where id=(t.row_ref->>'project_id')::uuid;
   elsif t.owner_type='promotion' then
   if col not in ('title','summary','conditions_public','legal_terms','disclaimer') then raise exception 'Invalid promotion text' using errcode='23514';end if;
   perform hub.residential_environment();
   execute format('update hub.public_promotions set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true),draft_revision=draft_revision+1,
    editors=array(select distinct e from unnest(editors||array[created_by,$3]) e where e is not null) where id=$2',col,col) using english,t.owner_key::uuid,actor;
   elsif t.owner_type in ('feature','place','solar_estimate') then
   if not(t.owner_type='feature' and col in ('detail','source_note') or t.owner_type='place' and col='name'
    or t.owner_type='solar_estimate' and col in ('usage_profile','assumptions','source_note')) then raise exception 'Invalid project text' using errcode='23514';end if;
   table_name:=case t.owner_type when 'feature' then 'project_features' when 'place' then 'project_places' else 'solar_estimates' end;
   execute format('update hub.%I set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where id=$2',table_name,col,col) using english,t.owner_key::uuid;
   else raise exception 'Unsupported translation target' using errcode='23514'; end if;
 update hub.content_translations set reviewed_en=english,en_from_th_version=th_version,translation_state='reviewed',reviewed_by=actor,reviewed_at=clock_timestamp(),revision=revision+1 where id=translation;
 return (select to_jsonb(c) from hub.content_translations c where id=translation);
end $function$;
CREATE OR REPLACE FUNCTION hub.publication_promotion_check(promotion uuid, revision integer, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare actor uuid:=hub.publication_actor();source hub.public_promotions;reviewers uuid[];editors uuid[];dependency jsonb;deps jsonb:='[]';r record;begin
 perform hub.promotion_scope_access(promotion,'view');select * into source from hub.public_promotions where id=promotion;
 if not found or source.returned_revision=revision then raise exception 'Promotion was returned for editing' using errcode='23514';end if;
 if not(hub.promotion_readiness(payload)->>'ready')::boolean then raise exception 'Promotion DATA and LEGAL review are incomplete' using errcode='23514';end if;
 select array_agg(reviewed_by) into reviewers from (select distinct on(review_type) review_type,reviewed_by,decision
  from hub.promotion_reviews where promotion_id=promotion and review_revision=revision order by review_type,reviewed_at desc,id desc) latest where decision='APPROVED';
 if cardinality(reviewers) is distinct from 2 then raise exception 'Promotion DATA and LEGAL approvals are required' using errcode='23514';end if;
 editors:=source.editors||array(select reviewed_by from hub.content_translations where owner_type='promotion' and owner_key=promotion::text and en_from_th_version=th_version and reviewed_by is not null);
 if actor=any(reviewers) or actor=any(editors) then raise exception 'Promotion publisher must differ from its editors and reviewers' using errcode='42501';end if;
 for r in select id from hub.promotion_target_projects(promotion) loop perform hub.require_permission('projects','view');end loop;
 for r in select * from hub.asset_links where target_type='promotion' and target_key=promotion::text and deleted_at is null and usage='banner' loop
  dependency:=hub.web_dependency('asset_links',jsonb_build_object('id',r.id),'projects');perform hub.publication_dependency_check(dependency,true,true);deps:=deps||jsonb_build_array(dependency);
  dependency:=hub.web_dependency('assets',jsonb_build_object('id',r.asset_id),'projects');perform hub.publication_dependency_check(dependency,true,true);deps:=deps||jsonb_build_array(dependency);
 end loop;
 perform hub.validate_promotion_targets(source.targets);
 return jsonb_build_object('revision',revision,'editors',editors,'approvers',reviewers,'dependencies',deps);
end $function$;
CREATE OR REPLACE FUNCTION hub.release_candidates(demo_mode boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare items jsonb:='[]';r record;p jsonb;readiness jsonb;begin
 perform hub.require_permission('releases','view');if demo_mode then perform hub.residential_environment();end if;
 for r in select 'brand'::text kind,id,public_brand_id public_id,updated_at,null::integer revision,published_version_id from hub.brands where deleted_at is null
 union all select 'project',id,public_project_id,updated_at,null,published_version_id from hub.projects where deleted_at is null
 union all select 'promotion',id,code,updated_at,draft_revision,published_version_id from hub.public_promotions order by kind,public_id loop
   if not hub.can(hub.content_member_tab(r.kind),'view') or r.kind='promotion' and not hub.promotion_scope_visible(r.id) then continue; end if;
 if demo_mode and r.kind<>'promotion' and not exists(select 1 from hub.demo_release_selection where entity_type=r.kind and entity_id=r.id) then continue;end if;
 p:=case when r.kind='promotion' then hub.promotion_payload(r.id) else hub.residential_payload(r.kind,r.id,demo_mode) end;
 readiness:=case r.kind when 'brand' then hub.brand_snapshot_readiness(p) when 'project' then hub.snapshot_readiness(p) else hub.promotion_readiness(p) end;
 items:=items||jsonb_build_array(jsonb_build_object('entity_type',r.kind,'entity_id',r.id,'public_id',r.public_id,'title',coalesce(p->'title',p->'public_name'),'expected_updated_at',case when r.kind<>'promotion' then r.updated_at end,'expected_revision',r.revision,'expected_published_version_id',r.published_version_id,'readiness',readiness,'demo_fields',coalesce(p->'demo_fields','[]'),'demo_mode',coalesce((p->>'demo_mode')::boolean,false),'demo_excluded_asset_count',p->'demo_excluded_asset_count','demo_excluded_model_count',p->'demo_excluded_model_count'));
 end loop;return jsonb_build_object('items',items);
end $function$;
-- Read projections over current drafts, frozen publications and existing import evidence.
create function hub.workspace_promotion_rows(kind text,ref text,phase text)
returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare selected hub.projects;projects uuid[];brand uuid;begin
 perform hub.require_permission('promotions','view');
 if kind is null or kind not in ('project','brand') or kind='brand' and phase is not null then
  raise exception 'Invalid promotion page context' using errcode='22023';end if;
 perform hub.content_scope_access(kind,ref,'view');
 perform hub.require_permission('projects','view');
 if kind='project' then
  selected:=hub.workspace_phase(kind,ref,phase);
  if selected.id is null then raise exception 'Project phase not found' using errcode='P0002';end if;
  projects:=array[selected.id];
 else
  select id into brand from hub.brands where public_brand_id=ref and deleted_at is null;
  projects:=hub.workspace_projects(kind,ref);
 end if;
 return query
 with scoped as materialized (
  select p.*,v.payload published,
   hub.promotion_payload(p.id) draft,
   exists(select 1 from hub.promotion_target_projects(p.id) s where s.id=any(projects)) draft_applies,
   exists(select 1 from hub.projects x where x.id=any(projects) and
    coalesce(v.payload->'target_project_ids',jsonb_build_array(v.payload->>'public_project_id')) ? x.public_project_id) published_applies,
   exists(select 1 from public_api.promotions live where live.promotion_id=p.id and live.project_id=any(projects)) active,
   exists(select 1 from hub.promotion_versions old where old.promotion_id=p.id) was_published
  from hub.public_promotions p left join hub.promotion_versions v on v.id=p.published_version_id
  where hub.promotion_scope_visible(p.id)
 ), included as (
  select s.*,case when active then published else draft end display from scoped s
  where draft_applies or published_applies or owning_brand_id=brand
 )
 select jsonb_build_object('id',s.id,'code',s.code,'title',s.display->'title',
  'project_id',s.project_id,'owning_brand_id',s.owning_brand_id,'draft_revision',s.draft_revision,
  'draft_applies',s.draft_applies,'published_applies',s.published_applies,
  'draft_project_ids',s.draft->'target_project_ids',
  'published_project_ids',case when s.published is null then '[]'::jsonb else
   coalesce(s.published->'target_project_ids',jsonb_build_array(s.published->>'public_project_id')) end,
  'scope_count',jsonb_array_length(coalesce(s.display->'target_project_ids',jsonb_build_array(s.display->>'public_project_id'))),
  'source',jsonb_build_object('kind',case when s.owning_brand_id is not null then 'brand'
   when jsonb_array_length(coalesce(s.display->'target_project_ids',jsonb_build_array(s.display->>'public_project_id')))=1 and s.project_id=selected.id then 'project' else 'shared' end,
   'brand_id',b.public_brand_id,'label',b.public_name),
  'starts_at',s.display->'starts_at','ends_at',s.display->'ends_at',
  'booking_from',s.display->'booking_from','booking_to',s.display->'booking_to',
  'transfer_from',s.display->'transfer_from','transfer_to',s.display->'transfer_to','audience',s.display->'audience',
  'group',case when s.active then 'active' when (s.display->>'ends_at')::timestamptz<=now() then 'expired'
   when exists(select 1 from hub.promotion_reviews r where r.promotion_id=s.id and r.review_revision=s.draft_revision) then 'in_review' else 'draft' end,
  'publication_state',case when s.active then 'active'
   when s.published is not null and (s.published->>'ends_at')::timestamptz<=now() then 'expired'
   when s.published is not null and (s.published->>'starts_at')::timestamptz>now() then 'scheduled'
   when s.published is not null then 'unavailable' when s.was_published then 'withdrawn' else 'draft' end,
  'review_lanes',(select coalesce(jsonb_agg(jsonb_build_object('type',r.review_type,'decision',r.decision) order by r.review_type),'[]')
   from (select distinct on(review_type) review_type,decision from hub.promotion_reviews where promotion_id=s.id
    and review_revision=s.draft_revision order by review_type,event_seq desc) r),
  'banner',(select jsonb_build_object('asset_id',a.id,'rights_status',a.rights_status,'caption',a.caption)
   from hub.assets a where a.deleted_at is null and hub.can_read_asset(a.id) and
    (s.active and exists(select 1 from jsonb_array_elements(coalesce(s.published->'banners','[]')) frozen where frozen->>'id'=a.id::text)
     or not s.active and exists(select 1 from hub.asset_links l where l.asset_id=a.id and l.target_type='promotion'
      and l.target_key=s.id::text and l.usage='banner' and l.deleted_at is null))
   order by (a.rights_status='approved') desc,a.id limit 1),
  'ending_soon',s.active and (s.published->>'ends_at')::timestamptz<=now()+interval '7 days',
  'banner_missing',s.active and not exists(select 1 from public_api.promotions live where live.promotion_id=s.id
   and live.project_id=any(projects) and jsonb_array_length(coalesce(live.payload->'banners','[]'))>0))
 from included s left join hub.brands b on b.id=s.owning_brand_id;
end $$;

create function hub.workspace_promotions(kind text,ref text,phase text default null,filter text default 'all',
 page_size integer default 50,page_offset integer default 0,item uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin
 if filter is null or filter not in ('all','active','in_review','draft','expired','ending_soon','banner_missing')
 or page_size is null or page_size not between 1 and 100 or page_offset is null or page_offset not between 0 and 100000 then
  raise exception 'Invalid promotion page query' using errcode='22023';end if;
 with rows as materialized(select x row from hub.workspace_promotion_rows(kind,ref,phase) x), filtered as (
  select row from rows where (item is null or row->>'id'=item::text) and
   (filter='all' or row->>'group'=filter or filter in ('ending_soon','banner_missing') and row->filter='true'::jsonb)
 ), page as (select row from filtered order by row->>'ends_at',row->>'id' limit page_size offset page_offset)
 select jsonb_build_object('items',(select coalesce(jsonb_agg(row order by row->>'ends_at',row->>'id'),'[]') from page),
  'total',(select count(*) from filtered),'counts',jsonb_build_object(
   'active',count(*) filter(where row->>'group'='active'),'in_review',count(*) filter(where row->>'group'='in_review'),
   'draft',count(*) filter(where row->>'group'='draft'),'expired',count(*) filter(where row->>'group'='expired'),
   'ending_soon',count(*) filter(where row->'ending_soon'='true'::jsonb),
   'banner_missing',count(*) filter(where row->'banner_missing'='true'::jsonb))) into result from rows;
 if item is not null and (result->>'total')::integer=0 then raise exception 'Promotion not found in this context' using errcode='P0002';end if;
 return result||jsonb_build_object('context',jsonb_build_object('kind',kind,'ref',ref,'phase',phase,
  'project_id',case when kind='project' then (hub.workspace_phase(kind,ref,phase)).id end,
  'owning_brand_id',case when kind='brand' then (select id from hub.brands where public_brand_id=ref) end));
end $$;

create function hub.workspace_promotion_suggestions(kind text,ref text,phase text default null,
 page_size integer default 50,page_offset integer default 0,item uuid default null,source text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare selected hub.projects;projects uuid[];result jsonb;begin
 perform hub.require_permission('promotions','view');
 if kind is null or kind not in ('project','brand') or kind='brand' and phase is not null
 or page_size is null or page_size not between 1 and 100 or page_offset is null or page_offset not between 0 and 100000
 or source is not null and source not in ('website','km') then raise exception 'Invalid suggestion context' using errcode='22023';end if;
 perform hub.content_scope_access(kind,ref,'view');perform hub.require_permission('projects','view');
 if source='km' then perform hub.require_permission('knowledge','view');end if;
 if kind='project' then selected:=hub.workspace_phase(kind,ref,phase);projects:=array[selected.id];
 else projects:=hub.workspace_projects(kind,ref);end if;
 with candidates as materialized (
  select k.*,a.likely_expired,a.date_unknown,a.category,
   case when k.evidence->>'source_kind'='sena_public_website' then 'website' else 'km' end origin
  from staging.knowledge_candidates k left join staging.knowledge_promotion_annotations a on a.candidate_id=k.id
  where k.kind='promotion' and exists(select 1 from hub.projects p where p.id=any(projects) and p.rem_project_id=any(k.project_ids))
   and (k.evidence->>'source_kind'='sena_public_website' and k.evidence->>'website_item_kind'='promotion_terms'
    or k.evidence->>'source_kind' is distinct from 'sena_public_website' and hub.can('knowledge','view'))
 ), filtered as (
  select * from candidates where (item is null or id=item) and (source is null or origin=source)
 ), page as (select * from filtered order by id limit page_size offset page_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'items',coalesce(jsonb_agg(jsonb_build_object(
  'id',k.id,'source',k.origin,
  'source_url',case when coalesce(k.evidence#>>'{website_source,page_url}',k.source_url) ~ '^https://([A-Za-z0-9-]+\.)?sena\.co\.th/'
   then coalesce(k.evidence#>>'{website_source,page_url}',k.source_url) end,
  'captured_at',case when k.origin='website' then k.evidence#>>'{website_source,fetched_at}' end,
  'flags',jsonb_build_object('likely_expired',coalesce(k.likely_expired,false),
   'undated',coalesce(k.date_unknown,true),'not_a_promotion',coalesce(k.category='text_not_promotion',false)),
  'text',jsonb_build_object('title',left(case when k.origin='website' and jsonb_typeof(k.evidence#>'{website_value,heading}')='string'
    then k.evidence#>>'{website_value,heading}' when jsonb_typeof(k.evidence->'title')='string' then k.evidence->>'title' else '' end,20000),
   'summary',left(case when k.origin='website' and jsonb_typeof(k.evidence#>'{website_value,text}')='string' then k.evidence#>>'{website_value,text}'
    when k.origin='website' and jsonb_typeof(k.evidence->'website_value')='string' then k.evidence->>'website_value'
    when jsonb_typeof(k.evidence->'benefit')='string' then k.evidence->>'benefit' else '' end,20000),
   'conditions_public',left(case when jsonb_typeof(k.evidence->'conditions')='string' then k.evidence->>'conditions' else '' end,20000))
 ) order by k.id),'[]')) into result from page k;
 if item is not null and (result->>'total')::integer=0 then raise exception 'Suggestion not found in this context' using errcode='P0002';end if;
 return result;
end $$;

revoke all on function hub.workspace_promotion_rows(text,text,text),
 hub.workspace_promotions(text,text,text,text,integer,integer,uuid),
 hub.workspace_promotion_suggestions(text,text,text,integer,integer,uuid,text)
 from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
grant execute on function hub.workspace_promotions(text,text,text,text,integer,integer,uuid),
 hub.workspace_promotion_suggestions(text,text,text,integer,integer,uuid,text) to hub_app;
CREATE OR REPLACE FUNCTION hub.workspace_native_rows()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  select 'promotion',p.id::text,'promotions',case when p.owning_brand_id is null then 'project' else 'brand' end,coalesce(pr.public_project_id,b.public_brand_id),p.title,
   to_jsonb(p)||jsonb_build_object('version_no',p.draft_revision,'state',case when (hub.promotion_readiness(hub.promotion_payload(p.id))->>'ready')::boolean then 'APPROVED' when exists(select 1 from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision) then 'IN_REVIEW' else 'DRAFT' end,
    'approved_by',null,'approvers',coalesce((select jsonb_agg(reviewed_by) from
     (select distinct on(review_type) reviewed_by,decision from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision order by review_type,event_seq desc) decisions where decision='APPROVED'),'[]')),
   hub.workspace_context(case when p.owning_brand_id is null then 'project' else 'brand' end,coalesce(pr.public_project_id,b.public_brand_id))||jsonb_build_object('promotion',p.id,'item',p.id,'tab','promotions','field','promotion.title'),
   null::text,null::jsonb,'promotion',p.id::text,(hub.promotion_readiness(hub.promotion_payload(p.id))->>'ready')::boolean,true,
   array(select target.rem_project_id from hub.promotion_target_projects(p.id) tp join hub.projects target on target.id=tp.id)
  from hub.public_promotions p left join hub.projects pr on pr.id=p.project_id left join hub.brands b on b.id=p.owning_brand_id
  where hub.promotion_scope_visible(p.id) and (p.project_id is not null and pr.deleted_at is null or p.owning_brand_id is not null and b.deleted_at is null)
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
$function$;
CREATE OR REPLACE FUNCTION hub.content_workflow_source(kind text, identity jsonb, level text DEFAULT 'view'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare row_data jsonb;table_name text:=hub.content_workflow_table(kind);tab text;scope text;project uuid;tabs text[];required_tab text;begin
 if identity is distinct from hub.content_workflow_identity(kind,identity) then raise exception 'Invalid content identity' using errcode='23514';end if;
 execute format('select to_jsonb(t) from hub.%I t where to_jsonb(t) @> $1 %s',table_name,
  case when kind='selling_point' then 'order by revision desc limit 1' else '' end) into strict row_data using identity;
 if row_data is null or row_data->>'deleted_at' is not null then raise exception 'Content not found' using errcode='P0002';end if;
 scope:=row_data->>'scope_type';
 tab:=case when kind in ('faq','article','question','glossary','page_config') then 'knowledge'
  when kind in ('brand','brand_asset') or scope='brand' then 'brands'
  when kind='promotion' then 'promotions'
  when kind in ('article','question','glossary') or kind in ('faq','section','contact') and scope is distinct from 'project' then 'knowledge'
  else 'projects' end;
 if kind='asset' then
  perform hub.require_asset_access((row_data->>'id')::uuid);
  select coalesce(array_agg(name order by name),'{}') into tabs from (values
   ('projects',exists(select 1 from hub.entity_assets where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.commercial_type_assets where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.asset_links where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.projects p join hub.entity_versions v on v.id=p.published_version_id where p.deleted_at is null and
      (jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',row_data->>'id'))
       or jsonb_path_exists(v.payload,'$.commercial_types[*].assets[*].id ? (@ == $asset)',jsonb_build_object('asset',row_data->>'id'))))),
   ('brands',exists(select 1 from hub.brand_assets where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.brands b join hub.brand_versions v on v.id=b.published_version_id where b.deleted_at is null and
      jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',row_data->>'id')))),
   ('knowledge',exists(select 1 from hub.knowledge_asset_links where asset_id=(row_data->>'id')::uuid)),
   ('promotions',exists(select 1 from hub.asset_links where asset_id=(row_data->>'id')::uuid and target_type='promotion' and deleted_at is null))
  ) sources(name,owns) where owns;
  if cardinality(tabs)=0 then
   select array[name] into tabs from unnest(array['projects','brands','knowledge']) name where hub.can(name,level) limit 1;
  end if;
  if level='view' then
   select name into tab from unnest(tabs) name where hub.can(name,'view') limit 1;
  else
   foreach required_tab in array coalesce(tabs,'{}') loop perform hub.require_permission(required_tab,level);end loop;tab:=tabs[1];
  end if;
  if tab is null then raise exception 'Asset source permission required' using errcode='42501';end if;
 else perform hub.require_permission(tab,level);tabs:=array[tab];end if;
 if kind='promotion' then perform hub.promotion_scope_access((row_data->>'id')::uuid,level);end if;
 if kind in ('section','contact') then perform hub.content_scope_access(scope,row_data->>'scope_id',level);end if;
 project:=case when kind='project' then (row_data->>'id')::uuid else (row_data->>'project_id')::uuid end;
 if project is not null and not exists(select 1 from hub.projects where id=project and deleted_at is null) then raise exception 'Content not found' using errcode='P0002';end if;
 if kind='asset' then
  perform hub.require_asset_access((row_data->>'id')::uuid);
 elsif kind in ('project_asset','brand_asset','type_asset','asset_context') then perform hub.require_asset_access((row_data->>'asset_id')::uuid);
 end if;
 if kind in ('asset_context','media_target') and not hub.media_target(project,row_data->>'target_type',row_data->>'target_key',level) then raise exception 'Content target is unavailable' using errcode='42501';end if;
 -- The ordinary model and native forms guard their owning project timestamp. Keep that
 -- concurrency token in expected_hash, never in authored approval material.
 if kind in ('model','unit_type','price','disclosure','sales_term','programme','progress') then
  row_data:=row_data||jsonb_build_object('_form_updated_at',(select updated_at from hub.projects where id=project));
 end if;
 return row_data||jsonb_build_object('_tab',tab,'_tabs',tabs,'_staged_values',hub.content_workflow_staged_values(kind,row_data));
 exception when no_data_found then raise exception 'Content not found' using errcode='P0002';
end $function$;
CREATE OR REPLACE FUNCTION hub.workspace_history_contexts(table_name text, row_data jsonb)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r jsonb:=row_data;kind text;ref text;tab text;section text;subject uuid;project uuid;ids uuid[];target jsonb;child jsonb;
 f hub.faqs;s hub.content_sections;page hub.web_pages;article_version uuid;faq_scope jsonb;faq_owned boolean:=false;phase_ref text;name text:=replace(table_name,'hub.','');begin
 if row_data is null or table_name not like 'hub.%' then return;end if;
 if name='content_review_versions' then
  child:=hub.content_workflow_source(r->>'kind',r->'identity','view');
  return query select c||jsonb_build_object('target',c->'target'||jsonb_build_object('version',r->'id'))
   from hub.workspace_history_contexts('hub.'||hub.content_workflow_table(r->>'kind'),child-array['_tab','_tabs','_staged_values']) c;
  return;
 elsif name='translation_glossary' then
  perform hub.content_workflow_source('glossary',jsonb_build_object('term_key',r->>'term_key'),'view');
  return next jsonb_build_object('kind','corporate','ref','sena','name',hub.workspace_name('corporate','sena'),
   'source_tab','knowledge','section_key','glossary','project_ids','[]'::jsonb,
   'target',hub.workspace_target('corporate','sena','history',jsonb_build_object('term',r->>'term_key','item',r->>'term_key')));
  return;
 end if;
 if name in ('publication_releases','web_publications') then
  if name='publication_releases' then
   for child in select to_jsonb(m) from hub.publication_release_members m where release_id=(r->>'id')::uuid loop
    return query select * from hub.workspace_history_contexts('hub.publication_release_members',child);end loop;
  else
   for child in select value from jsonb_array_elements(coalesce(r->'pages','[]')) loop
    select * into page from hub.web_pages where page_key=child#>>'{snapshot,page_key}';
    if page.id is not null then return query select * from hub.workspace_history_contexts('hub.web_pages',to_jsonb(page));end if;
   end loop;
  end if;return;
 elsif name='publication_release_members' then
  if r->>'entity_type'='project' then select to_jsonb(p) into child from hub.projects p where id=(r->>'entity_id')::uuid;
  elsif r->>'entity_type'='brand' then select to_jsonb(b) into child from hub.brands b where id=(r->>'entity_id')::uuid;
  elsif r->>'entity_type'='promotion' then select to_jsonb(p) into child from hub.public_promotions p where id=(r->>'entity_id')::uuid;end if;
  return query select c||jsonb_build_object('section_key','publication') from hub.workspace_history_contexts(
   case r->>'entity_type' when 'project' then 'hub.projects' when 'brand' then 'hub.brands' when 'promotion' then 'hub.public_promotions' end,child) c;return;
 elsif name in ('web_pages','web_changes') or name='entity_versions' and r->>'entity_type'='web_page' then
  select * into page from hub.web_pages where (name='web_pages' and id=(r->>'id')::uuid)
   or (name='web_changes' and page_key=r->>'page_key') or (name='entity_versions' and id=(r->>'web_page_id')::uuid);
  if page.id is null or not hub.can('knowledge','view') then return;end if;
  if name='entity_versions' then perform hub.web_assert_sources(r->'payload','view');end if;
  if page.page_type='project' then
   for child in select to_jsonb(p) from hub.projects p where p.public_project_id=any(page.project_ids) and p.deleted_at is null loop
    return query select c||jsonb_build_object('section_key','publication') from hub.workspace_history_contexts('hub.projects',child) c;
   end loop;return;
  elsif page.page_type='brand' then kind:='brand';ref:=page.entity_ref;tab:='brands';
  elsif page.page_type='programme' then kind:='programme';ref:=page.entity_ref;tab:='knowledge';
  else kind:='corporate';ref:='sena';tab:='knowledge';end if;section:='publication';
 elsif name in ('projects','model_types','entity_assets','commercial_types','commercial_type_sources','commercial_type_assets','commercial_type_versions',
  'project_facts','project_buildings','project_selling_points','project_facilities','project_features','solar_estimates','project_places',
  'project_prices','project_price_versions','project_disclosures','project_sales_terms','project_programmes','project_progress','project_commercial_versions','entity_versions','website_text_decision',
  'asset_links','media_links','media_link_targets') then
  project:=(case when name='projects' then r->>'id' else r->>'project_id' end)::uuid;kind:='project';tab:='projects';
  select public_project_id into ref from hub.projects where id=project and deleted_at is null;
  if name in ('project_disclosures','project_commercial_versions') and not (hub.can('projects','edit') or hub.can('projects','approve')) then return;end if;
  if name in ('asset_links','media_link_targets') and not hub.media_target(project,r->>'target_type',r->>'target_key','view') then return;end if;
  if name in ('entity_assets','commercial_type_assets','asset_links') and not hub.can_read_asset((r->>'asset_id')::uuid) then return;end if;
  section:=case when name like '%price%' or name like 'commercial_type%' or name='model_types' then 'unit-types'
   when name like '%asset%' or name like 'media_%' then 'media' when name='entity_versions' then 'publication'
   when name='project_facts' then 'facts' when name='project_buildings' then 'buildings' when name='project_selling_points' then 'narrative'
   when name in ('project_facilities','project_features','solar_estimates','project_places') then 'amenities'
   when name='website_text_decision' then r->>'section_key' else 'identity' end;
 elsif name in ('brands','brand_versions','brand_assets') then
  subject:=(case when name='brands' then r->>'id' else r->>'brand_id' end)::uuid;kind:='brand';tab:='brands';
  select public_brand_id into ref from hub.brands where id=subject and deleted_at is null;
  if name='brand_assets' and not hub.can_read_asset((r->>'asset_id')::uuid) then return;end if;
  section:=case when name='brand_assets' then 'media' when name='brand_versions' then 'publication' else 'identity' end;
 elsif name in ('contacts','content_sections','content_section_versions') then
  if name='contacts' then kind:=r->>'scope_type';ref:=r->>'scope_id';section:='contacts';
  else
   select * into s from hub.content_sections where id=(case when name='content_sections' then r->>'id' else r->>'section_id' end)::uuid;
   kind:=case when s.scope_type='rem_project_group' then 'project_group' else s.scope_type end;ref:=s.scope_id;section:=coalesce(s.section_key,'narrative');
   if kind='project' and s.section_key is null then select public_project_id into ref from hub.projects where rem_project_id=s.scope_id and deleted_at is null;end if;
  end if;tab:=hub.content_scope_tab(kind);
 elsif name in ('faqs','faq_versions','faq_sources','faq_intake_decisions') then
  subject:=(case when name='faqs' then r->>'id' else r->>'faq_id' end)::uuid;
  if subject is null and name='faq_intake_decisions' then
   perform hub.faq_intake_cluster((r->>'cluster_id')::uuid);
   for phase_ref in select null::text union select unnest(c.project_ids) from staging.faq_clusters c where c.id=(r->>'cluster_id')::uuid loop
    begin
     target:=hub.workspace_resolve(null,(r->>'cluster_id')::uuid,phase_ref);
     faq_scope:=hub.workspace_faq_scope_access(target->>'level',target->>'id',target->>'phase');
     return next jsonb_build_object('kind',target->>'level','ref',target->>'id','name',faq_scope->'name','source_tab','knowledge','section_key','faq','faq_owned',true,
      'project_ids',array(select (x->>'id')::uuid from jsonb_array_elements(faq_scope->'projects') x),'target',target);
    exception when insufficient_privilege or no_data_found or check_violation then null;end;
   end loop;return;
  end if;
  if subject is null then return;end if;
  target:=hub.workspace_faq_target(subject);kind:=target->>'level';ref:=target->>'id';tab:='knowledge';section:='faq';faq_owned:=true;
 elsif name in ('faq_questions','faq_question_versions') then kind:='corporate';ref:='sena';tab:='knowledge';section:='faq';
 elsif name='content_gaps' then
  select id,public_project_id into project,ref from hub.projects where rem_project_id=r->>'project_id' and deleted_at is null;
  kind:='project';tab:='knowledge';section:='faq';
 elsif name='content_translations' then
  tab:=r->>'source_tab';section:=r->>'field_key';
  if r->>'owner_type'='faq' then target:=hub.workspace_faq_target((r->>'owner_key')::uuid);kind:=target->>'level';ref:=target->>'id';faq_owned:=true;
  elsif r->>'owner_type'='section' then
   select * into s from hub.content_sections where id=(r->>'owner_key')::uuid;kind:=s.scope_type;ref:=s.scope_id;
  elsif tab='projects' then kind:='project';ref:=r->>'scope_id';
  elsif tab='brands' then kind:='brand';ref:=r->>'scope_id';
  elsif r->>'owner_type'='article' then
   select to_jsonb(a) into child from hub.articles a where id=(r#>>'{row_ref,article_id}')::uuid;
   return query select c||jsonb_build_object('section_key',section) from hub.workspace_history_contexts('hub.articles',child) c;return;
  else return;end if;
 elsif name in ('articles','article_versions','article_links') then
  subject:=(case when name='articles' then r->>'id' else r->>'article_id' end)::uuid;
  if not exists(select 1 from hub.articles where id=subject) then return;end if;
  perform hub.article_read(subject);
  article_version:=case when name='article_versions' then (r->>'id')::uuid when name='article_links' then (r->>'version_id')::uuid
   else (select draft_version_id from hub.articles where id=subject) end;
  if jsonb_array_length(hub.article_reference_issues(article_version))>0 or exists(select 1 from hub.article_links l where l.version_id=article_version
   and not hub.content_scope_allowed(l.kind,l.ref,'view')) then return;end if;
  kind:='corporate';ref:='sena';tab:='knowledge';section:='articles';
  select coalesce(array_agg(distinct p.id),'{}') into ids from hub.projects p join hub.article_links l on
   l.kind='project' and l.ref=p.public_project_id or l.kind='brand' and exists(select 1 from hub.brands b where b.id=p.brand_id and b.public_brand_id=l.ref)
   where l.article_id=subject and p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view');
 elsif name in ('public_promotions','promotion_reviews','promotion_versions') then
  subject:=(case when name='public_promotions' then r->>'id' else r->>'promotion_id' end)::uuid;
  if not hub.can('promotions','view') then return;end if;
  perform hub.promotion_read(subject,'{}');
  select coalesce(array_agg(p.id),'{}') into ids from hub.promotion_target_projects(subject) p where hub.content_scope_allowed('project',p.public_id,'view');
  select p.id,p.public_project_id into project,ref from hub.projects p join hub.public_promotions x on x.project_id=p.id where x.id=subject and p.deleted_at is null;
  kind:='project';
  if project is null then
   select b.public_brand_id into ref from hub.brands b join hub.public_promotions p on p.owning_brand_id=b.id where p.id=subject and b.deleted_at is null;
   kind:='brand';end if;
  select array_agg(distinct x) into ids from (
   select unnest(ids) x union select p.id from hub.projects p where p.deleted_at is null
    and hub.content_scope_allowed('project',p.public_project_id,'view') and
    (r#>'{payload,target_project_ids}' ? p.public_project_id or r->'resolved_project_ids' ? p.public_project_id)
  ) affected;tab:='promotions';section:='promotions';
 elsif name in ('assets','asset_media_tags','knowledge_asset_links') then
  subject:=(case when name='assets' then r->>'id' else r->>'asset_id' end)::uuid;
  if not hub.can_read_asset(subject) then return;end if;
  select p.id,p.public_project_id into project,ref from hub.projects p where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view') and
   (exists(select 1 from hub.entity_assets a where a.project_id=p.id and a.asset_id=subject and a.deleted_at is null)
    or exists(select 1 from hub.asset_links a where a.project_id=p.id and a.asset_id=subject and a.deleted_at is null and hub.media_target(p.id,a.target_type,a.target_key,'view'))
    or exists(select 1 from hub.commercial_type_assets a where a.project_id=p.id and a.asset_id=subject and a.deleted_at is null)) order by p.public_project_id limit 1;
  if project is not null then kind:='project';tab:='projects';
  else select b.public_brand_id into ref from hub.brands b join hub.brand_assets a on a.brand_id=b.id
   where a.asset_id=subject and a.deleted_at is null and b.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view') order by b.public_brand_id limit 1;
   kind:='brand';tab:='brands';end if;section:='media';
 elsif name='entity_aliases' then
  kind:=case r->>'entity_type' when 'rem_project_group' then 'project_group' else r->>'entity_type' end;ref:=r->>'entity_id';tab:='knowledge';section:='identity';
  if kind='project' then select public_project_id into ref from hub.projects where rem_project_id=ref and deleted_at is null;end if;
 elsif name='knowledge_fact_candidates' then
  for child in select to_jsonb(p) from hub.projects p where r->'project_ids' ? p.rem_project_id and p.deleted_at is null and hub.can('knowledge','view') loop
   return query select c||jsonb_build_object('source_tab','knowledge','section_key','facts') from hub.workspace_history_contexts('hub.projects',child) c;end loop;return;
 else return;end if;
 if ref is null or not hub.can(tab,'view') then return;end if;
 if faq_owned then
  faq_scope:=hub.workspace_faq_scope_access(kind,ref);
  ids:=array(select (x->>'id')::uuid from jsonb_array_elements(faq_scope->'projects') x);
 else
  if not hub.content_scope_allowed(kind,ref,'view') then return;end if;
  ids:=coalesce(ids,hub.workspace_projects(kind,ref));
 end if;
 return next jsonb_build_object('kind',kind,'ref',ref,'name',case when faq_owned then faq_scope->'name' else hub.workspace_name(kind,ref) end,
  'source_tab',tab,'section_key',section,'faq_owned',faq_owned,
  'project_ids',ids,'target',coalesce(target,hub.workspace_target(kind,ref,'history',jsonb_build_object('section',section,'item',r->>'id'))));
exception when insufficient_privilege or no_data_found then return;
end $function$;
CREATE OR REPLACE FUNCTION hub.workspace_page(kind text, ref text, phase text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare p hub.projects;ids uuid[];phases jsonb;tabs jsonb:='["overview"]';sections jsonb:='[]';required jsonb:='[]';recommended jsonb:='[]';tasks jsonb:='[]';
 readiness jsonb;media jsonb;item jsonb;target jsonb;field text;section text;entry jsonb;s record;r record;preview jsonb;changes jsonb:='[]';published_at timestamptz;
 promotion_summary jsonb;invalid_prices jsonb;
 today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;group_ref text;faq_scope jsonb;begin
 if not hub.content_scope_allowed(kind,ref,'view') or kind='unit_type' and not exists(select 1 from hub.commercial_types c join hub.projects x on x.id=c.project_id
  where c.id::text=ref and c.deleted_at is null and hub.content_scope_allowed('project',x.public_project_id,'view')) then
  faq_scope:=hub.workspace_faq_scope_access(kind,ref,phase);
  return jsonb_build_object('entity',jsonb_build_object('kind',kind,'ref',ref,'name',faq_scope->'name',
   'scope_type',kind,'scope_id',faq_scope->>'scope_id'),'faq_only',true,
   'phases',(select coalesce(jsonb_agg(x-'id'),'[]') from jsonb_array_elements(faq_scope->'projects') x),
   'selected_phase',faq_scope#>>'{selected,rem_project_id}','tabs',jsonb_build_array('faq','history'),'sections','[]'::jsonb,
   'overview',jsonb_build_object('readiness',jsonb_build_object('required','[]'::jsonb,'recommended','[]'::jsonb),
    'tasks','[]'::jsonb,'changes_since_publication','[]'::jsonb,'preview_target',null));
 end if;
 perform hub.content_scope_access(kind,ref,'view');ids:=hub.workspace_projects(kind,ref);p:=hub.workspace_phase(kind,ref,phase);
 if kind='project' then select g.anchor into group_ref from hub.workspace_confirmed_groups() g where p.id=any(g.members);end if;
 select coalesce(jsonb_agg(jsonb_build_object('rem_project_id',rem_project_id,'public_project_id',public_project_id,'name',public_name) order by public_project_id),'[]') into phases
  from hub.projects where id=any(ids);
 if kind in ('project','brand','corporate') then tabs:=tabs||'"data"'::jsonb;end if;
 if kind='project' then tabs:=tabs||'"unit-types"'::jsonb;end if;
 if kind in ('project','brand') then
  if hub.can('promotions','view') and hub.can('projects','view') then tabs:=tabs||'"promotions"'::jsonb;end if;
  tabs:=tabs||'"media"'::jsonb;end if;
 if hub.can('knowledge','view') then tabs:=tabs||'"faq"'::jsonb;end if;tabs:=tabs||'"history"'::jsonb;
 if p.id is not null then
  readiness:=hub.project_content_readiness_before_media(p.public_project_id);media:=hub.media_checklist(p.public_project_id);
  for item in select value from jsonb_array_elements(coalesce(readiness->'items','[]')) loop
   if (item->>'complete')::boolean then continue;end if;
   field:=item->>'field_key';target:=hub.workspace_field_target('project',p.public_project_id,field,
    jsonb_build_object('phase',p.rem_project_id,'item',item->>'point_key','building',item->>'building_key'));
   entry:=jsonb_build_object('code',field,'label',item->'label','state','missing','target',target);
   if (item->>'required')::boolean then required:=required||jsonb_build_array(entry);else recommended:=recommended||jsonb_build_array(entry);end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(media->'items','[]')) loop
   if (item->>'complete')::boolean then continue;end if;
   target:=hub.workspace_target('project',p.public_project_id,'media',jsonb_build_object('phase',p.rem_project_id,'section','coverage','media_slot',
    jsonb_build_object('rule_key',item->>'rule_key','media_category',item->>'media_category','target_type',item#>>'{context,target_type}',
     'target_key',item#>>'{context,target_key}','floor',item->'floor','tags',item->'tags','usage',item#>>'{context,usage}',
     'media_role',case when item->>'rule_key' in ('hero','thumbnail') then item->>'rule_key' end)));
   entry:=jsonb_build_object('code',item->>'rule_key','label',item->'label','state','missing','target',target);
   if (item->>'blocks_publish')::boolean and not(item->>'minimum_met')::boolean then required:=required||jsonb_build_array(entry);else recommended:=recommended||jsonb_build_array(entry);end if;
  end loop;
  -- Reuse each existing writer's readiness; preserve the public type identity for its wizard.
  for s in select c.id,c.public_commercial_type_id,hub.unit_type_readiness(c.id) readiness,null::date due,upper(c.status) state,c.public_name label,'commercial_type.public_name' field from hub.commercial_types c
    where c.project_id=p.id and c.deleted_at is null
   union all select price.id,c.public_commercial_type_id,hub.project_price_readiness(price.id),price.valid_to,upper(price.state),price.display_text,'price.amount' from hub.project_prices price
    join hub.commercial_types c on c.id=price.commercial_type_id where price.project_id=p.id and c.deleted_at is null and price.state<>'withdrawn' loop
   if s.state in ('IN_REVIEW','RETURNED') then tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.field,'label',s.label,'state',s.state,
    'target',hub.workspace_field_target('project',p.public_project_id,s.field,jsonb_build_object('phase',p.rem_project_id,'item',s.id,'unit_type',s.public_commercial_type_id))));end if;
   for item in select value from jsonb_array_elements(s.readiness->'items') loop
    if (item->>'complete')::boolean then continue;end if;
    target:=hub.workspace_field_target('project',p.public_project_id,item->>'field_key',jsonb_build_object('phase',p.rem_project_id,'item',s.id,'unit_type',s.public_commercial_type_id));
    entry:=jsonb_build_object('code',item->>'field_key','label',item->'label','state','missing','target',target);
    if (item->>'required')::boolean then required:=required||jsonb_build_array(entry);else recommended:=recommended||jsonb_build_array(entry);end if;
   end loop;
   if s.due<=today+30 then
    tasks:=tasks||jsonb_build_array(jsonb_build_object('code','price.valid_to','label',(select label from hub.field_catalog where field_key='price.valid_to'),
     'state',case when s.due<today then 'expired' else 'expiring' end,'due',s.due,'target',hub.workspace_field_target('project',p.public_project_id,'price.valid_to',
      jsonb_build_object('phase',p.rem_project_id,'item',s.id,'unit_type',s.public_commercial_type_id))));end if;
  end loop;
  for s in select key kind,value records from jsonb_each(hub.project_commercial_workspace(p.public_project_id)->'records') loop
   for r in select value data,ordinality display_number from jsonb_array_elements(s.records) with ordinality loop
    if upper(r.data->>'state') in ('IN_REVIEW','RETURNED') then
     field:=hub.project_commercial_entity(s.kind)||'.'||case s.kind when 'disclosures' then 'owner_company' when 'sales-terms' then 'conditions' else 'as_of' end;
     tasks:=tasks||jsonb_build_array(jsonb_build_object('code',field,'label',(select label from hub.field_catalog where field_key=field),'state',upper(r.data->>'state'),
      'target',hub.workspace_field_target('project',p.public_project_id,field,jsonb_build_object('phase',p.rem_project_id,'item',r.data->>'id','kind',s.kind))));end if;
    for item in select value from jsonb_array_elements(r.data#>'{readiness,items}') loop
     if (item->>'complete')::boolean then continue;end if;
     target:=hub.workspace_field_target('project',p.public_project_id,item->>'field_key',jsonb_build_object('phase',p.rem_project_id,'item',r.data->>'id','kind',s.kind));
     required:=required||jsonb_build_array(jsonb_build_object('code',item->>'field_key','label',item->'label','state','missing','target',target,'context',jsonb_build_object('kind','record','label',r.display_number::text)));
    end loop;
   end loop;
  end loop;
  for s in select f.fact_key,f.grain,case when f.grain like 'building:%' then substr(f.grain,10) end building_key,least(f.valid_to,f.as_of+c.review_every_days) due,c.label from hub.project_facts f
   join hub.field_catalog c on c.field_key=f.fact_key where f.project_id=p.id and least(f.valid_to,f.as_of+c.review_every_days)<=today+30 loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.fact_key,'label',s.label,'state',case when s.due<today then 'expired' else 'expiring' end,'due',s.due,
    'target',hub.workspace_field_target('project',p.public_project_id,s.fact_key,jsonb_build_object('phase',p.rem_project_id,'grain',s.grain,'building',s.building_key))));
  end loop;
  for s in with bindings as (
   select a.id binding,a.asset_id,a.asset_role usage,'project'::text target_type,p.id::text target_key,null::integer floor,a.effective_to from hub.entity_assets a
    where a.project_id=p.id and a.model_id is null and a.deleted_at is null
   union all select a.id,a.asset_id,a.asset_role,'commercial_type',a.commercial_type_id::text,a.floor_number,null::timestamptz from hub.commercial_type_assets a where a.project_id=p.id and a.deleted_at is null
   union all select a.id,a.asset_id,a.usage,a.target_type,a.target_key,a.floor_from,a.effective_to from hub.asset_links a where a.project_id=p.id and a.deleted_at is null and hub.media_target(p.id,a.target_type,a.target_key,'view'))
   select b.*,a.media_category,a.original_filename,least(a.effective_to,b.effective_to) due from bindings b join hub.assets a on a.id=b.asset_id
    where a.deleted_at is null and hub.can_read_asset(a.id) and least(a.effective_to,b.effective_to)<=now()+interval '30 days' loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code','asset.effective_to','label',jsonb_build_object('th',s.original_filename),
    'state',case when s.due<=now() then 'expired' else 'expiring' end,'due',s.due,'target',hub.workspace_target('project',p.public_project_id,'media',
     jsonb_build_object('phase',p.rem_project_id,'section','coverage','item',s.binding,'asset_id',s.asset_id,'media_role',case when s.usage in ('hero','thumbnail') then s.usage end,
      'media_slot',jsonb_build_object('rule_key',s.usage,'media_category',s.media_category,'target_type',s.target_type,'target_key',s.target_key,'floor',s.floor,'tags','[]'::jsonb,'usage',s.usage)))));
  end loop;
 end if;
 if kind='brand' then
  readiness:=hub.brand_detail(ref)->'readiness';
  for item in select value from jsonb_array_elements(coalesce(readiness->'missing','[]')) loop
   field:=item->>'field';
   if field like 'assets.%' then
    target:=hub.workspace_target('brand',ref,'media',jsonb_build_object('section','coverage','field',field,'media_role','logo_primary',
     'asset_id',case when split_part(field,'.',2) ~ '^[0-9a-fA-F-]{36}$' then split_part(field,'.',2) end));
   else target:=hub.workspace_field_target('brand',ref,'brand.'||split_part(field,'.',1));end if;
   required:=required||jsonb_build_array(jsonb_build_object('code',field,'label',jsonb_build_object('th',item->>'message'),'state','missing','target',target));
  end loop;
  for s in select a.id,a.original_filename,b.id binding,b.asset_role,least(a.effective_to,b.effective_to) due
   from hub.brands root join hub.brand_assets b on b.brand_id=root.id join hub.assets a on a.id=b.asset_id
   where root.public_brand_id=ref and b.deleted_at is null and a.deleted_at is null and hub.can_read_asset(a.id)
    and least(a.effective_to,b.effective_to)<=now()+interval '30 days' loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code','asset.effective_to','label',jsonb_build_object('th',s.original_filename),
    'state',case when s.due<=now() then 'expired' else 'expiring' end,'due',s.due,'target',hub.workspace_target('brand',ref,'media',
     jsonb_build_object('section','coverage','item',s.binding,'asset_id',s.id,'media_role',s.asset_role))));
  end loop;
 end if;
 for s in select cs.*,v.state version_state,v.ai_exposure version_exposure from hub.content_sections cs left join hub.content_section_versions v on v.id=cs.draft_version_id
  where cs.scope_type=kind and cs.scope_id=case when kind='project' then p.public_project_id else ref end and cs.section_key is not null order by cs.section_key loop
  target:=hub.workspace_field_target(kind,case when kind='project' then p.public_project_id else ref end,s.section_key,jsonb_build_object('phase',p.rem_project_id,'item',s.id));
  entry:=jsonb_build_object('ai_exposure',s.version_exposure,'key',s.section_key,'label',(select label from hub.field_catalog where field_key=s.section_key),'tab','data','state',coalesce(s.version_state,s.state),'revision',s.revision,'target',target,
   'suggestion_count',case when p.id is null then 0 else (select count(*) from staging.knowledge_candidates k where p.rem_project_id=any(k.project_ids)
     and k.evidence->>'source_kind'='sena_public_website' and hub.website_text_key(k.evidence->>'website_item_kind')=s.section_key) end);
  sections:=sections||jsonb_build_array(entry);
  if coalesce(s.version_state,s.state) in ('RETURNED','IN_REVIEW') then tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.section_key,'label',(select label from hub.field_catalog where field_key=s.section_key),'state',coalesce(s.version_state,s.state),'target',target));end if;
 end loop;
 if p.id is not null and hub.can('knowledge','view') then
  for item in select value from jsonb_array_elements(hub.compose_project_faq(p.id,'th',null,false,false)->'cells') loop
   if item->>'state' in ('waiting_for_fact','missing','hold') then
    tasks:=tasks||jsonb_build_array(jsonb_build_object('code',item->>'question_key','label',jsonb_build_object('th',item->>'question_label'),'state',item->>'state',
     'target',hub.workspace_target('project',p.public_project_id,'faq',jsonb_build_object('phase',p.rem_project_id,'question_key',item->>'question_key'))));end if;
  end loop;
 end if;
 if hub.can('knowledge','view') then
  for s in select f.id,f.question_key,v.question,v.state from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id
   where f.scope_type=kind and f.scope_id=case when kind='project' then p.rem_project_id else ref end
    and v.state in ('IN_REVIEW','RETURNED') and hub.workspace_faq_visible(f.id) loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.question_key,'label',s.question,'state',s.state,'target',hub.workspace_faq_target(s.id)));
  end loop;
 end if;
 if hub.can('knowledge','view') then
  for s in select w.page_key,v.id,v.payload,v.published_at from hub.web_pages w join hub.entity_versions v on v.id=w.published_version_id
   where w.page_type=kind and w.entity_ref=coalesce(group_ref,ref) order by w.page_key limit 1 loop
   begin
    perform hub.web_assert_sources(s.payload,'view');
    preview:=hub.workspace_target(kind,ref,'overview',jsonb_build_object('section','preview','web_page',s.page_key,'version',s.id));
    published_at:=s.published_at;
   exception when insufficient_privilege then preview:=null;end;
  end loop;
  if kind in ('project','brand','corporate','programme') then
   preview:=hub.workspace_target(kind,ref,'overview',jsonb_build_object('section','preview','phase',p.rem_project_id));
  end if;
 end if;
 if published_at is null and kind='project' then select max(v.published_at) into published_at from hub.projects x join hub.entity_versions v on v.id=x.published_version_id where x.id=any(ids);
 elsif published_at is null and kind='brand' then select v.published_at into published_at from hub.brands b join hub.brand_versions v on v.id=b.published_version_id where b.public_brand_id=ref;end if;
 select coalesce(jsonb_agg(value),'[]') into changes from jsonb_array_elements(hub.content_history(kind,ref,null,5)->'items')
  where published_at is null or (value->>'occurred_at')::timestamptz>published_at;
 select coalesce(jsonb_agg(hub.workspace_item_context(p.id,x) order by n),'[]') into required from jsonb_array_elements(required) with ordinality rows(x,n);
 select coalesce(jsonb_agg(hub.workspace_item_context(p.id,x) order by n),'[]') into recommended from jsonb_array_elements(recommended) with ordinality rows(x,n);
 select coalesce(jsonb_agg(hub.workspace_item_context(p.id,x) order by n),'[]') into tasks from jsonb_array_elements(tasks) with ordinality rows(x,n);
 if kind in ('project','brand') and hub.can('promotions','view') and hub.can('projects','view') then
  promotion_summary:=hub.workspace_promotions(kind,ref,phase,'all',1,0,null)->'counts';
  select coalesce(jsonb_agg(jsonb_build_object('id',price.id,'label',price.display_text,
   'target',hub.workspace_field_target('project',x.public_project_id,'price.amount',jsonb_build_object('phase',x.rem_project_id,'item',price.id,'unit_type',c.public_commercial_type_id))) order by price.id),'[]') into invalid_prices
  from hub.project_prices price join hub.projects x on x.id=price.project_id
  join hub.commercial_types c on c.id=price.commercial_type_id
  join hub.public_promotions pr on pr.id=price.promotion_id
  where price.project_id=any(case when workspace_page.kind='project' then array[p.id] else ids end)
   and price.kind='starting' and price.state<>'withdrawn' and c.deleted_at is null and hub.promotion_scope_visible(pr.id)
   and (pr.published_version_id is null and exists(select 1 from hub.promotion_versions old where old.promotion_id=pr.id)
    or exists(select 1 from hub.promotion_versions v where v.id=pr.published_version_id
    and (v.payload->>'ends_at')::timestamptz<=now()));
  promotion_summary:=promotion_summary||jsonb_build_object('invalid_price_count',jsonb_array_length(invalid_prices),'invalid_prices',invalid_prices);
 end if;
 return jsonb_build_object('entity',jsonb_build_object('kind',kind,'ref',ref,'name',hub.workspace_name(kind,coalesce(group_ref,ref)),'scope_type',kind,
  'scope_id',case when kind='project' then p.rem_project_id else ref end,'grouping',case when kind='project' then jsonb_build_object(
   'state',case when group_ref is null then 'unconfirmed' else 'confirmed' end,'group_ref',group_ref,
   'review_href',case when group_ref is null and hub.can('knowledge','view') then '/faq?tab=publication' end) end),
  'phases',phases,'selected_phase',p.rem_project_id,'tabs',tabs,'sections',sections,
  'overview',jsonb_build_object('promotions',promotion_summary,'readiness',jsonb_build_object('required',required,'recommended',recommended),'tasks',tasks,'changes_since_publication',changes,'preview_target',preview));
end $function$;

revoke all on function hub.promotion_owner_guard(),hub.promotion_scope_projects(uuid,uuid,jsonb,uuid[]),
 hub.validate_promotion_scope(uuid,uuid,jsonb,uuid[]),hub.promotion_scope_snapshot(uuid),hub.promotion_scope_access(uuid,text),hub.promotion_scope_visible(uuid),
 hub.promotion_resolve(jsonb) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
grant execute on function hub.promotion_resolve(jsonb) to hub_app;
commit;
