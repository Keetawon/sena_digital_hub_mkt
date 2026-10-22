begin;
update hub.field_catalog set status='active',help=jsonb_build_object('th','ข้อมูลสื่อร่างตามบริบทที่เลือก ต้องตรวจสิทธิ์และเผยแพร่ก่อนส่งไปช่องทางที่ระบุ')
 where status='planned' and entity in ('asset','media_tag','asset_link','media_requirement','media_link','media_link_target');
update hub.field_catalog set surfaces=array['hub_only'],default_ai_exposure='internal'
 where entity in ('media_tag','media_requirement','media_link_target')
 or field_key in ('asset.ai_suggestion','asset.metadata_state','media_link.metadata_source','media_link.metadata_fetched_at','media_link.checked_at','media_link.link_status');
insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy,surfaces,default_ai_exposure,help)
select key,split_part(key,'.',1),'media',jsonb_build_object('th',label),kind,'mkt',array['hub_only'],'internal',
 jsonb_build_object('th','ข้อมูลควบคุมภายใน ไม่ส่งไปเว็บไซต์หรือ AI; คำยืนยันภาพการตลาดใช้กำหนดสิทธิ์ขอคำแนะนำตาม E1')
from (values ('asset.ai_exposure','การใช้กับ AI','enum'),('asset.marketing_publication','ภาพการตลาดเพื่อเผยแพร่','bool'),
 ('media_requirement.label','ชื่อเกณฑ์','text'),('media_requirement.rule_key','รหัสเกณฑ์','text'),
 ('media_requirement.usage','บทบาทของภาพ','enum'),('media_requirement.status','สถานะเกณฑ์','enum')) f(key,label,kind);
create role hub_media_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema hub to hub_media_worker;
create table hub.media_jobs (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 kind text not null check(kind in ('image_suggestion','clip_metadata','clip_check')), subject_id uuid not null,
 source_revision integer not null check(source_revision>=0), requested_by uuid not null,
 status text not null default 'queued' check(status in ('queued','running','done','failed','superseded')),
 attempts integer not null default 0, lease_token uuid, lease_expires timestamptz,
 error_code text check(error_code in ('source_changed','permission_revoked','provider_unavailable','provider_error','invalid_result','manual_required','file_unavailable')),
 completed_at timestamptz, model text,
 created_at timestamptz not null default clock_timestamp(),created_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid
);
create unique index media_job_active on hub.media_jobs(kind,subject_id,source_revision) where status in ('queued','running');
alter table hub.media_jobs enable row level security;
alter table hub.media_jobs force row level security;
do $$ begin execute format('create policy media_owner on hub.media_jobs to %I using(true) with check(true)',current_user);end $$;
create policy media_read on hub.media_jobs for select to hub_app using(hub.can('projects','view') and
 (kind<>'image_suggestion' or hub.can_read_asset(subject_id)));
grant select on hub.media_jobs to hub_app;
create trigger media_audit after insert or update or delete on hub.media_jobs for each row execute function audit.record_change();
create trigger media_touch before update on hub.media_jobs for each row execute function hub.touch_record();

create function hub.media_job_allowed(job hub.media_jobs) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare before_actor text:=current_setting('app.actor_id',true); allowed boolean:=false; begin
 if not exists(select 1 from hub.projects where id=job.project_id and deleted_at is null) then return false;end if;
 perform set_config('app.actor_id',job.requested_by::text,true);
 begin
  perform hub.require_permission('projects','edit');
  if job.kind='image_suggestion' then
   perform hub.media_require_asset_edit(job.subject_id);
   allowed:=exists(select 1 from hub.assets where id=job.subject_id and deleted_at is null and media_revision=job.source_revision
    and mime_type in ('image/png','image/jpeg','image/webp','image/svg+xml') and media_category is not null
    and media_category not in ('legal_document','brochure') and marketing_publication and ai_exposure<>'internal');
  else
   if exists(select 1 from hub.media_link_targets where media_link_id=job.subject_id and target_type='promotion') then perform hub.require_permission('promotions','edit');end if;
   allowed:=exists(select 1 from hub.media_links where id=job.subject_id and project_id=job.project_id and revision=job.source_revision and state<>'WITHDRAWN');
  end if;
 exception when insufficient_privilege or no_data_found then allowed:=false;
 end;
 perform set_config('app.actor_id',coalesce(before_actor,''),true);return allowed;
end $$;
create function hub.media_job_request(public_id text,kind_name text,subject uuid,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs; begin
 j.project_id:=hub.media_project(public_id,'edit'); j.kind:=kind_name; j.subject_id:=subject;
 j.source_revision:=expected;j.requested_by:=hub.permission_actor();
 if kind_name is null or kind_name not in ('image_suggestion','clip_metadata','clip_check') then raise exception 'Invalid media job' using errcode='23514'; end if;
 if not hub.media_job_allowed(j) then raise exception 'Media source is unavailable or not eligible' using errcode='42501'; end if;
 insert into hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by) values(j.project_id,j.kind,j.subject_id,j.source_revision,j.requested_by)
 on conflict(kind,subject_id,source_revision) where status in ('queued','running') do nothing returning id into j.id;
 return jsonb_build_object('status','queued');
