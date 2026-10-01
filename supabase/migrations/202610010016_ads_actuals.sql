-- P3 local TEST read-back. Source facts stay immutable; only Hub workflow changes.
begin;
create role ads_actuals_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema ads,staging,hub to ads_actuals_writer;
grant execute on function hub.require_actor(text[]) to ads_actuals_writer;

create table staging.ads_actuals_batch (
 id uuid primary key default gen_random_uuid(),snapshot_id text not null,snapshot_at timestamptz not null,
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),manifest jsonb not null,relations jsonb not null,
 status text not null check(status in('APPLIED','QUARANTINED')),issues jsonb not null default '[]',
 received_at timestamptz not null default clock_timestamp(),created_by uuid not null
);
create unique index actuals_one_applied_snapshot on staging.ads_actuals_batch(snapshot_id) where status='APPLIED';
create table staging.ads_actuals_current(singleton boolean primary key default true check(singleton),batch_id uuid references staging.ads_actuals_batch);
insert into staging.ads_actuals_current values(true,null);
-- JSONB preserves the closed DW contract losslessly, including decimal strings and
-- unknown fields' nulls. Each relation has an independently enforced business key.
create table staging.ads_actuals_dim(batch_id uuid not null references staging.ads_actuals_batch,line_key text not null,revision_key text not null,row_data jsonb not null,primary key(batch_id,line_key,revision_key));
create table staging.ads_actuals_bridge(batch_id uuid not null references staging.ads_actuals_batch,platform text not null,account_id text not null,campaign_id text not null,month ads.finance_month not null,row_data jsonb not null,primary key(batch_id,platform,account_id,campaign_id,month));
create table staging.ads_actuals_monthly(batch_id uuid not null references staging.ads_actuals_batch,line_key text not null,month ads.finance_month not null,revision_key text not null,row_data jsonb not null,primary key(batch_id,line_key,month),foreign key(batch_id,line_key,revision_key) references staging.ads_actuals_dim);
create table staging.ads_actuals_finding(batch_id uuid not null references staging.ads_actuals_batch,finding_key text not null check(finding_key ~ '^[0-9a-f]{64}$'),row_data jsonb not null check(row_data->>'control_code' in('C5','C6')),primary key(batch_id,finding_key));
create table ads.finding_workflow(
 finding_key text primary key,state text not null check(state in('OPEN','ACKNOWLEDGED','RESOLVED')),
 owner_role text check(owner_role in('online_staff','admin')),owner_id uuid,note text not null default '',
 version integer not null check(version>0),updated_by uuid not null,updated_at timestamptz not null default clock_timestamp(),
 source_snapshot_id text not null,check((owner_role is null)=(owner_id is null))
);
create table ads.finding_history(
 id uuid primary key default gen_random_uuid(),finding_key text not null,state text not null,action text not null,
 owner_role text,owner_id uuid,note text not null,version integer not null,actor_id uuid not null,
 snapshot_id text not null,recorded_at timestamptz not null default clock_timestamp()
);
create table ads.document_follow_up(
 id uuid primary key default gen_random_uuid(),key text not null,source_version text not null,template_version text not null,
 snapshot_id text not null,message_th text not null,action text not null default 'COPIED' check(action='COPIED'),
 actor_id uuid not null,copied_at timestamptz not null default clock_timestamp()
);

create function ads.actuals_immutable() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin raise exception 'ห้ามแก้ไขหรือลบประวัติข้อมูลต้นทาง' using errcode='23514';end $$;
do $$ declare s text;t text;begin
 for s,t in select schemaname,tablename from pg_tables where (schemaname='staging' and tablename like 'ads_actuals_%') or(schemaname='ads' and tablename in('finding_workflow','finding_history','document_follow_up')) loop
 execute format('alter table %I.%I enable row level security',s,t);
 execute format('alter table %I.%I force row level security',s,t);
 execute format('create policy actuals_writer on %I.%I to ads_actuals_writer using(true) with check(true)',s,t);
 execute format('grant select,insert,update on %I.%I to ads_actuals_writer',s,t);
 execute format('create trigger actuals_audit after insert or update on %I.%I for each row execute function audit.record_change()',s,t);
 execute format('create trigger actuals_no_delete before delete on %I.%I for each row execute function ads.actuals_immutable()',s,t);
 if t not in('ads_actuals_current','finding_workflow') then execute format('create trigger actuals_no_update before update on %I.%I for each row execute function ads.actuals_immutable()',s,t);end if;
 end loop;
 -- P3 can read the exact P2 sources needed for reference tracking, never write them.
 foreach t in array array['media_line','media_line_revision','media_line_component','line_budget_item','memo','document_requirement','cost_record','scope_code'] loop
 execute format('grant select on ads.%I to ads_actuals_writer',t);
 execute format('create policy actuals_source_read on ads.%I for select to ads_actuals_writer using(true)',t);
 end loop;
 foreach t in array array['ads_card_row','ads_card_batch'] loop
 execute format('grant select on staging.%I to ads_actuals_writer',t);
 execute format('create policy actuals_source_read on staging.%I for select to ads_actuals_writer using(true)',t);
 end loop;
