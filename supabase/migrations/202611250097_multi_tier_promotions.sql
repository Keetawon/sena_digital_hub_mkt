-- Five website promotion tiers. Existing draft/review/publication OIDs, RLS,
-- audit triggers and immutable version payloads are retained.
begin;

alter table hub.public_promotions
 add column promotion_tier text,
 add column legacy_scope boolean not null default false,
 add column owning_project_group_id text,
 add column programme_key text,
 add column all_active_projects boolean not null default false,
 add column campaign_name jsonb not null default '{}',
 add column campaign_slug text,
 add column ads_campaign_code text,
 add column highlight_badge jsonb not null default '{}',
 add column unit_scope_note jsonb not null default '{}',
 add column benefit_items jsonb not null default '[]';

-- Backfill only new fields. Keep the original editing identity/time while all
-- audit, translation and immutable-owner triggers remain active.
create function pg_temp.promotion_backfill_metadata() returns trigger language plpgsql as $$
begin new.updated_at:=old.updated_at;new.updated_by:=old.updated_by;return new;end $$;
create trigger zz_promotion_backfill_metadata before update on hub.public_promotions
for each row execute function pg_temp.promotion_backfill_metadata();
update hub.public_promotions set promotion_tier=case when owning_brand_id is not null then 'brand' else 'project' end,legacy_scope=true;
drop trigger zz_promotion_backfill_metadata on hub.public_promotions;
drop function pg_temp.promotion_backfill_metadata();
alter table hub.public_promotions
 alter column promotion_tier set not null,
 drop constraint promotion_exact_owner,
 add constraint promotion_tier_valid check(promotion_tier in ('campaign','corporate','brand','project_group','project')),
 add constraint promotion_exact_owner check(
  promotion_tier='project' and project_id is not null and owning_brand_id is null and owning_project_group_id is null
  or promotion_tier='brand' and owning_brand_id is not null and project_id is null and owning_project_group_id is null
  or promotion_tier='project_group' and owning_project_group_id is not null and project_id is null and owning_brand_id is null
  or promotion_tier in ('campaign','corporate') and project_id is null and owning_brand_id is null and owning_project_group_id is null),
 add constraint promotion_group_key check(owning_project_group_id is null or length(btrim(owning_project_group_id)) between 1 and 200),
 add constraint promotion_programme_key check(programme_key is null or promotion_tier='corporate' and programme_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$'),
 add constraint promotion_all_active_tier check(not all_active_projects or promotion_tier in ('campaign','corporate')),
 add constraint promotion_campaign_name check(campaign_name='{}' or hub.content_locales(campaign_name,300,true)),
 add constraint promotion_campaign_slug check(campaign_slug is null or length(campaign_slug)<=120 and campaign_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 add constraint promotion_ads_code check(ads_campaign_code is null or length(ads_campaign_code)<=200),
 add constraint promotion_highlight_badge check(hub.content_locales(highlight_badge,300)),
 add constraint promotion_unit_scope_note check(hub.content_locales(unit_scope_note,2000) and (promotion_tier='project' or unit_scope_note='{}'));

create function hub.promotion_benefit_items_valid(items jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare item jsonb;kind text;amount text;unit text;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>20 then return false;end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['benefit_type','benefit_value','benefit_unit','label']
   or item-array['benefit_type','benefit_value','benefit_unit','label']<>'{}'
   or hub.content_locales(item->'label',300) is not true then return false;end if;
  kind:=item->>'benefit_type';amount:=item->>'benefit_value';unit:=item->>'benefit_unit';
  if kind is null or kind not in ('discount_amount','discount_pct','free_transfer_fee','free_common_fee','furniture','cashback','rate_subsidy','gift','other')
   or unit is not null and unit not in ('THB','percent','months','items')
   or amount is not null and (jsonb_typeof(item->'benefit_value')<>'string' or amount !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') then return false;end if;
  if kind='discount_pct' and (unit is distinct from 'percent' or amount is null or amount::numeric>100)
   or kind in ('discount_amount','cashback') and (unit is distinct from 'THB' or amount is null) then return false;end if;
 end loop;
 return true;
end $$;
alter table hub.public_promotions add constraint promotion_benefit_items_valid check(hub.promotion_benefit_items_valid(benefit_items));

create function hub.promotion_benefit_sync() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='INSERT' and new.promotion_tier is null then
  new.promotion_tier:=case when new.owning_brand_id is not null then 'brand' else 'project' end;
  new.legacy_scope:=true;
 end if;
 if tg_op='UPDATE' and jsonb_array_length(new.benefit_items)>0 and new.benefit_items=old.benefit_items
  and (new.benefit_type,new.benefit_value,new.benefit_unit) is distinct from (old.benefit_type,old.benefit_value,old.benefit_unit) then
  -- A legacy caller may edit its primary benefit without discarding the package.
  new.benefit_items:=jsonb_set(new.benefit_items,'{0}',new.benefit_items->0||jsonb_build_object(
   'benefit_type',new.benefit_type,'benefit_value',new.benefit_value::text,'benefit_unit',new.benefit_unit));
 end if;
 if not hub.promotion_benefit_items_valid(new.benefit_items) then
  raise exception 'รายการสิทธิประโยชน์ไม่ถูกต้อง' using errcode='23514';end if;
 if jsonb_array_length(new.benefit_items)>0 then
  new.benefit_type:=new.benefit_items#>>'{0,benefit_type}';
  new.benefit_value:=(new.benefit_items#>>'{0,benefit_value}')::numeric;
  new.benefit_unit:=new.benefit_items#>>'{0,benefit_unit}';
 end if;
 return new;
end $$;
create trigger promotion_benefit_sync before insert or update on hub.public_promotions
for each row execute function hub.promotion_benefit_sync();

create or replace function hub.promotion_owner_guard() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
 if (new.promotion_tier,new.project_id,new.owning_brand_id,new.owning_project_group_id,new.legacy_scope)
  is distinct from (old.promotion_tier,old.project_id,old.owning_brand_id,old.owning_project_group_id,old.legacy_scope) then
  raise exception 'เปลี่ยนระดับหรือเจ้าของโปรโมชั่นหลังสร้างไม่ได้' using errcode='23514';end if;
 return new;
end $$;

create or replace function hub.validate_promotion_targets(items jsonb) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare item jsonb;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>100
  or (select count(*)<>count(distinct value) from jsonb_array_elements(items)) then
  raise exception 'ขอบเขตโปรโมชั่นไม่ถูกต้องหรือซ้ำกัน' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item)<>'object' or not item ?& array['type','id'] or item-array['type','id']<>'{}'
   or jsonb_typeof(item->'id') is distinct from 'string' then raise exception 'ขอบเขตโปรโมชั่นไม่ถูกต้อง' using errcode='23514';end if;
  if item->>'type'='project' then
   perform hub.require_permission('projects','view');
   if not exists(select 1 from hub.projects where id=(item->>'id')::uuid and deleted_at is null) then raise exception 'ไม่พบโครงการ' using errcode='23514';end if;
  elsif item->>'type'='brand' then
   perform hub.require_permission('brands','view');
   if not exists(select 1 from hub.brands where id=(item->>'id')::uuid and deleted_at is null) then raise exception 'ไม่พบแบรนด์' using errcode='23514';end if;
  elsif item->>'type'='project_group' then
   perform hub.require_permission('projects','view');
   if length(item->>'id') not between 1 and 200 or not exists(select 1 from staging.dw_project_groups where project_group_id=item->>'id')
    and not exists(select 1 from staging.dw_projects where source_record->>'rem_project_group_id'=item->>'id') then
    raise exception 'ไม่พบกลุ่มโครงการ' using errcode='23514';end if;
  elsif item->>'type'='commercial_type' then
   perform hub.require_permission('projects','view');
   if not exists(select 1 from hub.commercial_types c join hub.projects p on p.id=c.project_id where c.id=(item->>'id')::uuid and c.deleted_at is null and p.deleted_at is null) then
    raise exception 'ไม่พบประเภทสินค้าที่ขาย' using errcode='23514';end if;
  else raise exception 'ประเภทขอบเขตโปรโมชั่นไม่ถูกต้อง' using errcode='23514';end if;
 end loop;
end $$;

-- This overload is internal. The original four-argument signature remains for
-- older callers; all stored promotions use their explicit tier and programme.
create function hub.promotion_scope_projects(scope jsonb)
returns table(id uuid,public_id text) language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with input as (select coalesce(scope->>'promotion_tier',case when scope->>'owning_brand_id' is not null then 'brand' else 'project' end) tier,
  coalesce((scope->>'legacy_scope')::boolean,not(scope?'promotion_tier')) legacy),
 candidates as (
 select p.* from hub.projects p cross join input i
 where p.deleted_at is null and not coalesce(scope->'excluded_project_ids','[]') ? p.id::text and (
  i.tier='corporate' and scope->>'programme_key' is not null and exists(
   select 1 from hub.project_programmes x where x.project_id=p.id and lower(x.programme_key)=lower(scope->>'programme_key') and x.participating and x.state='approved')
  or (i.tier<>'corporate' or scope->>'programme_key' is null) and (
   i.tier in ('campaign','corporate') and (coalesce((scope->>'all_active_projects')::boolean,false)
    or i.tier='corporate' and jsonb_array_length(coalesce(scope->'targets','[]'))=0)
    and not exists(select 1 from staging.rem_projects r where r.rem_project_id=p.rem_project_id
     and (r.source_record->>'is_active'='false' or lower(r.source_record->>'project_status') in ('inactive','3')
      or r.source_record->>'ProjectStatus'='3' or r.source_record->>'isDeleted'='true' or r.source_record->>'is_deleted'='true'))
   or i.tier='project' and p.id::text=scope->>'project_id'
   or i.tier='brand' and p.brand_id::text=scope->>'owning_brand_id'
   or i.tier='project_group' and p.rem_project_id=any(hub.content_scope_projects('project_group',scope->>'owning_project_group_id'))
   -- Preserve the legacy union of owner and explicit targets for project/brand.
   or (i.tier in ('campaign','corporate') and not coalesce((scope->>'all_active_projects')::boolean,false) or i.legacy)
    and exists(select 1 from jsonb_array_elements(coalesce(scope->'targets','[]')) t where
    t->>'type'='project' and t->>'id'=p.id::text
    or t->>'type'='brand' and t->>'id'=p.brand_id::text
    or t->>'type'='project_group' and p.rem_project_id=any(hub.content_scope_projects('project_group',t->>'id'))
    or t->>'type'='commercial_type' and exists(select 1 from hub.commercial_types c where c.id::text=t->>'id' and c.project_id=p.id and c.deleted_at is null)))))
 select p.id,p.public_project_id from candidates p
$$;
create or replace function hub.promotion_scope_projects(owner_project uuid,owner_brand uuid,targets jsonb,excluded uuid[])
returns table(id uuid,public_id text) language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select * from hub.promotion_scope_projects(jsonb_build_object('project_id',owner_project,'owning_brand_id',owner_brand,'targets',targets,'excluded_project_ids',coalesce(excluded,'{}')))
$$;
create or replace function hub.promotion_target_projects(p_id uuid) returns table(id uuid,public_id text)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select scope.* from hub.public_promotions p cross join lateral hub.promotion_scope_projects(to_jsonb(p)) scope where p.id=p_id
$$;

create function hub.validate_promotion_scope(scope jsonb) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare tier text:=coalesce(scope->>'promotion_tier',case when scope->>'owning_brand_id' is not null then 'brand' else 'project' end);
 excluded uuid[];begin
 if tier not in ('campaign','corporate','brand','project_group','project')
  or (scope->>'project_id' is not null)<>(tier='project')
  or (scope->>'owning_brand_id' is not null)<>(tier='brand')
  or (scope->>'owning_project_group_id' is not null)<>(tier='project_group')
  or scope->>'programme_key' is not null and tier<>'corporate'
  or coalesce((scope->>'all_active_projects')::boolean,false) and tier not in ('campaign','corporate')
  or jsonb_typeof(coalesce(scope->'excluded_project_ids','[]')) is distinct from 'array' then
  raise exception 'ระดับ เจ้าของ หรือขอบเขตโปรโมชั่นไม่ถูกต้อง' using errcode='22023';end if;
 perform hub.require_permission('projects','view');
 excluded:=array(select x::uuid from jsonb_array_elements_text(coalesce(scope->'excluded_project_ids','[]')) x);
 if cardinality(excluded)>100 or array_position(excluded,null) is not null
  or cardinality(excluded)<>(select count(distinct x) from unnest(excluded) x) then
  raise exception 'โครงการที่ยกเว้นไม่ถูกต้องหรือซ้ำกัน' using errcode='22023';end if;
 if exists(select 1 from unnest(excluded) x where not exists(select 1 from hub.projects where id=x and deleted_at is null)) then
  raise exception 'ไม่พบโครงการที่ยกเว้น' using errcode='23514';end if;
 if tier='project' then perform hub.validate_promotion_targets(jsonb_build_array(jsonb_build_object('type','project','id',scope->>'project_id')));
 elsif tier='brand' then perform hub.validate_promotion_targets(jsonb_build_array(jsonb_build_object('type','brand','id',scope->>'owning_brand_id')));
 elsif tier='project_group' then perform hub.validate_promotion_targets(jsonb_build_array(jsonb_build_object('type','project_group','id',scope->>'owning_project_group_id')));end if;
 if scope->>'programme_key' is not null and not exists(select 1 from jsonb_array_elements(hub.promotion_references()->'programmes') x
  where lower(x->>'programme_key')=lower(scope->>'programme_key')) then
  raise exception 'ไม่มีสิทธิ์เข้าถึงโปรแกรมที่อ้างอิง' using errcode='42501';end if;
 perform hub.validate_promotion_targets(coalesce(scope->'targets','[]'));
 if not coalesce((scope->>'legacy_scope')::boolean,not(scope?'promotion_tier')) then
  if tier in ('brand','project_group') and jsonb_array_length(coalesce(scope->'targets','[]'))>0
   or tier='project' and exists(select 1 from jsonb_array_elements(coalesce(scope->'targets','[]')) t
    where t->>'type'<>'commercial_type' or not exists(select 1 from hub.commercial_types c
     where c.id::text=t->>'id' and c.project_id::text=scope->>'project_id' and c.deleted_at is null)) then
   raise exception 'ขอบเขตย่อยต้องอยู่ภายในเจ้าของโปรโมชั่น' using errcode='23514';end if;
 end if;
 if tier='campaign' and not coalesce((scope->>'all_active_projects')::boolean,false) and jsonb_array_length(coalesce(scope->'targets','[]'))=0 then
  raise exception 'กรุณาเลือกโครงการหรือใช้กับทุกโครงการที่ใช้งาน' using errcode='23514';end if;
end $$;

create function hub.promotion_require_scope(scope jsonb,level text) returns void
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare ids text[];permission_level text:=case when level='publish' then 'view' else level end;begin
 select coalesce(array_agg(p.rem_project_id),'{}') into ids from hub.promotion_scope_projects(scope) s join hub.projects p on p.id=s.id;
 perform hub.require_content_project_set('promotions',permission_level,ids);
 -- W6 permits partial shared-text edits generally. Promotions now require every
 -- affected project for mutation; old and proposed sets are checked atomically.
 if level in ('edit','approve','publish') or scope->>'promotion_tier' in ('campaign','corporate') then
  if exists(select 1 from unnest(ids) x where not hub.content_project_allowed('promotions',permission_level,x)
   or not hub.content_project_allowed('projects','view',x)
   or level='publish' and not hub.content_project_allowed('knowledge','view',x)) then
   raise exception 'ไม่มีสิทธิ์ครบทุกโครงการที่ใช้โปรโมชั่นนี้' using errcode='42501';end if;
 end if;
end $$;

-- Frozen publication membership remains authoritative when a later draft moves
-- elsewhere. Reject unknown snapshot references rather than dropping them.
create function hub.promotion_require_project_ids(public_ids text[],level text) returns void
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare ids text[];permission_level text:=case when level='publish' then 'view' else level end;begin
 if exists(select 1 from unnest(public_ids) x where x is null or not exists(select 1 from hub.projects p where p.public_project_id=x)) then
  raise exception 'ไม่พบโครงการในขอบเขตฉบับเผยแพร่' using errcode='42501';end if;
 select coalesce(array_agg(p.rem_project_id),'{}') into ids from hub.projects p where p.public_project_id=any(public_ids);
 perform hub.require_content_project_set('promotions',permission_level,ids);
 if exists(select 1 from unnest(ids) x where not hub.content_project_allowed('promotions',permission_level,x)
  or not hub.content_project_allowed('projects','view',x)
  or level='publish' and not hub.content_project_allowed('knowledge','view',x)) then
  raise exception 'ไม่มีสิทธิ์ครบทุกโครงการในขอบเขตฉบับเผยแพร่' using errcode='42501';end if;
end $$;
create function hub.promotion_frozen_scope_guard() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare version hub.promotion_versions;begin
 if tg_table_name='public_promotions' then
  if new.published_version_id is not distinct from old.published_version_id then return new;end if;
  perform hub.publication_actor();
  perform hub.promotion_require_scope(to_jsonb(new),'publish');
  for version in select * from hub.promotion_versions where id=any(array[old.published_version_id,new.published_version_id]) loop
   perform hub.promotion_require_project_ids(array(select jsonb_array_elements_text(coalesce(
    version.payload->'target_project_ids',jsonb_build_array(version.payload->>'public_project_id')))),'publish');
  end loop;
 else
  perform hub.promotion_require_scope((select to_jsonb(p) from hub.public_promotions p where id=new.promotion_id),'approve');
  if new.resolved_project_ids is not null then perform hub.promotion_require_project_ids(new.resolved_project_ids,'approve');end if;
  for version in select * from hub.promotion_versions where promotion_id=new.promotion_id and draft_revision=new.review_revision loop
   perform hub.promotion_require_project_ids(array(select jsonb_array_elements_text(coalesce(
    version.payload->'target_project_ids',jsonb_build_array(version.payload->>'public_project_id')))),'approve');
  end loop;
 end if;
 return new;
end $$;
create trigger promotion_frozen_scope before update of published_version_id on hub.public_promotions
for each row execute function hub.promotion_frozen_scope_guard();
create trigger promotion_review_frozen_scope before insert on hub.promotion_reviews
for each row execute function hub.promotion_frozen_scope_guard();

-- Extend private references and redaction without loosening their existing
-- per-tab checks. Group counts are returned only for a fully visible group.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_promotion_reference_visible(text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$anchor$ if kind='brand' then$anchor$,$new$ if kind='project_group' then
  return exists(select 1 from staging.dw_project_groups where project_group_id=ref)
   or exists(select 1 from staging.dw_projects where source_record->>'rem_project_group_id'=ref)
   and (cardinality(hub.content_scope_projects('project_group',ref))>0
    or hub.content_unrestricted('projects','view') and hub.content_unrestricted('promotions','view'))
   and not exists(select 1 from unnest(hub.content_scope_projects('project_group',ref)) x
    where not hub.content_project_allowed('projects','view',x) or not hub.content_project_allowed('promotions','view',x));
 elsif kind='brand' then$new$);
 -- Parenthesize existence so a dictionary row never bypasses scope filtering.
 d:=replace(d,'return exists(select 1 from staging.dw_project_groups where project_group_id=ref)',
  'return (exists(select 1 from staging.dw_project_groups where project_group_id=ref)');
 d:=replace(d,$anchor$or exists(select 1 from staging.dw_projects where source_record->>'rem_project_group_id'=ref)
   and (cardinality$anchor$, $anchor$or exists(select 1 from staging.dw_projects where source_record->>'rem_project_group_id'=ref))
   and (cardinality$anchor$);
 execute d;
 d:=replace(pg_get_functiondef('hub.content_promotion_projection(jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$anchor$'public_owning_brand_id','brand_id')$anchor$,$anchor$'public_owning_brand_id','brand_id','owning_project_group_id','project_group_id')$anchor$);
 d:=hub.content_definition_replace(d,$anchor$case when entry.key in ('owning_brand_id'$anchor$,$anchor$case when entry.key in ('owning_project_group_id','project_group_id') then 'project_group' when entry.key in ('owning_brand_id'$anchor$);execute d;
 d:=replace(pg_get_functiondef('hub.content_source_projects(text,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$anchor$from hub.promotion_target_projects((row_data->>'id')::uuid) t$anchor$,'from hub.promotion_scope_projects(row_data) t');execute d;
 d:=replace(pg_get_functiondef('hub.require_content_source(text,jsonb,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,'ids:=hub.content_source_projects(table_name,row_data);',
  $new$if table_name='public_promotions' then perform hub.promotion_require_scope(row_data,level);end if;
 ids:=hub.content_source_projects(table_name,row_data);$new$);execute d;
end $$;

create or replace function hub.content_promotion_scope_input(p_id uuid,expected integer,proposed jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.public_promotions;targets jsonb;excluded jsonb;result jsonb;begin
 if p_id is not null then
  perform hub.promotion_scope_access(p_id,'view');select * into prior from hub.public_promotions where id=p_id;
  if expected is distinct from prior.draft_revision then raise exception 'ฉบับโปรโมชั่นเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
  result:=jsonb_build_object('promotion_tier',prior.promotion_tier,'project_id',prior.project_id,'owning_brand_id',prior.owning_brand_id,
   'owning_project_group_id',prior.owning_project_group_id,'programme_key',prior.programme_key,'all_active_projects',prior.all_active_projects,'legacy_scope',prior.legacy_scope);
 else
  result:=jsonb_build_object('promotion_tier',coalesce(proposed->>'promotion_tier',case when proposed->>'owning_brand_id' is not null then 'brand' else 'project' end),
   'project_id',proposed->'project_id','owning_brand_id',proposed->'owning_brand_id','owning_project_group_id',proposed->'owning_project_group_id',
   'programme_key',proposed->'programme_key','all_active_projects',coalesce(proposed->'all_active_projects','false'),'legacy_scope',not(proposed?'promotion_tier'));
  if result->>'promotion_tier' in ('project','brand','project_group')
   and coalesce(case result->>'promotion_tier' when 'project' then result->>'project_id' when 'brand' then result->>'owning_brand_id' when 'project_group' then result->>'owning_project_group_id' end,'')<>''
   and not hub.content_promotion_reference_visible(result->>'promotion_tier',
    case result->>'promotion_tier' when 'project' then result->>'project_id' when 'brand' then result->>'owning_brand_id' when 'project_group' then result->>'owning_project_group_id' end) then
   raise exception 'ไม่มีสิทธิ์เข้าถึงเจ้าของโปรโมชั่น' using errcode='42501';end if;
 end if;
 if proposed?'programme_key' then result:=result||jsonb_build_object('programme_key',proposed->'programme_key');end if;
 if proposed?'all_active_projects' then result:=result||jsonb_build_object('all_active_projects',proposed->'all_active_projects');end if;
 targets:=coalesce(prior.targets,'[]');excluded:=to_jsonb(coalesce(prior.excluded_project_ids,'{}'::uuid[]));
 if proposed?'targets' then
  perform hub.validate_promotion_targets(proposed->'targets');
  if exists(select 1 from jsonb_array_elements(proposed->'targets') x where not hub.content_promotion_reference_visible(x->>'type',x->>'id')) then
   raise exception 'ไม่มีสิทธิ์เข้าถึงขอบเขตโปรโมชั่น' using errcode='42501';end if;
  select coalesce(jsonb_agg(x order by ordinal),'[]') into targets from jsonb_array_elements(targets) with ordinality entries(x,ordinal)
   where not hub.content_promotion_reference_visible(x->>'type',x->>'id');
  targets:=(proposed->'targets')||targets;
 end if;
 if proposed?'excluded_project_ids' then
  if jsonb_typeof(proposed->'excluded_project_ids') is distinct from 'array' then raise exception 'โครงการที่ยกเว้นไม่ถูกต้อง' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(proposed->'excluded_project_ids') x where not hub.content_promotion_reference_visible('project',x)) then
   raise exception 'ไม่มีสิทธิ์เข้าถึงโครงการที่ยกเว้น' using errcode='42501';end if;
  select coalesce(jsonb_agg(x order by ordinal),'[]') into excluded from jsonb_array_elements(excluded) with ordinality entries(x,ordinal)
   where not hub.content_promotion_reference_visible('project',x#>>'{}');
  excluded:=(proposed->'excluded_project_ids')||excluded;
 end if;
 result:=result||jsonb_build_object('targets',targets,'excluded_project_ids',excluded);
 perform hub.validate_promotion_scope(result);
 return result;
end $$;

-- Existing dispatcher retains its review/publication branches verbatim. Exact
-- anchors fail migration replay if an earlier security guard has drifted.
do $$ declare d text;extra text:=$keys$'programme_key','all_active_projects','campaign_name','campaign_slug','ads_campaign_code','highlight_badge','unit_scope_note','benefit_items'$keys$;begin
 d:=replace(pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,'review_revision integer;','review_revision integer;review_project_ids text[];');
 d:=hub.content_definition_replace(d,$old$if p->>'decision'='APPROVED' and (p->>'expected_scope_hash' is distinct from hub.promotion_scope_snapshot(r.id)->>'hash'
  or not exists(select 1 from hub.promotion_target_projects(r.id))) then$old$,
  $new$review_project_ids:=array(select public_id from hub.promotion_target_projects(r.id) order by public_id);
 if p->>'decision'='APPROVED' and (p->>'expected_scope_hash' is distinct from hub.web_hash(to_jsonb(review_project_ids))
  or cardinality(review_project_ids)=0) then$new$);
 d:=hub.content_definition_replace(d,$old$case when p->>'decision'='APPROVED' then array(select public_id from hub.promotion_target_projects(r.id) order by public_id) end$old$,
  $new$case when p->>'decision'='APPROVED' then review_project_ids end$new$);
 d:=hub.content_definition_replace(d,$anchor$'synthetic','project_id','owning_brand_id','code'$anchor$,$anchor$'synthetic','promotion_tier','project_id','owning_brand_id','owning_project_group_id','code'$anchor$);
 d:=hub.content_definition_replace(d,$anchor$'transfer_to','excluded_project_ids']$anchor$,$anchor$'transfer_to','excluded_project_ids',$anchor$||extra||']');
 d:=hub.content_definition_replace(d,$anchor$p:=p||hub.content_promotion_scope_input(null,null,p);$anchor$,$new$p:=p||hub.content_promotion_scope_input(null,null,p);
 perform hub.promotion_require_scope(p,'edit');$new$);
 d:=hub.content_definition_replace(d,$anchor$-array['project_id','owning_brand_id']$anchor$,$anchor$-array['promotion_tier','project_id','owning_brand_id','owning_project_group_id']$anchor$);
 d:=hub.content_definition_replace(d,$old$perform hub.validate_promotion_scope((merged->>'project_id')::uuid,(merged->>'owning_brand_id')::uuid,
  coalesce(merged->'targets','[]'),array(select x::uuid from jsonb_array_elements_text(coalesce(merged->'excluded_project_ids','[]')) x));$old$,
  $new$perform hub.validate_promotion_scope(merged);perform hub.promotion_require_scope(merged,'edit');$new$);
 d:=hub.content_definition_replace(d,'insert into hub.public_promotions(project_id,owning_brand_id,',
  'insert into hub.public_promotions(promotion_tier,legacy_scope,owning_project_group_id,programme_key,all_active_projects,campaign_name,campaign_slug,ads_campaign_code,highlight_badge,unit_scope_note,benefit_items,project_id,owning_brand_id,');
 d:=hub.content_definition_replace(d,$anchor$values((p->>'project_id')::uuid,(p->>'owning_brand_id')::uuid,$anchor$,
  $new$values(p->>'promotion_tier',(p->>'legacy_scope')::boolean,p->>'owning_project_group_id',p->>'programme_key',coalesce((p->>'all_active_projects')::boolean,false),coalesce(p->'campaign_name','{}'),p->>'campaign_slug',p->>'ads_campaign_code',coalesce(p->'highlight_badge','{}'),coalesce(p->'unit_scope_note','{}'),coalesce(p->'benefit_items','[]'),(p->>'project_id')::uuid,(p->>'owning_brand_id')::uuid,$new$);
 d:=hub.content_definition_replace(d,$anchor$update hub.public_promotions set title=merged->'title',$anchor$,
  $new$update hub.public_promotions set programme_key=merged->>'programme_key',all_active_projects=coalesce((merged->>'all_active_projects')::boolean,false),campaign_name=merged->'campaign_name',campaign_slug=merged->>'campaign_slug',ads_campaign_code=merged->>'ads_campaign_code',highlight_badge=merged->'highlight_badge',unit_scope_note=merged->'unit_scope_note',benefit_items=merged->'benefit_items',title=merged->'title',$new$);
 d:=hub.content_definition_replace(d,$old$if action in('publish','withdraw') then perform hub.publication_actor();$old$,
  $new$if action in('publish','withdraw') then perform hub.promotion_require_scope((select to_jsonb(x) from hub.public_promotions x where id=p_id),'publish');perform hub.publication_actor();$new$);
 execute d;
 d:=replace(pg_get_functiondef('hub.validate_promotion(jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,'declare field text;begin', $new$declare field text;begin
 if p?'benefit_items' then
  if not hub.promotion_benefit_items_valid(p->'benefit_items') then raise exception 'รายการสิทธิประโยชน์ไม่ถูกต้อง' using errcode='23514';end if;
  if jsonb_array_length(p->'benefit_items')>0 then p:=p||((p->'benefit_items'->0)-'label');end if;
 end if;$new$);execute d;
 d:=replace(pg_get_functiondef('hub.promotion_payload(uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,'to_jsonb(p)-array[',$new$to_jsonb(p)-array['legacy_scope',$new$);
 d:=hub.content_definition_replace(d,$anchor$from jsonb_array_elements(p.targets) t),'[]')$anchor$,
  $new$from (select value from jsonb_array_elements(p.targets) where (
    value->>'type'='project' and exists(select 1 from hub.promotion_target_projects(p.id) s where s.id::text=value->>'id')
    or value->>'type'='commercial_type' and exists(select 1 from hub.commercial_types c join hub.promotion_target_projects(p.id) s on s.id=c.project_id where c.id::text=value->>'id')
    or value->>'type'='brand' and exists(select 1 from hub.projects x join hub.promotion_target_projects(p.id) s on s.id=x.id where x.brand_id::text=value->>'id')
     and not exists(select 1 from hub.projects x where x.brand_id::text=value->>'id' and x.deleted_at is null
      and not exists(select 1 from hub.promotion_target_projects(p.id) s where s.id=x.id)))
    and not p.all_active_projects and not(p.promotion_tier='corporate' and p.programme_key is not null)
   union select jsonb_build_object('type','project','id',s.id) from hub.promotion_target_projects(p.id) s
    join hub.projects included on included.id=s.id
    where not p.all_active_projects and not(p.promotion_tier='corporate' and p.programme_key is not null)
     and exists(select 1 from jsonb_array_elements(p.targets) t where
      t->>'type'='project_group' and included.rem_project_id=any(hub.content_scope_projects('project_group',t->>'id'))
      or t->>'type'='brand' and included.brand_id::text=t->>'id' and exists(select 1 from hub.projects omitted
       where omitted.brand_id=included.brand_id and omitted.deleted_at is null
        and not exists(select 1 from hub.promotion_target_projects(p.id) visible where visible.id=omitted.id)))) resolved(t)),'[]')$new$);
 d:=hub.content_definition_replace(d,$anchor$'applies_via',case when p.owning_brand_id is not null then jsonb_build_object('scope_level','brand','brand_id',owner_brand.public_brand_id) else jsonb_build_object('scope_level','project','project_id',project.public_project_id) end$anchor$,
  $new$'applies_via',jsonb_build_object('scope_level',p.promotion_tier,'brand_id',owner_brand.public_brand_id,'project_id',project.public_project_id,'project_group_id',p.owning_project_group_id,'corporate_id',case when p.promotion_tier='corporate' then 'sena' end)$new$);execute d;
 d:=replace(pg_get_functiondef('hub.promotion_readiness(jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$anchor$if payload->>'owning_brand_id' is null and not exists$anchor$, $anchor$if payload->>'project_id' is not null and not exists$anchor$);
 d:=hub.content_definition_replace(d,$anchor$elsif payload->>'owning_brand_id' is not null and exists$anchor$, $anchor$elsif payload->>'project_id' is null and exists$anchor$);execute d;
 d:=replace(pg_get_functiondef('hub.lock_release_members(jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$anchor$hub.promotion_scope_projects(pr.project_id,pr.owning_brand_id,pr.targets,'{}')$anchor$, $anchor$hub.promotion_scope_projects(to_jsonb(pr)||jsonb_build_object('excluded_project_ids','[]'::jsonb))$anchor$);execute d;
 d:=replace(pg_get_functiondef('hub.publication_promotion_check(uuid,integer,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$if not(hub.promotion_readiness(payload)->>'ready')::boolean then$old$,
  $new$perform hub.promotion_require_scope(to_jsonb(source),'publish');
 if not(hub.promotion_readiness(payload)->>'ready')::boolean then$new$);execute d;
 d:=replace(pg_get_functiondef('hub.publication_queue_return(text,jsonb,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$if kind='promotion' then$old$,
  $new$if kind='promotion' then perform hub.promotion_require_scope(source,'publish');$new$);execute d;
end $$;

create or replace function hub.promotion_resolve(scope jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare proposed jsonb;rows jsonb;ids jsonb;begin
 perform hub.require_permission('promotions','view');perform hub.content_scope_lock();
 if jsonb_typeof(scope) is distinct from 'object'
  or scope-array['promotion_id','expected_revision','promotion_tier','project_id','owning_brand_id','owning_project_group_id','programme_key','all_active_projects','targets','excluded_project_ids']<>'{}' then
  raise exception 'ขอบเขตโปรโมชั่นไม่ถูกต้อง' using errcode='22023';end if;
 if scope?'promotion_id' or scope?'expected_revision' then
  if jsonb_typeof(scope->'promotion_id') is distinct from 'string' or jsonb_typeof(scope->'expected_revision') is distinct from 'number'
   or scope->>'expected_revision' !~ '^[1-9][0-9]*$'
   or scope ?| array['promotion_tier','project_id','owning_brand_id','owning_project_group_id'] then
   raise exception 'ข้อมูลอ้างอิงโปรโมชั่นไม่ถูกต้อง' using errcode='22023';end if;
  proposed:=hub.content_promotion_scope_input((scope->>'promotion_id')::uuid,(scope->>'expected_revision')::integer,scope);
 else proposed:=hub.content_promotion_scope_input(null,null,scope);end if;
 perform hub.promotion_require_scope(proposed,'view');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'public_id',p.public_project_id,'label',p.public_name) order by p.public_project_id),'[]'),
  coalesce(jsonb_agg(p.public_project_id order by p.public_project_id),'[]') into rows,ids
 from hub.promotion_scope_projects(proposed) s join hub.projects p on p.id=s.id;
 return hub.content_promotion_projection(jsonb_build_object('items',rows,'count',jsonb_array_length(rows),'scope_hash',hub.web_hash(ids)));
end $$;

create or replace function hub.promotion_references() returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('promotions','view');
 return jsonb_build_object(
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'public_id',p.public_project_id,'label',p.public_name,
   'brand_id',case when hub.content_promotion_reference_visible('brand',p.brand_id::text) then p.brand_id end,
   'project_group_id',(select d.source_record->>'rem_project_group_id' from staging.dw_projects d where d.rem_project_id=p.rem_project_id
    and hub.content_promotion_reference_visible('project_group',d.source_record->>'rem_project_group_id'))) order by p.public_project_id)
   from hub.projects p where p.deleted_at is null and hub.content_promotion_reference_visible('project',p.id::text)),'[]'),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'public_id',b.public_brand_id,'label',b.public_name) order by b.public_brand_id)
   from hub.brands b where b.deleted_at is null and hub.content_promotion_reference_visible('brand',b.id::text)),'[]'),
  'commercial_types',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'public_id',c.public_commercial_type_id,'label',c.public_name,'project_id',p.public_project_id) order by c.public_commercial_type_id)
   from hub.commercial_types c join hub.projects p on p.id=c.project_id where c.deleted_at is null and p.deleted_at is null
    and hub.content_promotion_reference_visible('commercial_type',c.id::text)),'[]'),
  'project_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'label',jsonb_build_object('th',coalesce(
    nullif(d.source_record->>'project_name_th',''),nullif(d.source_record->>'project_group_name',''),
    (select p.public_name->>'th' from hub.projects p where p.rem_project_id=any(hub.content_scope_projects('project_group',g.id)) order by p.public_project_id limit 1),'กลุ่มโครงการ')),
    'member_project_count',cardinality(hub.content_scope_projects('project_group',g.id)),
    'phase_count',cardinality(hub.content_scope_projects('project_group',g.id))) order by g.id)
   from (select project_group_id id from staging.dw_project_groups union select source_record->>'rem_project_group_id' from staging.dw_projects where nullif(source_record->>'rem_project_group_id','') is not null) g
   left join staging.dw_project_groups d on d.project_group_id=g.id where hub.content_promotion_reference_visible('project_group',g.id)),'[]'),
  'programmes',coalesce((select jsonb_agg(jsonb_build_object('id',g.key,'programme_key',g.key,'label',jsonb_build_object('th',coalesce(
    '{"livnex":"ลิฟเน็กซ์ เช่าออมบ้าน","rentnex":"เรนท์เน็กซ์","solar":"เสนา โซลาร์","sena360":"เสนา 360"}'::jsonb->>g.key,upper(g.key)))) order by g.key)
   from (select distinct lower(x.programme_key) key from hub.project_programmes x join hub.projects p on p.id=x.project_id
    where p.deleted_at is null and hub.content_promotion_reference_visible('project',p.id::text)) g
   where not exists(select 1 from hub.project_programmes x join hub.projects p on p.id=x.project_id
    where lower(x.programme_key)=g.key and x.participating and x.state='approved' and p.deleted_at is null
     and not hub.content_promotion_reference_visible('project',p.id::text))),'[]'));