end $$;
create function hub.media_jobs_read(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid;begin project_uuid:=hub.media_project(public_id,'view');
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'subject_id',subject_id,'status',status,'error_code',error_code,'created_at',created_at,'completed_at',completed_at) order by created_at desc),'[]')
  from (select * from hub.media_jobs where project_id=project_uuid and (kind<>'image_suggestion' or hub.can_read_asset(subject_id)) order by created_at desc limit 100) jobs);
end $$;
create function hub.media_claim() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs; a hub.assets; c hub.media_links; lease uuid;begin
 loop
  select * into j from hub.media_jobs where status='queued' or status='running' and lease_expires<clock_timestamp() order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  if not hub.media_job_allowed(j) then update hub.media_jobs set status='superseded',error_code='source_changed',lease_token=null,lease_expires=null where id=j.id;continue;end if;
  if j.attempts>=3 then update hub.media_jobs set status='failed',error_code='provider_error',lease_token=null,lease_expires=null where id=j.id;continue;end if;
  lease:=gen_random_uuid();update hub.media_jobs set status='running',attempts=attempts+1,lease_token=lease,lease_expires=clock_timestamp()+interval '120 seconds' where id=j.id;
  if j.kind='image_suggestion' then
   select * into a from hub.assets where id=j.subject_id;
   return jsonb_build_object('id',j.id,'kind',j.kind,'lease_token',lease,
    'file',jsonb_build_object('mime_type',a.mime_type,'checksum',a.checksum,'storage_path',a.storage_path,'storage_provider',case when a.storage_bucket='local-originals' then 'local' else 'hosted' end,'file_size',a.file_size),
    'context',jsonb_build_object('chosen_category',a.media_category,
     'categories',array_remove(array_remove(hub.media_categories(),'legal_document'),'brochure'),
     'tags',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label,'tag_group',tag_group,'allowed_categories',allowed_categories)),'[]') from hub.media_tags where status='active'),
     'facilities',(select coalesce(jsonb_agg(jsonb_build_object('code',f.facility_code,'name',t.name_th)),'[]') from hub.project_facilities f join hub.facility_taxonomy t on t.code=f.facility_code where f.project_id=j.project_id and f.status in ('present','planned')),
     'commercial_types',(select coalesce(jsonb_agg(jsonb_build_object('key',id,'name',public_name)),'[]') from hub.commercial_types where project_id=j.project_id and deleted_at is null),
     'buildings',(select coalesce(jsonb_agg(jsonb_build_object('key',building_key,'name',name)),'[]') from hub.project_buildings where project_id=j.project_id)));
  end if;
  select * into c from hub.media_links where id=j.subject_id;
  return jsonb_build_object('id',j.id,'kind',j.kind,'lease_token',lease,'provider',c.provider,'url',c.url);
 end loop;