end $$;

create function ads.actuals_local_guard() returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if current_database()<>'sena_hub_local' or inet_server_addr() is distinct from '127.0.0.1'::inet or inet_server_port()<>55432 then
 raise exception 'ข้อมูลตัวอย่างใช้ได้เฉพาะฐานข้อมูลทดสอบภายในเครื่อง' using errcode='42501';end if;
end $$;
create function staging.ads_actuals_current_snapshot() returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_actor(array['admin']);perform ads.actuals_local_guard();
 return(select b.snapshot_id from staging.ads_actuals_current c join staging.ads_actuals_batch b on b.id=c.batch_id);
end $$;

create function staging.apply_ads_actuals(p_manifest jsonb,p_relations jsonb,p_fingerprint text,p_expected_snapshot_id text) returns jsonb
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
 for w in select wf.* from ads.finding_workflow wf join staging.ads_actuals_finding f on f.finding_key=wf.finding_key and f.batch_id=added where wf.state='RESOLVED' and f.row_data->'condition_present'='true'::jsonb loop
 update ads.finding_workflow set state='OPEN',version=version+1,updated_by=actor,updated_at=clock_timestamp(),source_snapshot_id=snap where finding_key=w.finding_key;
 insert into ads.finding_history(finding_key,state,action,owner_role,owner_id,note,version,actor_id,snapshot_id)
 values(w.finding_key,'OPEN','SOURCE_REOPEN',w.owner_role,w.owner_id,'พบเงื่อนไขเดิมในข้อมูลชุดใหม่',w.version+1,actor,snap);
 end loop;
 return jsonb_build_object('status','APPLIED','batch_id',added,'snapshot_id',snap,'issues','[]'::jsonb);
end $$;

