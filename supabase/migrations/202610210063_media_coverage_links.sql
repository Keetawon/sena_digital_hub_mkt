begin;
create table hub.media_requirements (
 rule_key text primary key check(rule_key ~ '^[a-z][a-z0-9_]{0,79}$'), label jsonb not null,
 per text not null check(per in ('project','facility_present','commercial_type','type_storey','building_floor','active_promotion','under_construction')),
 media_category text check(media_category=any(hub.media_categories())), usage text check(usage in ('hero','thumbnail','gallery','card','banner','evidence')),
 tags text[] not null default '{}', min_count integer not null check(min_count between 0 and 100),
 target_count integer not null check(target_count between 1 and 100 and target_count>=min_count),
 blocks_publish boolean not null default false, max_age_days integer check(max_age_days between 1 and 3660),
 status text not null default 'active' check(status in ('active','retired')), revision integer not null default 1,
 check(not blocks_publish or per='project' and usage in ('hero','thumbnail')),
 check(hub.content_locales(label,200,true)), check(media_category is not null or usage in ('hero','thumbnail'))
);
create table hub.media_links (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 provider text not null check(provider in ('youtube','tiktok','facebook','instagram','matterport','kuula','other')),
 kind text not null check(kind in ('review','walkthrough','tour_360','drone','ad','interview','progress')),
 tour_kind text check(tour_kind in ('panorama','virtual_walk','dollhouse','other')),
 url text not null check(length(url)<=2048), external_id text, embed_url text,
 title jsonb not null default '{}', description jsonb not null default '{}',
 published_at timestamptz, captured_at date, duration_sec integer check(duration_sec between 1 and 86400),
 aspect text check(aspect in ('landscape','portrait','square','panorama')), language text check(language in ('th','en','other')),
 subtitles text[] not null default '{}' check(subtitles <@ array['th','en','other']),
 channel_name jsonb not null default '{}', owner_type text not null check(owner_type in ('sena_owned','partner','influencer')),
 is_sponsored boolean not null default false, thumbnail_asset_id uuid references hub.assets,
 metadata_source text not null default 'manual' check(metadata_source in ('manual','provider')),
 metadata_fetched_at timestamptz, provider_metadata jsonb,
 link_status text not null default 'ok' check(link_status in ('ok','broken','private','removed')), checked_at timestamptz,
 is_featured boolean not null default false, sort integer not null default 0 check(sort>=0),
 state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','PUBLISHED','WITHDRAWN')),
 ai_exposure text not null default 'internal' check(ai_exposure in ('open','web_only','internal')), revision integer not null default 1,
 unique(id,project_id)
);
create table hub.media_link_targets (
 id uuid primary key default gen_random_uuid(), media_link_id uuid not null, project_id uuid not null,
 target_type text not null, target_key text not null, revision integer not null default 1,
 foreign key(media_link_id,project_id) references hub.media_links(id,project_id),
 unique(media_link_id,target_type,target_key)
);

-- A private clip thumbnail is another authorized binding, never an uploader bypass.
create or replace function hub.can_read_asset(asset_uuid uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.assets a where a.id=asset_uuid and a.deleted_at is null
  and (a.media_category is distinct from 'legal_document' or hub.can('projects','edit') or hub.can('projects','approve'))
  and (hub.can_read_asset_before_media(asset_uuid) or exists(select 1 from hub.asset_links l join hub.projects p on p.id=l.project_id
   where l.asset_id=a.id and l.deleted_at is null and p.deleted_at is null and hub.media_target(l.project_id,l.target_type,l.target_key,'view'))
   or hub.can('projects','view') and exists(select 1 from hub.media_links c join hub.projects p on p.id=c.project_id
    where c.thumbnail_asset_id=a.id and c.state<>'WITHDRAWN' and p.deleted_at is null)))
$$;
create function hub.media_thumbnail_binding() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.thumbnail_asset_id is not null then
  update hub.assets set first_bound_at=clock_timestamp() where id=new.thumbnail_asset_id and first_bound_at is null;
 end if;return new;
end $$;
create trigger remember_thumbnail after insert or update of thumbnail_asset_id on hub.media_links for each row execute function hub.media_thumbnail_binding();
revoke all on function hub.media_thumbnail_binding() from public;

