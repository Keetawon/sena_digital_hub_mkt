-- Task 5: private actor-owned metadata and explicitly confirmed synthetic draft changes.
begin;
create table internal.assistant_run(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null, actor_role text not null check(actor_role in('editor','publisher','viewer','admin','online_staff')),
 mode text not null check(mode in('SYNTHETIC','LIVE_SYNTHETIC')),config_version text not null check(config_version ~ '^[A-Za-z0-9_.:-]{1,100}$'),
 scope_project_id text check(length(scope_project_id) between 1 and 100 and scope_project_id !~ '[[:cntrl:]]'),
 status text not null default 'RUNNING' check(status in('RUNNING','DONE','CANCELLED','ERROR')),created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 duration_ms integer check(duration_ms between 0 and 3600000),input_tokens integer check(input_tokens between 0 and 1000000),output_tokens integer check(output_tokens between 0 and 1000000),
 error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
create table internal.assistant_tool(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references internal.assistant_run,
 tool_name text not null check(tool_name in('get_project','find_projects','get_models','get_brand','check_publish_readiness','search_content','get_promotions','get_project_marketing','get_campaign','find_campaigns','get_line_actuals','explain_name','search_documents')),
 outcome text not null check(outcome in('SUCCESS','DENIED','NO_ANSWER','ERROR','CANCELLED')),duration_ms integer not null check(duration_ms between 0 and 3600000),created_at timestamptz not null default clock_timestamp()
);
create table internal.assistant_citation(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references internal.assistant_run,tool_id uuid not null references internal.assistant_tool,
 namespace text not null check(namespace in('internal_content','internal_ads','internal_memo')),
 entity_type text not null check(entity_type in('project','brand','model','promotion','campaign','media_line','memo','naming_rule')),
 entity_id text not null check(length(entity_id) between 1 and 200 and entity_id !~ '[[:cntrl:]]' and entity_id !~ '://'),
 version text not null check(length(version) between 1 and 100 and version !~ '[[:cntrl:]]' and version !~ '://'),
 page integer check(page between 1 and 1000),created_at timestamptz not null default clock_timestamp()
);
create table internal.assistant_proposal(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,actor_role text not null,run_id uuid references internal.assistant_run,
 entity_type text not null check(entity_type in('project','brand')),entity_id uuid not null,field_path text not null,
 expected_updated_at timestamptz not null,old_text text not null,new_text text not null check(length(btrim(new_text)) between 1 and 4000),
 rationale text not null default '' check(length(rationale)<=1000),citation_ids uuid[] not null default '{}',
 digest text not null check(digest ~ '^[0-9a-f]{64}$'),created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default(clock_timestamp()+interval '30 minutes'),
 check((entity_type='project' and field_path in('meta_title.th','meta_description.th')) or(entity_type='brand' and field_path='description.th')),
 check(actor_role in('editor','publisher','admin'))
);
create table internal.assistant_proposal_application(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null unique references internal.assistant_proposal,actor_id uuid not null,actor_role text not null,
 source_updated_at timestamptz not null,result_updated_at timestamptz not null,applied_at timestamptz not null default clock_timestamp()
);
create table audit.assistant_proposal_event(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references internal.assistant_proposal,actor_id uuid not null,actor_role text not null,
 action text not null check(action in('PROPOSED','APPLIED')),entity_type text not null,entity_id uuid not null,field_path text not null,source_updated_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index assistant_runs_by_actor on internal.assistant_run(actor_id,created_at desc);
create index assistant_tools_by_run on internal.assistant_tool(run_id,created_at);
create index assistant_citations_by_run on internal.assistant_citation(run_id);
create index assistant_proposals_by_actor on internal.assistant_proposal(actor_id,created_at desc);

do $$ declare s text;t text;begin
 foreach t in array array['assistant_run','assistant_tool','assistant_citation','assistant_proposal','assistant_proposal_application','assistant_proposal_event'] loop
 s:=case when t='assistant_proposal_event' then 'audit' else 'internal' end;
 execute format('alter table %I.%I enable row level security',s,t);
 execute format('alter table %I.%I force row level security',s,t);
 execute format('create trigger assistant_no_delete before delete on %I.%I for each row execute function hub.reject_version_change()',s,t);
 if t<>'assistant_run' then execute format('create trigger assistant_immutable before update on %I.%I for each row execute function hub.reject_version_change()',s,t);end if;
 -- Proposal text remains only in its protected diff, never duplicated into generic audit payloads.
 if t in('assistant_run','assistant_tool','assistant_citation','assistant_proposal_application') then
 execute format('create trigger assistant_audit after insert or update on %I.%I for each row execute function audit.record_change()',s,t);end if;
 end loop;
end $$;

-- No direct grants; ownership policies also fail closed if read access is added later.
create policy assistant_run_owner on internal.assistant_run for select using(actor_id=nullif(current_setting('app.actor_id',true),'')::uuid and actor_role=current_setting('role'));
create policy assistant_proposal_owner on internal.assistant_proposal for select using(actor_id=nullif(current_setting('app.actor_id',true),'')::uuid and actor_role=current_setting('role'));
create policy assistant_application_owner on internal.assistant_proposal_application for select using(actor_id=nullif(current_setting('app.actor_id',true),'')::uuid and actor_role=current_setting('role'));
create policy assistant_event_owner on audit.assistant_proposal_event for select using(actor_id=nullif(current_setting('app.actor_id',true),'')::uuid and actor_role=current_setting('role'));
create policy assistant_tool_owner on internal.assistant_tool for select using(exists(select 1 from internal.assistant_run r where r.id=run_id and r.actor_id=nullif(current_setting('app.actor_id',true),'')::uuid and r.actor_role=current_setting('role')));
create policy assistant_citation_owner on internal.assistant_citation for select using(exists(select 1 from internal.assistant_run r where r.id=run_id and r.actor_id=nullif(current_setting('app.actor_id',true),'')::uuid and r.actor_role=current_setting('role')));

create function internal.assistant_owned_run(p_id uuid) returns internal.assistant_run language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r internal.assistant_run;actor uuid;begin
 actor:=hub.require_actor(array['editor','publisher','viewer','admin','online_staff']);
 select * into r from internal.assistant_run where id=p_id and actor_id=actor and actor_role=current_setting('role');
 if r.id is null then raise exception 'ไม่พบการสนทนาที่คุณเข้าถึงได้' using errcode='P0002';end if;return r;
end $$;
create function internal.assistant_run_create(p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r internal.assistant_run;actor uuid;begin
 actor:=hub.require_actor(array['editor','publisher','viewer','admin','online_staff']);
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in('mode','config_version','scope_project_id')) then raise exception 'ข้อมูลเริ่มการสนทนาไม่ถูกต้อง' using errcode='22023';end if;
 insert into internal.assistant_run(actor_id,actor_role,mode,config_version,scope_project_id) values(actor,current_setting('role'),p->>'mode',p->>'config_version',p->>'scope_project_id') returning * into r;
 return to_jsonb(r);
end $$;
create function internal.assistant_run_read(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r internal.assistant_run;begin r:=internal.assistant_owned_run(p_id);
 return to_jsonb(r)||jsonb_build_object('tools',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from internal.assistant_tool t where t.run_id=r.id),'[]'),
 'citations',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from internal.assistant_citation c where c.run_id=r.id),'[]'));
