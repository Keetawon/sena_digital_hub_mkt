-- Hosted TEST settings profile v1. Canonical 0014 stays immutable.
-- Only the issuance setting mechanism differs; review against profile.json.
begin;

create schema ads;
create schema ads_export;
revoke all on schema ads, ads_export from public;
alter default privileges in schema ads revoke execute on functions from public;
do $$ declare r text; begin
  foreach r in array array['online_staff','agency','ads_registry_writer','ads_export_owner','ads_export_reader'] loop
    if not exists(select 1 from pg_roles where rolname=r) then
      execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',r);
    end if;
  end loop;
end $$;

create table ads.vocab (
  vocab_type text not null check(vocab_type in ('OBJECTIVE','AGENCY','VARIANT','PLATFORM','BUD')),
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  label_th text not null check(btrim(label_th)<>''), label_en text not null,
  status text not null default 'PROPOSED' check(status in ('PROPOSED','ACTIVE','INACTIVE')),
  active_from date, active_to date, alias_of text, source_reference text not null,
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid,
  primary key(vocab_type,code), foreign key(vocab_type,alias_of) references ads.vocab(vocab_type,code),
  check(alias_of is null or alias_of<>code), check(active_to is null or active_from is null or active_to>=active_from)
);
create table ads.scope_code (
  scope_id uuid primary key default gen_random_uuid(),
  scope_code text not null check(scope_code ~ '^((C|H|T|S)-[A-Z0-9]{4}-[A-Z0-9]{5}(-[A-Z0-9]+)?|ZONE-[A-Z0-9-]+|BRAND-[A-Z0-9-]+|CORP-[A-Z0-9-]+|BU-[A-Z0-9-]+)$'),
  kind text not null check(kind in ('GROUP','PHASE','MULTI_PHASE','ZONE','BRAND','CORP','BU')),
  label_th text not null check(btrim(label_th)<>''),
  label_en text not null check(label_en ~ '^[A-Z0-9][A-Z0-9 .-]{0,39}$'),
  parent_group_id text, home_bud text, member_signature text not null,
  status text not null default 'PROPOSED' check(status in ('PROPOSED','ACTIVE','INACTIVE','CONFLICT')),
  source_snapshot timestamptz, source_fingerprint text,
  created_at timestamptz not null default clock_timestamp(), created_by uuid,
  unique(kind,member_signature),
  check((kind in ('PHASE','MULTI_PHASE'))=(parent_group_id is not null))
);
create unique index ads_scope_named_token on ads.scope_code(scope_code) where kind<>'MULTI_PHASE';
create table ads.scope_member (
  scope_id uuid not null references ads.scope_code,
  member_type text not null check(member_type in ('GROUP','PHASE','BRAND','CORPORATE','BU')),
  member_id text not null check(btrim(member_id)<>''), parent_group_id text,
  name_alias text check(name_alias ~ '^[A-Z0-9]+$'), source_snapshot timestamptz,
  effective_from timestamptz, effective_to timestamptz,
  primary key(scope_id,member_type,member_id),
  check((member_type='PHASE')=(parent_group_id is not null)),
  check(effective_to is null or effective_from is null or effective_to>effective_from)
);
create table ads.code_sequence (
  sequence_year integer primary key check(sequence_year between 2000 and 2099),
  last_value integer not null check(last_value between 0 and 99999)
);
create table ads.setting (
  key text primary key check(key in ('sena_h_approved','hosted_test_issuing_enabled')), value jsonb not null check(jsonb_typeof(value)='boolean'),
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid,
  change_reason text not null, approval_evidence text,
  check(value<>'true'::jsonb or (updated_by is not null and approval_evidence is not null and btrim(approval_evidence)<>''))
);
insert into ads.setting(key,value,change_reason) values('sena_h_approved','false','Pending pattern-owner approval'),
('hosted_test_issuing_enabled','false','H1 issuance disabled; deployment operator only');
create table ads.campaign_registration (
  code text primary key check(code ~ '^SN[0-9]{7}[2-9A-HJ-NP-Z]$'),
  sequence_year integer not null check(sequence_year between 2000 and 2099),
  sequence_no integer not null check(sequence_no between 1 and 99999),
  scope_id uuid not null references ads.scope_code, objective text not null, agency text not null,
  variant text, label text not null check(label ~ '^[A-Z0-9][A-Z0-9 .-]{0,39}$'),
  objective_type text generated always as ('OBJECTIVE'::text) stored,
  agency_type text generated always as ('AGENCY'::text) stored,
  variant_type text generated always as ('VARIANT'::text) stored,
  status text not null default 'REGISTERED' check(status in ('REGISTERED','CANCELLED')),
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  label_approved_by uuid, label_approved_at timestamptz,
  cancelled_at timestamptz, cancelled_by uuid, cancelled_reason text,
  unique(sequence_year,sequence_no),
  foreign key(objective_type,objective) references ads.vocab(vocab_type,code),
  foreign key(agency_type,agency) references ads.vocab(vocab_type,code),
  foreign key(variant_type,variant) references ads.vocab(vocab_type,code),
  check((label_approved_by is null)=(label_approved_at is null)),
  check((status='CANCELLED')=(cancelled_at is not null and cancelled_by is not null and cancelled_reason is not null and btrim(cancelled_reason)<>''))
);
create table ads.campaign_name (
  name_id uuid primary key default gen_random_uuid(), code text not null references ads.campaign_registration,
  variant text, variant_type text generated always as ('VARIANT'::text) stored,
  template_version text not null default 'SENA-H' check(template_version='SENA-H'),
  frozen_name text not null unique check(length(frozen_name)<=150 and frozen_name ~ '^[A-Z0-9][A-Z0-9 .\-]{0,39}__(LEADS|TRAFFIC|AWARENESS|ENGAGEMENT|SALES|VIDEOVIEWS|CONVERSION)__((C|H|T|S)-[A-Z0-9]{4}-[A-Z0-9]{5}(-[A-Z0-9]+)?|ZONE-[A-Z0-9-]+|BRAND-[A-Z0-9-]+|CORP-[A-Z0-9-]+|BU-[A-Z0-9-]+)__[A-Z0-9]{2,20}__SN[0-9]{7}[2-9A-HJ-NP-Z](__[A-Z0-9-]{1,24})?$'),
  utm_campaign text not null check(utm_campaign=frozen_name),
  utm_id_note text not null default 'ใช้ Campaign ID ของแพลตฟอร์มเป็น utm_id; Google ใช้ {campaignid} ห้ามใช้รหัส SN',
  issued_at timestamptz not null default clock_timestamp(), issued_by uuid not null,
  unique(name_id,code), unique nulls not distinct(code,variant),
  foreign key(variant_type,variant) references ads.vocab(vocab_type,code)
);
create table ads.native_binding (
  platform text not null, platform_type text generated always as ('PLATFORM'::text) stored,
  account_id text not null check(length(account_id) between 1 and 200 and account_id=btrim(account_id)),
  campaign_id text not null check(length(campaign_id) between 1 and 200 and campaign_id=btrim(campaign_id)),
  code text not null, name_id uuid not null,
  method text not null check(method in ('AGENCY_RETURNED','ONLINE_CONFIRMED')),
  bound_by uuid not null, bound_at timestamptz not null default clock_timestamp(),
  primary key(platform,account_id,campaign_id),
  foreign key(platform_type,platform) references ads.vocab(vocab_type,code),
  foreign key(name_id,code) references ads.campaign_name(name_id,code)
);
create index ads_registration_scope on ads.campaign_registration(scope_id);
create index ads_registration_agency on ads.campaign_registration(agency,created_at desc,code);
create index ads_binding_name on ads.native_binding(name_id);