do $$ declare name text; begin
 foreach name in array array['media_requirements','media_links','media_link_targets'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy media_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create policy media_read on hub.%I for select to hub_app using(hub.can(''projects'',''view'')%s)',name,
   case when name='media_link_targets' then ' and hub.media_target(project_id,target_type,target_key,''view'')' else '' end);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger media_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger media_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;

insert into hub.media_requirements(rule_key,label,per,media_category,usage,tags,min_count,target_count,blocks_publish,max_age_days)
select key,jsonb_build_object('th',label),per,category,usage,tags,minimum,target,block,age from (values
 ('hero','ภาพหลักโครงการ','project',null,'hero','{}'::text[],1,1,true,null::integer),
 ('thumbnail','ภาพย่อโครงการ','project',null,'thumbnail','{}'::text[],1,1,true,null),
 ('exterior','ภาพภายนอก','project','exterior',null,'{}'::text[],1,3,false,null),
 ('aerial','ภาพมุมสูง','project','aerial',null,'{}'::text[],1,3,false,null),
 ('master_plan','ผังโครงการ','project','master_plan',null,'{}'::text[],1,3,false,null),
 ('map','แผนที่','project','map',null,'{}'::text[],1,3,false,null),
 ('lifestyle','ภาพไลฟ์สไตล์','project','lifestyle',null,'{}'::text[],1,3,false,null),
 ('facility','ภาพส่วนกลางที่มี','facility_present','facility',null,'{}'::text[],1,3,false,null),
 ('type_plan','แปลนแบบที่อยู่อาศัย','commercial_type','unit_plan',null,'{}'::text[],1,4,false,null),
 ('type_living','ห้องนั่งเล่นของแบบ','commercial_type','interior',null,array['living_room'],1,4,false,null),
 ('type_bedroom','ห้องนอนของแบบ','commercial_type','interior',null,array['bedroom'],1,4,false,null),
 ('type_bathroom','ห้องน้ำของแบบ','commercial_type','interior',null,array['bathroom'],1,4,false,null),
 ('type_kitchen','ห้องครัวของแบบ','commercial_type','interior',null,array['kitchen'],1,4,false,null),
 ('storey_plan','แปลนครบทุกชั้นของบ้าน','type_storey','unit_plan',null,'{}'::text[],1,4,false,null),
 ('building_plan','ผังครบทุกชั้นอาคาร','building_floor','floor_plan',null,'{}'::text[],0,1,false,null),
 ('promotion_banner','แบนเนอร์โปรโมชันที่ใช้งาน','active_promotion','promotion_ad','banner','{}'::text[],1,1,false,null),
 ('construction','ภาพความคืบหน้าไม่เกิน 30 วัน','under_construction','progress',null,'{}'::text[],1,3,false,30)
) seed(key,label,per,category,usage,tags,minimum,target,block,age);

create function hub.media_requirements_read() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_permission('projects','view');
 return (select coalesce(jsonb_agg(to_jsonb(r) order by rule_key),'[]') from hub.media_requirements r);
end $$;
create function hub.media_requirement_save(key text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.media_requirements; edited hub.media_requirements; begin
 perform hub.require_permission('projects','approve');
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('label','per','media_category','usage','tags','min_count','target_count','blocks_publish','max_age_days','status')) then raise exception 'Invalid coverage rule fields' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('media-rule:'||key,0));
 select * into prior from hub.media_requirements where rule_key=key for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Coverage rule changed' using errcode='40001'; end if;
 if prior.rule_key is null then prior:=jsonb_populate_record(null::hub.media_requirements,'{"tags":[],"min_count":1,"target_count":3,"blocks_publish":false,"status":"active"}');end if;
 edited:=jsonb_populate_record(prior,body);
 if exists(select 1 from unnest(edited.tags) tag(value) where not exists(select 1 from hub.media_tags where code=tag.value and status='active')) then raise exception 'Invalid coverage tags' using errcode='23514'; end if;
 if key in ('hero','thumbnail') and (edited.per<>'project' or edited.usage is distinct from key or not edited.blocks_publish or edited.status<>'active' or edited.min_count<>1) then
  raise exception 'Hero and thumbnail remain required' using errcode='23514'; end if;
 insert into hub.media_requirements(rule_key,label,per,media_category,usage,tags,min_count,target_count,blocks_publish,max_age_days,status)
 values(key,edited.label,edited.per,edited.media_category,edited.usage,edited.tags,edited.min_count,edited.target_count,edited.blocks_publish,edited.max_age_days,edited.status)
 on conflict(rule_key) do update set label=excluded.label,per=excluded.per,media_category=excluded.media_category,usage=excluded.usage,tags=excluded.tags,
  min_count=excluded.min_count,target_count=excluded.target_count,blocks_publish=excluded.blocks_publish,max_age_days=excluded.max_age_days,status=excluded.status,
  revision=hub.media_requirements.revision+1 returning * into edited;
 return to_jsonb(edited);
