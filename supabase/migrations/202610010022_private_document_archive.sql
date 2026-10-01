-- Fixed local TEST archive. No real uploads, external OCR, public index or financial approval.
begin;
do $$ begin if not exists(select 1 from pg_roles where rolname='ads_document_worker') then create role ads_document_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end $$;
grant usage on schema ads to ads_document_worker;
create table ads.archive_fixture(
 fixture_id text primary key,document_type text not null check(document_type in('E_MEMO','CARD_STATEMENT')),
 label_th text not null,sha256 text not null unique check(sha256~'^[0-9a-f]{64}$'),byte_size bigint not null check(byte_size between 1 and 10485760),
 mime text not null check(mime='application/pdf'),filename text not null,page_count integer not null check(page_count between 1 and 20),
 storage_key text not null unique,pipeline_version text not null,truth jsonb not null,registered_at timestamptz not null default clock_timestamp()
);
create table ads.archive_document(
 id uuid primary key default gen_random_uuid(),document_type text not null check(document_type in('E_MEMO','CARD_STATEMENT')),label_th text not null,
 current_version_id uuid,revision integer not null default 1,legal_hold boolean not null default false,hold_reason text,
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),updated_by uuid not null,updated_at timestamptz not null default clock_timestamp()
);
create table ads.archive_version(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references ads.archive_document,version_no integer not null,
 fixture_id text not null references ads.archive_fixture,sha256 text not null unique,byte_size bigint not null,mime text not null,filename text not null,page_count integer not null,
 storage_key text not null,received_by uuid not null,received_at timestamptz not null default clock_timestamp(),unique(document_id,version_no),unique(document_id,id)
);
alter table ads.archive_document add foreign key(id,current_version_id) references ads.archive_version(document_id,id);
create table ads.archive_receipt(id uuid primary key default gen_random_uuid(),version_id uuid not null references ads.archive_version,received_by uuid not null,received_at timestamptz not null default clock_timestamp(),receipt_status text not null);
create table ads.archive_job(
 id uuid primary key default gen_random_uuid(),version_id uuid not null unique references ads.archive_version,pipeline_version text not null,
 status text not null default 'QUEUED' check(status in('QUEUED','RUNNING','RETRY','DRAFT','CONFIRMED','FAILED')),
 attempt integer not null default 0,worker_id text,lease_token uuid,lease_until timestamptz,safe_error text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table ads.archive_attempt(id uuid primary key default gen_random_uuid(),job_id uuid not null references ads.archive_job,attempt integer not null,lease_token uuid not null,worker_id text not null,started_at timestamptz not null,finished_at timestamptz,outcome text check(outcome in('DRAFT','FAILED','LEASE_EXPIRED')),safe_error text,unique(job_id,attempt));
create table ads.archive_extraction(id uuid primary key default gen_random_uuid(),job_id uuid not null unique references ads.archive_job,original_result jsonb not null,validation jsonb not null,created_at timestamptz not null default clock_timestamp());
create table ads.archive_confirmation(id uuid primary key default gen_random_uuid(),version_id uuid not null unique references ads.archive_version,job_id uuid not null references ads.archive_job,extraction_id uuid not null references ads.archive_extraction,corrected_result jsonb not null,validation jsonb not null,evidence text not null,confirmed_by uuid not null,confirmed_at timestamptz not null default clock_timestamp());
create table ads.archive_application(id uuid primary key default gen_random_uuid(),version_id uuid not null unique references ads.archive_version,confirmation_id uuid not null references ads.archive_confirmation,request_id uuid not null unique,request_payload jsonb not null,mode text not null check(mode in('MEMO_CREATE','MEMO_UPDATE','LINK_MEMO','CARD_CREATE','LINK_CARD')),target_type text not null check(target_type in('MEMO','CARD_BATCH')),target_id uuid not null,target_version integer not null,applied_by uuid not null,applied_at timestamptz not null default clock_timestamp());
create table ads.archive_memo_chunk(id uuid primary key default gen_random_uuid(),version_id uuid not null references ads.archive_version,confirmation_id uuid not null references ads.archive_confirmation,page integer not null check(page>0),body text not null,namespace text not null default 'internal_memo' check(namespace='internal_memo'),is_public boolean not null default false check(not is_public),unique(version_id,page));
create table audit.archive_access(id uuid primary key default gen_random_uuid(),action text not null,outcome text not null,original_role text not null,original_actor_id uuid,document_id uuid,version_id uuid,page integer,request_id uuid not null,bytes bigint,recorded_at timestamptz not null default clock_timestamp());

create function ads.archive_identity_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if new.document_type<>old.document_type or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'ชนิดและตัวตนเอกสารเปลี่ยนไม่ได้' using errcode='23514';end if;return new;end $$;
create trigger archive_identity before update on ads.archive_document for each row execute function ads.archive_identity_guard();
create function ads.archive_index_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from ads.archive_version v join ads.archive_document d on d.id=v.document_id join ads.archive_confirmation c on c.version_id=v.id where v.id=new.version_id and d.document_type='E_MEMO' and c.id=new.confirmation_id and new.page<=v.page_count) then raise exception 'เฉพาะบันทึกข้อความที่ยืนยันแล้วเข้าสู่การค้นหาภายใน' using errcode='23514';end if;return new;
end $$;
create trigger archive_index_boundary before insert or update on ads.archive_memo_chunk for each row execute function ads.archive_index_guard();
do $$ declare schema_name text;table_name text;begin
 for schema_name,table_name in select * from(values('ads','archive_fixture'),('ads','archive_document'),('ads','archive_version'),('ads','archive_receipt'),('ads','archive_job'),('ads','archive_attempt'),('ads','archive_extraction'),('ads','archive_confirmation'),('ads','archive_application'),('ads','archive_memo_chunk'),('audit','archive_access')) entries(s,t) loop
 execute format('alter table %I.%I enable row level security',schema_name,table_name);execute format('alter table %I.%I force row level security',schema_name,table_name);
 execute format('create trigger archive_no_delete before delete on %I.%I for each row execute function ads.finance_no_delete()',schema_name,table_name);
 if table_name not in('archive_document','archive_job','archive_attempt') then execute format('create trigger archive_immutable before update on %I.%I for each row execute function hub.reject_version_change()',schema_name,table_name);end if;
 if schema_name<>'audit' then execute format('create trigger archive_audit after insert or update on %I.%I for each row execute function audit.record_change()',schema_name,table_name);end if;
 end loop;