-- Operator-exported evidence only; the importer never reads/writes the DW.
create table staging.ads_scope_import (
  source_fingerprint text primary key, source_record jsonb not null, provenance jsonb not null,
  source_snapshot_at timestamptz, received_at timestamptz not null default clock_timestamp(),
  status text not null check(status in ('APPLIED','QUARANTINED')), issues jsonb not null default '[]'
);

insert into ads.vocab(vocab_type,code,label_th,label_en,status,source_reference)
select 'OBJECTIVE',x.code,x.label,x.code,'ACTIVE','docs/19 §4.2; Naming_Options'
from (values ('LEADS','ลูกค้าเป้าหมาย'),('TRAFFIC','การเข้าชม'),('AWARENESS','การรับรู้'),('ENGAGEMENT','การมีส่วนร่วม'),('SALES','ยอดขาย'),('VIDEOVIEWS','การรับชมวิดีโอ'),('CONVERSION','การเปลี่ยนเป็นผลลัพธ์')) x(code,label);
insert into ads.vocab(vocab_type,code,label_th,label_en,status,source_reference)
select 'AGENCY',code,code,code,'ACTIVE','docs/19 §4.2; Naming_Options!N'
from unnest(array['BRANDSTROM','COMBAY','KIN','MEDIAOPTION','7DAYSSUCCESS','INHOUSE']) code;
insert into ads.vocab(vocab_type,code,label_th,label_en,status,source_reference)
select 'VARIANT',code,code,code,'ACTIVE','docs/19 §4.2 controlled variants'
from unnest(array['KW-BRAND','KW-COMPETITOR','KW-GENERIC','KW-LOCATION','CAPI-TEST','LIVNEX']) code;
insert into ads.vocab(vocab_type,code,label_th,label_en,status,source_reference)
select 'PLATFORM',code,code,code,case when code in ('META','GOOGLE') then 'ACTIVE' else 'PROPOSED' end,
  'Naming_Options!G:I; platform candidate is not integration approval'