end $$;

create function hub.media_clip_save(public_id text,clip_uuid uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid; prior hub.media_links; edited hub.media_links; target jsonb; begin
 project_uuid:=hub.media_project(public_id,'edit');
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('provider','kind','tour_kind','url','title','description','published_at','captured_at','duration_sec','aspect','language','subtitles','channel_name',
   'owner_type','is_sponsored','thumbnail_asset_id','is_featured','sort','state','ai_exposure','targets')) then raise exception 'Invalid clip fields' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('media-clip:'||clip_uuid::text,0));
 select * into prior from hub.media_links where id=clip_uuid and project_id=project_uuid for update;
 if exists(select 1 from hub.media_link_targets where media_link_id=clip_uuid and target_type='promotion') then perform hub.require_permission('promotions','edit');end if;
 if prior.id is null and exists(select 1 from hub.media_links where id=clip_uuid) then raise exception 'Clip not found' using errcode='P0002'; end if;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Clip changed' using errcode='40001'; end if;
 if prior.id is null then prior:=jsonb_populate_record(null::hub.media_links,'{"title":{},"description":{},"channel_name":{},"subtitles":[],"is_sponsored":false,"is_featured":false,"sort":0,"state":"DRAFT","ai_exposure":"internal"}');end if;
 edited:=jsonb_populate_record(prior,body-'targets');
 if edited.url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?/' or edited.url ~ '[[:space:]\\]' or length(edited.url)>2048
  or not hub.content_locales(edited.title,500) or not hub.content_locales(edited.description,4000) or not hub.content_locales(edited.channel_name,300)
  or edited.captured_at>current_date or edited.state not in ('DRAFT','WITHDRAWN') then raise exception 'Invalid clip metadata' using errcode='23514'; end if;
 if edited.provider<>'other' and not (case edited.provider
  when 'youtube' then edited.url ~ '^https://(www\.)?(youtube\.com|youtu\.be)/'
  when 'tiktok' then edited.url ~ '^https://(www\.)?tiktok\.com/'
  when 'facebook' then edited.url ~ '^https://(www\.)?facebook\.com/'
  when 'instagram' then edited.url ~ '^https://(www\.)?instagram\.com/'
  when 'matterport' then edited.url ~ '^https://my\.matterport\.com/'
  when 'kuula' then edited.url ~ '^https://(www\.)?kuula\.co/' else false end) then raise exception 'Provider URL mismatch' using errcode='23514'; end if;
 if edited.thumbnail_asset_id is not null then
  perform hub.require_asset_access(edited.thumbnail_asset_id);
  if exists(select 1 from hub.assets where id=edited.thumbnail_asset_id and (mime_type not like 'image/%' or media_category='legal_document')) then raise exception 'Invalid clip thumbnail' using errcode='23514'; end if;
 end if;
 -- A target list is replaced atomically, with both removed and added scopes checked.
 if body ? 'targets' then
  if jsonb_typeof(body->'targets') is distinct from 'array' or jsonb_array_length(body->'targets')>40 then raise exception 'Invalid clip targets' using errcode='23514'; end if;
  if exists(select 1 from hub.media_link_targets where media_link_id=clip_uuid and target_type='promotion') and not hub.can('promotions','edit') then raise exception 'Target permission denied' using errcode='42501'; end if;
  for target in select value from jsonb_array_elements(body->'targets') loop
   if not hub.media_target(project_uuid,target->>'target_type',target->>'target_key','edit') then raise exception 'Target permission denied' using errcode='42501'; end if;
  end loop;
 end if;
 insert into hub.media_links(id,project_id,provider,kind,tour_kind,url,title,description,published_at,captured_at,duration_sec,aspect,language,subtitles,
  channel_name,owner_type,is_sponsored,thumbnail_asset_id,is_featured,sort,state,ai_exposure)
 values(clip_uuid,project_uuid,edited.provider,edited.kind,edited.tour_kind,edited.url,edited.title,edited.description,edited.published_at,edited.captured_at,
  edited.duration_sec,edited.aspect,edited.language,edited.subtitles,edited.channel_name,edited.owner_type,edited.is_sponsored,edited.thumbnail_asset_id,edited.is_featured,edited.sort,edited.state,edited.ai_exposure)
 on conflict(id) do update set provider=excluded.provider,kind=excluded.kind,tour_kind=excluded.tour_kind,url=excluded.url,title=excluded.title,description=excluded.description,
  published_at=excluded.published_at,captured_at=excluded.captured_at,duration_sec=excluded.duration_sec,aspect=excluded.aspect,language=excluded.language,subtitles=excluded.subtitles,
  channel_name=excluded.channel_name,owner_type=excluded.owner_type,is_sponsored=excluded.is_sponsored,thumbnail_asset_id=excluded.thumbnail_asset_id,is_featured=excluded.is_featured,
  sort=excluded.sort,state=excluded.state,ai_exposure=excluded.ai_exposure,revision=hub.media_links.revision+1,
  external_id=case when hub.media_links.url=excluded.url then hub.media_links.external_id end,
  embed_url=case when hub.media_links.url=excluded.url then hub.media_links.embed_url end,
  metadata_source=case when hub.media_links.url=excluded.url then hub.media_links.metadata_source else 'manual' end,
  provider_metadata=case when hub.media_links.url=excluded.url then hub.media_links.provider_metadata end,
  metadata_fetched_at=case when hub.media_links.url=excluded.url then hub.media_links.metadata_fetched_at end,
  checked_at=case when hub.media_links.url=excluded.url then hub.media_links.checked_at end,
  link_status=case when hub.media_links.url=excluded.url then hub.media_links.link_status else 'ok' end returning * into edited;
 if body ? 'targets' then
  delete from hub.media_link_targets t where media_link_id=clip_uuid and not exists(select 1 from jsonb_array_elements(body->'targets') v
   where v->>'target_type'=t.target_type and v->>'target_key'=t.target_key);
  insert into hub.media_link_targets(media_link_id,project_id,target_type,target_key)
   select clip_uuid,project_uuid,v->>'target_type',v->>'target_key' from jsonb_array_elements(body->'targets') v on conflict do nothing;
 end if;
 return to_jsonb(edited);