create function ads.actuals_meta() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select coalesce((select jsonb_build_object('snapshot_id',b.snapshot_id,'snapshot_at',b.snapshot_at,'received_at',b.received_at,'environment','test','synthetic_only',true,'status','AVAILABLE',
 'source_watermarks',jsonb_build_object('hub_source_snapshot_at',b.manifest->'hub_source_snapshot_at','platform_source_snapshot_at',b.manifest->'platform_source_snapshot_at','rem_source_snapshot_at',b.manifest->'rem_source_snapshot_at'),
 'control_totals',b.manifest->'control_totals','quality_codes',jsonb_build_array('SYNTHETIC_TEST_DATA'),
 'context_changed',exists(select 1 from staging.ads_actuals_dim d left join ads.media_line l on l.id::text=d.line_key left join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED' where d.batch_id=b.id and d.row_data->'is_applicable'='true'::jsonb and (r.id::text is distinct from d.revision_key or l.state is distinct from 'ACTIVE')))
 from staging.ads_actuals_current c join staging.ads_actuals_batch b on b.id=c.batch_id),jsonb_build_object('status','NOT_IMPORTED','environment','test','synthetic_only',true))
$$;

-- This projection deliberately has no financial totals, approvers or evidence URL fetch.
create function ads.actuals_documents(selected_month date default null) returns setof jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
with months as (
 select l.id::text line_key,coalesce(l.month,selected_month) as month,r.id::text revision_key,s.scope_code,l.agency
 from ads.media_line l join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED'
 left join ads.scope_code s on s.scope_id=l.scope_id
 where l.state='ACTIVE' and ((l.month is not null and(selected_month is null or l.month=selected_month))
 or(l.month is null and selected_month between l.period_start_month and l.period_end_month))
), subjects as (
 select x.*, 'COMPONENT'::text subject_kind,c.id::text subject_id,b.cost_type::text,b.payment_method::text,
 coalesce(c.memo_snapshot->>'memo_no',mm.memo_no,c.observed_memo_no) memo_ref,c.fee_po_ref,
 '{}'::jsonb evidence_refs,null::text statement_ref,null::text commitment_ref,null::text account_ref,
 jsonb_build_array(c.row_version,b.row_version,mm.row_version,l.row_version,r.row_version) versions,
 '/ads/finance?view=media-lines'::text source_link
 from months x join ads.media_line l on l.id::text=x.line_key join ads.media_line_revision r on r.id::text=x.revision_key and r.status='APPROVED' and l.state='ACTIVE'
 join ads.media_line_component c on c.revision_id=r.id left join ads.line_budget_item b on b.component_id=c.id left join ads.memo mm on mm.id=c.memo_id
 union all
 select x.*,'COST',c.id::text,c.cost_type::text,c.payment_method::text,coalesce(mm.memo_no,c.observed_memo_no),null,c.evidence_refs,
 cb.statement_control_id::text,c.commitment_occurrence_id::text,c.account_mapping_id::text,jsonb_build_array(c.row_version,mm.row_version,cb.row_version),'/ads/finance?view=cost-records'
 from months x join ads.cost_record c on c.line_id::text=x.line_key and date_trunc('month',c.charge_date)::date=x.month and c.status='CONFIRMED'
 left join ads.memo mm on mm.id=c.memo_id left join staging.ads_card_row cr on cr.id=c.source_row_id left join staging.ads_card_batch cb on cb.id=cr.batch_id
 where cb.id is null or cb.status='CONFIRMED'
), required as (
 select s.*,coalesce(req.status,'UNAVAILABLE') matrix_status,req.version requirement_version,
 unnest(case when coalesce(cardinality(req.requirement_codes),0)=0 then array['UNKNOWN'] else req.requirement_codes end) requirement_code,
 req.row_version matrix_version
 from subjects s left join lateral(select q.* from ads.document_requirement q where q.cost_type::text=s.cost_type and q.payment_method::text=s.payment_method and q.status<>'RETIRED' and s.month>=date_trunc('month',q.valid_from)::date and(q.valid_to is null or s.month<q.valid_to) order by q.version desc limit 1) req on true
), references_present as (
 select *,case requirement_code when 'M' then coalesce(memo_ref,evidence_refs->>'M') when 'S' then coalesce(evidence_refs->>'S',statement_ref)
 when 'A' then coalesce(evidence_refs->>'A',account_ref) when 'C' then coalesce(evidence_refs->>'C',commitment_ref)
 when 'P' then null when 'UNKNOWN' then null else evidence_refs->>requirement_code end reference,
 case when requirement_code='P' then coalesce(fee_po_ref,evidence_refs->>'P') end partial_reference
 from required
), keyed as (
 select *,encode(sha256(convert_to(jsonb_build_array(line_key,month,subject_kind,subject_id,requirement_version,cost_type,payment_method,requirement_code)::text,'UTF8')),'hex') key,
 encode(sha256(convert_to(jsonb_build_array(versions,matrix_version,reference,partial_reference,revision_key)::text,'UTF8')),'hex') source_version
 from references_present
)
select jsonb_build_object('key',key,'line_id',line_key,'month',month,'scope_code',scope_code,'agency',agency,'subject_kind',subject_kind,'subject_id',subject_id,
 'cost_type',cost_type,'payment_method',payment_method,'requirement_code',requirement_code,'requirement_version',requirement_version,'matrix_status',matrix_status,
 'status',case when nullif(btrim(reference),'') is null then 'MISSING' else 'REFERENCE_RECORDED' end,'reference',reference,'partial_reference',partial_reference,
 'reason',case when requirement_code='UNKNOWN' then 'MATRIX_UNAVAILABLE' when requirement_code='P' then 'PO_AND_INVOICE_PAIR_UNAVAILABLE' else 'VERIFICATION_NOT_AUTHORIZED' end,
 'source_version',source_version,'source_link',source_link,'owner',null,'due_at',null,'is_overdue',null,'template_version','1',
 'message_th','ขอติดตามเอกสารอ้างอิง '||requirement_code||' สำหรับรายการ '||coalesce(scope_code,line_key)||' เดือน '||to_char(month,'MM/')||(extract(year from month)::integer+543)::text||' กรุณาส่งข้อมูลให้ผู้รับผิดชอบเพื่อตรวจสอบใน Hub',
 'follow_ups',coalesce((select jsonb_agg(to_jsonb(f) order by f.copied_at desc) from ads.document_follow_up f where f.key=keyed.key),'[]')) from keyed
$$;

create function ads.actuals_read(resource text,key text default null,filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;rows jsonb:='[]';entry jsonb;dim jsonb;meta jsonb;total integer;lim integer:=coalesce((filters->>'limit')::integer,50);off integer:=coalesce((filters->>'offset')::integer,0);
begin
 perform hub.require_actor(array['online_staff','admin']);perform ads.actuals_local_guard();meta:=ads.actuals_meta();
 if lim not between 1 and 100 or off<0 then raise exception 'ขนาดหน้าข้อมูลไม่ถูกต้อง' using errcode='22023';end if;
 if resource='actuals' and key is not null then
 select d.row_data into dim from staging.ads_actuals_current c join staging.ads_actuals_dim d on d.batch_id=c.batch_id where d.line_key=key order by(d.row_data->>'is_applicable')::boolean desc,(d.row_data->>'revision_no')::int desc limit 1;
 if dim is null then return null;end if;
 return jsonb_build_object('line',dim,'revisions',coalesce((select jsonb_agg(d.row_data order by(d.row_data->>'revision_no')::int desc) from staging.ads_actuals_current c join staging.ads_actuals_dim d on d.batch_id=c.batch_id where d.line_key=key),'[]'),
 'months',coalesce((select jsonb_agg(m.row_data order by m.month) from staging.ads_actuals_current c join staging.ads_actuals_monthly m on m.batch_id=c.batch_id where m.line_key=key and(filters->>'month' is null or m.month=(filters->>'month')::date)),'[]'),
 'campaigns',coalesce((select jsonb_agg(b.row_data order by b.month,b.platform,b.account_id,b.campaign_id) from staging.ads_actuals_current c join staging.ads_actuals_bridge b on b.batch_id=c.batch_id where b.row_data->>'line_key'=key and(filters->>'month' is null or b.month=(filters->>'month')::date)),'[]'),'meta',meta);
 elsif resource='actuals' then
 select coalesce(jsonb_agg(m.row_data||jsonb_build_object('dimension',d.row_data) order by m.month desc,m.line_key),'[]') into rows
 from staging.ads_actuals_current c join staging.ads_actuals_monthly m on m.batch_id=c.batch_id join staging.ads_actuals_dim d on d.batch_id=m.batch_id and d.line_key=m.line_key and d.revision_key=m.revision_key
 where (filters->>'month' is null or m.month=(filters->>'month')::date) and(filters->>'agency' is null or d.row_data->>'agency'=filters->>'agency' or d.row_data->'permitted_agencies' ? (filters->>'agency'))
 and(filters->>'scope' is null or d.row_data->>'scope_code'=filters->>'scope') and(filters->>'bud' is null or exists(select 1 from jsonb_array_elements(d.row_data->'components') e where e->>'bud'=filters->>'bud'));
 elsif resource='findings' then
 select coalesce(jsonb_agg(f.row_data||jsonb_build_object('workflow',coalesce(to_jsonb(w)-'finding_key',jsonb_build_object('state','OPEN','owner_role',null,'owner_id',null,'note','','version',0,'updated_at',null,'updated_by',null))) order by f.finding_key),'[]') into rows
 from staging.ads_actuals_current c join staging.ads_actuals_finding f on f.batch_id=c.batch_id left join ads.finding_workflow w on w.finding_key=f.finding_key
 where (key is null or f.finding_key=key) and(filters->>'month' is null or f.row_data->>'month'=filters->>'month') and(filters->>'agency' is null or f.row_data->>'agency'=filters->>'agency')
 and(filters->>'control_code' is null or f.row_data->>'control_code'=filters->>'control_code') and(filters->>'state' is null or coalesce(w.state,'OPEN')=filters->>'state')
 and(filters->>'owner' is null or w.owner_id::text=filters->>'owner' or w.owner_role=filters->>'owner' or(filters->>'owner'='unassigned' and w.owner_id is null))
 and(filters->>'condition' is null or case when f.row_data->>'evaluation_status'='UNAVAILABLE' then 'UNAVAILABLE' when f.row_data->'condition_present'='true' then 'PRESENT' else 'CLEARED' end=filters->>'condition');
 if key is not null then if jsonb_array_length(rows)=0 then return null;end if;
 return jsonb_build_object('finding',rows->0,'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.recorded_at,h.id) from ads.finding_history h where h.finding_key=key),'[]'),'meta',meta);end if;
 elsif resource='document-tracking' then
 meta:=meta||jsonb_build_object('period_month_selection_required',filters->>'month' is null and exists(select 1 from ads.media_line where state='ACTIVE' and month is null));
 select coalesce(jsonb_agg(e order by e->>'month' desc,e->>'key'),'[]') into rows from ads.actuals_documents((filters->>'month')::date) e
 where(key is null or e->>'key'=key) and(filters->>'month' is null or e->>'month'=filters->>'month') and(filters->>'agency' is null or e->>'agency'=filters->>'agency')
 and(filters->>'status' is null or e->>'status'=filters->>'status') and(filters->>'overdue' is null or filters->>'overdue'='unknown')
 and(filters->>'owner' is null or filters->>'owner'='unassigned');
 if key is not null then if jsonb_array_length(rows)=0 then return null;end if;return jsonb_build_object('item',rows->0,'meta',meta);end if;
 else raise exception 'ไม่พบชนิดข้อมูล' using errcode='22023';end if;
 total:=jsonb_array_length(rows);
 select coalesce(jsonb_agg(value),'[]') into result from(select value from jsonb_array_elements(rows) with ordinality order by ordinality limit lim offset off) page;
 return jsonb_build_object('items',result,'total',total,'meta',meta||jsonb_build_object('limit',lim,'offset',off));
end $$;

create function ads.actuals_command(action text,key text,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;snap text;w ads.finding_workflow;doc jsonb;result jsonb;v integer;newstate text;newownerrole text;newownerid uuid;
begin
 actor:=hub.require_actor(array['online_staff','admin']);perform ads.actuals_local_guard();perform pg_advisory_xact_lock(160016);
 select b.snapshot_id into snap from staging.ads_actuals_current c join staging.ads_actuals_batch b on b.id=c.batch_id;
 if snap is null or snap is distinct from p->>'expected_snapshot_id' then raise exception 'ชุดข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
 if action='workflow' then
 if not exists(select 1 from staging.ads_actuals_current c join staging.ads_actuals_finding f on f.batch_id=c.batch_id where f.finding_key=key) then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 select * into w from ads.finding_workflow where finding_key=key;v:=coalesce(w.version,0);
 if v is distinct from(p->>'expected_version')::integer then raise exception 'สถานะเปลี่ยนแล้ว' using errcode='40001';end if;
 newstate:=p->>'state';
 if newstate is null or newstate not in('OPEN','ACKNOWLEDGED','RESOLVED') or length(coalesce(p->>'note',''))>2000 or(newstate='RESOLVED' and nullif(btrim(p->>'note'),'') is null)
 or p ? 'owner_role' or p ? 'owner_id' or coalesce(p->>'owner_action','KEEP') not in('KEEP','SELF','CLEAR') then raise exception 'สถานะ ผู้รับผิดชอบ หรือเหตุผลไม่ถูกต้อง' using errcode='22023';end if;
 newownerrole:=case coalesce(p->>'owner_action','KEEP') when 'SELF' then current_setting('role') when 'CLEAR' then null else w.owner_role end;
 newownerid:=case coalesce(p->>'owner_action','KEEP') when 'SELF' then actor when 'CLEAR' then null else w.owner_id end;
 insert into ads.finding_workflow(finding_key,state,owner_role,owner_id,note,version,updated_by,source_snapshot_id)
 values(key,newstate,newownerrole,newownerid,coalesce(p->>'note',''),v+1,actor,snap)
 on conflict(finding_key) do update set state=excluded.state,owner_role=excluded.owner_role,owner_id=excluded.owner_id,note=excluded.note,version=excluded.version,updated_by=actor,updated_at=clock_timestamp(),source_snapshot_id=snap;
 insert into ads.finding_history(finding_key,state,action,owner_role,owner_id,note,version,actor_id,snapshot_id)
 values(key,newstate,'OPERATOR',newownerrole,newownerid,coalesce(p->>'note',''),v+1,actor,snap);
 return ads.actuals_read('findings',key);
 elsif action='follow-up' then
 select value into doc from ads.actuals_documents((p->>'month')::date) value where value->>'key'=key;
 if doc is null then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 if p->>'expected_source_version' is distinct from doc->>'source_version' or p->>'template_version' is distinct from '1' then raise exception 'แหล่งข้อมูลหรือข้อความเปลี่ยนแล้ว' using errcode='40001';end if;
 insert into ads.document_follow_up(key,source_version,template_version,snapshot_id,message_th,actor_id)
 values(key,doc->>'source_version','1',snap,doc->>'message_th',actor) returning to_jsonb(document_follow_up) into result;
 return jsonb_build_object('follow_up',result);
 else raise exception 'ไม่พบคำสั่ง' using errcode='22023';end if;
end $$;

do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where (pronamespace='ads'::regnamespace and proname like 'actuals_%') or(pronamespace='staging'::regnamespace and proname in('apply_ads_actuals','ads_actuals_current_snapshot')) loop
 execute format('revoke all on function %s from public',f.signature);execute format('alter function %s owner to ads_actuals_writer',f.signature);
 end loop;
end $$;
grant execute on function staging.apply_ads_actuals(jsonb,jsonb,text,text),staging.ads_actuals_current_snapshot() to admin;
grant execute on function ads.actuals_read(text,text,jsonb),ads.actuals_command(text,text,jsonb) to online_staff,admin;
commit;