from unnest(array['META','GOOGLE','TIKTOK','CHATGPT']) code;
insert into ads.vocab(vocab_type,code,label_th,label_en,status,source_reference)
select 'BUD',code,code,code,'ACTIVE','docs/19 legacy BUD vocabulary; context only in P1'
from unnest(array['C1','C2','C3','H1','H2','PREMIUM','SID']) code;

-- Dedicated function owner is not a login, superuser or RLS bypass role.
grant usage on schema ads,hub to ads_registry_writer;
grant execute on function hub.require_actor(text[]) to ads_registry_writer;
grant select,insert,update on all tables in schema ads to ads_registry_writer;
grant usage on schema ads to admin,online_staff,agency,ads_export_owner;
grant select on ads.vocab,ads.scope_code,ads.scope_member,ads.campaign_registration,ads.campaign_name,ads.native_binding to admin,online_staff,agency;
grant insert,update on ads.vocab,ads.scope_code,ads.scope_member to admin;
grant select on ads.setting to admin,online_staff;

do $$ declare t text; begin
  foreach t in array array['vocab','scope_code','scope_member','campaign_registration','campaign_name','native_binding','code_sequence','setting'] loop
    execute format('alter table ads.%I enable row level security',t);
    execute format('alter table ads.%I force row level security',t);
    execute format('create policy guarded_writer on ads.%I to ads_registry_writer using (true) with check (true)',t);
    execute format('create trigger audit_write after insert or update or delete on ads.%I for each row execute function audit.record_change()',t);
  end loop;
  foreach t in array array['vocab','scope_code','scope_member','campaign_registration','campaign_name','native_binding','setting'] loop
    execute format('create policy staff_read on ads.%I for select to admin,online_staff using (true)',t);
  end loop;
  foreach t in array array['vocab','scope_code','scope_member'] loop
    execute format('create policy steward_insert on ads.%I for insert to admin with check (nullif(current_setting(''app.actor_id'',true),'''') is not null)',t);
    execute format('create policy steward_update on ads.%I for update to admin using (true) with check (nullif(current_setting(''app.actor_id'',true),'''') is not null)',t);
  end loop;
end $$;
-- Profile-only permissions: application admin is not the deployment operator.
grant usage on schema hub_deployment to ads_registry_writer;
grant select(project_ref,environment,profile,source) on hub_deployment.target to ads_registry_writer;
drop policy guarded_writer on ads.setting;
create policy registry_setting_read on ads.setting for select to ads_registry_writer using(true);
create policy registry_setting_update on ads.setting for update to ads_registry_writer
  using(key='sena_h_approved') with check(key='sena_h_approved');
revoke insert,update on ads.setting from ads_registry_writer;
grant update(value,updated_at,updated_by,change_reason,approval_evidence) on ads.setting to ads_registry_writer;
do $$ begin execute format('create policy deployment_setting_operator on ads.setting to %I using(true) with check(true)',current_user);end $$;

create policy agency_vocab on ads.vocab for select to agency using(status='ACTIVE' and vocab_type<>'BUD');
create policy agency_registration on ads.campaign_registration for select to agency
  using(agency=nullif(current_setting('app.agency_code',true),''));
create policy agency_names on ads.campaign_name for select to agency
  using(exists(select 1 from ads.campaign_registration r where r.code=campaign_name.code));
create policy agency_bindings on ads.native_binding for select to agency
  using(exists(select 1 from ads.campaign_registration r where r.code=native_binding.code));
create policy agency_binding_check on ads.native_binding for insert to agency with check(
  exists(select 1 from ads.campaign_registration r join ads.campaign_name n using(code)
    where r.code=native_binding.code and n.name_id=native_binding.name_id and r.status='REGISTERED'));
create policy agency_scopes on ads.scope_code for select to agency using(
  (status='ACTIVE' and kind not in ('MULTI_PHASE','ZONE')) or exists(select 1 from ads.campaign_registration r where r.scope_id=scope_code.scope_id));
