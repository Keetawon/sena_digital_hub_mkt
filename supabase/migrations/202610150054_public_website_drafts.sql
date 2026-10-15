-- Public website evidence is a draft source, never a human approval.
begin;
alter table hub.projects add column website_content jsonb not null default '{}'
  check (jsonb_typeof(website_content)='object'
    and not jsonb_path_exists(website_content,'$.* ? (@.type() != "string")')
    and length(website_content::text)<=300000);

-- Preserve the existing private snapshot helper and its ACL. Published versions
-- only acquire this text through the ordinary explicit publication workflow.
create or replace function hub.draft_payload(project_uuid uuid) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
 select base||jsonb_build_object('demo_fields',p.demo_fields,
   'models',hub.demo_model_provenance(base->'models'),'website_content',p.website_content,
   'website_sources',coalesce((select jsonb_agg(jsonb_build_object('url',s.source_url,'fetched_at',s.fetched_at) order by s.source_url)
     from (select c.source_url,max(c.evidence->>'fetched_at') fetched_at
       from staging.knowledge_candidates c where c.project_ids @> array[p.rem_project_id]
       and c.kind='section' and c.evidence->>'source_kind'='sena_public_website'
       and c.source_ref like 'sena-public:%' group by c.source_url) s),'[]'::jsonb))
 from hub.projects p cross join lateral(select hub.draft_payload_before_demo(p.id) base) d where p.id=project_uuid
$$;

create or replace function hub.patch_project(project_uuid uuid, changes jsonb, expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; edited hub.projects;
begin
 perform hub.require_permission('projects','edit');
 if jsonb_typeof(changes)<>'object' or exists(select 1 from jsonb_object_keys(changes) k
   where k not in ('public_name','slug','address','latitude','longitude','ad_disclaimer','meta_title','meta_description','effective_from','effective_to','website_content')) then
   raise exception 'Only draft marketing fields may be changed' using errcode='42501';
 end if;
 select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
 if not found then raise exception 'Project not found' using errcode='P0002'; end if;
 if expected_updated_at is null or p.updated_at<>expected_updated_at then
   raise exception 'Draft changed; reload before saving' using errcode='40001';
 end if;
 edited:=jsonb_populate_record(p,changes);
 update hub.projects set public_name=edited.public_name,slug=edited.slug,address=edited.address,
   latitude=edited.latitude,longitude=edited.longitude,ad_disclaimer=edited.ad_disclaimer,
   meta_title=edited.meta_title,meta_description=edited.meta_description,website_content=edited.website_content,
   effective_from=edited.effective_from,effective_to=edited.effective_to,
   name_source=case when changes?'public_name' then 'marketing_override' else p.name_source end where id=project_uuid;
 return hub.project_detail(p.public_project_id);
end $$;

-- Extend existing progress projections without duplicating their permission,
-- redaction, readiness or cache rules. Fail if their expected shape changed.
do $$
declare definition text; changed text;
begin
 definition:=pg_get_functiondef('hub.summarize_project_progress()'::regprocedure);
 changed:=replace(definition,'''updated_at'',d->''updated_at''',
   '''website_sources'',d->''website_sources'',''updated_at'',d->''updated_at''');
 if changed=definition then raise exception 'Unexpected progress summary definition'; end if;
 execute changed;
 definition:=pg_get_functiondef('hub.progress_review_content(jsonb)'::regprocedure);
 changed:=replace(definition,'''meta_description''','''meta_description'',''website_content''');
 if changed=definition then raise exception 'Unexpected progress comparison definition'; end if;
 execute changed;
end $$;
select hub.refresh_project_progress(array(select rem_project_id from staging.rem_projects));
commit;