end $$;

create function ads.archive_register_fixture(metadata jsonb,truth jsonb) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare old ads.archive_fixture;begin
 perform hub.require_demo_seeder();
 if jsonb_typeof(metadata) is distinct from 'object' or jsonb_typeof(truth) is distinct from 'object' or exists(select 1 from jsonb_object_keys(metadata) k where k not in('fixture_id','document_type','label_th','sha256','byte_size','mime','filename','page_count','storage_key','pipeline_version')) then raise exception 'ชุดเอกสารตัวอย่างไม่ถูกต้อง' using errcode='22023';end if;
 if metadata->>'storage_key' is distinct from(case metadata->>'document_type' when 'E_MEMO' then 'memo' when 'CARD_STATEMENT' then 'statement' end)||'/sha256/'||(metadata->>'sha256')||'.pdf' then raise exception 'ตำแหน่งเอกสารตัวอย่างไม่ถูกต้อง' using errcode='22023';end if;
 select * into old from ads.archive_fixture where fixture_id=metadata->>'fixture_id';
 if found then if(to_jsonb(old)-'registered_at'-'truth') is distinct from metadata or old.truth is distinct from archive_register_fixture.truth then raise exception 'ชุดตัวอย่างเดิมมีข้อมูลขัดแย้ง' using errcode='40001';end if;return;end if;
 insert into ads.archive_fixture(fixture_id,document_type,label_th,sha256,byte_size,mime,filename,page_count,storage_key,pipeline_version,truth)
 values(metadata->>'fixture_id',metadata->>'document_type',metadata->>'label_th',metadata->>'sha256',(metadata->>'byte_size')::bigint,metadata->>'mime',metadata->>'filename',(metadata->>'page_count')::integer,metadata->>'storage_key',metadata->>'pipeline_version',truth);
end $$;

create function ads.archive_validate(fixture text,result jsonb) returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare f ads.archive_fixture;issues jsonb:='[]';r jsonb;expected jsonb;key text;page_no integer;debits numeric:=0;credits numeric:=0;net numeric:=0;control numeric;counts jsonb:='[]';amount numeric;
begin
 select * into f from ads.archive_fixture where fixture_id=fixture;
 if not found or jsonb_typeof(result) is distinct from 'object' then return jsonb_build_object('valid',false,'issues',jsonb_build_array(jsonb_build_object('code','INVALID_RESULT')));end if;
 if exists(select 1 from jsonb_object_keys(result) k where k not in('pages','fields','field_sources','rows','controls')) or jsonb_typeof(result->'pages') is distinct from 'array' or jsonb_typeof(result->'fields') is distinct from 'object' or jsonb_typeof(result->'field_sources') is distinct from 'object' or jsonb_typeof(result->'rows') is distinct from 'array' or jsonb_typeof(result->'controls') is distinct from 'object' then return jsonb_build_object('valid',false,'issues',jsonb_build_array(jsonb_build_object('code','INVALID_RESULT_STRUCTURE')));end if;
 if jsonb_array_length(result->'pages')<>f.page_count or(select count(distinct (x->>'page')::integer) from jsonb_array_elements(result->'pages') x)<>f.page_count then issues:=issues||'[{"code":"PAGE_COUNT_MISMATCH"}]';end if;
 for r in select value from jsonb_array_elements(result->'pages') loop
 if(r->>'page')::integer not between 1 and f.page_count or r->>'page' is null or r->>'method' is null or r->>'method' not in('TEXT','OCR') or jsonb_typeof(r->'text') is distinct from 'string' or(r->>'confidence' is not null and(r->>'confidence')::numeric not between 0 and 1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_PAGE','page',r->'page'));end if;end loop;
 if f.document_type='E_MEMO' then
 if result->'fields' is distinct from f.truth->'fields' then issues:=issues||'[{"code":"MEMO_FIELDS_MISMATCH"}]';end if;
 if result->'rows'<>'[]'::jsonb or result->'controls'<>'{}'::jsonb then issues:=issues||'[{"code":"MEMO_CONTAINS_STATEMENT_DATA"}]';end if;
 for key in select jsonb_object_keys(result->'fields') loop
 r:=result#>array['field_sources',key];
 if r is null or(r->>'page')::integer not between 1 and f.page_count or r->>'page' is null or(r->>'confidence' is not null and(r->>'confidence')::numeric not between 0 and 1) or(f.truth#>>array['field_sources',key,'page'] is not null and r->>'page' is distinct from f.truth#>>array['field_sources',key,'page']) then issues:=issues||jsonb_build_array(jsonb_build_object('code','FIELD_SOURCE_MISSING','field',key));end if;end loop;
 else
 if result->'fields'<>'{}'::jsonb or result->'field_sources'<>'{}'::jsonb then issues:=issues||'[{"code":"STATEMENT_CONTAINS_MEMO_FIELDS"}]';end if;
 if result#>>'{controls,meaning}' is distinct from 'NET_CHARGES' then issues:=issues||'[{"code":"CONTROL_MEANING_UNCONFIRMED"}]';end if;
 for key in select jsonb_object_keys(f.truth->'controls') loop if result#>array['controls',key] is distinct from f.truth#>array['controls',key] then issues:=issues||jsonb_build_array(jsonb_build_object('code','CONTROL_MISMATCH','field',key));end if;end loop;
 if jsonb_array_length(result->'rows')<>jsonb_array_length(f.truth->'rows') then issues:=issues||'[{"code":"ROW_COUNT_MISMATCH"}]';end if;
 if(select count(distinct (x->>'page',x->>'occurrence')) from jsonb_array_elements(result->'rows') x)<>jsonb_array_length(result->'rows') then issues:=issues||'[{"code":"DUPLICATE_OCCURRENCE"}]';end if;
 for r in select value from jsonb_array_elements(result->'rows') loop
 select value into expected from jsonb_array_elements(f.truth->'rows') x where x.value->>'page'=r->>'page' and x.value->>'occurrence'=r->>'occurrence';
 if expected is null or r is distinct from expected then issues:=issues||jsonb_build_array(jsonb_build_object('code','ROW_SOURCE_MISMATCH','page',r->'page','occurrence',r->'occurrence'));end if;
 if jsonb_typeof(r->'amount') is distinct from 'string' or r->>'amount' !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_AMOUNT','page',r->'page','occurrence',r->'occurrence'));
 else amount:=(r->>'amount')::numeric;if amount<0 then credits:=credits-amount;else debits:=debits+amount;end if;end if;
 end loop;
 for page_no in 1..f.page_count loop
 counts:=counts||jsonb_build_array(jsonb_build_object('page',page_no,'count',(select count(*) from jsonb_array_elements(result->'rows') x where(x->>'page')::integer=page_no)));
 if(select count(*) from jsonb_array_elements(result->'rows') x where(x->>'page')::integer=page_no)<>(select count(*) from jsonb_array_elements(f.truth->'rows') x where(x->>'page')::integer=page_no) then issues:=issues||jsonb_build_array(jsonb_build_object('code','PAGE_ROW_COUNT_MISMATCH','page',page_no));end if;end loop;
 net:=debits-credits;
 if result#>>'{controls,statement_total}' ~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then control:=(result#>>'{controls,statement_total}')::numeric;end if;
 if control is null or net<>control then issues:=issues||'[{"code":"NET_TOTAL_MISMATCH"}]';end if;
 end if;
 return jsonb_build_object('valid',issues='[]'::jsonb,'issues',issues,'debit_total',debits::text,'credit_total',credits::text,'net_total',net::text,'statement_total',control::text,'difference',(net-control)::text,'row_count',jsonb_array_length(result->'rows'),'page_counts',counts);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
 return jsonb_build_object('valid',false,'issues',jsonb_build_array(jsonb_build_object('code','INVALID_TYPED_RESULT')));
end $$;

create function ads.archive_fixtures() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_actor(array['online_staff','admin']);return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('fixture_id',fixture_id,'document_type',document_type,'label_th',label_th,'page_count',page_count,'filename',filename) order by fixture_id) from ads.archive_fixture),'[]'));end $$;

