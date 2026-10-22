-- Additive media drafts; historical assets, bindings and rights are not rewritten.
begin;

create function hub.media_categories() returns text[] language sql immutable
set search_path=pg_catalog,pg_temp as $$ select array['exterior','interior','facility','lifestyle','aerial','surrounding',
 'master_plan','floor_plan','unit_plan','map','progress','promotion_ad','brochure','legal_document'] $$;
alter table hub.assets
 add column media_category text check(media_category=any(hub.media_categories())),
 add column caption jsonb not null default '{}', add column alt_text jsonb not null default '{}',
 add column image_kind text check(image_kind in ('photo','render','progress','drawing','stock')),
 add column taken_at date, add column people text not null default 'unknown' check(people in ('present','absent','unknown')),
 add column third_party_marks text not null default 'unknown' check(third_party_marks in ('present','absent','unknown')),
 add column credit jsonb not null default '{}', add column ai_suggestion jsonb,
 add column metadata_state text not null default 'needs_review' check(metadata_state in ('needs_review','confirmed')),
 add column media_revision integer not null default 0 check(media_revision>=0),
 add column ai_exposure text not null default 'internal' check(ai_exposure in ('open','web_only','internal')),
 add column marketing_publication boolean not null default false;

create table hub.media_tags (
 code text primary key check(code ~ '^[a-z][a-z0-9_]{0,79}$'), label jsonb not null,
 tag_group text not null check(tag_group in ('room','facility','view','time','style')),
 allowed_categories text[] not null default '{}' check(allowed_categories <@ hub.media_categories()),
 status text not null default 'proposed' check(status in ('active','proposed','retired')),
 revision integer not null default 1, approved_by uuid, approved_at timestamptz,
 check(hub.content_locales(label,200,true))
);
create table hub.asset_media_tags (
 asset_id uuid not null references hub.assets, tag_code text not null references hub.media_tags,
 primary key(asset_id,tag_code)
);
create table hub.asset_links (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 asset_id uuid not null references hub.assets,
 target_type text not null check(target_type in ('project','commercial_type','facility','feature','place','promotion','article','building_floor','selling_point','disclosure')),
 target_key text not null, usage text not null check(usage in ('hero','thumbnail','gallery','card','banner','evidence')),
 building_key text, floor_from integer, floor_to integer, room_tag text references hub.media_tags,
 sort integer not null default 0 check(sort>=0), is_primary boolean not null default false,
 effective_from timestamptz, effective_to timestamptz, revision integer not null default 1,
 ai_exposure text not null default 'internal' check(ai_exposure in ('open','web_only','internal')),
 deleted_at timestamptz,
 foreign key(project_id,building_key) references hub.project_buildings,
 check(floor_from is null or floor_from>0), check(floor_to is null or floor_to>=floor_from),
 check(floor_to is null or floor_from is not null),
 check(effective_to is null or effective_from is null or effective_to>effective_from)
);
create unique index asset_link_identity on hub.asset_links(project_id,asset_id,target_type,target_key,usage) where deleted_at is null;
create unique index facility_media_cover on hub.asset_links(project_id,target_key) where target_type='facility' and is_primary and deleted_at is null;

create function hub.media_project(public_id text,level text) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result uuid; begin
 perform hub.content_scope_access('project',public_id,level);
 select id into result from hub.projects where public_project_id=public_id and deleted_at is null;
 return result;
