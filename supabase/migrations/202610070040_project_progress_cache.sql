begin;
-- Rebuildable private projection. Publications and their gates are unchanged.
create table hub.project_progress_cache (
  rem_project_id text primary key,
  source jsonb not null,
  record jsonb,
  knowledge jsonb not null,
  thumbnail jsonb,
  brand_logo jsonb,
  summary jsonb,
  refreshed_at timestamptz not null default clock_timestamp(),
  valid_until timestamptz not null
);
create table hub.project_progress_dirty (rem_project_id text primary key);
revoke all on hub.project_progress_cache,hub.project_progress_dirty from public,editor,publisher,viewer,admin,service_consumer,online_staff,agency;

create function hub.compact_source_readiness(value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select (value-'excluded_models') || jsonb_build_object('recommended',
   coalesce((select jsonb_agg(e) from jsonb_array_elements(value->'recommended') e where e->>'group'<>'models'),'[]') ||
   case when exists(select 1 from jsonb_array_elements(value->'recommended') e where e->>'group'='models') then jsonb_build_array(jsonb_build_object('field','models','group','models','message',
     'ยืนยันการจับคู่ REM ('||(select count(*) from jsonb_array_elements(value->'recommended') e where e->>'field' like '%.match_status')||')','passed',false),
     jsonb_build_object('field','models.specifications','group','models','message',
     'กรอกข้อมูลแบบบ้าน ('||(select count(*) from jsonb_array_elements(value->'recommended') e where e->>'field' like '%.specifications')||')','passed',false)) else '[]'::jsonb end)
$$;

create function hub.refresh_project_progress(ids text[]) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare boundary timestamptz;
begin
  if coalesce(cardinality(ids),0)=0 then return; end if;
  -- Serialize projection maintenance only; never lock or edit the draft/publication.
  perform pg_advisory_xact_lock(710040);
  select coalesce(min(t),now()+interval '1 day') into boundary from (
    select unnest(array[effective_from,effective_to,effective_to-interval '30 days']) t from hub.assets
    union all select unnest(array[effective_from,effective_to]) from hub.entity_assets
    union all select unnest(array[effective_from,effective_to]) from hub.brand_assets
    union all select unnest(array[effective_from,effective_to]) from hub.projects
    union all select unnest(array[(a->>'effective_from')::timestamptz,(a->>'effective_to')::timestamptz,(a->>'effective_to')::timestamptz-interval '30 days'])
      from hub.projects p join hub.entity_versions v on v.id=p.published_version_id
      cross join lateral jsonb_array_elements(v.payload->'assets') a
  ) deadlines where t>now();
  delete from hub.project_progress_cache c where c.rem_project_id=any(ids) and not exists(select 1 from staging.rem_projects s where s.rem_project_id=c.rem_project_id);
  with base as materialized (
    select s.*,p.id project_id,p.public_project_id,p.updated_at,p.published_version_id,
      b.brand_name_rem,company.company_name_rem,bc.public_name brand_public_name,g.source_record gold_record,
      hub.project_source_review(s.rem_project_id) review,
      case when p.id is not null then hub.draft_payload(p.id) else jsonb_build_object('rem_project_id',s.rem_project_id,'models','[]'::jsonb,'assets','[]'::jsonb) end payload,
      live.payload live_payload,
      (select count(*) from hub.entity_versions v where v.project_id=p.id) version_count,
      (live_brand.published_version_id is null and exists(select 1 from hub.brand_versions v where v.brand_id=live_brand.id)) live_brand_withdrawn,
      exists(select 1 from public_api.projects published where published.public_project_id=p.public_project_id) publication_available
    from staging.rem_projects s left join hub.projects p on p.rem_project_id=s.rem_project_id and p.deleted_at is null
    left join staging.rem_brands b on b.rem_brand_id=s.rem_brand_id left join hub.brands bc on bc.id=p.brand_id
    left join staging.rem_companies company on company.rem_company_id=s.rem_company_id
    left join staging.dw_projects g on g.rem_project_id=s.rem_project_id
    left join hub.entity_versions live on live.id=p.published_version_id
    left join hub.brands live_brand on live_brand.id=(live.payload->>'brand_id')::uuid
    where s.rem_project_id=any(ids)
  ), checks as materialized (select base.*,hub.snapshot_readiness(payload) readiness from base),
  models as (select rem_project_id,count(*) n from staging.rem_models where rem_project_id=any(ids)
    and coalesce(source_record->>'isDeleted',source_record->>'is_deleted','false')<>'true' group by rem_project_id),
  knowledge as (select project_id,count(*) staged,count(r.candidate_id) reviewed
    from staging.knowledge_candidates c cross join lateral unnest(c.project_ids) project_id
    left join hub.knowledge_reviews r on r.candidate_id=c.id where project_id=any(ids) group by project_id)
  insert into hub.project_progress_cache(rem_project_id,source,record,knowledge,thumbnail,brand_logo,refreshed_at,valid_until)
  select c.rem_project_id,jsonb_build_object('rem_project_id',c.rem_project_id,'project_name_rem',c.project_name_rem,
    'rem_brand_id',c.rem_brand_id,'brand_name_rem',c.brand_name_rem,'source_record',c.source_record,
    'rem_company_id',c.rem_company_id,'company_name_rem',c.company_name_rem,'source_updated_at',c.source_updated_at,
    'source_snapshot_at',c.source_snapshot_at,'source_fingerprint',c.source_fingerprint,'intake_manifest_sha256',c.intake_manifest_sha256,
    'source_review',c.review,'first_seen_at',c.first_seen_at,'mirror_imported_at',
      (select min(batch.imported_at) from staging.intake_batches batch where batch.manifest_sha256=c.intake_manifest_sha256
        or batch.datasets->'projects'->'rows' @> jsonb_build_array(jsonb_build_object('record',jsonb_build_object('project_id',c.rem_project_id)))),
    'model_count',coalesce(m.n,0),'public_project_id',c.public_project_id,
    'gold_source',jsonb_build_object('record',jsonb_build_object('marketing_project_group_id',c.gold_record->'marketing_project_group_id',
      'project_group_conflict',c.gold_record->'project_group_conflict','project_identity_conflict',c.gold_record->'project_identity_conflict')),
    'readiness',case when c.project_id is null then hub.compact_source_readiness(c.readiness) else null end),
    case when c.project_id is not null then jsonb_build_object('detail',c.payload||jsonb_build_object('readiness',c.readiness,
      'published_version_id',c.published_version_id,'publication_available',c.publication_available,'updated_at',c.updated_at,
      'brand_summary',jsonb_build_object('public_name',c.brand_public_name),'facilities',hub.project_facility_payload(c.project_id)),
      'live_payload',c.live_payload,'version_count',c.version_count,'live_brand_withdrawn',c.live_brand_withdrawn,
      'live_assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'rights_status',a.rights_status,'effective_to',a.effective_to)),'[]')
        from hub.assets a where a.id in(select (item->>'id')::uuid from jsonb_array_elements(c.live_payload->'assets') item))) end,
    jsonb_build_object('staged',coalesce(k.staged,0),'reviewed',coalesce(k.reviewed,0)),
    (select jsonb_build_object('id',a.id,'public_url',null) from hub.entity_assets ea join hub.assets a on a.id=ea.asset_id
      where ea.project_id=c.project_id and ea.asset_role='thumbnail' and ea.is_primary and ea.model_id is null
      and ea.deleted_at is null and a.deleted_at is null and a.mime_type like 'image/%' limit 1),
    (select jsonb_build_object('id',a.id,'public_url',null) from hub.brands b join hub.brand_assets ba on ba.brand_id=b.id join hub.assets a on a.id=ba.asset_id
      where b.rem_brand_id=c.rem_brand_id and b.deleted_at is null and ba.asset_role='logo_primary' and ba.is_primary
      and ba.deleted_at is null and a.deleted_at is null and a.mime_type like 'image/%' limit 1),clock_timestamp(),boundary
    from checks c left join models m using(rem_project_id) left join knowledge k on k.project_id=c.rem_project_id
    left join staging.intake_batches i on i.manifest_sha256=c.intake_manifest_sha256
  on conflict(rem_project_id) do update set source=excluded.source,record=excluded.record,knowledge=excluded.knowledge,
    thumbnail=excluded.thumbnail,brand_logo=excluded.brand_logo,refreshed_at=excluded.refreshed_at,valid_until=excluded.valid_until;
  delete from hub.project_progress_dirty where rem_project_id=any(ids);
