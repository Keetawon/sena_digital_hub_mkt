-- Public website evidence stays private and unconfirmed. No existing row is edited.
begin;
alter table hub.assets drop constraint assets_provenance_check;
alter table hub.assets add constraint assets_provenance_check check(provenance in ('upload','public_website'));

create function hub.website_source_valid(value jsonb) returns boolean
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select value is null or coalesce((jsonb_typeof(value)='object' and value->>'source_kind'='sena_public_website'
  and value->>'source_remark'='ดึงจากเว็บไซต์สาธารณะ SENA'
  and value->>'capture_sha256' ~ '^[0-9a-f]{64}$'
  and value->>'page_url' ~ '^https://([a-z0-9-]+\.)*sena\.co\.th/'
  and nullif(value->>'fetched_at','') is not null and value->'confirmed'='false'::jsonb),false)
$$;
revoke all on function hub.website_source_valid(jsonb) from public;

do $$ declare name text;begin
 foreach name in array array['contacts','project_facilities','project_places','commercial_types','project_progress','project_disclosures','media_links','content_sections'] loop
  execute format('alter table hub.%I add column website_source jsonb check(hub.website_source_valid(website_source))',name);
 end loop;
end $$;
alter table hub.asset_links add column binding_confirmed boolean not null default true,
 add column website_source jsonb check(hub.website_source_valid(website_source)),
 add constraint website_binding_private check(binding_confirmed or website_source is not null and ai_exposure='internal');

-- Unknown dates/status/ownership are allowed only for private website candidates.
alter table hub.project_places alter column category drop not null, alter column status drop not null, alter column as_of drop not null;
alter table hub.project_places add constraint website_place_unknowns check(
 (category is not null and status is not null and as_of is not null)
 or website_source is not null and ai_exposure='internal' and not show_on_web);
alter table hub.project_progress alter column as_of drop not null;
alter table hub.project_progress drop constraint project_progress_source_check;
alter table hub.project_progress add constraint project_progress_source_check check(source in ('construction','mkt','website_import')),
 add constraint website_progress_date check(as_of is not null or source='website_import' and website_source is not null and state='draft' and ai_exposure='internal');
alter table hub.project_disclosures drop constraint project_disclosures_basis_check;
alter table hub.project_disclosures add constraint project_disclosures_basis_check check(basis in ('mkt_entered','legal_document','legal_approved','website_import'));
alter table hub.media_links alter column owner_type drop not null;
alter table hub.media_links add constraint website_clip_owner check(owner_type is not null or website_source is not null and state='DRAFT' and ai_exposure='internal');
alter table hub.media_links drop constraint media_links_link_status_check;
alter table hub.media_links add constraint media_links_link_status_check check(link_status in ('ok','broken','private','removed','unknown'));
-- Keep the ordinary email save and publication checks strict. An imported email
-- is source evidence only until the editor explicitly confirms the shared mailbox.
alter table hub.contacts drop constraint contacts_check;
alter table hub.contacts add constraint contacts_check check(channel<>'email' or shared_mailbox_confirmed
 or website_source is not null and ai_exposure='internal');

create table hub.website_asset_suggestions (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 asset_id uuid not null references hub.assets, batch_sha256 text not null references staging.knowledge_batches,
 page_position jsonb not null check(jsonb_typeof(page_position)='object'),
 source jsonb not null check(hub.website_source_valid(source)),
 status text not null default 'pending' check(status in ('pending','confirmed')),
 revision integer not null default 1 check(revision>0), confirmed_by uuid, confirmed_at timestamptz,
 confirmation jsonb,
 created_at timestamptz not null default clock_timestamp(),created_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid,
 unique(project_id,asset_id,batch_sha256),
 check((status='pending' and confirmed_by is null and confirmed_at is null and confirmation is null)
  or (status='confirmed' and confirmed_by is not null and confirmed_at is not null and jsonb_typeof(confirmation)='object'))
);
alter table hub.website_asset_suggestions enable row level security;
alter table hub.website_asset_suggestions force row level security;
do $$ begin execute format('create policy website_owner on hub.website_asset_suggestions to %I using(true) with check(true)',current_user);end $$;
create policy website_read on hub.website_asset_suggestions for select to hub_app
 using(hub.can('projects','view') and hub.can_read_asset(asset_id));
grant select on hub.website_asset_suggestions to hub_app;
create trigger website_audit after insert or update or delete on hub.website_asset_suggestions for each row execute function audit.record_change();
create trigger website_touch before update on hub.website_asset_suggestions for each row execute function hub.touch_record();