end $$;

create function hub.promotion_filter_matches(p hub.public_promotions,filters jsonb) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select (filters->>'tier' is null or p.promotion_tier=filters->>'tier')
 and (filters->>'project_id' is null or hub.content_promotion_reference_visible('project',filters->>'project_id')
  and exists(select 1 from hub.promotion_target_projects(p.id) s where s.id=(filters->>'project_id')::uuid))
 and (filters->>'brand_id' is null or hub.content_promotion_reference_visible('brand',filters->>'brand_id') and (p.owning_brand_id=(filters->>'brand_id')::uuid or exists(
  select 1 from hub.promotion_target_projects(p.id) s join hub.projects x on x.id=s.id where x.brand_id=(filters->>'brand_id')::uuid)))
 and (filters->>'project_group_id' is null or hub.content_promotion_reference_visible('project_group',filters->>'project_group_id') and (p.owning_project_group_id=filters->>'project_group_id' or exists(
  select 1 from hub.promotion_target_projects(p.id) s join hub.projects x on x.id=s.id
   where x.rem_project_id=any(hub.content_scope_projects('project_group',filters->>'project_group_id')))))
 and (nullif(btrim(filters->>'q'),'') is null or strpos(lower(p.code||' '||coalesce(p.title->>'th','')||' '||coalesce(p.title->>'en','')),lower(btrim(filters->>'q')))>0)