end $$;

create function hub.media_checklist(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid; project_label text; result jsonb; begin
 project_uuid:=hub.media_project(public_id,'view');
 select coalesce(public_name->>'th','โครงการนี้') into project_label from hub.projects where id=project_uuid;
 with contexts as (
  select 'project' per,'project' kind,project_uuid::text key,project_label label,null::integer floor
  union all select 'facility_present','facility',f.facility_code,t.name_th,null from hub.project_facilities f join hub.facility_taxonomy t on t.code=f.facility_code where f.project_id=project_uuid and f.status='present'
  union all select 'commercial_type','commercial_type',id::text,public_name->>'th',null from hub.commercial_types where project_id=project_uuid and deleted_at is null
  union all select 'type_storey','commercial_type',t.id::text,(t.public_name->>'th')||' ชั้น '||f::text,f from hub.commercial_types t
   cross join lateral generate_series(1,case when t.storeys is not null then least(t.storeys,200) end) f where t.project_id=project_uuid and t.deleted_at is null and t.product_form in ('house','townhome')
  union all select 'building_floor','building_floor',b.building_key,(b.name->>'th')||' ชั้น '||f::text,f from hub.project_buildings b
   cross join lateral generate_series(1,case when b.floors_above is not null then least(b.floors_above,200) end) f where b.project_id=project_uuid and not f=any(b.skip_floors)
  union all select 'active_promotion','promotion',id::text,title->>'th',null from hub.public_promotions where project_id=project_uuid and starts_at<=now() and ends_at>now() and hub.can('promotions','view')
  union all select 'under_construction','project',project_uuid::text,project_label,null where exists(select 1 from hub.projects p join staging.dw_projects s on s.rem_project_id=p.rem_project_id
   where p.id=project_uuid and lower(s.source_record->>'project_status_detail') in ('under_construction','construction','กำลังก่อสร้าง','อยู่ระหว่างก่อสร้าง'))
 ), bindings as (
  select asset_id,target_type kind,target_key key,usage,floor_from,floor_to,effective_from,effective_to,room_tag from hub.asset_links where project_id=project_uuid and deleted_at is null
   and hub.media_target(project_id,target_type,target_key,'view')
  union all select asset_id,'project',project_uuid::text,asset_role,null,null,effective_from,effective_to,null from hub.entity_assets
   where project_id=project_uuid and model_id is null and deleted_at is null and (asset_role not in ('hero','thumbnail') or is_primary)
  union all select asset_id,'commercial_type',commercial_type_id::text,asset_role,null,null,null,null,null from hub.commercial_type_assets where project_id=project_uuid and deleted_at is null
 ), counts as (
  select r.rule_key,r.label,r.media_category,r.usage,r.tags,r.min_count,r.target_count,r.blocks_publish,c.kind,c.key,c.label context_label,c.floor,
   (select count(distinct a.id) from bindings b join hub.assets a on a.id=b.asset_id
    where b.kind=c.kind and b.key=c.key and a.deleted_at is null and a.media_category is distinct from 'legal_document'
     and (a.media_category is null or a.metadata_state='confirmed' or r.blocks_publish)
     and a.rights_status='approved' and (a.effective_from is null or a.effective_from<=now()) and (a.effective_to is null or a.effective_to>now())
     and (b.effective_from is null or b.effective_from<=now()) and (b.effective_to is null or b.effective_to>now())
     and (r.media_category is null or a.media_category=r.media_category or a.media_category is null and b.usage=r.media_category)
     and (r.usage is null or b.usage=r.usage) and (c.floor is null or c.floor between b.floor_from and coalesce(b.floor_to,b.floor_from))
     and (r.max_age_days is null or a.taken_at between current_date-r.max_age_days and current_date)
     and not exists(select 1 from unnest(r.tags) t(code) where t.code is distinct from b.room_tag and not exists(select 1 from hub.asset_media_tags mt where mt.asset_id=a.id and mt.tag_code=t.code))
   ) count from hub.media_requirements r join contexts c on c.per=r.per where r.status='active'
 ), items as (
  select to_jsonb(c)||jsonb_build_object('complete',count>=target_count,'minimum_met',count>=min_count,
   'context',jsonb_build_object('target_type',kind,'target_key',key,'floor_from',floor,'floor_to',floor,'media_category',media_category,'usage',coalesce(usage,'gallery'),'tags',tags)) item from counts c
 ) select jsonb_build_object('items',coalesce(jsonb_agg(item order by item->>'rule_key',item->>'key',item->>'floor'),'[]'),
  'required_missing',count(*) filter(where (item->>'blocks_publish')::boolean and not (item->>'minimum_met')::boolean),
  'recommended_score',coalesce(round(100.0*sum(least((item->>'count')::numeric/(item->>'target_count')::numeric,1))/nullif(count(*),0)),0)) into result from items;
 return result||jsonb_build_object('broken_links',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'link_status',link_status)),'[]') from hub.media_links
  where project_id=project_uuid and state<>'WITHDRAWN' and link_status<>'ok'),
  'unknown_coverage',(select coalesce(jsonb_agg(jsonb_build_object('kind','building_floor','key',building_key,'label',name)),'[]') from hub.project_buildings
   where project_id=project_uuid and (floors_above is null or floors_above>200))||
   (select coalesce(jsonb_agg(jsonb_build_object('kind','type_storey','key',id,'label',public_name)),'[]') from hub.commercial_types
    where project_id=project_uuid and deleted_at is null and product_form in ('house','townhome') and (storeys is null or storeys>200)));