end $$;
create function hub.media_finish(job_uuid uuid,lease uuid,result jsonb,model_name text,error text) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs; a hub.assets; c hub.media_links; proposal jsonb; tags text[]; before_actor text:=current_setting('app.actor_id',true);begin
 select * into j from hub.media_jobs where id=job_uuid for update;
 if not found or j.status<>'running' or j.lease_token is distinct from lease or j.lease_expires<clock_timestamp() then raise exception 'Media lease changed' using errcode='40001';end if;
 if j.kind='image_suggestion' then select * into a from hub.assets where id=j.subject_id for update;
 else select * into c from hub.media_links where id=j.subject_id for update;end if;
 if not hub.media_job_allowed(j) then
  update hub.media_jobs set status='superseded',error_code='source_changed',lease_token=null,lease_expires=null,completed_at=clock_timestamp() where id=j.id;return 'superseded';end if;
 if error is not null then
  update hub.media_jobs set status='failed',error_code=error,lease_token=null,lease_expires=null,completed_at=clock_timestamp() where id=j.id;return 'failed';end if;
 if jsonb_typeof(result) is distinct from 'object' or octet_length(result::text)>40000 then raise exception 'Invalid media result' using errcode='23514';end if;
 if j.kind='image_suggestion' then
  if result->>'media_category' is null or not (result->>'media_category'=any(array_remove(array_remove(hub.media_categories(),'legal_document'),'brochure')))
   or not hub.content_locales(result->'caption',2000) or not hub.content_locales(result->'alt_text',1000)
   or coalesce(result->>'sensitive_content','true')<>'false' or jsonb_typeof(result->'tags') is distinct from 'array'
   or jsonb_array_length(result->'tags')>30 or jsonb_typeof(result->'proposed_tags') is distinct from 'array' or jsonb_array_length(result->'proposed_tags')>5
   or result->>'image_kind' not in ('photo','render','progress','drawing','stock')
   or result->>'people' not in ('present','absent','unknown') or result->>'third_party_marks' not in ('present','absent','unknown')
   or jsonb_typeof(result->'confidence') is distinct from 'number' or (result->>'confidence')::numeric not between 0 and 1 or btrim(coalesce(model_name,''))='' or length(model_name)>150 then
   raise exception 'Invalid media suggestion' using errcode='23514';end if;
  select coalesce(array_agg(value),'{}') into tags from jsonb_array_elements_text(result->'tags');
  if exists(select 1 from unnest(tags) t(code) where not exists(select 1 from hub.media_tags mt where mt.code=t.code and mt.status='active'
   and (cardinality(mt.allowed_categories)=0 or result->>'media_category'=any(mt.allowed_categories)))) then raise exception 'Suggestion tags changed' using errcode='23514';end if;
  for proposal in select value from jsonb_array_elements(result->'proposed_tags') loop
   insert into hub.media_tags(code,label,tag_group,allowed_categories,status,created_by,updated_by)
    values(proposal->>'code',proposal->'label',proposal->>'tag_group',array[result->>'media_category'],'proposed',j.requested_by,j.requested_by) on conflict do nothing;
  end loop;
  perform set_config('app.actor_id',j.requested_by::text,true);
  update hub.assets set ai_suggestion=result||jsonb_build_object('model',model_name,'suggested_at',clock_timestamp(),'source_revision',j.source_revision) where id=a.id;
 else
  if result->>'link_status' is null or result->>'link_status' not in ('ok','broken','private','removed')
   or exists(select 1 from jsonb_object_keys(result) k where k not in ('link_status','title','channel_name','external_id','embed_url'))
   or not hub.content_locales(coalesce(result->'title','{}'),500) or not hub.content_locales(coalesce(result->'channel_name','{}'),300)
   or length(coalesce(result->>'external_id',''))>100
   or result->>'embed_url' is not null and not (result->>'embed_url' ~ '^https://www\.(youtube\.com/embed/[A-Za-z0-9_-]+|tiktok\.com/player/v1/[0-9]+)/?$') then
   raise exception 'Invalid clip result' using errcode='23514';end if;
  perform set_config('app.actor_id',j.requested_by::text,true);
  update hub.media_links set link_status=result->>'link_status',checked_at=clock_timestamp(),
   provider_metadata=case when j.kind='clip_metadata' then result else provider_metadata end,
   metadata_source=case when j.kind='clip_metadata' then 'provider' else metadata_source end,
   metadata_fetched_at=case when j.kind='clip_metadata' then clock_timestamp() else metadata_fetched_at end,
   external_id=coalesce(result->>'external_id',external_id),embed_url=coalesce(result->>'embed_url',embed_url)
   where id=c.id;
 end if;
 update hub.media_jobs set status='done',model=model_name,completed_at=clock_timestamp(),lease_token=null,lease_expires=null,error_code=null where id=j.id;
 perform set_config('app.actor_id',coalesce(before_actor,''),true);return 'done';
end $$;
create function hub.media_schedule_checks() returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare count_added integer;begin
 insert into hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by)
  select c.project_id,'clip_check',c.id,c.revision,c.updated_by from hub.media_links c
  where c.state<>'WITHDRAWN' and c.provider in ('youtube','tiktok') and coalesce(c.checked_at,'-infinity')<now()-interval '7 days'
   and hub.translation_requester_allowed(c.updated_by,'projects') and not exists(select 1 from hub.media_jobs j where j.subject_id=c.id and j.kind='clip_check' and j.created_at>now()-interval '1 day')
  order by c.checked_at nulls first limit 100 on conflict do nothing;
 get diagnostics count_added=row_count;return count_added;
end $$;
create function hub.media_clip_check(public_id text,clip_uuid uuid,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid;row hub.media_links;begin
 project_uuid:=hub.media_project(public_id,'edit');select * into row from hub.media_links where id=clip_uuid and project_id=project_uuid for update;
 if not found then raise exception 'Clip not found' using errcode='P0002';end if;
 if exists(select 1 from hub.media_link_targets where media_link_id=clip_uuid and target_type='promotion') then perform hub.require_permission('promotions','edit');end if;
 if row.revision is distinct from expected then raise exception 'Clip changed' using errcode='40001';end if;
 if decision is null or decision not in ('ok','broken','private','removed') then raise exception 'Invalid link check' using errcode='23514';end if;
 update hub.media_links set link_status=decision,checked_at=clock_timestamp(),revision=revision+1 where id=clip_uuid returning * into row;
 return to_jsonb(row);
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and p.proname in ('media_job_allowed','media_job_request','media_jobs_read','media_claim','media_finish','media_schedule_checks','media_clip_check') loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname in ('media_job_request','media_jobs_read','media_clip_check') then execute format('grant execute on function %s to hub_app',f.signature);end if;
  if f.proname in ('media_claim','media_finish','media_schedule_checks') then execute format('grant execute on function %s to hub_media_worker',f.signature);end if;
 end loop;
end $$;
commit;
