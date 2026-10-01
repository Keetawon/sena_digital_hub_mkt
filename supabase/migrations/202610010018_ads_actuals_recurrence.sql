-- Reopen an acknowledged condition only when DW explicitly reports clearance then recurrence.
begin;
create or replace function staging.apply_ads_actuals(p_manifest jsonb,p_relations jsonb,p_fingerprint text,p_expected_snapshot_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;current_batch staging.ads_actuals_batch;existing staging.ads_actuals_batch;added uuid;issues jsonb:='[]';
 rel jsonb;r jsonb;relation_name text;names text[]:=array['dim_media_line','bridge_native_campaign_media_line','fact_media_line_monthly','fact_marketing_ops_finding'];
 snap text:=p_manifest->>'snapshot_id';stamp timestamptz;w ads.finding_workflow;
begin
 actor:=hub.require_actor(array['admin']);perform ads.actuals_local_guard();
 -- ponytail: serialize low-volume full snapshots and workflow commands together.
 perform pg_advisory_xact_lock(160016);
 if p_manifest->>'environment' is distinct from 'test' or p_manifest->>'contract_version' is distinct from 'hub-p3-test-v1'
 or p_manifest->'synthetic_only' is distinct from 'true'::jsonb or nullif(snap,'') is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
 raise exception 'ชุดข้อมูลต้องเป็นสัญญา TEST สังเคราะห์ที่ตรวจสอบแล้ว' using errcode='22023';end if;
 stamp:=(p_manifest->>'snapshot_at')::timestamptz;
 select b.* into current_batch from staging.ads_actuals_current c join staging.ads_actuals_batch b on b.id=c.batch_id;
 select * into existing from staging.ads_actuals_batch where snapshot_id=snap and status='APPLIED';
 if existing.id is not null and existing.fingerprint=p_fingerprint and existing.manifest=p_manifest and existing.relations=p_relations then
 return jsonb_build_object('status','NOOP','batch_id',existing.id,'snapshot_id',snap,'issues','[]'::jsonb);end if;
 if existing.id is not null then issues:=issues||'"SNAPSHOT_CONTENT_CONFLICT"'::jsonb;end if;
 if current_batch.snapshot_id is distinct from p_expected_snapshot_id then issues:=issues||'"CURRENT_SNAPSHOT_CHANGED"'::jsonb;end if;
 if current_batch.id is not null and stamp<=current_batch.snapshot_at then issues:=issues||'"SNAPSHOT_NOT_NEWER"'::jsonb;end if;
 if jsonb_typeof(p_relations) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_relations) k) is distinct from (select array_agg(k order by k) from unnest(names) k)
 or jsonb_typeof(p_manifest->'relations') is distinct from 'array' or jsonb_array_length(p_manifest->'relations')<>4 then
 issues:=issues||'"INCOMPLETE_RELATIONS"'::jsonb;
 else
 foreach relation_name in array names loop
 select value into rel from jsonb_array_elements(p_manifest->'relations') where value->>'relation'=relation_name;
 if rel is null or jsonb_typeof(p_relations->relation_name) is distinct from 'array' then issues:=issues||'"INCOMPLETE_RELATIONS"'::jsonb;continue;end if;
 if jsonb_array_length(p_relations->relation_name)<>(rel->>'row_count')::integer then issues:=issues||'"ROW_COUNT_MISMATCH"'::jsonb;end if;
 for r in select value from jsonb_array_elements(p_relations->relation_name) loop
 if r->>'environment' is distinct from 'test' or r->>'contract_version' is distinct from p_manifest->>'contract_version' or r->>'snapshot_id' is distinct from snap
 or (r->>'snapshot_at')::timestamptz is distinct from stamp or r->>'hub_snapshot_id' is distinct from p_manifest->>'hub_snapshot_id' then issues:=issues||'"MIXED_GENERATION"'::jsonb;exit;end if;
 end loop;
 end loop;
 end if;
 -- A complete refresh must retain finding identities; disappearance is not clearance.
 if current_batch.id is not null and exists(select 1 from staging.ads_actuals_finding f where f.batch_id=current_batch.id and not exists(select 1 from jsonb_array_elements(coalesce(p_relations->'fact_marketing_ops_finding','[]')) e where e->>'finding_key'=f.finding_key)) then issues:=issues||'"FINDING_DISAPPEARED"'::jsonb;end if;
 if issues<>'[]' then
 insert into staging.ads_actuals_batch(snapshot_id,snapshot_at,fingerprint,manifest,relations,status,issues,created_by) values(snap,stamp,p_fingerprint,p_manifest,p_relations,'QUARANTINED',issues,actor) returning id into added;
 return jsonb_build_object('status','QUARANTINED','batch_id',added,'snapshot_id',snap,'issues',issues);end if;
 -- The subtransaction rolls all source inserts back before recording quarantine.
 begin
 insert into staging.ads_actuals_batch(snapshot_id,snapshot_at,fingerprint,manifest,relations,status,created_by) values(snap,stamp,p_fingerprint,p_manifest,p_relations,'APPLIED',actor) returning id into added;
 insert into staging.ads_actuals_dim select added,e->>'line_key',e->>'revision_key',e from jsonb_array_elements(p_relations->'dim_media_line') e;
 insert into staging.ads_actuals_bridge select added,e->>'platform',e->>'account_id',e->>'campaign_id',(e->>'month')::date,e from jsonb_array_elements(p_relations->'bridge_native_campaign_media_line') e;
 insert into staging.ads_actuals_monthly select added,e->>'line_key',(e->>'month')::date,e->>'revision_key',e from jsonb_array_elements(p_relations->'fact_media_line_monthly') e;
 insert into staging.ads_actuals_finding select added,e->>'finding_key',e from jsonb_array_elements(p_relations->'fact_marketing_ops_finding') e;
 if exists(select 1 from staging.ads_actuals_bridge b where b.batch_id=added and b.row_data->>'line_key' is not null and not exists(select 1 from staging.ads_actuals_dim d where d.batch_id=added and d.line_key=b.row_data->>'line_key' and d.revision_key=b.row_data->>'revision_key')) then raise exception 'Missing bridge dimension' using errcode='23503';end if;
 exception when integrity_constraint_violation or data_exception then
 issues:=jsonb_build_array('INVALID_SOURCE_ROWS');
 insert into staging.ads_actuals_batch(snapshot_id,snapshot_at,fingerprint,manifest,relations,status,issues,created_by) values(snap,stamp,p_fingerprint,p_manifest,p_relations,'QUARANTINED',issues,actor) returning id into added;
 return jsonb_build_object('status','QUARANTINED','batch_id',added,'snapshot_id',snap,'issues',issues);
 end;
 update staging.ads_actuals_current set batch_id=added where singleton;
 for w in select wf.* from ads.finding_workflow wf join staging.ads_actuals_finding f on f.finding_key=wf.finding_key and f.batch_id=added where f.row_data->'condition_present'='true'::jsonb and (wf.state='RESOLVED' or exists(select 1 from staging.ads_actuals_finding prior where prior.batch_id=current_batch.id and prior.finding_key=wf.finding_key and prior.row_data->>'evaluation_status'='EVALUATED' and prior.row_data->'condition_present'='false'::jsonb)) loop
 update ads.finding_workflow set state='OPEN',version=version+1,updated_by=actor,updated_at=clock_timestamp(),source_snapshot_id=snap where finding_key=w.finding_key;
 insert into ads.finding_history(finding_key,state,action,owner_role,owner_id,note,version,actor_id,snapshot_id)
 values(w.finding_key,'OPEN','SOURCE_REOPEN',w.owner_role,w.owner_id,'พบเงื่อนไขเดิมในข้อมูลชุดใหม่',w.version+1,actor,snap);
 end loop;
 return jsonb_build_object('status','APPLIED','batch_id',added,'snapshot_id',snap,'issues','[]'::jsonb);
end $$;
commit;