create policy agency_members on ads.scope_member for select to agency using(
  exists(select 1 from ads.scope_code s where s.scope_id=scope_member.scope_id));

create function ads.sn_code(full_year integer, sequence_no integer) returns text
language plpgsql immutable strict set search_path=pg_catalog,pg_temp as $$
declare digits text; checksum integer:=0; weights integer[]:=array[3,5,7,9,11,13,15]; i integer;
begin
  if full_year not between 2000 and 2099 or sequence_no not between 1 and 99999 then
    raise exception 'ปีหรือลำดับรหัสไม่ถูกต้อง' using errcode='23514';
  end if;
  digits:=lpad((full_year%100)::text,2,'0')||lpad(sequence_no::text,5,'0');
  for i in 1..7 loop checksum:=checksum+weights[i]*substr(digits,i,1)::integer; end loop;
  return 'SN'||digits||substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',checksum%32+1,1);
end $$;
create function ads.scope_signature(members jsonb) returns text
language sql immutable strict set search_path=pg_catalog,pg_temp as $$
  select jsonb_agg(jsonb_build_array(x->>'member_type',x->>'member_id',x->>'parent_group_id')
    order by (x->>'member_type') collate "C",(x->>'member_id') collate "C",(x->>'parent_group_id') collate "C")::text
  from jsonb_array_elements(members) x
$$;
create function ads.active_vocab(kind text, token text) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from ads.vocab v where v.vocab_type=kind and v.code=token and v.status='ACTIVE' and v.alias_of is null
    and (v.active_from is null or v.active_from<=(now() at time zone 'Asia/Bangkok')::date)
    and (v.active_to is null or v.active_to>=(now() at time zone 'Asia/Bangkok')::date))
$$;
create function ads.require_issuance() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not exists(select 1 from ads.setting where key='sena_h_approved' and value='true'::jsonb)
    and not ads.test_issuing_enabled() then
    raise exception 'รออนุมัติรูปแบบชื่อ' using errcode='42501';
  end if;
end $$;
create function ads.registry_settings() returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('sena_h_approved',exists(select 1 from ads.setting where key='sena_h_approved' and value='true'::jsonb))
$$;
create function ads.test_issuing_enabled() returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from hub_deployment.target
    where project_ref='eqlrtevwpyboplljgowo' and environment='hosted-test'
      and profile='hosted-test-settings-v1' and source='sena-hub-supabase-test-v2')
    and exists(select 1 from ads.setting where key='hosted_test_issuing_enabled' and value='true'::jsonb)
$$;
create function ads.registration_detail(registration_code text) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('registration',to_jsonb(r)-'objective_type'-'agency_type'-'variant_type',
    'scope',to_jsonb(s),'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.member_type collate "C",m.member_id collate "C") from ads.scope_member m where m.scope_id=r.scope_id),'[]'::jsonb),
    'names',coalesce((select jsonb_agg(to_jsonb(n)-'variant_type' order by n.issued_at,n.name_id) from ads.campaign_name n where n.code=r.code),'[]'::jsonb),
    'bindings',coalesce((select jsonb_agg(to_jsonb(b)-'platform_type' order by b.bound_at) from ads.native_binding b where b.code=r.code),'[]'::jsonb))
  from ads.campaign_registration r join ads.scope_code s using(scope_id) where r.code=registration_code
$$;