end $$;
create function hub.media_target(project_uuid uuid,kind text,key text,level text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.can('projects',level) then return false; end if;
 case kind
 when 'project' then return key=project_uuid::text;
 when 'facility' then return exists(select 1 from hub.project_facilities where project_id=project_uuid and facility_code=key and (level='view' or status in ('present','planned')));
 when 'commercial_type' then return exists(select 1 from hub.commercial_types where project_id=project_uuid and id::text=key and deleted_at is null);
 when 'building_floor' then return exists(select 1 from hub.project_buildings where project_id=project_uuid and building_key=key);
 when 'selling_point' then return exists(select 1 from hub.project_selling_points p where project_id=project_uuid and point_key::text=key and state<>'WITHDRAWN'
  and revision=(select max(v.revision) from hub.project_selling_points v where v.project_id=p.project_id and v.point_key=p.point_key));
 when 'promotion' then return hub.can('promotions',level) and exists(select 1 from hub.public_promotions where project_id=project_uuid and id::text=key);
 -- The owning phases add guarded reference cases; no speculative tables or IDs.
 else return false;
 end case;
end $$;

-- Preserve the existing read predicate while retaining its OID for RLS callers.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('hub.can_read_asset(uuid)'::regprocedure);
 execute replace(definition,'FUNCTION hub.can_read_asset(', 'FUNCTION hub.can_read_asset_before_media(');
end $$;
create or replace function hub.can_read_asset(asset_uuid uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.assets a where a.id=asset_uuid and a.deleted_at is null
  and (a.media_category is distinct from 'legal_document' or hub.can('projects','edit') or hub.can('projects','approve'))
  and (hub.can_read_asset_before_media(asset_uuid) or exists(select 1 from hub.asset_links l join hub.projects p on p.id=l.project_id
   where l.asset_id=a.id and l.deleted_at is null and p.deleted_at is null and hub.media_target(l.project_id,l.target_type,l.target_key,'view'))))
$$;

do $$ declare name text; predicate text; begin
 foreach name in array array['media_tags','asset_media_tags','asset_links'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy media_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  predicate:=case name when 'asset_media_tags' then 'hub.can_read_asset(asset_id)'
   when 'asset_links' then 'hub.media_target(project_id,target_type,target_key,''view'') and hub.can_read_asset(asset_id)'
   else 'hub.can(''projects'',''view'')' end;
  execute format('create policy media_read on hub.%I for select to hub_app using(%s)',name,predicate);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger media_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger media_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;
create trigger remember_asset_binding after insert or update of asset_id on hub.asset_links for each row execute function hub.remember_asset_binding();

insert into hub.media_tags(code,label,tag_group,allowed_categories,status)
select code,jsonb_build_object('th',th,'en',en),grp,categories,'active' from (values
 ('living_room','ห้องนั่งเล่น','Living room','room',array['interior']),('bedroom','ห้องนอน','Bedroom','room',array['interior']),
 ('master_bedroom','ห้องนอนใหญ่','Master bedroom','room',array['interior']),('bathroom','ห้องน้ำ','Bathroom','room',array['interior']),
 ('kitchen','ห้องครัว','Kitchen','room',array['interior']),('dining','พื้นที่รับประทานอาหาร','Dining','room',array['interior']),
 ('balcony','ระเบียง','Balcony','room',array['interior','exterior']),('walk_in_closet','ห้องแต่งตัว','Walk-in closet','room',array['interior']),
 ('maid_room','ห้องแม่บ้าน','Maid room','room',array['interior']),('multipurpose_room','ห้องอเนกประสงค์','Multipurpose room','room',array['interior']),
 ('family_area','พื้นที่ครอบครัว','Family area','room',array['interior']),
 ('city_view','วิวเมือง','City view','view',array['exterior','aerial','surrounding','interior']),
 ('garden_view','วิวสวน','Garden view','view',array['exterior','interior','facility','surrounding']),
 ('river_view','วิวแม่น้ำ','River view','view',array['exterior','interior','aerial','surrounding']),
 ('sunset_view','วิวพระอาทิตย์ตก','Sunset view','view',array['exterior','interior','aerial','surrounding']),
 ('day','กลางวัน','Day','time','{}'::text[]),('night','กลางคืน','Night','time','{}'::text[]),('sunset','ช่วงพระอาทิตย์ตก','Sunset','time','{}'::text[]),
 ('show_unit','ห้องตัวอย่าง','Show unit','style',array['interior','exterior']),('actual_unit','ยูนิตจริง','Actual unit','style',array['interior','exterior'])
) as seed(code,th,en,grp,categories);
insert into hub.media_tags(code,label,tag_group,allowed_categories,status)
select code,jsonb_build_object('th',name_th,'en',name_en),'facility',array['facility'],'active' from hub.facility_taxonomy;

create function hub.media_tag_save(key text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.media_tags; edited hub.media_tags; begin
 perform hub.require_permission('projects','edit');
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where k not in ('label','tag_group','allowed_categories')) then
  raise exception 'Invalid media tag fields' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('media-tag:'||key,0));
 select * into prior from hub.media_tags where code=key for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Media tag changed' using errcode='40001'; end if;
 if prior.status='active' then raise exception 'Active media vocabulary is immutable; propose a new code' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.media_tags,body);
 insert into hub.media_tags(code,label,tag_group,allowed_categories) values(key,edited.label,edited.tag_group,coalesce(edited.allowed_categories,'{}'))
 on conflict(code) do update set label=excluded.label,tag_group=excluded.tag_group,allowed_categories=excluded.allowed_categories,
  status='proposed',revision=hub.media_tags.revision+1,approved_by=null,approved_at=null returning * into edited;
 return to_jsonb(edited);