end $$;

create function hub.project_media(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; begin
 select * into p from hub.projects where id=hub.media_project(public_id,'view');
 return jsonb_build_object('project',jsonb_build_object('id',p.id,'public_project_id',p.public_project_id,'name',p.public_name,'updated_at',p.updated_at),
 'categories',hub.media_categories(),'tags',hub.media_tags_read(),'requirements',hub.media_requirements_read(),'checklist',hub.media_checklist(public_id),
 'assets',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('tags',(select coalesce(jsonb_agg(tag_code),'[]') from hub.asset_media_tags where asset_id=a.id)) order by a.created_at desc),'[]') from hub.assets a
  where hub.can_read_asset(a.id) and (exists(select 1 from hub.asset_links where asset_id=a.id and project_id=p.id and deleted_at is null)
   or exists(select 1 from hub.entity_assets where asset_id=a.id and project_id=p.id and deleted_at is null)
   or exists(select 1 from hub.commercial_type_assets where asset_id=a.id and project_id=p.id and deleted_at is null)
   or a.owner_id=hub.permission_actor() and a.first_bound_at is null)),
 'links',(select coalesce(jsonb_agg(to_jsonb(l) order by l.sort,l.id),'[]') from hub.asset_links l where project_id=p.id and deleted_at is null
  and hub.media_target(project_id,target_type,target_key,'view') and hub.can_read_asset(asset_id)),
 'clips',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('visible',c.link_status='ok' and c.state<>'WITHDRAWN',
  'targets',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from hub.media_link_targets t where media_link_id=c.id and hub.media_target(t.project_id,t.target_type,t.target_key,'view'))) order by c.sort,c.id),'[]') from hub.media_links c where project_id=p.id),
 'context',jsonb_build_object(
  'facilities',(select coalesce(jsonb_agg(jsonb_build_object('key',f.facility_code,'label',jsonb_build_object('th',t.name_th,'en',t.name_en),'status',f.status)),'[]') from hub.project_facilities f join hub.facility_taxonomy t on t.code=f.facility_code where f.project_id=p.id and f.status in ('present','planned')),
  'commercial_types',(select coalesce(jsonb_agg(jsonb_build_object('key',id,'label',public_name,'storeys',storeys)),'[]') from hub.commercial_types where project_id=p.id and deleted_at is null),
  'buildings',(select coalesce(jsonb_agg(jsonb_build_object('key',building_key,'label',name,'floors_above',floors_above,'skip_floors',skip_floors)),'[]') from hub.project_buildings where project_id=p.id),
  'promotions',(select coalesce(jsonb_agg(jsonb_build_object('key',id,'label',title,'starts_at',starts_at,'ends_at',ends_at)),'[]') from hub.public_promotions where project_id=p.id and hub.can('promotions','view')),
  'selling_points',(select coalesce(jsonb_agg(jsonb_build_object('key',point_key,'label',title)),'[]') from hub.project_selling_points s where project_id=p.id and state<>'WITHDRAWN'
   and revision=(select max(v.revision) from hub.project_selling_points v where v.project_id=s.project_id and v.point_key=s.point_key))));