end $$;

create function hub.mark_project_progress_dirty() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare old_id text; new_id text; old_row jsonb; new_row jsonb;
begin
  if tg_op<>'INSERT' then old_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_row:=to_jsonb(new); end if;
  if coalesce(new_row,old_row) ? 'rem_project_id' then
    old_id:=old_row->>'rem_project_id'; new_id:=new_row->>'rem_project_id';
    insert into hub.project_progress_dirty select distinct id from unnest(array[old_id,new_id]) id where id is not null on conflict do nothing;
  elsif coalesce(new_row,old_row) ? 'project_id' and tg_table_name not in ('knowledge_candidates','knowledge_reviews') then
    insert into hub.project_progress_dirty select rem_project_id from hub.projects where id in ((old_row->>'project_id')::uuid,(new_row->>'project_id')::uuid) on conflict do nothing;
  else
    -- Shared brand/rights, taxonomy and intake-head evidence may affect many identities.
    insert into hub.project_progress_dirty select rem_project_id from staging.rem_projects on conflict do nothing;
  end if;
  return null;
end $$;
create function hub.flush_project_progress() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.refresh_project_progress(array(select rem_project_id from hub.project_progress_dirty order by rem_project_id));
  return null;
end $$;
create constraint trigger refresh_progress_at_commit after insert on hub.project_progress_dirty
  deferrable initially deferred for each row execute function hub.flush_project_progress();
