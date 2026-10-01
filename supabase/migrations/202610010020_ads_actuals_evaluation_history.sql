-- Unknown evaluation does not erase the last explicitly evaluated source state.
begin;
create or replace function ads.apply_ads_actuals(p_manifest jsonb,p_relations jsonb,p_fingerprint text,p_expected_snapshot_id text) returns jsonb
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
 for w in select wf.* from ads.finding_workflow wf join staging.ads_actuals_finding f on f.finding_key=wf.finding_key and f.batch_id=added where f.row_data->'condition_present'='true'::jsonb and (wf.state='RESOLVED' or (select prior.row_data->'condition_present' from staging.ads_actuals_finding prior join staging.ads_actuals_batch prior_batch on prior_batch.id=prior.batch_id where prior_batch.status='APPLIED' and prior_batch.snapshot_at<stamp and prior.finding_key=wf.finding_key and prior.row_data->>'evaluation_status'='EVALUATED' and jsonb_typeof(prior.row_data->'condition_present')='boolean' order by prior_batch.snapshot_at desc limit 1)='false'::jsonb) loop
 update ads.finding_workflow set state='OPEN',version=version+1,updated_by=actor,updated_at=clock_timestamp(),source_snapshot_id=snap where finding_key=w.finding_key;
 insert into ads.finding_history(finding_key,state,action,owner_role,owner_id,note,version,actor_id,snapshot_id)
 values(w.finding_key,'OPEN','SOURCE_REOPEN',w.owner_role,w.owner_id,'พบเงื่อนไขเดิมในข้อมูลชุดใหม่',w.version+1,actor,snap);
 end loop;
 return jsonb_build_object('status','APPLIED','batch_id',added,'snapshot_id',snap,'issues','[]'::jsonb);
end $$;

-- A conservative global notice: source records changed after the DW input watermark.
-- Only table identity/write time are available to this non-login function owner.
grant usage on schema audit to ads_actuals_writer;
grant select(table_name,occurred_at) on audit.change_log to ads_actuals_writer;
create function ads.actuals_context_changed(source_watermark timestamptz) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
 select source_watermark is null or exists(select 1 from audit.change_log where occurred_at>source_watermark and table_name=any(array[
 'ads.scope_code','ads.scope_member','ads.campaign_registration','ads.campaign_name','ads.native_binding',
 'ads.memo','ads.memo_identifier','ads.media_line','ads.media_line_revision','ads.media_line_component','ads.line_budget_item',
 'ads.line_assignment','ads.correction','ads.correction_target','ads.ad_account','ads.account_mapping','ads.channel_account',
 'ads.recurring_commitment','ads.commitment_version','ads.commitment_memo_cover','ads.commitment_occurrence',
 'ads.card_statement_control','ads.cost_record','ads.cost_allocation_set','ads.cost_allocation']))
$$;
revoke all on function ads.actuals_context_changed(timestamptz) from public;
alter function ads.actuals_context_changed(timestamptz) owner to ads_actuals_writer;
create or replace function ads.actuals_meta() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select coalesce((select jsonb_build_object('snapshot_id',b.snapshot_id,'snapshot_at',b.snapshot_at,'received_at',b.received_at,'environment','test','synthetic_only',true,'status','AVAILABLE',
 'source_watermarks',jsonb_build_object('hub_source_snapshot_at',b.manifest->'hub_source_snapshot_at','platform_source_snapshot_at',b.manifest->'platform_source_snapshot_at','rem_source_snapshot_at',b.manifest->'rem_source_snapshot_at'),
 'control_totals',b.manifest->'control_totals','quality_codes',jsonb_build_array('SYNTHETIC_TEST_DATA'),
 'context_changed',ads.actuals_context_changed((b.manifest->>'hub_source_snapshot_at')::timestamptz) or exists(select 1 from staging.ads_actuals_dim d left join ads.media_line l on l.id::text=d.line_key left join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED' where d.batch_id=b.id and d.row_data->'is_applicable'='true'::jsonb and (r.id::text is distinct from d.revision_key or l.state is distinct from 'ACTIVE')))
 from staging.ads_actuals_current c join staging.ads_actuals_batch b on b.id=c.batch_id),jsonb_build_object('status','NOT_IMPORTED','environment','test','synthetic_only',true))
$$;
commit;