end $$;
create function internal.assistant_run_finish(p_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r internal.assistant_run;begin r:=internal.assistant_owned_run(p_id);
 if jsonb_typeof(p) is distinct from 'object' or p->>'status' is null or p->>'status' not in('DONE','CANCELLED','ERROR')
 or exists(select 1 from jsonb_object_keys(p) k where k not in('status','duration_ms','usage','error_code'))
 or(p ? 'usage' and(jsonb_typeof(p->'usage') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p->'usage') k where k not in('input_tokens','output_tokens')))) then raise exception 'ข้อมูลปิดการสนทนาไม่ถูกต้อง' using errcode='22023';end if;
 select * into r from internal.assistant_run where id=p_id for update;
 if r.status<>'RUNNING' then
 if r.status is distinct from p->>'status' then raise exception 'การสนทนาสิ้นสุดแล้ว' using errcode='40001';end if;return to_jsonb(r);
 end if;
 update internal.assistant_run set status=p->>'status',finished_at=clock_timestamp(),duration_ms=(p->>'duration_ms')::integer,
 input_tokens=(p#>>'{usage,input_tokens}')::integer,output_tokens=(p#>>'{usage,output_tokens}')::integer,error_code=p->>'error_code' where id=p_id returning * into r;return to_jsonb(r);
end $$;
create function internal.assistant_tool_record(p_run_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r internal.assistant_run;t internal.assistant_tool;c internal.assistant_citation;source jsonb;citations jsonb:='[]';expected_namespace text;begin
 r:=internal.assistant_owned_run(p_run_id);
 select * into r from internal.assistant_run where id=p_run_id for update;
 if r.status<>'RUNNING' then raise exception 'การสนทนาสิ้นสุดแล้ว' using errcode='40001';end if;
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in('tool_name','outcome','duration_ms','sources'))
 or jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources')>30 then raise exception 'ข้อมูลบันทึกเครื่องมือไม่ถูกต้อง' using errcode='22023';end if;
 if(select count(*) from internal.assistant_tool where run_id=p_run_id)>=8 then raise exception 'ครบจำนวนเครื่องมือที่อนุญาตแล้ว' using errcode='54000';end if;
 expected_namespace:=case when p->>'tool_name' in('get_project','find_projects','get_models','get_brand','check_publish_readiness','search_content','get_promotions') then 'internal_content' when p->>'tool_name'='search_documents' then 'internal_memo' else 'internal_ads' end;
 if jsonb_array_length(p->'sources')>0 then
 if expected_namespace='internal_content' then perform hub.require_actor(array['editor','publisher','viewer','admin']);
 elsif p->>'tool_name'<>'explain_name' then perform hub.require_actor(array['online_staff','admin']);end if;end if;
 if p->>'outcome'<>'SUCCESS' and jsonb_array_length(p->'sources')<>0 then raise exception 'เครื่องมือที่ไม่สำเร็จไม่มีแหล่งอ้างอิง' using errcode='22023';end if;
 insert into internal.assistant_tool(run_id,tool_name,outcome,duration_ms) values(p_run_id,p->>'tool_name',p->>'outcome',(p->>'duration_ms')::integer) returning * into t;
 for source in select value from jsonb_array_elements(p->'sources') loop
 if jsonb_typeof(source) is distinct from 'object' or exists(select 1 from jsonb_object_keys(source) k where k not in('namespace','entity_type','entity_id','version','page'))
 or source->>'namespace' is distinct from expected_namespace
 or(expected_namespace='internal_content' and source->>'entity_type' not in('project','brand','model','promotion'))
 or(expected_namespace='internal_memo' and source->>'entity_type' is distinct from 'memo')
 or(expected_namespace='internal_ads' and source->>'entity_type' not in('campaign','media_line','naming_rule'))
 or(p->>'tool_name'='explain_name' and(source->>'entity_type' is distinct from 'naming_rule' or source->>'entity_id' is distinct from 'SENA-H' or source->>'version' is distinct from '1')) then raise exception 'แหล่งอ้างอิงไม่ตรงกับเครื่องมือ' using errcode='22023';end if;
 insert into internal.assistant_citation(run_id,tool_id,namespace,entity_type,entity_id,version,page) values(p_run_id,t.id,source->>'namespace',source->>'entity_type',source->>'entity_id',source->>'version',(source->>'page')::integer) returning * into c;
 citations:=citations||jsonb_build_array(to_jsonb(c));end loop;
 return jsonb_build_object('id',t.id,'citations',citations);
end $$;
create function internal.assistant_citation_read(p_run_id uuid,p_citation_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare c internal.assistant_citation;begin perform internal.assistant_owned_run(p_run_id);
 select * into c from internal.assistant_citation where id=p_citation_id and run_id=p_run_id;
 if c.id is null then raise exception 'ไม่พบแหล่งอ้างอิงที่คุณเข้าถึงได้' using errcode='P0002';end if;
 if c.namespace='internal_content' then perform hub.require_actor(array['editor','publisher','viewer','admin']);
 elsif c.entity_type<>'naming_rule' then perform hub.require_actor(array['online_staff','admin']);end if;
 return to_jsonb(c);
end $$;

create function internal.assistant_proposal_read(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p internal.assistant_proposal;a internal.assistant_proposal_application;actor uuid;begin
 actor:=hub.require_actor(array['editor','publisher','admin']);
 select * into p from internal.assistant_proposal where id=p_id and actor_id=actor and actor_role=current_setting('role');
 if p.id is null then raise exception 'ไม่พบข้อเสนอที่คุณเข้าถึงได้' using errcode='P0002';end if;
 if p.entity_type='brand' then perform hub.require_actor(array['editor','admin']);end if;
 select * into a from internal.assistant_proposal_application where proposal_id=p.id;
 return to_jsonb(p)||jsonb_build_object('status',case when a.id is not null then 'APPLIED' when p.expires_at<=clock_timestamp() then 'EXPIRED' else 'PROPOSED' end,'receipt',case when a.id is not null then to_jsonb(a) else null end);
end $$;
create function internal.assistant_proposal_create(p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;target jsonb;row_id uuid;run internal.assistant_run;proposal internal.assistant_proposal;path text[];cid uuid;cids uuid[]:='{}';begin
 perform hub.residential_local();actor:=hub.require_actor(array['editor','publisher','admin']);
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in('entity_type','entity_id','field_path','new_text','expected_updated_at','run_id','rationale','citations'))
 or jsonb_typeof(p->'new_text') is distinct from 'string' or length(btrim(p->>'new_text')) not between 1 and 4000
 or(p ? 'rationale' and jsonb_typeof(p->'rationale') is distinct from 'string')
 or(p ? 'citations' and(jsonb_typeof(p->'citations') is distinct from 'array' or jsonb_array_length(p->'citations')>10)) then raise exception 'ข้อมูลข้อเสนอไม่ถูกต้อง' using errcode='22023';end if;
 if p->>'entity_type'='project' and p->>'field_path' in('meta_title.th','meta_description.th') then
 select to_jsonb(t) into target from hub.projects t where id=(p->>'entity_id')::uuid and deleted_at is null for share;
 elsif p->>'entity_type'='brand' and p->>'field_path'='description.th' then
 perform hub.require_actor(array['editor','admin']);select to_jsonb(t) into target from hub.brands t where id=(p->>'entity_id')::uuid and deleted_at is null for share;
 else raise exception 'แก้ไขได้เฉพาะข้อความตัวอย่างที่กำหนด' using errcode='42501';end if;
 path:=string_to_array(p->>'field_path','.');
 if target is null then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 if not(target->'demo_fields' ? (p->>'field_path')) or jsonb_typeof(target#>path) is distinct from 'string' then raise exception 'ฟิลด์นี้ไม่ได้ทำเครื่องหมายเป็นข้อมูลตัวอย่าง' using errcode='42501';end if;
 if (target->>'updated_at')::timestamptz is distinct from(p->>'expected_updated_at')::timestamptz then raise exception 'ฉบับร่างเปลี่ยนแล้ว โปรดสร้างข้อเสนอใหม่' using errcode='40001';end if;
 if target#>>path=p->>'new_text' then raise exception 'ข้อความใหม่ต้องต่างจากข้อความเดิม' using errcode='22023';end if;
 if p->>'run_id' is not null then run:=internal.assistant_owned_run((p->>'run_id')::uuid);end if;
 for cid in select value::uuid from jsonb_array_elements_text(coalesce(p->'citations','[]')) loop
 if run.id is null then raise exception 'แหล่งอ้างอิงต้องอยู่ในการสนทนาของคุณ' using errcode='42501';end if;
 perform internal.assistant_citation_read(run.id,cid);cids:=array_append(cids,cid);end loop;
 row_id:=gen_random_uuid();
 insert into internal.assistant_proposal(id,actor_id,actor_role,run_id,entity_type,entity_id,field_path,expected_updated_at,old_text,new_text,rationale,citation_ids,digest)
 values(row_id,actor,current_setting('role'),run.id,p->>'entity_type',(p->>'entity_id')::uuid,p->>'field_path',(target->>'updated_at')::timestamptz,target#>>path,p->>'new_text',coalesce(p->>'rationale',''),cids,
 encode(sha256(convert_to(jsonb_build_array(row_id,actor,current_setting('role'),p->>'entity_type',p->>'entity_id',p->>'field_path',target->>'updated_at',target#>>path,p->>'new_text')::text,'UTF8')),'hex')) returning * into proposal;
 insert into audit.assistant_proposal_event(proposal_id,actor_id,actor_role,action,entity_type,entity_id,field_path,source_updated_at) values(proposal.id,actor,current_setting('role'),'PROPOSED',proposal.entity_type,proposal.entity_id,proposal.field_path,proposal.expected_updated_at);
 return internal.assistant_proposal_read(proposal.id);
end $$;
create function internal.assistant_proposal_apply(p_id uuid,p_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p internal.assistant_proposal;a internal.assistant_proposal_application;actor uuid;target jsonb;after_target jsonb;path text[];patch jsonb;begin
 perform hub.residential_local();actor:=hub.require_actor(array['editor','publisher','admin']);
 perform internal.assistant_proposal_read(p_id);
 select * into p from internal.assistant_proposal where id=p_id for update;
 if p_digest is distinct from p.digest then raise exception 'ข้อเสนอที่ยืนยันไม่ตรงกับฉบับที่แสดง' using errcode='40001';end if;
 select * into a from internal.assistant_proposal_application where proposal_id=p.id;
 if a.id is not null then return jsonb_build_object('proposal',internal.assistant_proposal_read(p.id),'receipt',to_jsonb(a),'replayed',true);end if;
 if p.expires_at<=clock_timestamp() then raise exception 'ข้อเสนอหมดอายุ โปรดสร้างใหม่' using errcode='40001';end if;
 if p.entity_type='project' then select to_jsonb(t) into target from hub.projects t where id=p.entity_id and deleted_at is null for update;
 else perform hub.require_actor(array['editor','admin']);select to_jsonb(t) into target from hub.brands t where id=p.entity_id and deleted_at is null for update;end if;
 if target is null then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 path:=string_to_array(p.field_path,'.');
 if not(target->'demo_fields' ? p.field_path) then raise exception 'ฟิลด์นี้ไม่ได้ทำเครื่องหมายเป็นข้อมูลตัวอย่าง' using errcode='42501';end if;
 if(target->>'updated_at')::timestamptz is distinct from p.expected_updated_at or target#>>path is distinct from p.old_text then raise exception 'ฉบับร่างเปลี่ยนแล้ว โปรดสร้างข้อเสนอใหม่' using errcode='40001';end if;
 patch:=jsonb_build_object(path[1],jsonb_set(target->path[1],array[path[2]],to_jsonb(p.new_text),false));
 perform set_config('app.change_reason','ASSISTANT_PROPOSAL:'||p.id::text,true);
 if p.entity_type='project' then perform hub.patch_project(p.entity_id,patch,p.expected_updated_at);select to_jsonb(t) into after_target from hub.projects t where id=p.entity_id;
 else perform hub.update_brand_draft(p.entity_id,patch,p.expected_updated_at);select to_jsonb(t) into after_target from hub.brands t where id=p.entity_id;end if;
 if after_target->'demo_fields' is distinct from target->'demo_fields' or after_target->'published_version_id' is distinct from target->'published_version_id'
 or((after_target->path[1])-path[2]) is distinct from((target->path[1])-path[2]) then raise exception 'การบันทึกต้องคงที่มา ภาษาอื่น และฉบับเผยแพร่' using errcode='23514';end if;
 insert into internal.assistant_proposal_application(proposal_id,actor_id,actor_role,source_updated_at,result_updated_at) values(p.id,actor,current_setting('role'),p.expected_updated_at,(after_target->>'updated_at')::timestamptz) returning * into a;
 insert into audit.assistant_proposal_event(proposal_id,actor_id,actor_role,action,entity_type,entity_id,field_path,source_updated_at) values(p.id,actor,current_setting('role'),'APPLIED',p.entity_type,p.entity_id,p.field_path,p.expected_updated_at);
 return jsonb_build_object('proposal',internal.assistant_proposal_read(p.id),'receipt',to_jsonb(a),'replayed',false);
end $$;

do $$ declare obj regclass;f regprocedure;begin
 for obj in select c.oid::regclass from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and n.nspname in('internal','audit') and c.relname like 'assistant_%' loop execute format('revoke all on %s from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer,ads_export_reader',obj);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='internal' and p.proname like 'assistant_%' loop execute format('revoke all on function %s from public',f);end loop;
end $$;
grant usage on schema internal to editor,publisher,viewer,admin,online_staff;
grant execute on function internal.assistant_run_create(jsonb),internal.assistant_run_read(uuid),internal.assistant_run_finish(uuid,jsonb),internal.assistant_tool_record(uuid,jsonb),internal.assistant_citation_read(uuid,uuid) to editor,publisher,viewer,admin,online_staff;
grant execute on function internal.assistant_proposal_create(jsonb),internal.assistant_proposal_read(uuid),internal.assistant_proposal_apply(uuid,text) to editor,publisher,admin;
comment on table internal.assistant_run is 'Actor-and-role-owned assistant metadata only. No prompts, answers or raw tool documents. Domain reads retain their own caller ACL.';
comment on table internal.assistant_proposal is 'Immutable explicit text diff for existing synthetic fields only; confirmation calls normal draft functions and never publishes.';
commit;