do $$ declare relation text; begin
  foreach relation in array array['hub.projects','hub.model_types','hub.entity_assets','hub.project_facilities','hub.brands','hub.brand_assets','hub.assets',
    'hub.knowledge_reviews','hub.facility_taxonomy','staging.knowledge_candidates','staging.rem_projects','staging.rem_models','staging.rem_brands','staging.rem_companies',
    'staging.dw_projects','staging.project_intake_evidence','staging.project_intake_receipts'] loop
    execute format('create trigger progress_dirty after insert or update or delete on %s for each row execute function hub.mark_project_progress_dirty()',relation);
  end loop;
end $$;

create function hub.progress_inputs() returns setof hub.project_progress_cache
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  perform hub.refresh_project_progress(array(select rem_project_id from hub.project_progress_dirty union
    select rem_project_id from hub.project_progress_cache where valid_until<=now()));
  return query select * from hub.project_progress_cache order by rem_project_id;
end $$;

-- Compare only the same public-editable fields used by the existing dashboard.
create function hub.progress_review_content(value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'text',(select jsonb_object_agg(k,coalesce((select jsonb_object_agg(key,text) from jsonb_each(value->k) t(key,text) where text not in ('null','""')),'{}'))
      from unnest(array['public_name','address','ad_disclaimer','meta_title','meta_description']) k),
    'slug',coalesce(value->>'slug',''),'latitude',value->'latitude','longitude',value->'longitude','brand_id',value->'brand_id','brand_version_id',value->'brand_version_id',
    'models',(select coalesce(jsonb_agg((select jsonb_object_agg(k,m->k) from unnest(array['public_model_id','rem_model_id','public_name','bedrooms','bathrooms','usable_area_sqm','parking_spaces','match_status']) k) order by m->>'public_model_id'),'[]')
      from jsonb_array_elements(coalesce(value->'models','[]')) m where m->>'match_status'<>'REJECTED'),
    'assets',(select coalesce(jsonb_agg((select jsonb_object_agg(k,a->k) from unnest(array['id','asset_role','public_model_id','is_primary','alt_text','display_order','public_url','rights_status','effective_from','effective_to']) k) order by a->>'id',a->>'asset_role',a->>'public_model_id'),'[]')
      from jsonb_array_elements(coalesce(value->'assets','[]')) a where a->>'public_model_id' is null or exists(select 1 from jsonb_array_elements(value->'models') m where m->>'public_model_id'=a->>'public_model_id' and m->>'match_status'<>'REJECTED')))