create function ads.archive_read(p_id uuid default null,filters jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin
 -- Worker may receive its finished job's detail through archive_finish; no direct read grant.
 perform hub.require_actor(array['online_staff','admin','ads_document_worker']);
 if p_id is null then
 return jsonb_build_object('items',coalesce((select jsonb_agg(ads.archive_read(d.id) order by d.updated_at desc,d.id) from(select d.* from ads.archive_document d left join ads.archive_job j on j.version_id=d.current_version_id left join ads.archive_confirmation c on c.version_id=d.current_version_id where(filters->>'document_type' is null or d.document_type=filters->>'document_type') and(filters->>'status' is null or j.status=filters->>'status') and(filters->>'bud' is null or c.corrected_result#>>'{fields,requesting_bud}'=filters->>'bud') and(filters->>'month' is null or to_char((c.corrected_result#>>'{fields,period_start}')::date,'YYYY-MM')=left(filters->>'month',7) or to_char((c.corrected_result#>>'{controls,cycle_start}')::date,'YYYY-MM')=left(filters->>'month',7)) order by d.updated_at desc,d.id limit least(coalesce((filters->>'limit')::integer,50),100) offset coalesce((filters->>'offset')::integer,0)) d),'[]'),
 'total',(select count(*) from ads.archive_document d left join ads.archive_job j on j.version_id=d.current_version_id left join ads.archive_confirmation c on c.version_id=d.current_version_id where(filters->>'document_type' is null or d.document_type=filters->>'document_type') and(filters->>'status' is null or j.status=filters->>'status') and(filters->>'bud' is null or c.corrected_result#>>'{fields,requesting_bud}'=filters->>'bud') and(filters->>'month' is null or to_char((c.corrected_result#>>'{fields,period_start}')::date,'YYYY-MM')=left(filters->>'month',7) or to_char((c.corrected_result#>>'{controls,cycle_start}')::date,'YYYY-MM')=left(filters->>'month',7))));end if;
 select to_jsonb(d)||jsonb_build_object('versions',coalesce((select jsonb_agg(to_jsonb(v)-'received_by' order by version_no desc) from ads.archive_version v where v.document_id=d.id),'[]'),
 'current_version',(select to_jsonb(v)-'received_by' from ads.archive_version v where v.id=d.current_version_id),
 'job',(select to_jsonb(j)-'lease_token'-'worker_id' from ads.archive_job j where j.version_id=d.current_version_id),
 'extraction',(select to_jsonb(e) from ads.archive_extraction e join ads.archive_job j on j.id=e.job_id where j.version_id=d.current_version_id),
 'confirmation',(select to_jsonb(c) from ads.archive_confirmation c where c.version_id=d.current_version_id),
 'application',(select to_jsonb(a)-'request_payload' from ads.archive_application a where a.version_id=d.current_version_id)) into result from ads.archive_document d where id=p_id;
 if result is null then raise exception 'ไม่พบเอกสารที่มีสิทธิ์เข้าถึง' using errcode='P0002';end if;return result;
end $$;

create function ads.archive_receive(p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;f ads.archive_fixture;d ads.archive_document;v ads.archive_version;status text;begin
 perform hub.residential_local();actor:=hub.require_actor(array['online_staff','admin']);
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in('fixture_id','document_id','expected_revision')) then raise exception 'รับได้เฉพาะเอกสารตัวอย่างที่กำหนด' using errcode='22023';end if;
 perform pg_advisory_xact_lock(1560022);select * into f from ads.archive_fixture where fixture_id=p->>'fixture_id';
 if not found then raise exception 'ยังไม่อนุญาตให้นำเข้าเอกสารนี้' using errcode='42501';end if;
 select * into v from ads.archive_version where sha256=f.sha256;
 if found then
 if p->>'document_id' is not null and(p->>'document_id')::uuid<>v.document_id then raise exception 'เอกสารเดิมผูกกับตัวตนอื่นแล้ว' using errcode='40001';end if;
 select * into d from ads.archive_document where id=v.document_id for update;
 if d.legal_hold then raise exception 'เอกสารถูกระงับการประมวลผล' using errcode='23514';end if;
 insert into ads.archive_receipt(version_id,received_by,receipt_status) values(v.id,actor,'NOOP');return ads.archive_read(d.id)||jsonb_build_object('receipt_status','NOOP','received_version_id',v.id);
 end if;
 if p->>'document_id' is null then
 insert into ads.archive_document(document_type,label_th,created_by,updated_by) values(f.document_type,f.label_th,actor,actor) returning * into d;status:='CREATED';
 else
 select * into d from ads.archive_document where id=(p->>'document_id')::uuid for update;
 if not found then raise exception 'ไม่พบเอกสาร' using errcode='P0002';end if;
 if d.revision is distinct from(p->>'expected_revision')::integer then raise exception 'เอกสารเปลี่ยนแล้ว' using errcode='40001';end if;
 if d.document_type<>f.document_type then raise exception 'ชนิดเอกสารเปลี่ยนไม่ได้' using errcode='23514';end if;
 if d.legal_hold then raise exception 'เอกสารถูกระงับการประมวลผล' using errcode='23514';end if;status:='NEW_VERSION';end if;
 insert into ads.archive_version(document_id,version_no,fixture_id,sha256,byte_size,mime,filename,page_count,storage_key,received_by)
 select d.id,coalesce(max(version_no),0)+1,f.fixture_id,f.sha256,f.byte_size,f.mime,f.filename,f.page_count,f.storage_key,actor from ads.archive_version where document_id=d.id returning * into v;
 update ads.archive_document set current_version_id=v.id,label_th=f.label_th,revision=revision+case when status='NEW_VERSION' then 1 else 0 end,updated_by=actor,updated_at=clock_timestamp() where id=d.id;
 insert into ads.archive_job(version_id,pipeline_version) values(v.id,f.pipeline_version);
 insert into ads.archive_receipt(version_id,received_by,receipt_status) values(v.id,actor,status);
 return ads.archive_read(d.id)||jsonb_build_object('receipt_status',status,'received_version_id',v.id);
end $$;

create function ads.archive_claim(worker_id text,lease_seconds integer default 120) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d ads.archive_document;j ads.archive_job;v ads.archive_version;token uuid;begin
 perform hub.residential_local();perform hub.require_actor(array['admin','ads_document_worker']);
 if worker_id is null or length(worker_id) not between 1 and 100 or lease_seconds not between 10 and 300 or lease_seconds is null then raise exception 'ข้อมูลตัวประมวลผลไม่ถูกต้อง' using errcode='22023';end if;
 -- Exhausted leases become explicit failures, rather than remaining RUNNING forever.
 for d in select doc.* from ads.archive_document doc join ads.archive_job job on job.version_id=doc.current_version_id where not doc.legal_hold and job.status='RUNNING' and job.attempt>=5 and job.lease_until<=clock_timestamp() order by job.id for update of doc skip locked limit 100 loop
 select * into j from ads.archive_job where version_id=d.current_version_id for update;
 update ads.archive_attempt set outcome='LEASE_EXPIRED',finished_at=clock_timestamp(),safe_error='LEASE_EXPIRED' where job_id=j.id and attempt=j.attempt and outcome is null;
 update ads.archive_job set status='FAILED',lease_token=null,lease_until=null,safe_error='LEASE_EXPIRED',updated_at=clock_timestamp() where id=j.id;
 update ads.archive_document set revision=revision+1,updated_at=clock_timestamp() where id=d.id;
 end loop;
 select doc.* into d from ads.archive_document doc join ads.archive_job job on job.version_id=doc.current_version_id
 where not doc.legal_hold and job.attempt<5 and(job.status in('QUEUED','RETRY') or(job.status='RUNNING' and job.lease_until<clock_timestamp())) order by job.created_at,job.id for update of doc skip locked limit 1;
 if not found then return null;end if;
 select * into j from ads.archive_job where version_id=d.current_version_id for update;
 if j.status='RUNNING' then update ads.archive_attempt set outcome='LEASE_EXPIRED',finished_at=clock_timestamp(),safe_error='LEASE_EXPIRED' where job_id=j.id and attempt=j.attempt and outcome is null;end if;
 token:=gen_random_uuid();
 update ads.archive_job set status='RUNNING',attempt=attempt+1,worker_id=archive_claim.worker_id,lease_token=token,lease_until=clock_timestamp()+make_interval(secs=>lease_seconds),safe_error=null,updated_at=clock_timestamp() where id=j.id returning * into j;
 insert into ads.archive_attempt(job_id,attempt,lease_token,worker_id,started_at) values(j.id,j.attempt,token,worker_id,clock_timestamp());
 update ads.archive_document set revision=revision+1,updated_at=clock_timestamp() where id=d.id;
 select * into v from ads.archive_version where id=d.current_version_id;
 return jsonb_build_object('job_id',j.id,'document_id',d.id,'version_id',v.id,'document_type',d.document_type,'fixture_id',v.fixture_id,'sha256',v.sha256,'storage_key',v.storage_key,'byte_size',v.byte_size,'page_count',v.page_count,'pipeline_version',j.pipeline_version,'attempt',j.attempt,'lease_token',token,'lease_until',j.lease_until);
end $$;

create function ads.archive_heartbeat(job_id uuid,lease_token uuid) returns timestamptz language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d ads.archive_document;j ads.archive_job;expires timestamptz;begin
 perform hub.residential_local();perform hub.require_actor(array['admin','ads_document_worker']);
 select doc.* into d from ads.archive_document doc join ads.archive_version v on v.document_id=doc.id join ads.archive_job job on job.version_id=v.id where job.id=job_id for update of doc;
 select * into j from ads.archive_job where id=job_id for update;
 if j.id is null or d.legal_hold or d.current_version_id<>j.version_id or j.status<>'RUNNING' or j.lease_token is distinct from archive_heartbeat.lease_token or j.lease_until<=clock_timestamp() then raise exception 'สิทธิ์ประมวลผลหมดอายุหรือเอกสารเปลี่ยนแล้ว' using errcode='40001';end if;
 expires:=clock_timestamp()+interval '120 seconds';update ads.archive_job set lease_until=expires,updated_at=clock_timestamp() where id=j.id;return expires;
end $$;

create function ads.archive_finish(job_id uuid,lease_token uuid,result jsonb,error_code text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d ads.archive_document;j ads.archive_job;v ads.archive_version;checks jsonb;begin
 perform hub.residential_local();perform hub.require_actor(array['admin','ads_document_worker']);
 select doc.* into d from ads.archive_document doc join ads.archive_version version on version.document_id=doc.id join ads.archive_job job on job.version_id=version.id where job.id=job_id for update of doc;
 select * into j from ads.archive_job where id=job_id for update;
 if j.id is null or d.legal_hold or d.current_version_id<>j.version_id or j.status<>'RUNNING' or j.lease_token is distinct from archive_finish.lease_token or j.lease_until<=clock_timestamp() then raise exception 'สิทธิ์ประมวลผลหมดอายุหรือเอกสารเปลี่ยนแล้ว' using errcode='40001';end if;
 if error_code is not null and error_code not in('OCR_UNAVAILABLE','OCR_FAILED','PDF_INVALID','EXTRACTION_FAILED','ENGINE_UNAVAILABLE','LOCAL_OCR_UNAVAILABLE','LEASE_EXPIRED') then raise exception 'รหัสข้อผิดพลาดไม่ถูกต้อง' using errcode='22023';end if;
 if error_code is null then
 if result is null or octet_length(result::text)>2097152 then raise exception 'ผลถอดข้อมูลไม่ถูกต้องหรือใหญ่เกินขนาด' using errcode='22023';end if;
 select * into v from ads.archive_version where id=j.version_id;checks:=ads.archive_validate(v.fixture_id,result);
 insert into ads.archive_extraction(job_id,original_result,validation) values(j.id,result,checks);
 end if;
 update ads.archive_job set status=case when error_code is null then 'DRAFT' else 'FAILED' end,safe_error=error_code,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 update ads.archive_attempt set outcome=case when error_code is null then 'DRAFT' else 'FAILED' end,safe_error=error_code,finished_at=clock_timestamp() where archive_attempt.job_id=j.id and attempt=j.attempt;
 update ads.archive_document set revision=revision+1,updated_at=clock_timestamp() where id=d.id;
 return ads.archive_read(d.id);
end $$;

create function ads.archive_access(p jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;receipt uuid;begin
 perform hub.residential_local();actor:=hub.require_actor(array['admin']);
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in('action','outcome','original_role','original_actor_id','document_id','version_id','page','request_id','bytes'))
 or p->>'action' is null or p->>'action' not in('LIST','DETAIL','SEARCH','PREVIEW','DOWNLOAD','RECEIVE','RETRY','CONFIRM','APPLY','HOLD')
 or p->>'outcome' is null or p->>'outcome' not in('ALLOWED','DENIED','SERVED','PARTIAL','FAILED')
 or p->>'original_role' is null or p->>'original_role' not in('admin','online_staff','editor','publisher','viewer','agency','service_consumer','anonymous')
 or(p->>'original_actor_id' is not null and(p->>'original_actor_id')::uuid<>actor)
 or(p->>'bytes' is not null and(p->>'bytes')::bigint<0) or(p->>'page' is not null and(p->>'page')::integer<1) then raise exception 'ข้อมูลการเข้าถึงไม่ถูกต้อง' using errcode='22023';end if;
 insert into audit.archive_access(action,outcome,original_role,original_actor_id,document_id,version_id,page,request_id,bytes)
 values(p->>'action',p->>'outcome',p->>'original_role',(p->>'original_actor_id')::uuid,(p->>'document_id')::uuid,(p->>'version_id')::uuid,(p->>'page')::integer,(p->>'request_id')::uuid,(p->>'bytes')::bigint) returning id into receipt;return receipt;
end $$;

create function ads.archive_command(action text,p_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;d ads.archive_document;v ads.archive_version;j ads.archive_job;e ads.archive_extraction;c ads.archive_confirmation;a ads.archive_application;
 checks jsonb;allowed text[];data jsonb;fields jsonb;target jsonb;rows jsonb:='[]';r jsonb;row_no integer:=0;target_id uuid;target_type text;statement_id uuid;observed text;memo ads.memo;batch staging.ads_card_batch;s ads.card_statement_control;source_rows jsonb;existing_rows jsonb;
begin
 perform hub.residential_local();actor:=hub.require_actor(case when action='hold' then array['admin'] else array['online_staff','admin'] end);
 allowed:=case action when 'retry' then array['expected_revision','expected_version_id','reason'] when 'hold' then array['expected_revision','held','reason']
 when 'confirm' then array['expected_revision','expected_version_id','expected_job_id','corrected_result','evidence']
 when 'apply' then array['expected_revision','expected_version_id','expected_job_id','mode','target_id','expected_target_version','reason','request_id'] end;
 if allowed is null or jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then raise exception 'ข้อมูลคำขอไม่ถูกต้อง' using errcode='22023';end if;
 select * into d from ads.archive_document where id=p_id for update;
 if not found then raise exception 'ไม่พบเอกสาร' using errcode='P0002';end if;
 select * into v from ads.archive_version where id=d.current_version_id;
 select * into j from ads.archive_job where version_id=v.id for update;
 if action='apply' then
 select * into a from ads.archive_application where version_id=v.id;
 if found then if a.request_payload=p then return ads.archive_read(d.id)||'{"operation_status":"NOOP"}'::jsonb;else raise exception 'เอกสารฉบับนี้เชื่อมแล้ว กรุณาตรวจใบรับรายการเดิม' using errcode='40001';end if;end if;
 end if;
 if action='confirm' then
 select * into c from ads.archive_confirmation where version_id=v.id;
 if found and not d.legal_hold and c.corrected_result=p->'corrected_result' and c.evidence=p->>'evidence' and c.job_id=(p->>'expected_job_id')::uuid and v.id=(p->>'expected_version_id')::uuid then return ads.archive_read(d.id)||'{"operation_status":"NOOP"}'::jsonb;end if;
 end if;
 if d.revision is distinct from(p->>'expected_revision')::integer or(action<>'hold' and v.id is distinct from(p->>'expected_version_id')::uuid) or(action in('confirm','apply') and j.id is distinct from(p->>'expected_job_id')::uuid) then raise exception 'เอกสารหรือผลถอดข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
 if action<>'hold' and d.legal_hold then raise exception 'เอกสารถูกระงับการประมวลผล' using errcode='23514';end if;
 perform set_config('app.change_reason',coalesce(p->>'reason',p->>'evidence'),true);
 if action='hold' then
 if jsonb_typeof(p->'held') is distinct from 'boolean' or nullif(btrim(p->>'reason'),'') is null then raise exception 'ต้องระบุสถานะและเหตุผลการระงับเอกสาร' using errcode='22023';end if;
 update ads.archive_document set legal_hold=(p->>'held')::boolean,hold_reason=p->>'reason' where id=d.id;
 elsif action='retry' then
 if nullif(btrim(p->>'reason'),'') is null or j.attempt>=5 or not(j.status='FAILED' or(j.status='RUNNING' and j.lease_until<=clock_timestamp())) then raise exception 'งานนี้ยังไม่พร้อมลองใหม่หรือเกินจำนวนครั้งที่กำหนด' using errcode='23514';end if;
 if j.status='RUNNING' then update ads.archive_attempt set outcome='LEASE_EXPIRED',safe_error='LEASE_EXPIRED',finished_at=clock_timestamp() where job_id=j.id and attempt=j.attempt and outcome is null;end if;
 update ads.archive_job set status='RETRY',lease_token=null,lease_until=null,safe_error=null,updated_at=clock_timestamp() where id=j.id;
 elsif action='confirm' then
 if j.status<>'DRAFT' or nullif(btrim(p->>'evidence'),'') is null then raise exception 'ต้องตรวจทานผลฉบับร่างและระบุหลักฐานก่อนยืนยัน' using errcode='23514';end if;
 select * into e from ads.archive_extraction where job_id=j.id;
 if p#>'{corrected_result,pages}' is distinct from e.original_result->'pages' then raise exception 'ห้ามเขียนทับหน้าข้อความต้นฉบับ ให้แก้เฉพาะค่าที่ถอดพร้อมหลักฐาน' using errcode='23514';end if;
 if p#>'{corrected_result,field_sources}' is distinct from e.original_result->'field_sources' then raise exception 'ห้ามแก้หลักฐานการถอดข้อมูลหรือคะแนนจากเครื่องมือ ให้แก้เฉพาะค่าพร้อมหลักฐานตรวจทาน' using errcode='23514';end if;
 checks:=ads.archive_validate(v.fixture_id,p->'corrected_result');
 if not(checks->>'valid')::boolean then raise exception 'จำนวนรายการ ยอดเงิน หรือข้อมูลยังไม่ตรงหลักฐาน' using errcode='23514',detail=checks::text;end if;
 insert into ads.archive_confirmation(version_id,job_id,extraction_id,corrected_result,validation,evidence,confirmed_by) values(v.id,j.id,e.id,p->'corrected_result',checks,p->>'evidence',actor) returning * into c;
 update ads.archive_job set status='CONFIRMED',updated_at=clock_timestamp() where id=j.id;
 if d.document_type='E_MEMO' then
 -- Index only the reviewed identifier and subject, never raw pages, signatures or approvers.
 insert into ads.archive_memo_chunk(version_id,confirmation_id,page,body) values(v.id,c.id,(c.corrected_result#>>'{field_sources,subject,page}')::integer,(c.corrected_result#>>'{fields,memo_no}')||E'\n'||(c.corrected_result#>>'{fields,subject}'));
 end if;
 elsif action='apply' then
 if j.status<>'CONFIRMED' or nullif(btrim(p->>'reason'),'') is null or p->>'request_id' is null then raise exception 'ต้องยืนยันข้อมูลที่ถอดและระบุเหตุผลก่อนเชื่อมรายการ' using errcode='23514';end if;
 -- Respect P2's shared lock before taking any P2 row lock or invoking its commands.
 perform pg_advisory_xact_lock(1560015);
 select * into c from ads.archive_confirmation where version_id=v.id;data:=c.corrected_result;fields:=data->'fields';
 if d.document_type='E_MEMO' then
 if p->>'mode' is null or p->>'mode' not in('MEMO_CREATE','MEMO_UPDATE','LINK_MEMO') then raise exception 'วิธีเชื่อมบันทึกข้อความไม่ถูกต้อง' using errcode='22023';end if;
 observed:=fields->>'memo_no';
 if p->>'mode'='MEMO_CREATE' then
 if p->>'target_id' is not null or exists(select 1 from ads.memo_identifier where identifier=observed and status in('CONFIRMED','PROPOSED')) then raise exception 'เลขบันทึกข้อความมีรายการอยู่แล้ว ให้ตรวจสอบการเชื่อม' using errcode='40001';end if;
 target:=ads.finance_command('memo_create',ads.finance_pick(fields,array['memo_no','subject','requesting_bud','gross_amount','mirrored_status','approval_date'])||jsonb_build_object('evidence_ref','ARCHIVE:'||v.id::text));
 else
 select * into memo from ads.memo where id=(p->>'target_id')::uuid for update;
 if memo.id is null or memo.row_version is distinct from(p->>'expected_target_version')::integer then raise exception 'บันทึกข้อความปลายทางเปลี่ยนแล้ว' using errcode='40001';end if;
 if not exists(select 1 from ads.memo_identifier where memo_id=memo.id and identifier=observed and status='CONFIRMED') then raise exception 'เลขที่ไม่ตรงหรือชื่ออ้างอิงยังไม่ยืนยัน ห้ามรวมเลขต่างรายการ' using errcode='23514';end if;
 if p->>'mode'='MEMO_UPDATE' then
 target:=ads.finance_command('memo_update',ads.finance_pick(fields,array['subject','requesting_bud','gross_amount','mirrored_status','approval_date'])||jsonb_build_object('id',memo.id,'expected_version',memo.row_version,'evidence_ref','ARCHIVE:'||v.id::text));
 else
 if memo.gross_amount<>(fields->>'gross_amount')::numeric or memo.requesting_bud<>fields->>'requesting_bud' or memo.mirrored_status<>fields->>'mirrored_status' or memo.approval_date is distinct from(fields->>'approval_date')::date then raise exception 'ข้อมูลที่ยืนยันไม่ตรงบันทึกข้อความปลายทาง' using errcode='23514';end if;
 target:=ads.finance_read('memos',memo.id::text);end if;
 end if;target_type:='MEMO';
 else
 if p->>'mode' is null or p->>'mode' not in('CARD_CREATE','LINK_CARD') then raise exception 'วิธีเชื่อมใบแจ้งยอดไม่ถูกต้อง' using errcode='22023';end if;
 if p->>'mode'='CARD_CREATE' then
 if p->>'target_id' is not null or exists(select 1 from ads.archive_application app join ads.archive_version oldv on oldv.id=app.version_id where oldv.document_id=d.id) then raise exception 'เอกสารนี้มีชุดค่าใช้จ่ายแล้ว ต้องใช้การเชื่อมหรือขั้นตอนแทนที่เดิม' using errcode='40001';end if;
 target:=ads.finance_command('statement_create',jsonb_build_object('operator_ref','ARCHIVE:'||d.id::text,'issuer',data#>>'{controls,issuer}','cycle_start',data#>>'{controls,cycle_start}','cycle_end',data#>>'{controls,cycle_end}','due_date',data#>>'{controls,due_date}','declared_total',data#>>'{controls,statement_total}','total_meaning','NET_CHARGES','review_status','CONFIRMED','evidence_ref','ARCHIVE:'||v.id::text));statement_id:=(target->>'id')::uuid;
 for r in select value from jsonb_array_elements(data->'rows') order by(value->>'page')::integer,(value->>'occurrence')::integer loop
 row_no:=row_no+1;rows:=rows||jsonb_build_array(jsonb_build_object('row_no',row_no,'row_hash',encode(sha256(convert_to(r::text,'UTF8')),'hex'),'raw_row',r,'amount',abs((r->>'amount')::numeric)::text,'direction',case when(r->>'amount')::numeric<0 then 'CREDIT' else 'DEBIT' end,'charge_date',r->>'charge_date','posting_date',null,'cost_type',r->>'cost_type','category',r->>'cost_type','detail',r->>'descriptor','payment_method','CORPORATE_CARD','bud',null,'memo_no',null,'account_id',null,'platform',null));end loop;
 target:=ads.finance_command('card_import',jsonb_build_object('source_fingerprint',encode(sha256(convert_to('archive:'||v.id::text,'UTF8')),'hex'),'statement_control_id',statement_id,'logical_source_id','ARCHIVE:'||d.id::text,'source_file','SYNTHETIC-ARCHIVE','tab','CONFIRMED_TRANSCRIPTION','profile_id','archive-local-synthetic','profile_version',j.pipeline_version,'provenance',jsonb_build_object('archive_version_id',v.id,'confirmation_id',c.id,'synthetic_only',true),'issues','[]'::jsonb,'rows',rows));
 if target->>'status' is distinct from 'APPLIED_DRAFT' then raise exception 'ชุดค่าใช้จ่ายยังไม่ผ่านการตรวจนำเข้า' using errcode='23514';end if;
 else
 select * into batch from staging.ads_card_batch where id=(p->>'target_id')::uuid for update;
 if batch.id is null or batch.row_version is distinct from(p->>'expected_target_version')::integer then raise exception 'ชุดค่าใช้จ่ายปลายทางเปลี่ยนแล้ว' using errcode='40001';end if;
 select * into s from ads.card_statement_control where id=batch.statement_control_id for update;
 if batch.status not in('APPLIED_DRAFT','CONFIRMED') or batch.net_total<>(data#>>'{controls,statement_total}')::numeric or s.total_meaning<>'NET_CHARGES' or s.declared_total<>batch.net_total or s.cycle_start is distinct from(data#>>'{controls,cycle_start}')::date or s.cycle_end is distinct from(data#>>'{controls,cycle_end}')::date then raise exception 'ชุดค่าใช้จ่ายไม่ตรงกับใบแจ้งยอด' using errcode='23514';end if;
 select jsonb_agg(x.item order by x.item::text) into source_rows from(select jsonb_build_array(rw->>'charge_date',(rw->>'amount')::numeric,rw->>'descriptor') item from jsonb_array_elements(data->'rows') rw) x;
 select jsonb_agg(x.item order by x.item::text) into existing_rows from(select jsonb_build_array(charge_date::text,case when direction='CREDIT' then -amount else amount end,typed_row->>'detail') item from staging.ads_card_row where batch_id=batch.id) x;
 if source_rows is distinct from existing_rows then raise exception 'จำนวนหรือรายละเอียดแต่ละรายการไม่ตรง ห้ามเชื่อมโดยยอดรวมอย่างเดียว' using errcode='23514';end if;
 target:=ads.finance_read('card-imports',batch.id::text);
 end if;target_type:='CARD_BATCH';
 end if;
 target_id:=(target->>'id')::uuid;
 insert into ads.archive_application(version_id,confirmation_id,request_id,request_payload,mode,target_type,target_id,target_version,applied_by) values(v.id,c.id,(p->>'request_id')::uuid,p,p->>'mode',target_type,target_id,(target->>'row_version')::integer,actor);
 end if;
 update ads.archive_document set revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=d.id;
 return ads.archive_read(d.id)||'{"operation_status":"APPLIED"}'::jsonb;
end $$;

create function ads.archive_search(query text,filters jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare items jsonb:='[]';r record;total integer:=0;off integer:=greatest(coalesce((filters->>'offset')::integer,0),0);lim integer:=least(greatest(coalesce((filters->>'limit')::integer,50),1),100);begin
 perform hub.require_actor(array['online_staff','admin']);
 if query is null or length(query)>300 then raise exception 'ข้อความค้นหาไม่ถูกต้อง' using errcode='22023';end if;
 for r in select d.id document_id,v.id version_id,v.version_no,ch.page,m.id memo_id,m.memo_no,m.subject,m.requesting_bud bud,m.gross_amount::text gross_amount,m.approval_date,m.record_status memo_record_status,
 left(ch.body,500) snippet,c.confirmed_at,coalesce((select identifier from ads.memo_identifier where memo_id=m.id and status='CONFIRMED' and lower(identifier)=lower(btrim(query)) limit 1),m.memo_no) matched_identifier,
 case when exists(select 1 from ads.memo_identifier where memo_id=m.id and status='CONFIRMED' and lower(identifier)=lower(btrim(query))) then 1 else 2 end match_rank
 from ads.archive_document d join ads.archive_version v on v.id=d.current_version_id join ads.archive_job j on j.version_id=v.id and j.status='CONFIRMED'
 join ads.archive_confirmation c on c.version_id=v.id join ads.archive_memo_chunk ch on ch.version_id=v.id and ch.confirmation_id=c.id
 join ads.archive_application a on a.version_id=v.id and a.target_type='MEMO' join ads.memo m on m.id=a.target_id
 where d.document_type='E_MEMO' and not d.legal_hold and ch.namespace='internal_memo' and not ch.is_public
 and m.gross_amount=(c.corrected_result#>>'{fields,gross_amount}')::numeric and m.requesting_bud=c.corrected_result#>>'{fields,requesting_bud}'
 and m.mirrored_status=c.corrected_result#>>'{fields,mirrored_status}' and m.approval_date is not distinct from(c.corrected_result#>>'{fields,approval_date}')::date
 and exists(select 1 from ads.memo_identifier identifier where identifier.memo_id=m.id and identifier.identifier=c.corrected_result#>>'{fields,memo_no}' and identifier.status='CONFIRMED')
 and(filters->>'bud' is null or m.requesting_bud=filters->>'bud') and(filters->>'series' is null or m.series=filters->>'series')
 and(filters->>'month' is null or to_char((c.corrected_result#>>'{fields,period_start}')::date,'YYYY-MM')=left(filters->>'month',7))
 and(btrim(query)='' or ch.body ilike '%'||replace(replace(replace(query,'\','\\'),'%','\%'),'_','\_')||'%' escape '\' or exists(select 1 from ads.memo_identifier where memo_id=m.id and status='CONFIRMED' and lower(identifier)=lower(btrim(query))))
 order by match_rank,c.confirmed_at desc,d.id,ch.page loop
 total:=total+1;if total>off and jsonb_array_length(items)<lim then items:=items||jsonb_build_array(to_jsonb(r)-'match_rank');end if;end loop;
 return jsonb_build_object('items',items,'total',total);
end $$;

do $$ declare obj regclass;f regprocedure;begin
 for obj in select c.oid::regclass from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and((n.nspname='ads' and c.relname like 'archive_%') or(n.nspname='audit' and c.relname='archive_access')) loop execute format('revoke all on %s from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer,ads_export_reader',obj);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ads' and p.proname like 'archive_%' loop execute format('revoke all on function %s from public',f);end loop;
end $$;
grant execute on function ads.archive_fixtures(),ads.archive_read(uuid,jsonb),ads.archive_receive(jsonb),ads.archive_command(text,uuid,jsonb),ads.archive_search(text,jsonb) to online_staff,admin;
grant execute on function ads.archive_claim(text,integer),ads.archive_heartbeat(uuid,uuid),ads.archive_finish(uuid,uuid,jsonb,text),ads.archive_access(jsonb) to admin;
grant execute on function ads.archive_claim(text,integer),ads.archive_heartbeat(uuid,uuid),ads.archive_finish(uuid,uuid,jsonb,text) to ads_document_worker;
comment on table ads.archive_memo_chunk is 'Restricted reviewed memo identifier/subject snippets only. Statement indexing is rejected by trigger; no raw pages or external embeddings.';
comment on table ads.archive_fixture is 'Server-owned exact synthetic hash allowlist and independent expected data. Never returned to the worker or browser.';
commit;