create function ads.preview_scope(scope_kind text, parent_id text, member_ids text[]) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare members jsonb; signature text; result jsonb; label text; label_thai text; token text; n integer;
begin
  perform hub.require_actor(array['admin','online_staff']);
  if scope_kind not in ('MULTI_PHASE','ZONE') or member_ids is null or cardinality(member_ids)<2
    or array_position(member_ids,null) is not null or cardinality(member_ids)<>(select count(distinct x) from unnest(member_ids) x) then
    raise exception 'เลือกสมาชิกอย่างน้อยสองรายการที่ไม่ซ้ำกัน' using errcode='23514';
  end if;
  if scope_kind='MULTI_PHASE' then
    select s.scope_code,s.label_en,s.label_th into token,label,label_thai from ads.scope_code s
      where s.kind='GROUP' and s.scope_code=parent_id and s.status='ACTIVE';
    if not found then raise exception 'ไม่พบกลุ่มโครงการที่ใช้งานได้' using errcode='23514'; end if;
    select jsonb_agg(to_jsonb(m)-'scope_id' order by m.member_id collate "C"),count(*) into members,n
      from ads.scope_member m join ads.scope_code s using(scope_id)
      where s.kind='PHASE' and s.status='ACTIVE' and m.parent_group_id=parent_id and m.member_type='PHASE' and m.member_id=any(member_ids);
  else
    if parent_id is not null then raise exception 'กลุ่มพื้นที่ไม่มีโครงการแม่' using errcode='23514'; end if;
    select jsonb_agg(to_jsonb(m)-'scope_id' order by m.member_id collate "C"),count(*) into members,n
      from ads.scope_member m join ads.scope_code s using(scope_id)
      where s.kind='GROUP' and s.status='ACTIVE' and m.member_type='GROUP' and m.member_id=any(member_ids);
    label:='MULTI PROJECT'; label_thai:='หลายกลุ่มโครงการ';
  end if;
  if n<>cardinality(member_ids) then raise exception 'สมาชิกไม่ตรงกับกลุ่มหรือยังไม่พร้อมใช้งาน' using errcode='23514'; end if;
  signature:=ads.scope_signature(members);
  if scope_kind='ZONE' then
    token:='ZONE-'||upper(substr(encode(sha256(convert_to(signature,'UTF8')),'hex'),1,12));
    if exists(select 1 from ads.scope_code where scope_code=token and member_signature<>signature) then
      raise exception 'รหัสพื้นที่ชนกัน โปรดให้ผู้ดูแลตรวจสอบ' using errcode='23505';
    end if;
  end if;
  select to_jsonb(s) into result from ads.scope_code s where kind=scope_kind and member_signature=signature;
  if result is not null and result->>'status'<>'ACTIVE' then raise exception 'ขอบเขตนี้ยังไม่พร้อมใช้งาน' using errcode='23514'; end if;
  return jsonb_build_object('scope',coalesce(result,jsonb_build_object('scope_id',null,'scope_code',token,'kind',scope_kind,
    'label_en',label,'label_th',label_thai,'parent_group_id',parent_id,'member_signature',signature,'status','ACTIVE')),'members',members);
end $$;
create function ads.create_scope(scope_kind text, parent_id text, member_ids text[]) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p jsonb; s jsonb; id uuid;
begin
  perform hub.require_actor(array['admin','online_staff']);
  p:=ads.preview_scope(scope_kind,parent_id,member_ids); s:=p->'scope';
  if s->>'scope_id' is not null then return (s->>'scope_id')::uuid; end if;
  insert into ads.scope_code(scope_code,kind,label_th,label_en,parent_group_id,member_signature,status,created_by)
    values(s->>'scope_code',scope_kind,s->>'label_th',s->>'label_en',parent_id,s->>'member_signature','ACTIVE',nullif(current_setting('app.actor_id',true),'')::uuid)
    on conflict(kind,member_signature) do nothing returning scope_id into id;
  if id is null then select scope_id into id from ads.scope_code where kind=scope_kind and member_signature=s->>'member_signature'; return id; end if;
  insert into ads.scope_member(scope_id,member_type,member_id,parent_group_id,name_alias,source_snapshot,effective_from,effective_to)
    select id,x->>'member_type',x->>'member_id',x->>'parent_group_id',x->>'name_alias',
      (x->>'source_snapshot')::timestamptz,(x->>'effective_from')::timestamptz,(x->>'effective_to')::timestamptz from jsonb_array_elements(p->'members') x;
  return id;
end $$;

create function ads.check_scope(target uuid) returns ads.scope_code
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare s ads.scope_code; members jsonb; n integer; typ text;
begin
  select * into s from ads.scope_code where scope_id=target for share;
  if not found or s.status<>'ACTIVE' then raise exception 'ขอบเขตยังไม่พร้อมใช้งาน' using errcode='23514'; end if;
  select jsonb_agg(to_jsonb(m)),count(*) into members,n from ads.scope_member m where scope_id=target;
  typ:=case s.kind when 'GROUP' then 'GROUP' when 'PHASE' then 'PHASE' when 'MULTI_PHASE' then 'PHASE' when 'ZONE' then 'GROUP' when 'BRAND' then 'BRAND' when 'CORP' then 'CORPORATE' else 'BU' end;
  if n<>(case when s.kind in ('MULTI_PHASE','ZONE') then greatest(n,2) else 1 end)
    or exists(select 1 from ads.scope_member m where scope_id=target and (member_type<>typ or (typ='PHASE' and parent_group_id is distinct from s.parent_group_id)))
    or ads.scope_signature(members) is distinct from s.member_signature then
    raise exception 'สมาชิกขอบเขตไม่ครบหรือไม่ตรงกับทะเบียน' using errcode='23514';
  end if;
  if s.kind='MULTI_PHASE' then perform ads.preview_scope(s.kind,s.parent_group_id,array(select member_id from ads.scope_member where scope_id=target));
  elsif s.kind='ZONE' then perform ads.preview_scope(s.kind,null,array(select member_id from ads.scope_member where scope_id=target));
  elsif s.kind='PHASE' and not exists(select 1 from ads.scope_code where kind='GROUP' and scope_code=s.parent_group_id and status='ACTIVE') then
    raise exception 'กลุ่มโครงการแม่ยังไม่พร้อมใช้งาน' using errcode='23514';
  end if;
  return s;