$$;
create function hub.summarize_project_progress() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare s jsonb:=new.source; d jsonb:=new.record->'detail'; live jsonb:=new.record->'live_payload';
  ready jsonb:=coalesce(d->'readiness',s->'readiness'); changed boolean; pending boolean; awaiting boolean; editor_missing boolean;
  attention jsonb:='[]'; binding jsonb; current_asset jsonb; field text; message text;
  rem_group text; marketing_group text; group_conflict boolean; first_seen timestamptz;
begin
  changed:=d is not null and (live is null or live='null' or hub.progress_review_content(d) is distinct from hub.progress_review_content(live));
  select exists(select 1 from jsonb_array_elements(d->'assets') a where a->>'rights_status'='pending') into pending;
  awaiting:=d is not null and ((ready->>'ready')::boolean and changed or pending);
  select exists(select 1 from jsonb_array_elements(ready->'missing') e where not(pending and e->>'field' like '%rights%')) into editor_missing;
  if d->>'published_version_id' is not null then
    if (new.record->>'live_brand_withdrawn')::boolean then attention:=attention||jsonb_build_array(jsonb_build_object('field','brand','message','แบรนด์ที่เผยแพร่ถูกถอนการเผยแพร่แล้ว')); end if;
    for binding in select a from jsonb_array_elements(live->'assets') a where a->>'asset_role' in ('hero','thumbnail') and a->>'public_model_id' is null loop
      select a into current_asset from jsonb_array_elements(new.record->'live_assets') a where a->>'id'=binding->>'id';
      field:='assets.'||(binding->>'id')||'.rights'; message:=null;
      if current_asset->>'rights_status'='revoked' then message:='ถูกเพิกถอนสิทธิ์';
      elsif least((current_asset->>'effective_to')::timestamptz,(binding->>'effective_to')::timestamptz)<=now()+interval '30 days' then message:='หมดอายุหรือจะหมดภายใน 30 วัน'; end if;
      if message is not null then attention:=attention||jsonb_build_array(jsonb_build_object('field',field,'message',case binding->>'asset_role' when 'hero' then 'ภาพหลัก' else 'ภาพย่อ' end||message)); end if;
    end loop;
    if s#>>'{source_review,is_deleted}'='true' then message:='โครงการต้นทาง REM ถูกลบ';
    elsif s#>>'{source_review,status_raw}'='3' then message:='โครงการต้นทาง REM ปิดโครงการ (3)';
    elsif s#>>'{source_record,is_active}'='false' or lower(s#>>'{source_record,project_status}')='inactive' then message:='โครงการต้นทาง REM ไม่ใช้งาน';
    else message:=null; end if;
    if message is not null then attention:=attention||jsonb_build_array(jsonb_build_object('field','source','message',message)); end if;
  end if;
  rem_group:=case when s->'source_record' ? 'ProjectGroupID' then s#>>'{source_record,ProjectGroupID}' else s#>>'{source_record,rem_project_group_id}' end;
  if btrim(rem_group)='' then rem_group:=null; end if;
  marketing_group:=s#>>'{gold_source,record,marketing_project_group_id}'; if btrim(marketing_group)='' then marketing_group:=null; end if;
  group_conflict:=coalesce(s#>>'{gold_source,record,project_group_conflict}'='true' or s#>>'{gold_source,record,project_identity_conflict}'='true',false)
    or exists(select 1 from jsonb_array_elements(s#>'{source_review,exceptions}') e where e->>'code'='GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT');
  first_seen:=coalesce((s->>'first_seen_at')::timestamptz,(s->>'mirror_imported_at')::timestamptz);
  new.summary:=jsonb_build_object('public_project_id',s->'public_project_id','rem_project_id',new.rem_project_id,
    'name',coalesce(nullif(d#>>'{public_name,th}',''),s->>'project_name_rem',new.rem_project_id),
    'brand_name',coalesce(nullif(d#>>'{brand_summary,public_name,th}',''),s->>'brand_name_rem'),
    'rem_brand_id',s->'rem_brand_id','rem_project_group_id',rem_group,'marketing_project_group_id',marketing_group,
    'group_status',case when group_conflict then 'conflict' when rem_group is not null then 'rem_reference' else 'missing' end,
    'new_from_rem',d is null,'filling',d is not null and not (ready->>'ready')::boolean,'awaiting_publisher',awaiting,
    'published',coalesce((d->>'publication_available')::boolean,false),'needs_attention',jsonb_array_length(attention)>0,'attention',attention,
    'has_unpublished_changes',changed,'withdrawn',d->>'published_version_id' is null and coalesce((new.record->>'version_count')::integer,0)>0,
    'checklist',ready-'missing'-'excluded_models'-'model_catalogue_complete','required_missing',jsonb_array_length(ready->'missing'),
    'gaps','{}'::jsonb,'confirmed_models',(select count(*) from jsonb_array_elements(d->'models') m where m->>'match_status'='CONFIRMED'),
    'total_models',s->'model_count','amenities',case when d is not null then jsonb_build_object('collected',d#>'{facilities,collected_count}','total',d#>'{facilities,expected_count}') end,
    'waiting_on',case when d is null or editor_missing then '["editor"]'::jsonb else '[]'::jsonb end||case when awaiting then '["publisher"]'::jsonb else '[]'::jsonb end,
    'updated_at',d->'updated_at','source_review',s->'source_review','first_seen_at',first_seen,
    'age_basis',case when s->>'first_seen_at' is not null then case when (s#>>'{source_review,first_import_only}')::boolean then 'first_import' else 'first_seen' end when first_seen is not null then 'mirror_import' else 'unknown' end,
    'knowledge',new.knowledge,'thumbnail',new.thumbnail,'brand_logo',new.brand_logo);
  return new;
end $$;
create trigger summarize before insert or update on hub.project_progress_cache for each row execute function hub.summarize_project_progress();

create function hub.progress_rows(detail_id text default null) returns table(summary jsonb)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  perform hub.refresh_project_progress(array(select rem_project_id from hub.project_progress_dirty union select rem_project_id from hub.project_progress_cache where valid_until<=now()));
  return query select (case when detail_id is not null then c.summary else jsonb_set(c.summary,'{checklist}',(c.summary->'checklist')-'required'-'recommended') end)
    || jsonb_build_object('age_days',case when c.summary->>'first_seen_at' is not null then greatest(0,floor(extract(epoch from now()-(c.summary->>'first_seen_at')::timestamptz)/86400)) end)
    from hub.project_progress_cache c where detail_id is null or c.rem_project_id=detail_id
    order by (c.summary#>>'{checklist,ready}')::boolean desc,(c.summary#>>'{checklist,percent}')::integer desc,c.rem_project_id;
end $$;
revoke all on function hub.progress_review_content(jsonb),hub.summarize_project_progress(),hub.progress_rows(text) from public;
grant execute on function hub.progress_rows(text) to editor,publisher,viewer,admin;
revoke all on function hub.compact_source_readiness(jsonb),hub.refresh_project_progress(text[]),hub.mark_project_progress_dirty(),hub.flush_project_progress(),hub.progress_inputs() from public;
grant execute on function hub.progress_inputs() to editor,publisher,viewer,admin;
select hub.refresh_project_progress(array(select rem_project_id from staging.rem_projects));
commit;