end $$;

do $$ declare definition text;begin
 definition:=pg_get_functiondef('hub.project_content_readiness(text)'::regprocedure);
 execute replace(definition,'FUNCTION hub.project_content_readiness(', 'FUNCTION hub.project_content_readiness_before_media(');
end $$;
create or replace function hub.project_content_readiness(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare content jsonb;media jsonb;begin
 content:=hub.project_content_readiness_before_media(public_id);media:=hub.media_checklist(public_id);
 return content||jsonb_build_object('media_recommended_score',media->'recommended_score',
  'required_missing',(content->>'required_missing')::integer+(media->>'required_missing')::integer,
  'ready',(content->>'ready')::boolean and (media->>'required_missing')::integer=0,
  'items',(content->'items')||coalesce((select jsonb_agg(jsonb_build_object('field_key','asset.'||coalesce(item->>'media_category','media_category'),
   'label',jsonb_build_object('th',(item->'label'->>'th')||' · '||(item->>'context_label')),
   'required',(item->>'blocks_publish')::boolean,'complete',case when (item->>'blocks_publish')::boolean then (item->>'minimum_met')::boolean else (item->>'complete')::boolean end))
   from jsonb_array_elements(media->'items') item),'[]'));
end $$;
revoke all on function hub.project_content_readiness_before_media(text) from public;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and p.proname in ('media_requirements_read','media_requirement_save','media_clip_save','media_checklist','project_media') loop
  execute format('revoke all on function %s from public',f.signature); execute format('grant execute on function %s to hub_app',f.signature);
 end loop;
end $$;
commit;