create table staging.website_content_receipts (
 batch_sha256 text primary key references staging.knowledge_batches,
 outcomes jsonb not null, applied_at timestamptz not null default clock_timestamp()
);
alter table staging.website_content_receipts enable row level security;
alter table staging.website_content_receipts force row level security;
do $$ begin execute format('create policy website_operator on staging.website_content_receipts to %I using(true) with check(true)',current_user);end $$;
revoke all on staging.website_content_receipts from public,hub_app;
create trigger immutable_website_receipt before update or delete on staging.website_content_receipts for each row execute function hub.reject_version_change();

create function hub.website_media_agreement(proposal jsonb,suggestion jsonb,revision integer) returns numeric
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare score numeric:=0;fields integer:=0;key text;begin
 if suggestion is null or (suggestion->>'source_revision')::integer is distinct from revision then return null;end if;
 -- Only compare fields both systems supply. Empty tag sets and missing contexts
 -- are not evidence of agreement; confidence does not confirm a suggestion.
 foreach key in array array['media_category','image_kind'] loop
  if proposal->>key is not null then
   fields:=fields+1;if proposal->>key=suggestion->>key then score:=score+1;end if;
  end if;
 end loop;
 if jsonb_array_length(coalesce(proposal->'tags','[]'))>0 then
  fields:=fields+1;
  if (proposal->'tags') @> (suggestion->'tags') and (suggestion->'tags') @> (proposal->'tags') then score:=score+1;end if;
 end if;
 return score/nullif(fields,0);
end $$;

create function hub.website_media_projects() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','view');
 return (select coalesce(jsonb_agg(to_jsonb(t) order by public_project_id),'[]') from (
  select p.public_project_id,p.public_name,count(*)::int pending from hub.website_asset_suggestions s join hub.projects p on p.id=s.project_id
  where s.status='pending' and p.deleted_at is null and hub.can_read_asset(s.asset_id) group by p.id) t);
end $$;