$$;
do $$ declare d text;first_pos integer;last_pos integer;begin
 d:=replace(pg_get_functiondef('hub.promotion_read(uuid,jsonb)'::regprocedure),chr(13),'');
 first_pos:=strpos(d,'if p_id is null then');last_pos:=strpos(d,$old$perform hub.promotion_scope_access(p_id,'view');$old$);
 if first_pos=0 or last_pos<=first_pos then raise exception 'Promotion read scope guard anchor drift';end if;
 d:=substr(d,1,first_pos-1)||$new$if p_id is null then
  -- Private assistant filter reads only eligible frozen rows for this project.
  if p_filters->>'published_project_id' is not null then
   if not hub.content_promotion_reference_visible('project',p_filters->>'published_project_id') then
    raise exception 'ไม่มีสิทธิ์เข้าถึงโปรโมชั่นของโครงการนี้' using errcode='42501';end if;
   with eligible as materialized(select distinct v.id,v.promotion_id,v.version_no,live.payload,v.published_at from public_api.promotions live
    join hub.promotion_versions v on v.id=live.version_id
    where live.project_id=(p_filters->>'published_project_id')::uuid
     and (p_filters->>'published_promotion_id' is null or live.promotion_id=(p_filters->>'published_promotion_id')::uuid)
     and hub.content_source_allowed('promotion_versions',to_jsonb(v),'promotions')),
   page as (select * from eligible order by published_at desc,id
    limit least(coalesce((p_filters->>'limit')::integer,50),100) offset coalesce((p_filters->>'offset')::integer,0))
   select jsonb_build_object('items',coalesce((select jsonb_agg(hub.content_promotion_projection(jsonb_build_object(
    'id',p.promotion_id,'publication_available',true,'published',jsonb_build_object('id',p.id,'version_no',p.version_no,
     'payload',hub.public_content_payload('promotion',p.payload),'published_at',p.published_at))) order by p.published_at desc,p.id) from page p),'[]'),
    'total',(select count(*) from eligible)) into result;
   return result;
  end if;
  with visible as materialized(
   select p.*,exists(select 1 from public_api.promotions live where live.promotion_id=p.id) live,
    p.ends_at<=now() or p.published_version_id is not null or exists(select 1 from hub.promotion_versions v where v.promotion_id=p.id) paused
   from hub.content_promotion_rows() p where hub.promotion_scope_visible(p.id) and hub.promotion_filter_matches(p,p_filters-'tier')
  ), filtered as materialized(select * from visible where p_filters->>'tier' is null or promotion_tier=p_filters->>'tier'),
  selected as materialized(select * from filtered where p_filters->>'status' is null or p_filters->>'status'='all'
   or p_filters->>'status'='live' and live or p_filters->>'status'='draft' and not live and not paused
   or p_filters->>'status'='paused' and not live and paused),
  page as (select * from selected order by updated_at desc,id limit least(coalesce((p_filters->>'limit')::integer,50),100) offset coalesce((p_filters->>'offset')::integer,0))
  select jsonb_build_object('items',(select coalesce(jsonb_agg(hub.promotion_read(p.id)||jsonb_build_object(
    'status_group',case when p.live then 'live' when p.paused then 'paused' else 'draft' end) order by p.updated_at desc,p.id),'[]') from page p),
   'total',(select count(*) from selected),
   'tier_counts',(select jsonb_build_object('all',count(*),'campaign',count(*) filter(where promotion_tier='campaign'),
    'corporate',count(*) filter(where promotion_tier='corporate'),'brand',count(*) filter(where promotion_tier='brand'),
    'project_group',count(*) filter(where promotion_tier='project_group'),'project',count(*) filter(where promotion_tier='project')) from visible),
   'status_counts',(select jsonb_build_object('all',count(*),'live',count(*) filter(where live),
    'draft',count(*) filter(where not live and not paused),'paused',count(*) filter(where not live and paused)) from filtered)) into result;
  return result;
 end if;
 $new$||substr(d,last_pos);
 d:=hub.content_definition_replace(d,'return hub.content_promotion_projection(result);',
  $new$return hub.content_promotion_projection(result)||jsonb_build_object('can_edit',hub.content_source_allowed('public_promotions',
   (select to_jsonb(x) from hub.public_promotions x where id=p_id),'promotions','edit'),
   'scope_target_types',(select case when legacy_scope or promotion_tier in ('campaign','corporate') then to_jsonb(array['project','brand','project_group','commercial_type'])
    when promotion_tier='project' then '["commercial_type"]'::jsonb else '[]'::jsonb end from hub.public_promotions where id=p_id));$new$);
 execute d;

 d:=replace(pg_get_functiondef('hub.workspace_promotion_rows(text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$kind not in ('project','brand') or kind='brand' and phase is not null$old$,
  $new$kind not in ('project','brand','project_group','corporate') or kind<>'project' and phase is not null$new$);
 d:=hub.content_definition_replace(d,$old$'project_id',s.project_id,'owning_brand_id',s.owning_brand_id,$old$,
  $new$'project_id',s.project_id,'owning_brand_id',s.owning_brand_id,'owning_project_group_id',s.owning_project_group_id,
  'promotion_tier',s.promotion_tier,'applies_via',s.promotion_tier,
  'can_edit',hub.content_source_allowed('public_promotions',to_jsonb(s),'promotions','edit'),
  'benefit_items',coalesce(s.display->'benefit_items','[]'),'highlight_badge',coalesce(s.display->'highlight_badge','{}'),
  'benefit_type',s.display->'benefit_type','benefit_value',s.display->'benefit_value','benefit_unit',s.display->'benefit_unit',$new$);
 d:=hub.content_definition_replace(d,'where draft_applies or published_applies or owning_brand_id=brand',
  $new$where draft_applies or published_applies or owning_brand_id=brand
   or kind='project_group' and owning_project_group_id=ref or kind='corporate' and promotion_tier in ('campaign','corporate')$new$);
 execute d;
 d:=replace(pg_get_functiondef('hub.workspace_promotions(text,text,text,text,integer,integer,uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$'context',jsonb_build_object('kind',kind,'ref',ref,'phase',phase,$old$,
  $new$'context',jsonb_build_object('kind',kind,'ref',ref,'phase',phase,'promotion_tier',kind,
  'owning_project_group_id',case when kind='project_group' then ref end,$new$);execute d;
 d:=replace(pg_get_functiondef('hub.workspace_promotion_suggestions(text,text,text,integer,integer,uuid,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$kind not in ('project','brand') or kind='brand' and phase is not null$old$,
  $new$kind not in ('project','brand','project_group','corporate') or kind<>'project' and phase is not null$new$);execute d;
 d:=replace(pg_get_functiondef('hub.workspace_page(text,text,text)'::regprocedure),chr(13),'');
 -- Phase A reformatted this function; match only the promotion-tab predicates.
 d:=regexp_replace(d,$re$if kind in \('project',\s*'brand'\) then\s*if hub.can\('promotions',$re$,
  $new$if kind in ('project','brand','project_group','corporate') then
  if hub.can('promotions',$new$,'g');
 d:=regexp_replace(d,$re$if kind in \('project',\s*'brand'\) and hub.can\('promotions',$re$,
  $new$if kind in ('project','brand','project_group','corporate') and hub.can('promotions',$new$,'g');
 execute d;
 -- New fields are frozen in publication payloads and admitted explicitly to the
 -- public projection. Internal campaign codes and internal owner IDs stay private.
 d:=replace(pg_get_functiondef('hub.public_content_payload(text,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$'audience','booking_from','booking_to','transfer_from','transfer_to']$old$,
  $new$'audience','booking_from','booking_to','transfer_from','transfer_to','promotion_tier','campaign_name','campaign_slug','highlight_badge','unit_scope_note','benefit_items']$new$);execute d;
 d:=replace(pg_get_functiondef('hub.media_target(uuid,text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$when 'promotion' then return hub.can('promotions',level) and exists(select 1 from hub.public_promotions promo where id::text=key and exists(select 1 from hub.promotion_target_projects(promo.id) scope where scope.id=project_uuid));$old$,
  $new$when 'promotion' then return hub.can('promotions',level) and exists(select 1 from hub.public_promotions promo where promo.id::text=key
   and exists(select 1 from hub.promotion_target_projects(promo.id) s where s.id=project_uuid)
   and hub.content_source_allowed('public_promotions',to_jsonb(promo),'promotions',level));$new$);execute d;
 d:=replace(pg_get_functiondef('hub.promotion_banner_changed()'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$perform hub.require_permission('promotions','edit');$old$,
  $new$perform hub.promotion_scope_access(target,'edit');$new$);execute d;
 d:=replace(pg_get_functiondef('hub.content_scope_access(text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$or kind='project_group' and exists(select 1 from staging.dw_project_groups where project_group_id=ref)$old$,
  $new$or kind='project_group' and (exists(select 1 from staging.dw_project_groups where project_group_id=ref)
   or exists(select 1 from staging.dw_projects where source_record->>'rem_project_group_id'=ref))$new$);execute d;
 -- The publication queue and task list must also discover the new owner kinds.
 d:=replace(pg_get_functiondef('hub.workspace_native_rows_before_scopes()'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$case when p.owning_brand_id is null then 'project' else 'brand' end$old$,
  $new$case when p.promotion_tier in ('campaign','corporate') then 'corporate' else p.promotion_tier end$new$);
 d:=hub.content_definition_replace(d,'coalesce(pr.public_project_id,b.public_brand_id)',
  $new$coalesce(pr.public_project_id,b.public_brand_id,p.owning_project_group_id,'sena')$new$);
 d:=hub.content_definition_replace(d,$old$(p.project_id is not null and pr.deleted_at is null or p.owning_brand_id is not null and b.deleted_at is null)$old$,
  $new$(p.promotion_tier in ('campaign','corporate','project_group') or p.project_id is not null and pr.deleted_at is null or p.owning_brand_id is not null and b.deleted_at is null)$new$);execute d;
end $$;

-- Promotion citations retain the queried phase. Revalidation follows the frozen
-- version and current per-phase eligibility rather than the later draft owner.
alter table internal.assistant_citation add column scope jsonb not null default '{}'::jsonb
 check(jsonb_typeof(scope)='object' and scope-array['project_id']='{}'
  and (not(scope?'project_id') or jsonb_typeof(scope->'project_id')='string' and length(scope->>'project_id') between 1 and 100));
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_scoped_source(text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$elsif kind='promotion' then select to_jsonb(p) into row_data$old$,
  $new$elsif kind='promotion' then
  if version not like 'draft:%' then
   return exists(select 1 from public_api.promotions live join hub.promotion_versions v on v.id=live.version_id
    where (live.promotion_id::text=ref or live.code=ref) and v.id::text=version
     and hub.content_promotion_reference_visible('project',live.project_id::text)
     and hub.content_source_allowed('promotion_versions',to_jsonb(v),'promotions'));
  end if;
  select to_jsonb(p) into row_data$new$);execute d;
end $$;
create function internal.assistant_scoped_promotion_source(kind text,ref text,version text,project_ref text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 if kind<>'promotion' or version like 'draft:%' then return internal.assistant_scoped_source(kind,ref,version);end if;
 return exists(select 1 from public_api.promotions live join hub.promotion_versions v on v.id=live.version_id
  where (live.promotion_id::text=ref or live.code=ref) and v.id::text=version and live.public_project_id=project_ref
   and hub.content_promotion_reference_visible('project',live.project_id::text)
   and hub.content_source_allowed('promotion_versions',to_jsonb(v),'promotions'));
exception when insufficient_privilege or no_data_found then return false;
end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_tool_record(uuid,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$'namespace','entity_type','entity_id','version','page')$old$,
  $new$'namespace','entity_type','entity_id','version','page','scope')$new$);
 d:=hub.content_definition_replace(d,$old$internal.assistant_scoped_source(source->>'entity_type',source->>'entity_id',source->>'version')$old$,
  $new$internal.assistant_scoped_promotion_source(source->>'entity_type',source->>'entity_id',source->>'version',coalesce(source#>>'{scope,project_id}',r.scope_project_id))$new$);
 d:=hub.content_definition_replace(d,$old$if not internal.assistant_scoped_promotion_source(source->>'entity_type'$old$,
  $new$if source->>'entity_type'='promotion' and r.scope_project_id is not null
   and source#>>'{scope,project_id}' is not null and source#>>'{scope,project_id}'<>r.scope_project_id then
   raise exception 'โครงการอ้างอิงไม่ตรงกับบริบทการสนทนา' using errcode='42501';end if;
 if not internal.assistant_scoped_promotion_source(source->>'entity_type'$new$);
 d:=hub.content_definition_replace(d,'insert into internal.assistant_citation(run_id,tool_id,namespace,entity_type,entity_id,version,page)',
  'insert into internal.assistant_citation(run_id,tool_id,namespace,entity_type,entity_id,version,page,scope)');
 d:=hub.content_definition_replace(d,$old$(source->>'page')::integer) returning * into c;$old$,
  $new$(source->>'page')::integer,case when source->>'entity_type'='promotion' then
   case when coalesce(source#>>'{scope,project_id}',r.scope_project_id) is not null then
    jsonb_build_object('project_id',coalesce(source#>>'{scope,project_id}',r.scope_project_id)) else '{}'::jsonb end
   else '{}'::jsonb end) returning * into c;$new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_citation_read(uuid,uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,'internal.assistant_scoped_source(c.entity_type,c.entity_id,c.version)',
  $new$internal.assistant_scoped_promotion_source(c.entity_type,c.entity_id,c.version,coalesce(c.scope->>'project_id',
   (select r.scope_project_id from internal.assistant_run r where r.id=c.run_id)))$new$);
 d:=hub.content_definition_replace(d,'return to_jsonb(c)||',
  $new$return to_jsonb(c)||case when c.entity_type='promotion' and not(c.scope?'project_id') then
   jsonb_build_object('scope',coalesce((select jsonb_build_object('project_id',r.scope_project_id)
    from internal.assistant_run r where r.id=c.run_id and r.scope_project_id is not null),'{}'::jsonb))
   else '{}'::jsonb end||$new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_run_read(uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,'internal.assistant_scoped_source(c.entity_type,c.entity_id,c.version)',
  $new$internal.assistant_scoped_promotion_source(c.entity_type,c.entity_id,c.version,coalesce(c.scope->>'project_id',r.scope_project_id))$new$);
 d:=hub.content_definition_replace(d,'jsonb_agg(to_jsonb(c) order by c.created_at,c.id)',
  $new$jsonb_agg(to_jsonb(c)||case when c.entity_type='promotion' and not(c.scope?'project_id') and r.scope_project_id is not null then
   jsonb_build_object('scope',jsonb_build_object('project_id',r.scope_project_id)) else '{}'::jsonb end order by c.created_at,c.id)$new$);execute d;
end $$;
revoke all on function internal.assistant_scoped_promotion_source(text,text,text,text)
 from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;

revoke all on function hub.promotion_benefit_items_valid(jsonb),hub.promotion_benefit_sync(),
 hub.promotion_scope_projects(jsonb),hub.validate_promotion_scope(jsonb),hub.promotion_require_scope(jsonb,text),
 hub.promotion_require_project_ids(text[],text),hub.promotion_frozen_scope_guard(),
 hub.promotion_filter_matches(hub.public_promotions,jsonb)
 from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
-- Replaced RPCs retain their exact existing ACLs; no new runtime entry point.

commit;