end $$;
create function hub.media_tag_approve(key text,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare row hub.media_tags; actor uuid; begin
 actor:=hub.require_permission('projects','approve');
 select * into row from hub.media_tags where code=key for update;
 if not found then raise exception 'Media tag not found' using errcode='P0002'; end if;
 if row.revision is distinct from expected then raise exception 'Media tag changed' using errcode='40001'; end if;
 if decision not in ('active','retired') or decision is null then raise exception 'Invalid tag decision' using errcode='23514'; end if;
 if decision='active' and row.status='proposed' and (row.created_by=actor or row.updated_by=actor) then raise exception 'Another approver is required' using errcode='42501'; end if;
 update hub.media_tags set status=decision,revision=revision+1,approved_by=actor,approved_at=clock_timestamp() where code=key returning * into row;
 return to_jsonb(row);
end $$;
create function hub.media_tags_read() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_permission('projects','view');
 return (select coalesce(jsonb_agg(to_jsonb(t) order by tag_group,code),'[]') from hub.media_tags t);
end $$;

create function hub.media_require_asset_edit(asset_uuid uuid) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','edit'); perform hub.require_asset_access(asset_uuid);
 if (exists(select 1 from hub.brand_assets where asset_id=asset_uuid and deleted_at is null)
  or exists(select 1 from hub.brands b join hub.brand_versions v on v.id=b.published_version_id where b.deleted_at is null
   and jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',asset_uuid::text)))) and not hub.can('brands','edit')
 or exists(select 1 from hub.knowledge_asset_links where asset_id=asset_uuid) and not hub.can('knowledge','edit')
 or exists(select 1 from hub.asset_links where asset_id=asset_uuid and target_type='promotion' and deleted_at is null) and not hub.can('promotions','edit') then
  raise exception 'Editing shared media requires every source permission' using errcode='42501'; end if;
end $$;
create function hub.media_save_asset(public_id text,asset_uuid uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare row hub.assets; edited hub.assets; tags text[]; begin
 perform hub.media_project(public_id,'edit'); perform hub.media_require_asset_edit(asset_uuid);
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('media_category','caption','alt_text','image_kind','taken_at','people','third_party_marks','credit','metadata_state','tags','ai_exposure','marketing_publication')) then
  raise exception 'Invalid media metadata fields' using errcode='23514'; end if;
 select * into row from hub.assets where id=asset_uuid and deleted_at is null for update;
 if row.media_revision is distinct from expected then raise exception 'Media metadata changed' using errcode='40001'; end if;
 edited:=jsonb_populate_record(row,body-'tags');
 if not hub.content_locales(edited.caption,2000) or not hub.content_locales(edited.alt_text,1000) or not hub.content_locales(edited.credit,500)
  or edited.media_category is null or edited.taken_at>current_date
  or edited.metadata_state='confirmed' and not hub.content_locales(edited.alt_text,1000,true)
  or edited.media_category='legal_document' and (edited.ai_exposure<>'internal' or edited.marketing_publication)
  or row.media_category='legal_document' and edited.media_category<>'legal_document'
  or edited.media_category='legal_document' and row.media_category is distinct from 'legal_document' and row.first_bound_at is not null then
  raise exception 'Invalid or restricted media metadata' using errcode='23514'; end if;
 if body ? 'tags' then
  if jsonb_typeof(body->'tags') is distinct from 'array' or jsonb_array_length(body->'tags')>30 then raise exception 'Invalid media tags' using errcode='23514'; end if;
  select coalesce(array_agg(distinct value),'{}') into tags from jsonb_array_elements_text(body->'tags');
 else select coalesce(array_agg(tag_code),'{}') into tags from hub.asset_media_tags where asset_id=asset_uuid; end if;
 if exists(select 1 from unnest(tags) tag(value) where not exists(select 1 from hub.media_tags t where t.code=tag.value and t.status='active'
  and (cardinality(t.allowed_categories)=0 or edited.media_category=any(t.allowed_categories)))) then raise exception 'Unknown or incompatible media tags' using errcode='23514'; end if;
 update hub.assets set media_category=edited.media_category,caption=edited.caption,alt_text=edited.alt_text,image_kind=edited.image_kind,taken_at=edited.taken_at,
  people=edited.people,third_party_marks=edited.third_party_marks,credit=edited.credit,metadata_state=edited.metadata_state,
  ai_exposure=edited.ai_exposure,marketing_publication=edited.marketing_publication,media_revision=media_revision+1 where id=asset_uuid returning * into row;
 delete from hub.asset_media_tags where asset_id=asset_uuid and not tag_code=any(tags);
 insert into hub.asset_media_tags(asset_id,tag_code) select asset_uuid,unnest(tags) on conflict do nothing;
 return to_jsonb(row)||jsonb_build_object('tags',tags);
end $$;

create function hub.media_link_save(public_id text,link_uuid uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid; prior hub.asset_links; edited hub.asset_links; asset hub.assets; building hub.project_buildings; promo hub.public_promotions; begin
 project_uuid:=hub.media_project(public_id,'edit');
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('asset_id','target_type','target_key','usage','building_key','floor_from','floor_to','room_tag','sort','is_primary','effective_from','effective_to','ai_exposure')) then
  raise exception 'Invalid media link fields' using errcode='23514'; end if;
 -- Serialize cover changes without rewriting the former cover behind its editor.
 perform pg_advisory_xact_lock(hashtextextended('media-project:'||project_uuid::text,0));
 select * into prior from hub.asset_links where id=link_uuid and project_id=project_uuid and deleted_at is null for update;
 if prior.id is null and exists(select 1 from hub.asset_links where id=link_uuid) then raise exception 'Media link not found' using errcode='P0002'; end if;
 if prior.target_type='promotion' then perform hub.require_permission('promotions','edit');end if;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Media link changed' using errcode='40001'; end if;
 if prior.id is null then prior:=jsonb_populate_record(null::hub.asset_links,'{"usage":"gallery","sort":0,"is_primary":false,"ai_exposure":"internal"}');end if;
 edited:=jsonb_populate_record(prior,body);
 if not hub.media_target(project_uuid,edited.target_type,edited.target_key,'edit') then raise exception 'Media target unavailable' using errcode='42501'; end if;
 perform hub.require_asset_access(edited.asset_id);
 if prior.asset_id is not null and prior.asset_id<>edited.asset_id then raise exception 'Link asset identity is immutable' using errcode='23514'; end if;
 select * into asset from hub.assets where id=edited.asset_id and deleted_at is null for update;
 if asset.media_category='legal_document' and edited.target_type<>'disclosure'
  or edited.usage in ('hero','thumbnail') then raise exception 'Use the existing project hero/thumbnail workflow; Legal files are evidence only' using errcode='23514'; end if;
 if edited.target_type='building_floor' and edited.building_key is distinct from edited.target_key then raise exception 'Building context is required' using errcode='23514'; end if;
 if edited.floor_from is not null then
  if edited.target_type='commercial_type' then
   if edited.floor_to>(select storeys from hub.commercial_types where id=edited.target_key::uuid) or edited.floor_from>(select storeys from hub.commercial_types where id=edited.target_key::uuid)
    or (select storeys from hub.commercial_types where id=edited.target_key::uuid) is null then raise exception 'Invalid type storey' using errcode='23514'; end if;
  else
   select * into building from hub.project_buildings where project_id=project_uuid and building_key=edited.building_key;
   if not found or building.floors_above is null or edited.floor_from>building.floors_above or coalesce(edited.floor_to,edited.floor_from)>building.floors_above
    or exists(select 1 from unnest(building.skip_floors) f where f between edited.floor_from and coalesce(edited.floor_to,edited.floor_from)) then
    raise exception 'Invalid building floors' using errcode='23514'; end if;
  end if;
 elsif edited.target_type='building_floor' then raise exception 'Choose a building floor' using errcode='23514'; end if;
 if edited.room_tag is not null and not exists(select 1 from hub.media_tags where code=edited.room_tag and tag_group='room' and status='active') then raise exception 'Invalid room tag' using errcode='23514'; end if;
 if edited.target_type='promotion' then
  select * into promo from hub.public_promotions where id::text=edited.target_key;
  edited.effective_from:=greatest(coalesce(edited.effective_from,promo.starts_at),promo.starts_at);
  edited.effective_to:=least(coalesce(edited.effective_to,promo.ends_at),promo.ends_at);
 end if;
 insert into hub.asset_links(id,project_id,asset_id,target_type,target_key,usage,building_key,floor_from,floor_to,room_tag,sort,is_primary,effective_from,effective_to,ai_exposure)
 values(link_uuid,project_uuid,edited.asset_id,edited.target_type,edited.target_key,edited.usage,edited.building_key,edited.floor_from,edited.floor_to,edited.room_tag,edited.sort,edited.is_primary,edited.effective_from,edited.effective_to,edited.ai_exposure)
 on conflict(id) do update set usage=excluded.usage,building_key=excluded.building_key,floor_from=excluded.floor_from,floor_to=excluded.floor_to,
  room_tag=excluded.room_tag,sort=excluded.sort,is_primary=excluded.is_primary,effective_from=excluded.effective_from,effective_to=excluded.effective_to,
  target_type=excluded.target_type,target_key=excluded.target_key,ai_exposure=excluded.ai_exposure,revision=hub.asset_links.revision+1 returning * into edited;
 return to_jsonb(edited);
end $$;
create function hub.media_link_remove(public_id text,link_uuid uuid,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid; row hub.asset_links; begin
 project_uuid:=hub.media_project(public_id,'edit');
 select * into row from hub.asset_links where id=link_uuid and project_id=project_uuid and deleted_at is null for update;
 if not found then raise exception 'Media link not found' using errcode='P0002'; end if;
 if row.target_type='promotion' then perform hub.require_permission('promotions','edit');end if;
 if row.revision is distinct from expected then raise exception 'Media link changed' using errcode='40001'; end if;
 update hub.asset_links set deleted_at=clock_timestamp(),revision=revision+1 where id=link_uuid;
 return jsonb_build_object('removed',true);
end $$;

-- Legal files can never enter legacy publication bindings, even via direct SQL.
create function hub.media_legacy_binding_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from hub.assets where id=new.asset_id and media_category='legal_document') then
  raise exception 'Legal media cannot be bound to publication content' using errcode='23514'; end if;
 return new;
end $$;
do $$ declare name text; f record; begin
 foreach name in array array['entity_assets','brand_assets','commercial_type_assets','knowledge_asset_links'] loop
  execute format('create trigger media_legal_guard before insert or update of asset_id on hub.%I for each row execute function hub.media_legacy_binding_guard()',name);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and p.proname in ('media_categories','media_project','media_target','can_read_asset_before_media','media_require_asset_edit','media_tag_save','media_tag_approve',
  'media_tags_read','media_save_asset','media_link_save','media_link_remove','media_legacy_binding_guard') loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname in ('media_target','media_tag_save','media_tag_approve','media_tags_read','media_save_asset','media_link_save','media_link_remove') then
   execute format('grant execute on function %s to hub_app',f.signature);
  end if;
 end loop;
end $$;
commit;