create function hub.website_media_queue(public_id text,start_at integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid;begin
 project_uuid:=hub.media_project(public_id,'view');
 if start_at is null or start_at<0 or start_at>100000 then raise exception 'Invalid queue offset' using errcode='23514';end if;
 return jsonb_build_object('total',(select count(*) from hub.website_asset_suggestions s where s.project_id=project_uuid and s.status='pending' and hub.can_read_asset(s.asset_id)),
  'items',(select coalesce(jsonb_agg(item order by agreement desc nulls last,created_at,id),'[]') from (
   select s.id,s.created_at,hub.website_media_agreement(s.page_position,a.ai_suggestion,a.media_revision) agreement,
    to_jsonb(s)||jsonb_build_object('asset_revision',a.media_revision,'agreement',hub.website_media_agreement(s.page_position,a.ai_suggestion,a.media_revision),
     'links',(select coalesce(jsonb_agg(to_jsonb(l) order by l.sort,l.id),'[]') from hub.asset_links l
       where l.asset_id=s.asset_id and l.project_id=project_uuid and l.deleted_at is null and not l.binding_confirmed
        and hub.media_target(l.project_id,l.target_type,l.target_key,'view'))) item
   from hub.website_asset_suggestions s join hub.assets a on a.id=s.asset_id
   where s.project_id=project_uuid and s.status='pending' and hub.can_read_asset(a.id)
   order by agreement desc nulls last,s.created_at,s.id limit 40 offset start_at) q));
end $$;

create function hub.website_media_confirm(public_id text,items jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project_uuid uuid;actor uuid;item jsonb;link jsonb;s hub.website_asset_suggestions;old_link hub.asset_links;asset hub.assets;result jsonb:='[]';metadata jsonb;begin
 project_uuid:=hub.media_project(public_id,'edit');actor:=hub.permission_actor();
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 40
  or octet_length(items::text)>128000 then raise exception 'Invalid confirmation batch' using errcode='23514';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(items))<>jsonb_array_length(items) then
  raise exception 'Duplicate suggestion' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('media-project:'||project_uuid::text,0));
 for item in select value from jsonb_array_elements(items) order by value->>'id' loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in
   ('id','expected_revision','asset_revision','metadata','links')) then raise exception 'Invalid confirmation fields' using errcode='23514';end if;
  select * into s from hub.website_asset_suggestions where id=(item->>'id')::uuid and project_id=project_uuid for update;
  if not found then raise exception 'Suggestion not found' using errcode='P0002';end if;
  perform hub.media_require_asset_edit(s.asset_id);
  select * into asset from hub.assets where id=s.asset_id and deleted_at is null for update;
  -- Recover the exact committed batch after a lost response, without a second
  -- audit/metadata write. Any subsequent asset or context edit still conflicts.
  if s.status='confirmed' and s.revision=(item->>'expected_revision')::integer+1
   and asset.media_revision=(item->>'asset_revision')::integer+1
   and s.confirmation=jsonb_build_object('metadata',item->'metadata','links',item->'links','asset_revision_before',(item->>'asset_revision')::integer)
   and not exists(select 1 from jsonb_array_elements(item->'links') v where not exists(
    select 1 from hub.asset_links l where l.id=(v->>'id')::uuid and l.project_id=project_uuid and l.asset_id=s.asset_id
     and l.deleted_at is null and l.binding_confirmed and l.revision=(v->>'expected_revision')::integer+1)) then
   result:=result||jsonb_build_array(s.id);continue;
  end if;
  if s.status<>'pending' or s.revision is distinct from (item->>'expected_revision')::integer then raise exception 'Suggestion changed' using errcode='40001';end if;
  if asset.media_revision is distinct from (item->>'asset_revision')::integer then raise exception 'Media metadata changed' using errcode='40001';end if;
  metadata:=item->'metadata';
  if jsonb_typeof(metadata) is distinct from 'object' or not metadata ?& array['media_category','tags']
   or exists(select 1 from jsonb_object_keys(metadata) k where k not in ('media_category','tags','image_kind')) then
   raise exception 'Confirm only category, tags and image kind here' using errcode='23514';end if;
  if jsonb_typeof(item->'links') is distinct from 'array' or jsonb_array_length(item->'links')>30 then raise exception 'Invalid link confirmations' using errcode='23514';end if;
  -- Existing command validates controlled vocabulary, cross-tab authority and
  -- optimistic revisions. It never approves rights or fills missing alt text.
  perform hub.media_save_asset(public_id,s.asset_id,asset.media_revision,metadata);
  for link in select value from jsonb_array_elements(item->'links') loop
   if exists(select 1 from jsonb_object_keys(link) k where k not in ('id','expected_revision','changes')) then raise exception 'Invalid link confirmation' using errcode='23514';end if;
   select * into old_link from hub.asset_links where id=(link->>'id')::uuid and project_id=project_uuid and asset_id=s.asset_id and deleted_at is null for update;
   if not found then raise exception 'Suggested link not found' using errcode='P0002';end if;
   if old_link.binding_confirmed then raise exception 'Suggested link changed' using errcode='40001';end if;
   if (link->'changes') ?| array['asset_id','ai_exposure','effective_from','effective_to'] then raise exception 'Invalid context confirmation fields' using errcode='23514';end if;
   perform hub.media_link_save(public_id,old_link.id,(link->>'expected_revision')::integer,link->'changes');
   update hub.asset_links set binding_confirmed=true where id=old_link.id;
  end loop;
  if exists(select 1 from hub.asset_links where project_id=project_uuid and asset_id=s.asset_id and deleted_at is null and not binding_confirmed) then
   raise exception 'Review every suggested context for this project' using errcode='23514';end if;
  update hub.website_asset_suggestions set status='confirmed',revision=revision+1,confirmed_by=actor,confirmed_at=clock_timestamp(),
   confirmation=jsonb_build_object('metadata',metadata,'links',item->'links','asset_revision_before',asset.media_revision) where id=s.id;
  result:=result||jsonb_build_array(s.id);
 end loop;
 return jsonb_build_object('confirmed',result);
end $$;