end $$;
create function ads.append_name(registration_code text, name_variant text) returns void
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare r ads.campaign_registration; s ads.scope_code; name_text text;
begin
  select * into r from ads.campaign_registration where code=registration_code;
  s:=ads.check_scope(r.scope_id);
  if not ads.active_vocab('OBJECTIVE',r.objective) or not ads.active_vocab('AGENCY',r.agency)
    or (name_variant is not null and not ads.active_vocab('VARIANT',name_variant)) then
    raise exception 'รายการคำศัพท์ยังไม่พร้อมใช้งาน' using errcode='23514';
  end if;
  name_text:=r.label||'__'||r.objective||'__'||s.scope_code||'__'||r.agency||'__'||r.code||coalesce('__'||name_variant,'');
  insert into ads.campaign_name(code,variant,frozen_name,utm_campaign,issued_by)
    values(r.code,name_variant,name_text,name_text,nullif(current_setting('app.actor_id',true),'')::uuid) on conflict(code,variant) do nothing;
end $$;
create function ads.preview_existing_scope(target uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare s ads.scope_code;
begin
  perform hub.require_actor(array['admin','online_staff']);
  s:=ads.check_scope(target);
  return jsonb_build_object('scope',to_jsonb(s),'members',(select jsonb_agg(to_jsonb(m) order by member_type collate "C",member_id collate "C") from ads.scope_member m where scope_id=target));
end $$;
create function ads.issue_registration(target uuid, objective_code text, agency_code text, initial_variant text default null,
  content_label text default null, content_label_approved boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; s ads.scope_code; y integer; seq integer; issued_code text; approved_label text;
begin
  actor:=hub.require_actor(array['admin','online_staff']); perform ads.require_issuance();
  s:=ads.check_scope(target); approved_label:=s.label_en;
  if s.kind='CORP' then
    if content_label_approved is distinct from true or content_label is null or content_label !~ '^[A-Z0-9][A-Z0-9 .-]{0,39}$' then
      raise exception 'เจ้าหน้าที่ออนไลน์ต้องระบุและยืนยันชื่อเนื้อหาที่อนุมัติแล้ว' using errcode='23514'; end if;
    approved_label:=content_label;
  elsif content_label is not null or content_label_approved then
    raise exception 'ระบุชื่อเนื้อหาได้เฉพาะการโปรโมตองค์กร' using errcode='23514';
  end if;
  if not ads.active_vocab('OBJECTIVE',objective_code) or not ads.active_vocab('AGENCY',agency_code)
    or (initial_variant is not null and not ads.active_vocab('VARIANT',initial_variant)) then
    raise exception 'รายการคำศัพท์ยังไม่พร้อมใช้งาน' using errcode='23514'; end if;
  y:=extract(year from now() at time zone 'Asia/Bangkok')::integer;
  insert into ads.code_sequence(sequence_year,last_value) values(y,1)
    on conflict(sequence_year) do update set last_value=ads.code_sequence.last_value+1 where ads.code_sequence.last_value<99999
    returning last_value into seq;
  if seq is null then raise exception 'ลำดับรหัสของปีนี้เต็มแล้ว' using errcode='23514'; end if;
  issued_code:=ads.sn_code(y,seq);
  insert into ads.campaign_registration(code,sequence_year,sequence_no,scope_id,objective,agency,variant,label,created_by,label_approved_by,label_approved_at)
    values(issued_code,y,seq,target,objective_code,agency_code,initial_variant,approved_label,actor,
      case when s.kind='CORP' then actor end,case when s.kind='CORP' then clock_timestamp() end);
  perform ads.append_name(issued_code,initial_variant);
  return ads.registration_detail(issued_code);
end $$;
create function ads.add_variant(registration_code text, name_variant text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['admin','online_staff']); perform ads.require_issuance();
  perform 1 from ads.campaign_registration where code=registration_code and status='REGISTERED' for update;
  if not found then raise exception 'ไม่พบทะเบียนที่ใช้งานได้' using errcode='P0002'; end if;
  perform ads.append_name(registration_code,name_variant);
  return ads.registration_detail(registration_code);
end $$;
create function ads.bind_native(registration_code text, selected_name uuid, platform_code text, native_account text, native_campaign text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; r ads.campaign_registration; b ads.native_binding;
begin
  actor:=hub.require_actor(array['admin','online_staff','agency']);
  select * into r from ads.campaign_registration where code=registration_code and status='REGISTERED'
    and (current_setting('role')<>'agency' or agency=nullif(current_setting('app.agency_code',true),'')) for share;
  if not found or not exists(select 1 from ads.campaign_name where code=registration_code and name_id=selected_name) then
    raise exception 'ไม่พบทะเบียนหรือชื่อที่เลือก' using errcode='P0002'; end if;
  if not ads.active_vocab('PLATFORM',platform_code) then raise exception 'แพลตฟอร์มยังไม่พร้อมใช้งาน' using errcode='23514'; end if;
  if native_account is null or native_campaign is null or btrim(native_account)='' or btrim(native_campaign)='' then
    raise exception 'กรุณาระบุ Account ID และ Campaign ID' using errcode='23514'; end if;
  insert into ads.native_binding(platform,account_id,campaign_id,code,name_id,method,bound_by)
    values(platform_code,native_account,native_campaign,registration_code,selected_name,
      case when current_setting('role')='agency' then 'AGENCY_RETURNED' else 'ONLINE_CONFIRMED' end,actor)
    on conflict(platform,account_id,campaign_id) do nothing returning * into b;
  if b.code is null then
    select * into b from ads.native_binding where platform=platform_code and account_id=native_account and campaign_id=native_campaign;
    if b.code<>registration_code or b.name_id<>selected_name then raise exception 'รหัสแพลตฟอร์มนี้ผูกกับชื่ออื่นแล้ว โปรดให้ผู้ดูแลตรวจสอบ' using errcode='23505'; end if;
  end if;
  return to_jsonb(b)-'platform_type';
end $$;
create function ads.cancel_registration(registration_code text, reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;
begin
  actor:=hub.require_actor(array['admin']);
  if btrim(coalesce(reason,''))='' then raise exception 'กรุณาระบุเหตุผล' using errcode='23514'; end if;
  update ads.campaign_registration set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=actor,cancelled_reason=reason
    where code=registration_code and status='REGISTERED';
  if not found then raise exception 'ไม่พบทะเบียนที่ใช้งานได้' using errcode='P0002'; end if;
  return ads.registration_detail(registration_code);
end $$;
create function ads.set_approval(approved boolean, reason text, evidence text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;
begin
  actor:=hub.require_actor(array['admin']);
  if approved is null or btrim(coalesce(reason,''))='' or btrim(coalesce(evidence,''))='' then raise exception 'กรุณาระบุเหตุผลและหลักฐานการตัดสินใจ' using errcode='23514'; end if;
  update ads.setting set value=to_jsonb(approved),change_reason=reason,approval_evidence=evidence,updated_by=actor,updated_at=clock_timestamp() where key='sena_h_approved';
end $$;

-- Triggers protect even privileged application writes. Hard delete is never a workflow.
create function ads.freeze_identity() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if tg_table_name in ('campaign_name','native_binding') or tg_op='DELETE' then
    raise exception 'ข้อมูลที่ออกแล้วแก้ไขหรือลบไม่ได้' using errcode='23514';
  elsif tg_table_name='campaign_registration' then
    if (to_jsonb(new)-array['status','cancelled_at','cancelled_by','cancelled_reason','objective_type','agency_type','variant_type']) is distinct from (to_jsonb(old)-array['status','cancelled_at','cancelled_by','cancelled_reason','objective_type','agency_type','variant_type'])
      or old.status='CANCELLED' or new.status<>'CANCELLED' then raise exception 'ข้อมูลทะเบียนที่ออกแล้วแก้ไขไม่ได้' using errcode='23514'; end if;
  elsif tg_table_name='scope_code' then
    if exists(select 1 from ads.campaign_registration where scope_id=old.scope_id)
      and (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'ขอบเขตที่ออกชื่อแล้วแก้ไขไม่ได้' using errcode='23514'; end if;
  elsif tg_table_name='scope_member' then
    perform 1 from ads.scope_code where scope_id in (old.scope_id,new.scope_id) order by scope_id for update;
    if exists(select 1 from ads.campaign_registration where scope_id in (old.scope_id,new.scope_id)) then raise exception 'สมาชิกของขอบเขตที่ออกชื่อแล้วแก้ไขไม่ได้' using errcode='23514'; end if;
  elsif tg_table_name='vocab' and (old.vocab_type,old.code) is distinct from (new.vocab_type,new.code) then
    raise exception 'รหัสคำศัพท์แก้ไขไม่ได้ ให้เพิ่มรายการใหม่' using errcode='23514';
  end if;
  return new;
end $$;
create function ads.freeze_member_insert() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  -- Lock the scope against an issuing transaction before checking membership.
  perform 1 from ads.scope_code where scope_id=new.scope_id for update;
  if exists(select 1 from ads.campaign_registration where scope_id=new.scope_id) then raise exception 'สมาชิกของขอบเขตที่ออกชื่อแล้วแก้ไขไม่ได้' using errcode='23514'; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['campaign_registration','campaign_name','native_binding','scope_code','scope_member','vocab'] loop
    execute format('create trigger freeze_identity before update or delete on ads.%I for each row execute function ads.freeze_identity()',t);
  end loop;
end $$;
create trigger freeze_member_insert before insert on ads.scope_member for each row execute function ads.freeze_member_insert();
create trigger touch before update on ads.vocab for each row execute function hub.touch_record();

-- Export views intentionally omit actor IDs and all approval evidence.
grant select(code,sequence_year,sequence_no,scope_id,objective,agency,variant,label,status,created_at,cancelled_at) on ads.campaign_registration to ads_export_owner;
grant select(name_id,code,variant,template_version,frozen_name,utm_campaign,utm_id_note,issued_at) on ads.campaign_name to ads_export_owner;
grant select(platform,account_id,campaign_id,code,name_id,method,bound_at) on ads.native_binding to ads_export_owner;
grant select(scope_id,scope_code,kind,label_th,label_en,parent_group_id,home_bud,status,source_snapshot,source_fingerprint) on ads.scope_code to ads_export_owner;
grant select(scope_id,member_type,member_id,parent_group_id,name_alias,source_snapshot,effective_from,effective_to) on ads.scope_member to ads_export_owner;
do $$ declare t text; begin
  foreach t in array array['campaign_registration','campaign_name','native_binding','scope_code','scope_member'] loop
    execute format('create policy export_read on ads.%I for select to ads_export_owner using (true)',t);
  end loop;
end $$;
create view ads_export.campaign_registration with(security_barrier=true) as select code,sequence_year,sequence_no,scope_id,objective,agency,variant,label,status,created_at,cancelled_at from ads.campaign_registration;
create view ads_export.campaign_name with(security_barrier=true) as select name_id,code,variant,template_version,frozen_name,utm_campaign,utm_id_note,issued_at from ads.campaign_name;
create view ads_export.native_binding with(security_barrier=true) as select platform,account_id,campaign_id,code,name_id,method,bound_at from ads.native_binding;
create view ads_export.scope_code with(security_barrier=true) as select scope_id,scope_code,kind,label_th,label_en,parent_group_id,home_bud,status,source_snapshot,source_fingerprint from ads.scope_code;
create view ads_export.scope_member with(security_barrier=true) as select scope_id,member_type,member_id,parent_group_id,name_alias,source_snapshot,effective_from,effective_to from ads.scope_member;
grant usage on schema ads_export to ads_export_owner,ads_export_reader;
alter view ads_export.campaign_registration owner to ads_export_owner;
alter view ads_export.campaign_name owner to ads_export_owner;
alter view ads_export.native_binding owner to ads_export_owner;
alter view ads_export.scope_code owner to ads_export_owner;
alter view ads_export.scope_member owner to ads_export_owner;
grant select on all tables in schema ads_export to ads_export_reader;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='ads'::regnamespace loop
    execute format('revoke all on function %s from public',f.signature);
    execute format('alter function %s owner to ads_registry_writer',f.signature);
  end loop;
end $$;
grant execute on function ads.sn_code(integer,integer),ads.scope_signature(jsonb),ads.active_vocab(text,text),ads.registry_settings(),ads.test_issuing_enabled(),ads.registration_detail(text) to admin,online_staff,agency;
grant execute on function ads.preview_scope(text,text,text[]),ads.preview_existing_scope(uuid),ads.create_scope(text,text,text[]),ads.issue_registration(uuid,text,text,text,text,boolean),ads.add_variant(text,text) to admin,online_staff;
grant execute on function ads.bind_native(text,uuid,text,text,text) to admin,online_staff,agency;
grant execute on function ads.cancel_registration(text,text),ads.set_approval(boolean,text,text) to admin;
grant execute on function hub.require_actor(text[]) to online_staff,agency;
grant usage on schema hub to online_staff,agency;

comment on schema ads_export is 'DW source hub; extract all five views in one repeatable-read read-only transaction. No test data promotion.';
commit;