-- Public website evidence only. Internal KM records retain their existing ACL.
create function hub.website_content_sources(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;begin
 select * into p from hub.projects where id=hub.media_project(public_id,'view');
 return (select coalesce(jsonb_agg(jsonb_build_object('id',k.id,'kind',k.evidence->'website_item_kind',
   'value',k.evidence->'website_value','source',k.evidence->'website_source','wiring',k.evidence->'website_wiring','holds',k.holds)
   order by k.evidence->>'website_item_kind',k.id),'[]') from staging.knowledge_candidates k
  where k.project_ids @> array[p.rem_project_id] and k.evidence->>'source_kind'='sena_public_website'
   and k.evidence ? 'website_item_kind'
   and (k.evidence->>'website_item_kind'<>'disclosures' or hub.can('projects','edit') or hub.can('projects','approve')));
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='hub' and p.proname in ('website_media_agreement','website_media_projects','website_media_queue','website_media_confirm','website_content_sources') loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname<>'website_media_agreement' then execute format('grant execute on function %s to hub_app',f.signature);end if;
 end loop;
end $$;
-- A budgeted operator supplies exact approved job IDs. No other queue is drained,
-- and an ambiguous first attempt is never automatically retried against a budget.
alter table hub.media_jobs add column provider_usage jsonb;
create function hub.website_media_claim(approved_jobs uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j hub.media_jobs;a hub.assets;lease uuid;begin
 if approved_jobs is null or cardinality(approved_jobs) not between 1 and 5000 or array_position(approved_jobs,null) is not null then
  raise exception 'Approved image jobs required' using errcode='23514';end if;
 loop
  select * into j from hub.media_jobs where id=any(approved_jobs) and kind='image_suggestion'
   and (status='queued' or status='running' and lease_expires<clock_timestamp()) order by id for update skip locked limit 1;
  if not found then return null;end if;
  if not hub.media_job_allowed(j) then
   update hub.media_jobs set status='superseded',error_code='source_changed',lease_token=null,lease_expires=null where id=j.id;continue;end if;
  if j.attempts>0 then
   update hub.media_jobs set status='failed',error_code='provider_error',lease_token=null,lease_expires=null where id=j.id;continue;end if;
  select * into a from hub.assets where id=j.subject_id;
  if not exists(select 1 from hub.website_asset_suggestions where asset_id=a.id and project_id=j.project_id and status='pending') then
   raise exception 'Approved website source required' using errcode='23514';end if;
  lease:=gen_random_uuid();
  update hub.media_jobs set status='running',attempts=1,lease_token=lease,lease_expires=clock_timestamp()+interval '120 seconds' where id=j.id;
  return jsonb_build_object('id',j.id,'kind',j.kind,'lease_token',lease,
   'file',jsonb_build_object('mime_type',a.mime_type,'checksum',a.checksum,'storage_path',a.storage_path,'file_size',a.file_size,
    'storage_bucket',a.storage_bucket,'source_system',a.source_system,'storage_provider',case a.storage_bucket when 'local-originals' then 'local' when 'r2-test-content' then 'r2' else 'hosted' end),
   'context',jsonb_build_object(
    'categories',array_remove(array_remove(hub.media_categories(),'legal_document'),'brochure'),
    'tags',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label,'tag_group',tag_group,'allowed_categories',allowed_categories) order by code),'[]') from hub.media_tags where status='active'),
    'facilities',(select coalesce(jsonb_agg(jsonb_build_object('code',f.facility_code,'name',t.name_th) order by f.facility_code),'[]') from hub.project_facilities f join hub.facility_taxonomy t on t.code=f.facility_code where f.project_id=j.project_id and f.status in ('present','planned')),
    'commercial_types',(select coalesce(jsonb_agg(jsonb_build_object('key',id,'name',public_name) order by id),'[]') from hub.commercial_types where project_id=j.project_id and deleted_at is null),
    'buildings',(select coalesce(jsonb_agg(jsonb_build_object('key',building_key,'name',name) order by building_key),'[]') from hub.project_buildings where project_id=j.project_id)));
 end loop;
end $$;
create function hub.website_media_finish(job_uuid uuid,lease uuid,result jsonb,model_name text,error text,usage jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare state text;begin
 if usage is not null and (jsonb_typeof(usage) is distinct from 'object'
  or not usage ?& array['input_tokens','output_tokens','cached_input_tokens']
  or exists(select 1 from jsonb_each(usage) t(k,v) where k not in ('input_tokens','output_tokens','cached_input_tokens')
    or jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$' or (v::text)::numeric>10000000)
  or (usage->>'cached_input_tokens')::numeric>(usage->>'input_tokens')::numeric) then
  raise exception 'Invalid provider usage' using errcode='23514';end if;
 state:=hub.media_finish(job_uuid,lease,result,model_name,error);
 update hub.media_jobs set provider_usage=usage where id=job_uuid;
 return state;
end $$;
revoke all on function hub.website_media_claim(uuid[]),hub.website_media_finish(uuid,uuid,jsonb,text,text,jsonb) from public;
grant execute on function hub.website_media_claim(uuid[]),hub.website_media_finish(uuid,uuid,jsonb,text,text,jsonb) to hub_media_worker;
commit;
