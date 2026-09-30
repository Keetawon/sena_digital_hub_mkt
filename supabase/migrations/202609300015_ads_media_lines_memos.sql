-- Expanded P2: private financial records. No name changes or external-system writes.
begin;
do $$ begin if not exists(select 1 from pg_roles where rolname='ads_finance_writer') then create role ads_finance_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end $$;
grant usage on schema ads,staging,hub to ads_finance_writer;
grant execute on function hub.require_actor(text[]),ads.active_vocab(text,text) to ads_finance_writer;
grant select on ads.vocab,ads.scope_code,ads.scope_member,ads.campaign_registration to ads_finance_writer;
create policy finance_read on ads.vocab for select to ads_finance_writer using(true);
create policy finance_read on ads.scope_code for select to ads_finance_writer using(true);
create policy finance_read on ads.scope_member for select to ads_finance_writer using(true);
create policy finance_read on ads.campaign_registration for select to ads_finance_writer using(true);

create domain ads.cost_type as text check(value in ('MEDIA','AGENCY_FEE','CHANNEL','TOOL','BANK_FEE'));
create domain ads.payment_method as text check(value in ('CORPORATE_CARD','AGENCY_PO_INVOICE','PLATFORM_INVOICE','BANK_TRANSFER'));
create domain ads.finance_month as date check(extract(day from value)=1);

create table ads.memo (
 id uuid primary key default gen_random_uuid(),memo_no text not null unique,
 series text generated always as(case when memo_no like 'MO%' then 'BUD' else 'CORPORATE' end) stored,
 subject text not null check(btrim(subject)<>''),requesting_bud text not null,
 bud_type text generated always as('BUD'::text) stored,
 gross_amount numeric(14,2) not null check(gross_amount>=0),media_amount numeric(14,2),fee_amount numeric(14,2),cost_breakdown jsonb not null default '[]',
 mirrored_status text not null default 'UNKNOWN' check(mirrored_status in ('UNKNOWN','IN_REVIEW','APPROVED','REJECTED','CANCELLED')),
 approvers jsonb not null default '[]' check(jsonb_typeof(approvers)='array'),approval_date date,evidence_ref text,
 source text not null default 'MANUAL' check(source='MANUAL'),record_status text not null default 'DRAFT' check(record_status in ('DRAFT','CONFIRMED')),
 confirmed_by uuid,confirmed_at timestamptz,material_version integer not null default 1,
 check(memo_no ~ '^MO[0-9]{2}(0[1-9]|1[0-2])[0-9]{3}$' or memo_no ~ '^M\.COM[0-9]{3}_[0-9]{2}$'),
 check((media_amount is null and fee_amount is null) or (media_amount>=0 and fee_amount>=0 and media_amount+fee_amount=gross_amount)),
 foreign key(bud_type,requesting_bud) references ads.vocab(vocab_type,code)
);
create table ads.memo_identifier (
 id uuid primary key default gen_random_uuid(),identifier text not null unique check(length(identifier) between 1 and 100),memo_id uuid not null references ads.memo,
 kind text not null check(kind in ('CANONICAL','ALIAS')),status text not null default 'PROPOSED' check(status in ('PROPOSED','CONFIRMED','REJECTED','RETIRED')),
 reason text,evidence_ref text,reviewed_by uuid,reviewed_at timestamptz
);
create unique index memo_one_canonical on ads.memo_identifier(memo_id) where kind='CANONICAL';
create table ads.media_line (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('GROUP','ZONE_POOL','BRAND_POOL','CORP_PROGRAM','BU_PROGRAM')),
 scope_id uuid references ads.scope_code,month ads.finance_month,agency text,
 program_ref text,period_start_month ads.finance_month,period_end_month ads.finance_month,
 source_kind text not null default 'MANUAL' check(source_kind in ('MANUAL','LEDGER')),
 state text not null default 'DRAFT' check(state in ('DRAFT','ACTIVE','SUSPENDED')),archived_at timestamptz,archive_reason text,
 check((kind in ('GROUP','ZONE_POOL','BRAND_POOL') and scope_id is not null and month is not null and agency is not null and program_ref is null and period_start_month is null and period_end_month is null)
 or(kind in ('CORP_PROGRAM','BU_PROGRAM') and program_ref is not null and btrim(program_ref)<>'' and period_start_month is not null and period_end_month>=period_start_month and month is null and agency is null and (kind<>'BU_PROGRAM' or scope_id is not null)))
);
create unique index media_line_month_key on ads.media_line(scope_id,month,agency) where month is not null;
create unique index media_line_program_key on ads.media_line(kind,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid),program_ref,period_start_month,period_end_month) where program_ref is not null;
create table ads.media_line_revision (
 id uuid primary key default gen_random_uuid(),line_id uuid not null references ads.media_line,revision_no integer not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','SUPERSEDED')),
 reason text not null check(btrim(reason)<>''),permitted_scope_ids uuid[] not null default '{}',permitted_agencies text[] not null default '{}',mapping_verified boolean not null default false,
 reconciliation_acknowledgements jsonb not null default '[]',confirmed_by uuid,confirmed_at timestamptz,unique(line_id,revision_no)
);
create unique index line_one_approved on ads.media_line_revision(line_id) where status='APPROVED';
create table ads.media_line_component (
 id uuid primary key default gen_random_uuid(),revision_id uuid not null references ads.media_line_revision,
 component_kind text not null check(component_kind in ('PHASE','POOL','PROGRAM')),rem_project_id text,formatted_mapping text,
 bud text not null,bud_type text generated always as('BUD'::text) stored,
 gross_amount numeric(14,2) not null check(gross_amount>=0),media_amount numeric(14,2),fee_amount numeric(14,2),fee_po_ref text,
 memo_id uuid references ads.memo,observed_memo_no text,memo_snapshot jsonb,source_row_id uuid,origin text not null default 'MANUAL' check(origin in ('MANUAL','LEDGER')),
 check((component_kind='PHASE' and rem_project_id is not null and btrim(rem_project_id)<>'' and formatted_mapping is not null) or(component_kind<>'PHASE' and rem_project_id is null and formatted_mapping is null)),
 check((media_amount is null and fee_amount is null) or(media_amount>=0 and fee_amount>=0 and media_amount+fee_amount=gross_amount)),
 foreign key(bud_type,bud) references ads.vocab(vocab_type,code),unique(revision_id,rem_project_id)
);
create unique index line_single_pool on ads.media_line_component(revision_id) where component_kind<>'PHASE';
create table ads.line_budget_item (
 id uuid primary key default gen_random_uuid(),component_id uuid not null references ads.media_line_component,
 cost_type ads.cost_type not null,payment_method ads.payment_method not null,amount numeric(14,2) not null check(amount>=0)
);
create table ads.correction (
 id uuid primary key default gen_random_uuid(),observed_code text not null check(btrim(observed_code)<>''),agency text not null,
 month_from ads.finance_month not null,month_to ads.finance_month not null check(month_to>=month_from),reason text not null check(btrim(reason)<>''),evidence_ref text not null check(btrim(evidence_ref)<>''),
 status text not null default 'PROPOSED' check(status in ('PROPOSED','APPROVED','REJECTED','RETIRED')),reviewed_by uuid,reviewed_at timestamptz,review_reason text
);
create table ads.correction_target (
 id uuid primary key default gen_random_uuid(),correction_id uuid not null references ads.correction,month ads.finance_month not null,line_id uuid not null references ads.media_line,
 observed_code text not null,agency text not null,status text not null default 'PROPOSED' check(status in ('PROPOSED','APPROVED','APPLIED','REJECTED','RETIRED')),
 applied_by uuid,applied_at timestamptz,application_reason text,unique(correction_id,month)
);
create unique index correction_month_unique on ads.correction_target(observed_code,agency,month) where status in ('APPROVED','APPLIED');
create table ads.line_assignment (
 id uuid primary key default gen_random_uuid(),code text not null references ads.campaign_registration,month ads.finance_month not null,line_id uuid not null references ads.media_line,
 acknowledged_revision_id uuid not null references ads.media_line_revision,status text not null default 'ACTIVE' check(status in ('ACTIVE','ENDED')),
 correction_target_id uuid references ads.correction_target,reason text,ended_at timestamptz
);
create unique index assignment_one_month on ads.line_assignment(code,month) where status='ACTIVE';

create table ads.document_requirement (
 id uuid primary key default gen_random_uuid(),cost_type ads.cost_type not null,payment_method ads.payment_method not null,
 version integer not null default 1,valid_from date not null default '2026-09-30',valid_to date,
 requirement_codes text[] not null,status text not null default 'PROPOSED' check(status in ('PROPOSED','CONFIRMED','REVIEW_REQUIRED','RETIRED')),
 unique(cost_type,payment_method,version),check(valid_to is null or valid_to>valid_from)
);
insert into ads.document_requirement(cost_type,payment_method,requirement_codes,status)
select t::ads.cost_type,p::ads.payment_method,
 case when t='BANK_FEE' then case p when 'CORPORATE_CARD' then array['S','F'] when 'BANK_TRANSFER' then array['T','F'] else array[]::text[] end
 else array['M'] || case p when 'CORPORATE_CARD' then array['S','V'] when 'AGENCY_PO_INVOICE' then array['P'] when 'PLATFORM_INVOICE' then array['V'] else array['V','T'] end
 || case when t in ('MEDIA','CHANNEL') then array['A'] else array[]::text[] end
 || case when t in ('CHANNEL','TOOL') then array['C'] else array[]::text[] end end,
 case when t='BANK_FEE' then 'REVIEW_REQUIRED' else 'PROPOSED' end
from unnest(array['MEDIA','AGENCY_FEE','CHANNEL','TOOL','BANK_FEE']) t cross join unnest(array['CORPORATE_CARD','AGENCY_PO_INVOICE','PLATFORM_INVOICE','BANK_TRANSFER']) p;
create table ads.ad_account (
 id uuid primary key default gen_random_uuid(),platform text not null,account_id text not null check(length(account_id) between 1 and 200 and account_id=btrim(account_id)),label text,
 unique(platform,account_id)
);
create table ads.channel_account (
 id uuid primary key default gen_random_uuid(),channel text not null default 'LINE_OA' check(channel='LINE_OA'),account_id text,label text not null,steward_ref text,
 check(nullif(btrim(account_id),'') is not null or nullif(btrim(steward_ref),'') is not null),unique(channel,account_id)
);
create table ads.account_mapping (
 id uuid primary key default gen_random_uuid(),ad_account_id uuid references ads.ad_account,channel_account_id uuid references ads.channel_account,
 scope_id uuid not null references ads.scope_code,agency text,bud text,bud_splits jsonb not null default '[]',plan text,expected_amount numeric(14,2),
 valid_from date not null,valid_to date,closed_on date,closed_by uuid,closed_at timestamptz,close_reason text,status text not null default 'DRAFT' check(status in ('DRAFT','CONFIRMED','RETIRED')),
 evidence_ref text not null check(btrim(evidence_ref)<>''),confirmed_by uuid,confirmed_at timestamptz,
 check((ad_account_id is null)<>(channel_account_id is null)),check(valid_to is null or valid_to>valid_from),check(closed_on is null or(closed_on>valid_from and(valid_to is null or closed_on<=valid_to))),check(expected_amount is null or expected_amount>=0),
 check((bud is not null and bud_splits='[]') or(bud is null and jsonb_typeof(bud_splits)='array' and jsonb_array_length(bud_splits)>0)),
 check(channel_account_id is null or(bud is not null and plan is not null and expected_amount is not null))
);
create table ads.recurring_commitment (
 id uuid primary key default gen_random_uuid(),vendor text not null check(btrim(vendor)<>''),state text not null default 'DRAFT' check(state in ('DRAFT','ACTIVE','SUSPENDED','CLOSED')),
 reason text
);
create table ads.commitment_version (
 id uuid primary key default gen_random_uuid(),commitment_id uuid not null references ads.recurring_commitment,version_no integer not null,status text not null default 'DRAFT' check(status in ('DRAFT','CONFIRMED','SUPERSEDED')),
 account_mapping_id uuid references ads.account_mapping,vendor_account_ref text,scope_id uuid not null references ads.scope_code,bud text,bud_splits jsonb not null default '[]',
 plan text not null,cost_type ads.cost_type not null,payment_method ads.payment_method not null,amount_per_cycle numeric(14,2) not null check(amount_per_cycle>=0),
 frequency text not null check(frequency in ('MONTHLY','ANNUAL')),start_date date not null,end_date date not null check(end_date>=start_date),evidence_ref text not null check(btrim(evidence_ref)<>''),
 reconciliation_acknowledgements jsonb not null default '[]',confirmed_by uuid,confirmed_at timestamptz,
 check(account_mapping_id is not null or nullif(btrim(vendor_account_ref),'') is not null),
 check((bud is not null and bud_splits='[]') or(bud is null and jsonb_typeof(bud_splits)='array' and jsonb_array_length(bud_splits)>0)),unique(commitment_id,version_no)
);
create unique index commitment_one_confirmed on ads.commitment_version(commitment_id) where status='CONFIRMED';
create table ads.commitment_memo_cover (
 id uuid primary key default gen_random_uuid(),commitment_version_id uuid not null references ads.commitment_version,memo_id uuid not null references ads.memo,bud text not null,
 coverage_start ads.finance_month not null,coverage_end ads.finance_month not null check(coverage_end>=coverage_start),cap_amount numeric(14,2) not null check(cap_amount>=0),
 memo_material_version integer,component_id uuid references ads.media_line_component,budget_item_id uuid references ads.line_budget_item,
 evidence_ref text not null check(btrim(evidence_ref)<>''),status text not null default 'DRAFT' check(status in ('DRAFT','CONFIRMED','SUSPENDED','SUPERSEDED')),
 check(budget_item_id is null or component_id is not null)
);
create table ads.commitment_occurrence (
 id uuid primary key default gen_random_uuid(),commitment_version_id uuid not null references ads.commitment_version,cycle_no integer not null check(cycle_no>0),charge_date date not null,
 coverage_start ads.finance_month not null,coverage_end ads.finance_month not null check(coverage_end>=coverage_start),expected_amount numeric(14,2) not null check(expected_amount>=0),
 unique(commitment_version_id,cycle_no)
);
create table ads.card_statement_control (
 id uuid primary key default gen_random_uuid(),operator_ref text not null unique,issuer text not null,cycle_start date not null,cycle_end date not null check(cycle_end>=cycle_start),due_date date not null,
 currency text not null default 'THB' check(currency='THB'),declared_total numeric(14,2) not null check(declared_total>=0),
 total_meaning text not null default 'REVIEW_REQUIRED' check(total_meaning in ('NET_CHARGES','REVIEW_REQUIRED')),evidence_ref text not null,
 review_status text not null default 'DRAFT' check(review_status in ('DRAFT','CONFIRMED'))
);
create table staging.ads_ledger_batch (
 id uuid primary key default gen_random_uuid(),source_fingerprint text not null unique check(source_fingerprint ~ '^[0-9a-f]{64}$'),logical_source_id text not null,
 source_file text not null,tab text not null,month ads.finance_month not null,profile_id text not null,profile_version text not null,provenance jsonb not null,
 status text not null check(status in ('APPLIED','QUARANTINED')),issues jsonb not null default '[]'
);
create table staging.ads_ledger_row (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references staging.ads_ledger_batch,row_no integer not null check(row_no>0),row_hash text not null check(row_hash ~ '^[0-9a-f]{64}$'),
 raw_row jsonb not null,typed_row jsonb not null,status text not null check(status in ('APPLIED','QUARANTINED')),issues jsonb not null default '[]',unique(batch_id,row_no)
);
alter table ads.media_line_component add foreign key(source_row_id) references staging.ads_ledger_row;
create table staging.ads_card_batch (
 id uuid primary key default gen_random_uuid(),source_fingerprint text not null unique check(source_fingerprint ~ '^[0-9a-f]{64}$'),statement_control_id uuid not null references ads.card_statement_control,
 logical_source_id text not null,source_file text not null,tab text not null,profile_id text not null,profile_version text not null,provenance jsonb not null,
 status text not null check(status in ('APPLIED_DRAFT','QUARANTINED','CONFIRMED','SUPERSEDED')),issues jsonb not null default '[]',
 debit_total numeric(14,2) not null,credit_total numeric(14,2) not null,net_total numeric(14,2) not null,confirmed_by uuid,confirmed_at timestamptz
);
create unique index card_one_confirmed on staging.ads_card_batch(statement_control_id) where status='CONFIRMED';
create table staging.ads_card_row (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references staging.ads_card_batch,row_no integer not null check(row_no>0),row_hash text not null check(row_hash ~ '^[0-9a-f]{64}$'),
 raw_row jsonb not null,typed_row jsonb not null,amount numeric(14,2) check(amount>=0),direction text check(direction in ('DEBIT','CREDIT')),
 charge_date date,posting_date date,interpretation integer not null default 1,issues jsonb not null default '[]',unique(batch_id,row_no)
);
create table ads.cost_record (
 id uuid primary key default gen_random_uuid(),source_row_id uuid references staging.ads_card_row,interpretation integer not null default 1,item_no integer not null default 1,
 cost_type ads.cost_type not null,payment_method ads.payment_method not null,direction text not null default 'DEBIT' check(direction in ('DEBIT','CREDIT')),
 amount numeric(14,2) not null check(amount>=0),charge_date date not null,posting_date date,vendor text,scope_id uuid references ads.scope_code,bud text,
 account_mapping_id uuid references ads.account_mapping,memo_id uuid references ads.memo,observed_memo_no text,commitment_occurrence_id uuid references ads.commitment_occurrence,line_id uuid references ads.media_line,
 evidence_refs jsonb not null default '{}',document_status text not null default 'REVIEW_REQUIRED' check(document_status in ('REVIEW_REQUIRED','INCOMPLETE','COMPLETE')),
 attribution_status text not null default 'UNRESOLVED' check(attribution_status in ('UNRESOLVED','CONFIRMED','CONFLICT')),
 status text not null default 'DRAFT' check(status in ('DRAFT','CONFIRMED','SUPERSEDED')),refund_of uuid references ads.cost_record,
 unique(source_row_id,interpretation,item_no)
);
create table ads.cost_allocation_set (
 id uuid primary key default gen_random_uuid(),cost_id uuid not null references ads.cost_record,version_no integer not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','CONFIRMED','SUPERSEDED')),method text not null check(method in ('EXPLICIT','EQUAL_MONTHS')),
 reason text not null,confirmed_by uuid,confirmed_at timestamptz,unique(cost_id,version_no)
);
create unique index cost_one_allocation on ads.cost_allocation_set(cost_id) where status='CONFIRMED';
create table ads.cost_allocation (
 id uuid primary key default gen_random_uuid(),allocation_set_id uuid not null references ads.cost_allocation_set,cost_id uuid not null references ads.cost_record,
 month ads.finance_month not null,scope_id uuid not null references ads.scope_code,bud text not null,amount numeric(14,2) not null check(amount>=0),direction text not null check(direction in ('DEBIT','CREDIT')),
 cost_type ads.cost_type not null,payment_method ads.payment_method not null,account_mapping_id uuid references ads.account_mapping,commitment_occurrence_id uuid references ads.commitment_occurrence,
 unique(allocation_set_id,month,scope_id,bud)
);

-- The one shared lock deliberately serializes this low-volume workflow. Per-domain
-- locks can replace it if measured write throughput requires that complexity.
create function ads.finance_touch() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 new.updated_at:=clock_timestamp();new.updated_by:=nullif(current_setting('app.actor_id',true),'')::uuid;
 new.row_version:=old.row_version+1;return new;
end $$;
create function ads.finance_no_delete() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin raise exception 'ห้ามลบประวัติทางการเงิน' using errcode='23514';end $$;
create function ads.finance_frozen() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare frozen boolean:=false;before_data jsonb:=to_jsonb(old);after_data jsonb:=to_jsonb(new);
begin
 if tg_table_name='account_mapping' then
 if current_user='ads_finance_writer' and old.closed_on is null and new.closed_on is not null
 and new.close_reason is not null and new.closed_by is not null and new.closed_at is not null
 and(before_data-array['closed_on','closed_by','closed_at','close_reason','row_version','updated_at','updated_by'])=(after_data-array['closed_on','closed_by','closed_at','close_reason','row_version','updated_at','updated_by']) then return new;end if;end if;
 if tg_table_name in ('media_line_revision','commitment_version') and current_user='ads_finance_writer'
 and nullif(current_setting('app.finance_confirming_revision',true),'')=old.id::text
 and (before_data-array['reconciliation_acknowledgements','row_version','updated_at','updated_by'])=(after_data-array['reconciliation_acknowledgements','row_version','updated_at','updated_by']) then return new;end if;
 if tg_table_name in ('media_line_revision','account_mapping','commitment_version','commitment_memo_cover','cost_record','cost_allocation_set') then
 frozen:=before_data->>'status' in ('APPROVED','CONFIRMED','SUPERSEDED','RETIRED');
 if frozen and ((before_data-array['status','row_version','updated_at','updated_by']) is distinct from(after_data-array['status','row_version','updated_at','updated_by'])
 or after_data->>'status' not in ('SUPERSEDED','RETIRED','SUSPENDED')) then raise exception 'ข้อมูลที่ยืนยันแล้วแก้ไขไม่ได้ ให้สร้างรุ่นใหม่' using errcode='23514';end if;
 elsif tg_table_name='media_line_component' then select status<>'DRAFT' into frozen from ads.media_line_revision where id=old.revision_id;
 elsif tg_table_name='line_budget_item' then select r.status<>'DRAFT' into frozen from ads.media_line_component c join ads.media_line_revision r on r.id=c.revision_id where c.id=old.component_id;
 elsif tg_table_name='commitment_occurrence' then select status<>'DRAFT' into frozen from ads.commitment_version where id=old.commitment_version_id;
 elsif tg_table_name='cost_allocation' then select status<>'DRAFT' into frozen from ads.cost_allocation_set where id=old.allocation_set_id;
 end if;
 if frozen and tg_table_name in ('media_line_component','line_budget_item','commitment_occurrence','cost_allocation') then raise exception 'รายละเอียดรุ่นที่ยืนยันแล้วแก้ไขไม่ได้' using errcode='23514';end if;
 return new;
end $$;
create function ads.finance_invariant() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare k uuid;begin
 if tg_table_name='media_line' then k:=new.id;else k:=new.line_id;end if;
 if exists(select 1 from ads.media_line where id=k and state='ACTIVE') and (select count(*) from ads.media_line_revision where line_id=k and status='APPROVED')<>1 then raise exception 'รายการที่ใช้งานต้องมีรุ่นที่ยืนยันเพียงรุ่นเดียว' using errcode='23514';end if;return null;
end $$;
create constraint trigger active_line_revision after insert or update on ads.media_line deferrable initially deferred for each row execute function ads.finance_invariant();
create constraint trigger active_revision_line after insert or update on ads.media_line_revision deferrable initially deferred for each row execute function ads.finance_invariant();

create function ads.finance_line_check(k uuid,rid uuid) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare l ads.media_line;c ads.media_line_component;r ads.media_line_revision;s ads.scope_code;m ads.memo;
begin
 select * into l from ads.media_line where id=k;select * into r from ads.media_line_revision where id=rid and line_id=k;
 if r.id is null then raise exception 'รุ่นไม่ตรงกับรายการงบ' using errcode='22023';end if;
 if l.scope_id is not null then select * into s from ads.scope_code where scope_id=l.scope_id and status='ACTIVE';if s.scope_id is null then raise exception 'ขอบเขตยังไม่พร้อมใช้งาน' using errcode='22023';end if;end if;
 if l.kind='GROUP' and s.kind<>'GROUP' or l.kind='ZONE_POOL' and s.kind<>'ZONE' or l.kind='BRAND_POOL' and s.kind<>'BRAND' or l.kind='BU_PROGRAM' and s.kind<>'BU' then raise exception 'ชนิดขอบเขตไม่ตรงกับรายการงบ' using errcode='22023';end if;
 if l.agency is not null and not ads.active_vocab('AGENCY',l.agency) then raise exception 'เอเจนซียังไม่พร้อมใช้งาน' using errcode='22023';end if;
 if not exists(select 1 from ads.media_line_component where revision_id=rid) then raise exception 'กรุณาเพิ่มรายละเอียดงบ' using errcode='22023';end if;
 if l.kind in ('CORP_PROGRAM','BU_PROGRAM') then
 if not r.mapping_verified or cardinality(r.permitted_scope_ids)=0 or cardinality(r.permitted_agencies)=0
 or exists(select 1 from unnest(r.permitted_scope_ids) q where not exists(select 1 from ads.scope_code where scope_id=q and status='ACTIVE' and kind=case l.kind when 'CORP_PROGRAM' then 'CORP' else 'BU' end))
 or exists(select 1 from unnest(r.permitted_agencies) a where not ads.active_vocab('AGENCY',a))
 or(l.kind='BU_PROGRAM' and r.permitted_scope_ids<>array[l.scope_id]) then raise exception 'ต้องยืนยันโปรแกรม ขอบเขต เอเจนซี และ BUD ก่อน' using errcode='22023';end if;
 if exists(select 1 from ads.media_line x where x.id<>k and x.state='ACTIVE' and x.kind=l.kind and x.program_ref=l.program_ref and x.scope_id is not distinct from l.scope_id and daterange(x.period_start_month,x.period_end_month,'[]') && daterange(l.period_start_month,l.period_end_month,'[]')) then raise exception 'ช่วงเวลาโปรแกรมซ้อนกับรายการที่ใช้งาน' using errcode='23505';end if;
 end if;
 for c in select * from ads.media_line_component where revision_id=rid loop
 perform ads.finance_bud(c.bud);
 if (l.kind='GROUP')<>(c.component_kind='PHASE') or(l.kind in ('CORP_PROGRAM','BU_PROGRAM'))<>(c.component_kind='PROGRAM') then raise exception 'รายละเอียดไม่ตรงกับชนิดรายการงบ' using errcode='22023';end if;
 if c.component_kind='PHASE' and(c.formatted_mapping<>s.scope_code or not exists(select 1 from ads.scope_member sm join ads.scope_code sc using(scope_id) where sm.member_type='PHASE' and sm.member_id=c.rem_project_id and sm.parent_group_id=s.scope_code and sc.kind='PHASE' and sc.status='ACTIVE')) then raise exception 'รหัสเฟสไม่ตรงกับกลุ่มที่ยืนยันแล้ว' using errcode='22023';end if;
 if l.kind='CORP_PROGRAM' and c.bud<>'SID' then raise exception 'รายการ Corporate ต้องใช้ BUD SID' using errcode='22023';end if;
 if (select coalesce(sum(amount),0)>c.gross_amount from ads.line_budget_item where component_id=c.id) then raise exception 'รายการแยกประเภทเกินงบรวม' using errcode='22023';end if;
 end loop;
end $$;
create function ads.finance_components(rid uuid,parts jsonb) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare c jsonb;b jsonb;added jsonb;begin
 if jsonb_typeof(parts)<>'array' or jsonb_array_length(parts) not between 1 and 1000 then raise exception 'จำนวนรายการงบไม่ถูกต้อง' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(parts) loop
 added:=ads.finance_put('ads.media_line_component',ads.finance_pick(c,array['component_kind','rem_project_id','formatted_mapping','bud','gross_amount','media_amount','fee_amount','memo_id','observed_memo_no','fee_po_ref','source_row_id','origin'])||jsonb_build_object('revision_id',rid));
 for b in select value from jsonb_array_elements(coalesce(c->'budget_items','[]')) loop perform ads.finance_put('ads.line_budget_item',ads.finance_pick(b,array['cost_type','payment_method','amount'])||jsonb_build_object('component_id',added->>'id'));end loop;
 end loop;
end $$;
create function ads.finance_memo_allocated(k uuid) returns numeric language sql stable set search_path=pg_catalog,pg_temp as $$
 select coalesce((select sum(c.gross_amount) from ads.media_line_component c join ads.media_line_revision r on r.id=c.revision_id join ads.media_line l on l.id=r.line_id where c.memo_id=k and r.status='APPROVED' and l.state='ACTIVE'),0)
 +coalesce((select sum(c.cap_amount) from ads.commitment_memo_cover c join ads.commitment_version v on v.id=c.commitment_version_id join ads.recurring_commitment rc on rc.id=v.commitment_id where c.memo_id=k and c.component_id is null and c.status='CONFIRMED' and v.status='CONFIRMED' and rc.state='ACTIVE'),0)
$$;
create function ads.finance_ack(memo_ids uuid[],acks jsonb,actor uuid) returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare m ads.memo;a jsonb;allocated numeric;answer jsonb:='[]';begin
 for m in select * from ads.memo where id=any(memo_ids) loop
 allocated:=ads.finance_memo_allocated(m.id);
 if allocated<>m.gross_amount then
 select value into a from jsonb_array_elements(coalesce(acks,'[]')) where value->>'memo_id'=m.id::text;
 if nullif(btrim(a->>'reason'),'') is null then raise exception 'วงเงิน Memo มีผลต่าง กรุณาระบุเหตุผลการตรวจสอบ' using errcode='22023';end if;
 answer:=answer||jsonb_build_array(jsonb_build_object('memo_id',m.id,'material_version',m.material_version,'memo_gross',m.gross_amount,'allocated_amount',allocated,'difference',m.gross_amount-allocated,'reason',a->>'reason','reviewed_by',actor,'reviewed_at',clock_timestamp()));end if;
 end loop;return answer;end $$;
create function ads.finance_assignment_check(code_value text,month_value date,line_value uuid,revision_value uuid,allow_archived boolean default false) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare cr ads.campaign_registration;s ads.scope_code;l ads.media_line;r ads.media_line_revision;ls ads.scope_code;begin
 select * into cr from ads.campaign_registration where code=code_value and status='REGISTERED';select * into s from ads.scope_code where scope_id=cr.scope_id and status='ACTIVE';
 select * into l from ads.media_line where id=line_value and state='ACTIVE' and(archived_at is null or allow_archived);select * into r from ads.media_line_revision where id=revision_value and line_id=line_value and status='APPROVED';
 if cr.code is null or s.scope_id is null or l.id is null or r.id is null then raise exception 'รายการยังไม่พร้อมเชื่อมหรือรุ่นเปลี่ยนแล้ว' using errcode='40001';end if;
 select * into ls from ads.scope_code where scope_id=l.scope_id;
 if s.kind in ('GROUP','PHASE','MULTI_PHASE') then
 if l.kind<>'GROUP' or l.month<>month_value or l.agency<>cr.agency or ls.scope_code<>(case when s.kind='GROUP' then s.scope_code else s.parent_group_id end)
 or(s.kind in ('PHASE','MULTI_PHASE') and exists(select 1 from ads.scope_member sm where sm.scope_id=s.scope_id and sm.member_type='PHASE' and not exists(select 1 from ads.media_line_component c where c.revision_id=r.id and c.rem_project_id=sm.member_id))) then raise exception 'กลุ่ม เฟส เดือน หรือเอเจนซีไม่ตรงกัน' using errcode='22023';end if;
 elsif s.kind in ('ZONE','BRAND') then
 if l.scope_id<>s.scope_id or l.month<>month_value or l.agency<>cr.agency or l.kind<>(case when s.kind='ZONE' then 'ZONE_POOL' else 'BRAND_POOL' end) then raise exception 'ขอบเขตพูล เดือน หรือเอเจนซีไม่ตรงกัน' using errcode='22023';end if;
 else
 if l.kind<>(case s.kind when 'CORP' then 'CORP_PROGRAM' else 'BU_PROGRAM' end) or month_value not between l.period_start_month and l.period_end_month or not(s.scope_id=any(r.permitted_scope_ids)) or not(cr.agency=any(r.permitted_agencies)) or not r.mapping_verified then raise exception 'โปรแกรม ช่วงเวลา หรือหน่วยงานไม่ตรงกัน' using errcode='22023';end if;
 end if;end $$;
do $$ declare t text;s text; begin
 for s,t in select schemaname,tablename from pg_tables where (schemaname='ads' and tablename in
 ('memo','memo_identifier','media_line','media_line_revision','media_line_component','line_budget_item','correction','correction_target','line_assignment','document_requirement','ad_account','channel_account','account_mapping','recurring_commitment','commitment_version','commitment_memo_cover','commitment_occurrence','card_statement_control','cost_record','cost_allocation_set','cost_allocation'))
 or(schemaname='staging' and tablename in('ads_ledger_batch','ads_ledger_row','ads_card_batch','ads_card_row')) loop
 execute format('alter table %I.%I add created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,add updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,add created_at timestamptz not null default clock_timestamp(),add updated_at timestamptz not null default clock_timestamp(),add row_version integer not null default 1',s,t);
 execute format('alter table %I.%I enable row level security',s,t);execute format('alter table %I.%I force row level security',s,t);
 execute format('create policy finance_writer on %I.%I to ads_finance_writer using(true) with check(true)',s,t);
 execute format('create policy finance_staff on %I.%I for select to online_staff,admin using(nullif(current_setting(''app.actor_id'',true),'''') is not null)',s,t);
 execute format('grant select,insert,update on %I.%I to ads_finance_writer',s,t);
 execute format('grant select on %I.%I to online_staff,admin',s,t);
 execute format('create trigger finance_touch before update on %I.%I for each row execute function ads.finance_touch()',s,t);
 execute format('create trigger audit_write after insert or update or delete on %I.%I for each row execute function audit.record_change()',s,t);
 end loop;
end $$;
grant usage on schema staging to online_staff;

-- Helpers have no caller grants. All mutations enter finance_command below.
create function ads.finance_pick(p jsonb,keys text[]) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p) where key=any(keys)
$$;
create function ads.finance_put(target regclass,p jsonb,existing uuid default null) returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare cols text;vals text;result jsonb;
begin
 select string_agg(format('%I',key),','),string_agg(format('x.%I',key),',') into cols,vals from jsonb_each(p);
 if existing is null then execute format('insert into %s(%s) select %s from jsonb_populate_record(null::%s,$1) x returning to_jsonb(%s.*)',target,cols,vals,target,split_part(target::text,'.',2)) using p into result;
 else execute format('update %s t set (%s)=(select %s from jsonb_populate_record(null::%s,$1) x) where id=$2 returning to_jsonb(t.*)',target,cols,vals,target) using p,existing into result; end if;
 return result;
end $$;
create function ads.finance_money(p jsonb) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare r record;x jsonb;v text;
begin
 if jsonb_typeof(p)='object' then
 for r in select * from jsonb_each(p) loop
 if r.key=any(array['provenance','raw_row','issues','header_map']) then continue;end if;
 if r.key=any(array['gross_amount','media_amount','fee_amount','amount','amount_per_cycle','expected_amount','cap_amount','declared_total','debit_total','credit_total','net_total']) and r.value<>'null'::jsonb then
 v:=r.value#>>'{}';if v !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' or(v::numeric<0 and r.key<>'net_total') then raise exception 'จำนวนเงินต้องเป็นบาทและมีทศนิยมไม่เกินสองตำแหน่ง' using errcode='22023';end if;
 else perform ads.finance_money(r.value);end if;end loop;
 elsif jsonb_typeof(p)='array' then for x in select value from jsonb_array_elements(p) loop perform ads.finance_money(x);end loop;end if;
end $$;
create function ads.finance_version(target regclass,k uuid,expected integer) returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin execute format('select to_jsonb(t.*) from %s t where id=$1 for update',target) using k into result;
 if result is null then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 if expected is null or(result->>'row_version')::integer<>expected then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;return result;end $$;
create function ads.finance_evidence(v text) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if coalesce(v,'') ~* '(://[^/ ]+@|[?&](token|key|signature|sig|password|secret|x-amz-credential|x-amz-signature)=)' then raise exception 'ห้ามบันทึกลิงก์ที่มีรหัสลับ' using errcode='22023';end if;end $$;
create function ads.finance_bud(v text) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if not ads.active_vocab('BUD',v) then raise exception 'ไม่พบ BUD ที่เปิดใช้งาน' using errcode='22023';end if;end $$;
create function ads.finance_splits(bud text,splits jsonb,scope uuid) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare x jsonb;total integer:=0;begin
 if bud is not null then perform ads.finance_bud(bud);if splits<>'[]' then raise exception 'เลือก BUD หรือสัดส่วนอย่างใดอย่างหนึ่ง' using errcode='22023';end if;return;end if;
 if (select kind from ads.scope_code where scope_id=scope)<>'BRAND' or jsonb_array_length(splits)=0 then raise exception 'สัดส่วน BUD ใช้กับบัญชีระดับแบรนด์ที่ยืนยันแล้ว' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(splits) loop perform ads.finance_bud(x->>'bud');if x->>'weight_bps' !~ '^[0-9]+$' or (x->>'weight_bps')::integer not between 1 and 10000 then raise exception 'สัดส่วน BUD ไม่ถูกต้อง' using errcode='22023';end if;total:=total+(x->>'weight_bps')::integer;end loop;
 if total<>10000 or(select count(*)<>count(distinct value->>'bud') from jsonb_array_elements(splits)) then raise exception 'สัดส่วน BUD ต้องรวม 10000 และไม่ซ้ำ' using errcode='22023';end if;
end $$;

create function ads.finance_read(resource text,key text default null,filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare target regclass;v jsonb;items jsonb:='[]';row_data jsonb;child jsonb;sub jsonb;revision jsonb;total integer:=0;
 lim integer:=least(greatest(coalesce((filters->>'limit')::integer,50),1),200);off integer:=greatest(coalesce((filters->>'offset')::integer,0),0);k uuid;matched boolean;why text;
begin
 perform hub.require_actor(array['online_staff','admin']);
 if resource='registration-monthly-lines' then
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('line',ads.finance_read('media-lines',a.line_id::text),'review_status',case when l.state='ACTIVE' and a.acknowledged_revision_id=r.id then 'CURRENT' else 'REVIEW_REQUIRED' end) order by a.month desc) from ads.line_assignment a join ads.media_line l on l.id=a.line_id left join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED' where a.code=key),'[]'));
 elsif resource='line-candidates' then
 for v in select ads.finance_read('media-lines',l.id::text)||jsonb_build_object('revision_id',r.id) from ads.media_line l left join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED' where l.month=(filters->>'month')::date or(filters->>'month')::date between l.period_start_month and l.period_end_month order by l.created_at desc limit 200 loop
 matched:=true;why:='เลือกเชื่อมได้';begin perform ads.finance_assignment_check(key,(filters->>'month')::date,(v->>'id')::uuid,(v->>'revision_id')::uuid);exception when others then matched:=false;why:=sqlerrm;end;
 items:=items||jsonb_build_array(v||jsonb_build_object('eligible',matched,'reason',why));end loop;return jsonb_build_object('items',items);
 end if;
 target:=case resource when 'memos' then 'ads.memo'::regclass when 'memo-identifiers' then 'ads.memo_identifier'::regclass
 when 'media-lines' then 'ads.media_line'::regclass when 'line-assignments' then 'ads.line_assignment'::regclass when 'corrections' then 'ads.correction'::regclass
 when 'ledger-imports' then 'staging.ads_ledger_batch'::regclass when 'ad-accounts' then 'ads.ad_account'::regclass when 'channel-accounts' then 'ads.channel_account'::regclass
 when 'commitments' then 'ads.recurring_commitment'::regclass when 'statement-controls' then 'ads.card_statement_control'::regclass when 'card-imports' then 'staging.ads_card_batch'::regclass
 when 'costs' then 'ads.cost_record'::regclass when 'document-requirements' then 'ads.document_requirement'::regclass end;
 if target is null then raise exception 'ไม่พบประเภทข้อมูล' using errcode='22023';end if;
 if key is null then
 for row_data in execute format('select to_jsonb(t) from %s t order by created_at desc,id',target) loop
 if filters ? 'search' and not(row_data::text ilike '%'||(filters->>'search')||'%') then continue;end if;
 if filters ? 'status' and coalesce(row_data->>'state',row_data->>'status',row_data->>'record_status')<>filters->>'status' then continue;end if;
 if filters ? 'agency' and resource='media-lines' and row_data->>'agency' is distinct from filters->>'agency' and not exists(select 1 from ads.media_line_revision where line_id=(row_data->>'id')::uuid and status<>'SUPERSEDED' and filters->>'agency'=any(permitted_agencies)) then continue;end if;
 if filters ? 'scope_id' and resource='media-lines' and row_data->>'scope_id' is distinct from filters->>'scope_id' and not exists(select 1 from ads.media_line_revision where line_id=(row_data->>'id')::uuid and status<>'SUPERSEDED' and(filters->>'scope_id')::uuid=any(permitted_scope_ids)) then continue;end if;
 if filters ? 'month' and resource='media-lines' and not(coalesce(row_data->>'month'=filters->>'month',false) or coalesce((filters->>'month')::date between(row_data->>'period_start_month')::date and(row_data->>'period_end_month')::date,false)) then continue;end if;
 if filters ? 'bud' then
 if resource='memos' and row_data->>'requesting_bud'<>filters->>'bud' then continue;end if;
 if resource='media-lines' and not exists(select 1 from ads.media_line_component c join ads.media_line_revision r on r.id=c.revision_id where r.line_id=(row_data->>'id')::uuid and c.bud=filters->>'bud' and r.status<>'SUPERSEDED') then continue;end if;end if;
 total:=total+1;
 if total>off and jsonb_array_length(items)<lim then items:=items||jsonb_build_array(ads.finance_read(resource,row_data->>'id'));end if;
 end loop;return jsonb_build_object('items',items,'total',total,'limit',lim,'offset',off);
 end if;
 k:=key::uuid;execute format('select to_jsonb(t) from %s t where id=$1',target) using k into v;
 if v is null then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 if resource='memos' then
 v:=v||jsonb_build_object('identifiers',coalesce((select jsonb_agg(to_jsonb(i)) from ads.memo_identifier i where memo_id=k),'[]'),
 'reconciliation',jsonb_build_object('allocated_amount',ads.finance_memo_allocated(k),'difference',(v->>'gross_amount')::numeric-ads.finance_memo_allocated(k)),
 'linked_lines',coalesce((select jsonb_agg(distinct jsonb_build_object('id',l.id,'kind',l.kind,'state',l.state,'month',l.month,'revision_id',r.id)) from ads.media_line_component c join ads.media_line_revision r on r.id=c.revision_id join ads.media_line l on l.id=r.line_id where c.memo_id=k),'[]'));
 elsif resource='media-lines' then
 for revision in select to_jsonb(r) from ads.media_line_revision r where line_id=k order by revision_no desc loop
 child:=(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('budget_items',coalesce((select jsonb_agg(to_jsonb(b)) from ads.line_budget_item b where b.component_id=c.id),'[]'),'memo',case when c.memo_id is null then null else(select jsonb_build_object('id',m.id,'memo_no',m.memo_no,'record_status',m.record_status,'mirrored_status',m.mirrored_status) from ads.memo m where m.id=c.memo_id) end) order by c.rem_project_id),'[]') from ads.media_line_component c where revision_id=(revision->>'id')::uuid);
 items:=items||jsonb_build_array(revision||jsonb_build_object('components',child,'gross_amount',(select coalesce(sum(gross_amount),0) from ads.media_line_component where revision_id=(revision->>'id')::uuid)));end loop;
 v:=v||jsonb_build_object('revisions',items,'current_revision_id',(select id from ads.media_line_revision where line_id=k and status='APPROVED'),
 'gross_amount',(select coalesce(sum(c.gross_amount),0) from ads.media_line_component c where c.revision_id=(select id from ads.media_line_revision where line_id=k order by(status='APPROVED') desc,revision_no desc limit 1)),
 'scope',(select to_jsonb(s) from ads.scope_code s where scope_id=(v->>'scope_id')::uuid),'budget_grain',case when v->>'month' is null then 'PERIOD' else 'MONTH' end,
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('review_status',case when v->>'state'='ACTIVE' and a.acknowledged_revision_id=(select id from ads.media_line_revision where line_id=k and status='APPROVED') then 'CURRENT' else 'REVIEW_REQUIRED' end)) from ads.line_assignment a where line_id=k),'[]'));
 elsif resource='corrections' then v:=v||jsonb_build_object('targets',coalesce((select jsonb_agg(to_jsonb(t) order by month) from ads.correction_target t where correction_id=k),'[]'));
 elsif resource in('ad-accounts','channel-accounts') then v:=v||jsonb_build_object('mappings',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('effective_valid_to',least(m.valid_to,m.closed_on)) order by valid_from desc) from ads.account_mapping m where ad_account_id=k or channel_account_id=k),'[]'));
 elsif resource='commitments' then
 for revision in select to_jsonb(r) from ads.commitment_version r where commitment_id=k order by version_no desc loop
 items:=items||jsonb_build_array(revision||jsonb_build_object('occurrences',coalesce((select jsonb_agg(to_jsonb(o) order by cycle_no) from ads.commitment_occurrence o where commitment_version_id=(revision->>'id')::uuid),'[]'),
 'covers',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('actual_consumption',ads.finance_cover_consumed(c.id),'remaining_cap',c.cap_amount-ads.finance_cover_consumed(c.id))) from ads.commitment_memo_cover c where commitment_version_id=(revision->>'id')::uuid),'[]'),
 'monthly_preview',ads.finance_commitment_preview((revision->>'id')::uuid)));end loop;
 v:=v||jsonb_build_object('versions',items,'current_version_id',(select id from ads.commitment_version where commitment_id=k and status='CONFIRMED'));
 elsif resource='ledger-imports' then v:=v||jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by row_no) from staging.ads_ledger_row r where batch_id=k),'[]'));
 elsif resource='card-imports' then
 v:=v||jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('costs',coalesce((select jsonb_agg(to_jsonb(c) order by interpretation,item_no) from ads.cost_record c where source_row_id=r.id),'[]')) order by row_no) from staging.ads_card_row r where batch_id=k),'[]'),
 'statement_control',(select to_jsonb(s) from ads.card_statement_control s where id=(v->>'statement_control_id')::uuid),
 'difference',(v->>'net_total')::numeric-(select declared_total from ads.card_statement_control where id=(v->>'statement_control_id')::uuid),
 'previous_batch_id',(select id from staging.ads_card_batch where statement_control_id=(v->>'statement_control_id')::uuid and status='CONFIRMED' and id<>k));
 elsif resource='costs' then v:=v||jsonb_build_object('allocations',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(a) order by month,bud) from ads.cost_allocation a where allocation_set_id=s.id),'[]')) order by version_no desc) from ads.cost_allocation_set s where cost_id=k),'[]'));
 end if;return v;
end $$;

create function ads.finance_commitment_draft(k uuid,p jsonb) returns uuid language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v jsonb;x jsonb;rid uuid;begin
 perform ads.finance_splits(p->>'bud',coalesce(p->'bud_splits','[]'),(p->>'scope_id')::uuid);perform ads.finance_evidence(p->>'evidence_ref');
 v:=ads.finance_put('ads.commitment_version',ads.finance_pick(p,array['account_mapping_id','vendor_account_ref','scope_id','bud','bud_splits','plan','cost_type','payment_method','amount_per_cycle','frequency','start_date','end_date','evidence_ref'])
 ||jsonb_build_object('commitment_id',k,'version_no',(select coalesce(max(version_no),0)+1 from ads.commitment_version where commitment_id=k)));rid:=(v->>'id')::uuid;
 for x in select value from jsonb_array_elements(coalesce(p->'occurrences','[]')) loop perform ads.finance_put('ads.commitment_occurrence',ads.finance_pick(x,array['cycle_no','charge_date','coverage_start','coverage_end','expected_amount'])||jsonb_build_object('commitment_version_id',rid));end loop;
 for x in select value from jsonb_array_elements(coalesce(p->'covers','[]')) loop perform ads.finance_evidence(x->>'evidence_ref');perform ads.finance_put('ads.commitment_memo_cover',ads.finance_pick(x,array['memo_id','bud','coverage_start','coverage_end','cap_amount','component_id','budget_item_id','evidence_ref'])||jsonb_build_object('commitment_version_id',rid));end loop;
 return rid;end $$;
create function ads.finance_commitment_activate(k uuid,rid uuid,previous uuid,acks jsonb,actor uuid) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v ads.commitment_version;c ads.commitment_memo_cover;m ads.memo;o ads.commitment_occurrence;comp ads.media_line_component;
 shares jsonb;share jsonb;forecast numeric;reserved numeric;cap numeric;memo_ids uuid[];current_id uuid;days integer;
begin
 select id into current_id from ads.commitment_version where commitment_id=k and status='CONFIRMED';if current_id is distinct from previous then raise exception 'รุ่นภาระผูกพันเปลี่ยนแล้ว' using errcode='40001';end if;
 select * into v from ads.commitment_version where id=rid and commitment_id=k and status='DRAFT';if v.id is null then raise exception 'ไม่พบรุ่นร่าง' using errcode='22023';end if;
 if not exists(select 1 from ads.scope_code where scope_id=v.scope_id and status='ACTIVE') then raise exception 'ขอบเขตยังไม่พร้อมใช้งาน' using errcode='22023';end if;
 if v.account_mapping_id is not null and not exists(select 1 from ads.account_mapping am where am.id=v.account_mapping_id and am.status='CONFIRMED' and am.scope_id=v.scope_id and am.bud is not distinct from v.bud and am.bud_splits=v.bud_splits and am.valid_from<=v.start_date and(least(am.valid_to,am.closed_on) is null or least(am.valid_to,am.closed_on)>v.end_date)) then raise exception 'ผังบัญชีไม่ครอบคลุมภาระผูกพัน' using errcode='22023';end if;
 shares:=case when v.bud is not null then jsonb_build_array(jsonb_build_object('bud',v.bud,'weight_bps',10000)) else v.bud_splits end;
 if not exists(select 1 from ads.commitment_occurrence where commitment_version_id=rid) then raise exception 'ต้องระบุวันเรียกเก็บและช่วงคุ้มครอง' using errcode='22023';end if;
 for o in select * from ads.commitment_occurrence where commitment_version_id=rid loop
 if o.expected_amount<>v.amount_per_cycle or o.coverage_start<date_trunc('month',v.start_date)::date or o.coverage_end>date_trunc('month',v.end_date)::date
 or(v.frequency='MONTHLY' and o.coverage_end<>o.coverage_start) or(v.frequency='ANNUAL' and o.coverage_end<>(o.coverage_start+interval '11 months')::date) then raise exception 'รอบและวงเงินคาดการณ์ไม่ตรงกับแผน' using errcode='22023';end if;
 if exists(select 1 from ads.commitment_occurrence x where x.commitment_version_id=rid and x.id<>o.id and daterange(x.coverage_start,x.coverage_end,'[]') && daterange(o.coverage_start,o.coverage_end,'[]')) then raise exception 'ช่วงรอบภาระผูกพันซ้อนกัน' using errcode='22023';end if;
 for share in select value from jsonb_array_elements(shares) loop
 if (select count(*) from ads.commitment_memo_cover where commitment_version_id=rid and bud=share->>'bud' and coverage_start<=o.coverage_start and coverage_end>=o.coverage_end)<>1 then raise exception 'แต่ละรอบและ BUD ต้องมี Memo คุ้มครองเพียงรายการเดียว' using errcode='22023';end if;end loop;
 end loop;
 for c in select * from ads.commitment_memo_cover where commitment_version_id=rid loop
 select * into m from ads.memo where id=c.memo_id and record_status='CONFIRMED' and mirrored_status='APPROVED' and requesting_bud=c.bud;
 if m.id is null or not exists(select 1 from jsonb_array_elements(shares) x where x->>'bud'=c.bud) then raise exception 'Memo หรือ BUD ของวงเงินคุ้มครองไม่พร้อมใช้งาน' using errcode='22023';end if;
 if exists(select 1 from ads.commitment_memo_cover x where x.commitment_version_id=rid and x.id<>c.id and x.bud=c.bud and daterange(x.coverage_start,x.coverage_end,'[]') && daterange(c.coverage_start,c.coverage_end,'[]')) then raise exception 'วงเงินคุ้มครองซ้อนกัน' using errcode='22023';end if;
 select coalesce(sum((piece->>'amount')::numeric),0) into forecast from ads.commitment_occurrence occ cross join lateral jsonb_array_elements(ads.finance_split(occ.expected_amount,shares)) piece where occ.commitment_version_id=rid and occ.coverage_start>=c.coverage_start and occ.coverage_end<=c.coverage_end and piece->>'bud'=c.bud;
 if forecast>c.cap_amount then raise exception 'วงเงินคุ้มครองไม่พอกับรอบที่คาดการณ์' using errcode='23514';end if;
 if c.component_id is not null then
 select cc.* into comp from ads.media_line_component cc join ads.media_line_revision r on r.id=cc.revision_id join ads.media_line l on l.id=r.line_id where cc.id=c.component_id and r.status='APPROVED' and l.state='ACTIVE' and cc.memo_id=c.memo_id and cc.bud=c.bud and((l.month is not null and c.coverage_start=l.month and c.coverage_end=l.month) or(c.coverage_start>=l.period_start_month and c.coverage_end<=l.period_end_month));
 if comp.id is null then raise exception 'วงเงินอ้างอิงรายการงบที่ไม่พร้อมใช้งาน' using errcode='22023';end if;
 select coalesce(sum(x.cap_amount),0) into reserved from ads.commitment_memo_cover x join ads.commitment_version xv on xv.id=x.commitment_version_id join ads.recurring_commitment rc on rc.id=xv.commitment_id
 where x.component_id=c.component_id and x.id<>c.id and((x.status='CONFIRMED' and rc.state='ACTIVE' and xv.commitment_id<>k) or x.commitment_version_id=rid);
 if reserved+c.cap_amount>comp.gross_amount then raise exception 'วงเงินคุ้มครองทุกประเภทรวมเกินงบของรายการ' using errcode='23514';end if;
 cap:=comp.gross_amount;
 if c.budget_item_id is not null then select amount into cap from ads.line_budget_item where id=c.budget_item_id and component_id=c.component_id and cost_type=v.cost_type and payment_method=v.payment_method;if cap is null then raise exception 'ประเภทงบไม่ตรงกับภาระผูกพัน' using errcode='22023';end if;end if;
 select coalesce(sum(x.cap_amount),0) into reserved from ads.commitment_memo_cover x join ads.commitment_version xv on xv.id=x.commitment_version_id join ads.recurring_commitment rc on rc.id=xv.commitment_id
 where x.component_id=c.component_id and(x.budget_item_id is not distinct from c.budget_item_id or c.budget_item_id is null) and x.id<>c.id and((x.status='CONFIRMED' and rc.state='ACTIVE' and xv.commitment_id<>k) or x.commitment_version_id=rid);
 if reserved+c.cap_amount>cap then raise exception 'วงเงินคุ้มครองรวมเกินรายการงบที่สำรอง' using errcode='23514';end if;
 end if;
 update ads.commitment_memo_cover set memo_material_version=m.material_version,status='CONFIRMED' where id=c.id;
 end loop;
 select array_agg(distinct memo_id) into memo_ids from ads.commitment_memo_cover where commitment_version_id in(rid,current_id);
 update ads.commitment_memo_cover set status='SUPERSEDED' where commitment_version_id=current_id and status in('CONFIRMED','SUSPENDED');
 update ads.commitment_version set status='SUPERSEDED' where id=current_id;
 update ads.recurring_commitment set state='ACTIVE' where id=k;
 update ads.commitment_version set status='CONFIRMED',confirmed_by=actor,confirmed_at=clock_timestamp() where id=rid;
 perform set_config('app.finance_confirming_revision',rid::text,true);
 update ads.commitment_version set reconciliation_acknowledgements=ads.finance_ack(memo_ids,acks,actor) where id=rid;
 perform set_config('app.finance_confirming_revision','',true);
end $$;
create function ads.finance_split(amount numeric,splits jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 with shares as(select x->>'bud' bud,(x->>'weight_bps')::numeric weight from jsonb_array_elements(splits) x),
 raw as(select bud,floor(amount*100*weight/10000) base,mod(amount*100*weight,10000) remainder from shares),
 ranked as(select *,row_number() over(order by remainder desc,bud collate "C") rank,amount*100-sum(base) over() residual from raw)
 select coalesce(jsonb_agg(jsonb_build_object('bud',bud,'amount',(base+case when rank<=residual then 1 else 0 end)/100) order by bud),'[]') from ranked
$$;
create function ads.finance_cover_consumed(k uuid) returns numeric language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare cover ads.commitment_memo_cover;v ads.commitment_version;shares jsonb;result numeric;
begin select * into cover from ads.commitment_memo_cover where id=k;select * into v from ads.commitment_version where id=cover.commitment_version_id;
 shares:=case when v.bud is not null then jsonb_build_array(jsonb_build_object('bud',v.bud,'weight_bps',10000)) else v.bud_splits end;
 select coalesce(sum((piece->>'amount')::numeric*case cr.direction when 'DEBIT' then 1 else -1 end),0) into result from ads.cost_record cr join ads.commitment_occurrence occ on occ.id=cr.commitment_occurrence_id cross join lateral jsonb_array_elements(ads.finance_split(cr.amount,shares)) piece
 where occ.commitment_version_id=cover.commitment_version_id and occ.coverage_start>=cover.coverage_start and occ.coverage_end<=cover.coverage_end and cr.status='CONFIRMED' and piece->>'bud'=cover.bud;
 return result;end $$;
create function ads.finance_commitment_preview(k uuid) returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare o ads.commitment_occurrence;v ads.commitment_version;shares jsonb;part jsonb;month_value date;n integer;i integer;amount_value numeric;result jsonb:='[]';
begin select * into v from ads.commitment_version where id=k;shares:=case when v.bud is not null then jsonb_build_array(jsonb_build_object('bud',v.bud,'weight_bps',10000)) else v.bud_splits end;
 for o in select * from ads.commitment_occurrence where commitment_version_id=k order by cycle_no loop
 select count(*) into n from generate_series(o.coverage_start,o.coverage_end,interval '1 month');i:=0;
 for month_value in select g::date from generate_series(o.coverage_start,o.coverage_end,interval '1 month') g loop i:=i+1;
 amount_value:=(floor(o.expected_amount*100/n)+case when i<=mod(o.expected_amount*100,n) then 1 else 0 end)/100;
 for part in select value from jsonb_array_elements(ads.finance_split(amount_value,shares)) loop result:=result||jsonb_build_array(part||jsonb_build_object('month',month_value,'scope_id',v.scope_id,'occurrence_id',o.id,'measure','FORECAST'));end loop;end loop;end loop;return result;end $$;

create function ads.finance_ledger_import(p jsonb) returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare batch jsonb;r jsonb;safe jsonb;issues jsonb:=coalesce(p->'issues','[]');g record;scope uuid;line uuid;rid uuid;rowid uuid;resolved_memo uuid;old jsonb;
begin
 select to_jsonb(b) into batch from staging.ads_ledger_batch b where source_fingerprint=p->>'source_fingerprint';if batch is not null then return batch||'{"replayed":true}';end if;
 if jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows') not between 1 and 5000 then raise exception 'จำนวนแถวไม่ถูกต้อง' using errcode='22023';end if;
 if p->>'tab' ~* '^(draft|payment|target|summary)$' then raise exception 'แท็บนี้ไม่ใช่งบรายเดือน' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p->'rows') loop
 if not ads.active_vocab('BUD',r->>'bud') or not ads.active_vocab('AGENCY',r->>'agency') then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_VOCAB','row_no',r->'row_no'));end if;
 if not exists(select 1 from ads.scope_code s join ads.scope_member sm on sm.scope_id=s.scope_id join ads.scope_code group_scope on group_scope.scope_code=sm.parent_group_id and group_scope.kind='GROUP' and group_scope.status='ACTIVE' where s.kind='PHASE' and s.status='ACTIVE' and sm.member_type='PHASE' and sm.member_id=r->>'rem_project_id' and sm.parent_group_id=r->>'formatted_mapping') then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_BRIDGE','row_no',r->'row_no'));end if;
 if exists(select 1 from staging.ads_ledger_row oldrow join staging.ads_ledger_batch b on b.id=oldrow.batch_id where b.status='APPLIED' and b.logical_source_id=p->>'logical_source_id' and b.tab=p->>'tab' and oldrow.row_no=(r->>'row_no')::integer)
 or exists(select 1 from ads.media_line l join ads.scope_code s on s.scope_id=l.scope_id where l.kind='GROUP' and l.month=(p->>'month')::date and l.agency=r->>'agency' and s.scope_code=r->>'formatted_mapping') then issues:=issues||jsonb_build_array(jsonb_build_object('code','CONFLICTING_REPLAY','row_no',r->'row_no'));end if;
 select m.id into resolved_memo from ads.memo_identifier mi join ads.memo m on m.id=mi.memo_id where mi.identifier=r->>'memo_no' and mi.status='CONFIRMED';
 if resolved_memo is not null and exists(select 1 from ads.memo where id=resolved_memo and requesting_bud<>r->>'bud') then issues:=issues||jsonb_build_array(jsonb_build_object('code','MEMO_BUD_CONFLICT','row_no',r->'row_no'));end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'rows') x group by x->>'rem_project_id',x->>'agency' having count(*)>1) then issues:=issues||'[{"code":"DUPLICATE_BUSINESS_KEY"}]';end if;
 batch:=ads.finance_put('staging.ads_ledger_batch',ads.finance_pick(p,array['source_fingerprint','logical_source_id','source_file','tab','month','profile_id','profile_version','provenance'])||jsonb_build_object('status',case when issues='[]' then 'APPLIED' else 'QUARANTINED' end,'issues',issues));
 for r in select value from jsonb_array_elements(p->'rows') loop
 perform ads.finance_put('staging.ads_ledger_row',ads.finance_pick(r,array['row_no','row_hash','raw_row'])||jsonb_build_object('batch_id',batch->>'id','typed_row',r-array['raw_row','row_hash'],'status',batch->>'status','issues',issues));end loop;
 if issues<>'[]' then return ads.finance_read('ledger-imports',batch->>'id');end if;
 for g in select x->>'formatted_mapping' mapping,x->>'agency' agency from jsonb_array_elements(p->'rows') x group by 1,2 loop
 select scope_id into scope from ads.scope_code where scope_code=g.mapping and kind='GROUP' and status='ACTIVE';
 safe:=ads.finance_put('ads.media_line',jsonb_build_object('kind','GROUP','scope_id',scope,'month',p->>'month','agency',g.agency,'source_kind','LEDGER'));line:=(safe->>'id')::uuid;
 safe:=ads.finance_put('ads.media_line_revision',jsonb_build_object('line_id',line,'revision_no',1,'reason','นำเข้าจากไฟล์งบรายเดือน'));rid:=(safe->>'id')::uuid;
 for r in select value from jsonb_array_elements(p->'rows') where value->>'formatted_mapping'=g.mapping and value->>'agency'=g.agency loop
 select id into rowid from staging.ads_ledger_row where batch_id=(batch->>'id')::uuid and row_no=(r->>'row_no')::integer;
 select memo_id into resolved_memo from ads.memo_identifier where identifier=r->>'memo_no' and status='CONFIRMED';
 perform ads.finance_components(rid,jsonb_build_array(ads.finance_pick(r,array['rem_project_id','formatted_mapping','bud','gross_amount','fee_po_ref'])||jsonb_build_object('component_kind','PHASE','observed_memo_no',r->>'memo_no','memo_id',resolved_memo,'source_row_id',rowid,'origin','LEDGER')));
 end loop;perform ads.finance_line_check(line,rid);end loop;
 return ads.finance_read('ledger-imports',batch->>'id');
end $$;
create function ads.finance_card_import(p jsonb) returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare batch jsonb;r jsonb;rowdata jsonb;issues jsonb:=coalesce(p->'issues','[]');s ads.card_statement_control;debits numeric;credits numeric;memo uuid;
begin
 select to_jsonb(b) into batch from staging.ads_card_batch b where source_fingerprint=p->>'source_fingerprint';if batch is not null then return batch||'{"replayed":true}';end if;
 select * into s from ads.card_statement_control where id=(p->>'statement_control_id')::uuid for update;if s.id is null then raise exception 'ไม่พบรายการควบคุมใบแจ้งยอด' using errcode='22023';end if;
 if jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows') not between 1 and 5000 then raise exception 'จำนวนแถวไม่ถูกต้อง' using errcode='22023';end if;
 select coalesce(sum(case when x->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then(x->>'amount')::numeric else 0 end) filter(where x->>'direction'='DEBIT'),0),coalesce(sum(case when x->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then(x->>'amount')::numeric else 0 end) filter(where x->>'direction'='CREDIT'),0) into debits,credits from jsonb_array_elements(p->'rows') x;
 if debits-credits<>s.declared_total or s.total_meaning<>'NET_CHARGES' or s.review_status<>'CONFIRMED' then issues:=issues||'[{"code":"STATEMENT_TOTAL_REVIEW_REQUIRED"}]';end if;
 if exists(select 1 from staging.ads_card_batch where statement_control_id=s.id) then issues:=issues||'[{"code":"CONFLICTING_REPLACEMENT"}]';end if;
 for r in select value from jsonb_array_elements(p->'rows') loop
 if r->>'amount' is null or r->>'amount' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' or r->>'charge_date' is null or r->>'direction' is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_ROW','row_no',r->'row_no'));end if;
 if (r->>'charge_date')::date not between s.cycle_start and s.cycle_end then issues:=issues||jsonb_build_array(jsonb_build_object('code','OUTSIDE_CYCLE','row_no',r->'row_no'));end if;
 if r->>'bud' is not null and not ads.active_vocab('BUD',r->>'bud') then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_BUD','row_no',r->'row_no'));end if;
 if coalesce(r->>'payment_method','CORPORATE_CARD')<>'CORPORATE_CARD' or r->>'direction' not in('DEBIT','CREDIT') then issues:=issues||jsonb_build_array(jsonb_build_object('code','INVALID_COST_DIMENSION','row_no',r->'row_no'));end if;
 end loop;
 batch:=ads.finance_put('staging.ads_card_batch',ads.finance_pick(p,array['source_fingerprint','statement_control_id','logical_source_id','source_file','tab','profile_id','profile_version','provenance'])||jsonb_build_object('status',case when issues='[]' then 'APPLIED_DRAFT' else 'QUARANTINED' end,'issues',issues,'debit_total',debits,'credit_total',credits,'net_total',debits-credits));
 for r in select value from jsonb_array_elements(p->'rows') loop
 rowdata:=ads.finance_put('staging.ads_card_row',ads.finance_pick(r,array['row_no','row_hash','raw_row','charge_date','posting_date'])||jsonb_build_object('amount',case when r->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then(r->>'amount')::numeric else null end,'direction',case when r->>'direction' in('DEBIT','CREDIT') then r->>'direction' else null end,'batch_id',batch->>'id','typed_row',r-array['raw_row','row_hash'],'issues',issues));
 if r->>'cost_type' in('MEDIA','AGENCY_FEE','CHANNEL','TOOL','BANK_FEE') and not exists(select 1 from jsonb_array_elements(issues) issue where issue->>'code'<>'CONFLICTING_REPLACEMENT') then
 select memo_id into memo from ads.memo_identifier where identifier=r->>'memo_no' and status='CONFIRMED';
 perform ads.finance_put('ads.cost_record',ads.finance_pick(r,array['cost_type','amount','direction','charge_date','posting_date','bud'])||jsonb_build_object('source_row_id',rowdata->>'id','payment_method','CORPORATE_CARD','memo_id',memo,'observed_memo_no',r->>'memo_no'));
 end if;end loop;return ads.finance_read('card-imports',batch->>'id');
end $$;

create function ads.finance_command(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;k uuid;rid uuid;current_id uuid;result jsonb;old jsonb;x jsonb;y jsonb;p jsonb:=payload;parts jsonb;acks jsonb;
 memo_ids uuid[];m ads.memo;l ads.media_line;c ads.media_line_component;mapping ads.account_mapping;batch staging.ads_card_batch;
 account_kind text;resource text;target regclass;material boolean;total numeric;previous uuid;
begin
 actor:=hub.require_actor(array['online_staff','admin']);
 perform pg_advisory_xact_lock(1560015);
 if action not in('ledger_import','card_import') or coalesce(p->'issues','[]')='[]'::jsonb then perform ads.finance_money(p);end if;
 if jsonb_typeof(p)<>'object' then raise exception 'ข้อมูลคำขอไม่ถูกต้อง' using errcode='22023';end if;
 perform ads.finance_evidence(p->>'evidence_ref');k:=(p->>'id')::uuid;
 if action='memo_create' then
 perform ads.finance_bud(p->>'requesting_bud');
 result:=ads.finance_put('ads.memo',ads.finance_pick(p,array['memo_no','subject','requesting_bud','gross_amount','media_amount','fee_amount','cost_breakdown','mirrored_status','approvers','approval_date','evidence_ref']));k:=(result->>'id')::uuid;
 perform ads.finance_put('ads.memo_identifier',jsonb_build_object('identifier',p->>'memo_no','memo_id',k,'kind','CANONICAL','status','CONFIRMED'));
 resource:='memos';
 elsif action in('memo_update','memo_confirm') then
 old:=ads.finance_version('ads.memo',k,(p->>'expected_version')::integer);
 if action='memo_update' then
 if p ? 'memo_no' and p->>'memo_no'<>old->>'memo_no' then raise exception 'เลข Memo หลักเปลี่ยนไม่ได้ ให้เสนอชื่ออ้างอิง' using errcode='22023';end if;
 x:=ads.finance_pick(p,array['subject','requesting_bud','gross_amount','media_amount','fee_amount','cost_breakdown','mirrored_status','approvers','approval_date','evidence_ref']);
 if x='{}' then raise exception 'ไม่มีข้อมูลที่เปลี่ยน' using errcode='22023';end if;
 material:=((old||x)-array['subject','row_version','updated_at','updated_by']) is distinct from(old-array['subject','row_version','updated_at','updated_by']);
 if material then x:=x||jsonb_build_object('material_version',(old->>'material_version')::integer+1,'record_status','DRAFT','confirmed_by',null,'confirmed_at',null);
 update ads.media_line set state='SUSPENDED' where state='ACTIVE' and id in(select r.line_id from ads.media_line_revision r join ads.media_line_component part on part.revision_id=r.id where part.memo_id=k and r.status='APPROVED');
 update ads.recurring_commitment set state='SUSPENDED' where state='ACTIVE' and id in(select v.commitment_id from ads.commitment_version v join ads.commitment_memo_cover cv on cv.commitment_version_id=v.id where v.status='CONFIRMED' and(cv.memo_id=k or cv.component_id in(select part.id from ads.media_line_component part join ads.media_line_revision rr on rr.id=part.revision_id join ads.media_line ml on ml.id=rr.line_id where ml.state='SUSPENDED')));
 update ads.commitment_memo_cover set status='SUSPENDED' where status='CONFIRMED' and(memo_id=k or component_id in(select part.id from ads.media_line_component part join ads.media_line_revision r on r.id=part.revision_id join ads.media_line ml on ml.id=r.line_id where ml.state='SUSPENDED'));
 end if;result:=ads.finance_put('ads.memo',x,k);
 else
 if old->>'mirrored_status'<>'APPROVED' or old->>'approval_date' is null or nullif(btrim(old->>'evidence_ref'),'') is null then raise exception 'ต้องบันทึกหลักฐานและวันที่อนุมัติจาก E-memo' using errcode='22023';end if;
 perform ads.finance_bud(old->>'requesting_bud');
 for x in select value from jsonb_array_elements(old->'approvers') loop
 if nullif(btrim(x->>'name'),'') is null or coalesce(x->>'decision_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'ผู้ตัดสินใจต้องมีชื่อและเวลาพร้อมเขตเวลา' using errcode='22023';end if;perform(x->>'decision_at')::timestamptz;end loop;
 if jsonb_array_length(old->'cost_breakdown')>0 then
 if exists(select 1 from jsonb_array_elements(old->'cost_breakdown') b where b->>'cost_type' not in('MEDIA','AGENCY_FEE','CHANNEL','TOOL','BANK_FEE')) or(select sum((b->>'amount')::numeric) from jsonb_array_elements(old->'cost_breakdown') b)<>(old->>'gross_amount')::numeric then raise exception 'รายการประเภทค่าใช้จ่ายไม่ตรงวงเงิน Memo' using errcode='22023';end if;end if;
 update ads.memo set record_status='CONFIRMED',confirmed_by=actor,confirmed_at=clock_timestamp() where id=k;
 end if;resource:='memos';
 elsif action='memo_identifier_propose' then
 if nullif(btrim(p->>'reason'),'') is null or nullif(btrim(p->>'evidence_ref'),'') is null then raise exception 'ชื่ออ้างอิงต้องมีเหตุผลและหลักฐาน' using errcode='22023';end if;
 result:=ads.finance_put('ads.memo_identifier',ads.finance_pick(p,array['memo_id','identifier','reason','evidence_ref'])||'{"kind":"ALIAS"}');k:=(result->>'id')::uuid;resource:='memo-identifiers';
 elsif action in('memo_identifier_review','memo_identifier_retire') then
 perform hub.require_actor(array['admin']);old:=ads.finance_version('ads.memo_identifier',k,(p->>'expected_version')::integer);
 if old->>'kind'<>'ALIAS' or(action='memo_identifier_review' and old->>'status'<>'PROPOSED') or nullif(btrim(p->>'reason'),'') is null then raise exception 'รายการชื่ออ้างอิงไม่พร้อมพิจารณา' using errcode='22023';end if;
 if action='memo_identifier_review' and p->>'decision' not in('APPROVE','REJECT') then raise exception 'ผลการพิจารณาไม่ถูกต้อง' using errcode='22023';end if;
 update ads.memo_identifier set status=case when action='memo_identifier_retire' then 'RETIRED' when p->>'decision'='APPROVE' then 'CONFIRMED' else 'REJECTED' end,reviewed_by=actor,reviewed_at=clock_timestamp(),reason=p->>'reason' where id=k;resource:='memo-identifiers';
 elsif action='line_create' then
 result:=ads.finance_put('ads.media_line',ads.finance_pick(p,array['kind','scope_id','month','agency','program_ref','period_start_month','period_end_month','source_kind']));k:=(result->>'id')::uuid;
 result:=ads.finance_put('ads.media_line_revision',ads.finance_pick(p,array['permitted_scope_ids','permitted_agencies','mapping_verified','reason'])||jsonb_build_object('line_id',k,'revision_no',1));rid:=(result->>'id')::uuid;
 perform ads.finance_components(rid,p->'components');perform ads.finance_line_check(k,rid);resource:='media-lines';
 elsif action in('revision_create','revision_update') then
 if action='revision_create' then old:=ads.finance_version('ads.media_line',k,(p->>'expected_version')::integer);
 else old:=ads.finance_version('ads.media_line_revision',(p->>'revision_id')::uuid,(p->>'expected_version')::integer);if old->>'status'<>'DRAFT' or old->>'line_id'<>k::text then raise exception 'แก้ไขได้เฉพาะรุ่นร่างของรายการนี้' using errcode='22023';end if;update ads.media_line_revision set status='SUPERSEDED' where id=(p->>'revision_id')::uuid;end if;
 -- A draft edit also leaves its prior snapshot intact; no component DELETE is needed.
 result:=ads.finance_put('ads.media_line_revision',ads.finance_pick(p,array['permitted_scope_ids','permitted_agencies','mapping_verified','reason'])||jsonb_build_object('line_id',k,'revision_no',(select coalesce(max(revision_no),0)+1 from ads.media_line_revision where line_id=k)));rid:=(result->>'id')::uuid;
 perform ads.finance_components(rid,p->'components');perform ads.finance_line_check(k,rid);update ads.media_line set updated_by=actor where id=k;resource:='media-lines';
 elsif action='revision_confirm' then
 select * into l from ads.media_line where id=k for update;
 rid:=(p->>'revision_id')::uuid;select id into current_id from ads.media_line_revision where line_id=k and status='APPROVED';
 if not(p ? 'expected_revision_id') or current_id is distinct from(p->>'expected_revision_id')::uuid then raise exception 'รุ่นงบเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
 if not exists(select 1 from ads.media_line_revision where id=rid and line_id=k and status='DRAFT') then raise exception 'ไม่พบรุ่นร่าง' using errcode='22023';end if;
 perform ads.finance_line_check(k,rid);
 select array_agg(distinct memo_id) into memo_ids from ads.media_line_component where revision_id in(rid,current_id);
 for c in select * from ads.media_line_component where revision_id=rid loop
 select * into m from ads.memo where id=c.memo_id and record_status='CONFIRMED' and mirrored_status='APPROVED' and requesting_bud=c.bud;
 if m.id is null then raise exception 'แต่ละรายการต้องเชื่อม Memo ที่ยืนยันและอนุมัติจากภายนอกแล้ว' using errcode='22023';end if;
 update ads.media_line_component set memo_snapshot=jsonb_build_object('id',m.id,'memo_no',m.memo_no,'material_version',m.material_version,'requesting_bud',m.requesting_bud,'gross_amount',m.gross_amount,'mirrored_status',m.mirrored_status,'approval_date',m.approval_date) where id=c.id;
 end loop;
 update ads.recurring_commitment set state='SUSPENDED' where state='ACTIVE' and id in(select v.commitment_id from ads.commitment_version v join ads.commitment_memo_cover cv on cv.commitment_version_id=v.id join ads.media_line_component cc on cc.id=cv.component_id where cc.revision_id=current_id and v.status='CONFIRMED');
 update ads.commitment_memo_cover set status='SUSPENDED' where component_id in(select id from ads.media_line_component where revision_id=current_id) and status='CONFIRMED';
 update ads.media_line_revision set status='SUPERSEDED' where id=current_id;
 update ads.media_line_revision set status='APPROVED',confirmed_by=actor,confirmed_at=clock_timestamp() where id=rid;
 update ads.media_line set state='ACTIVE' where id=k;
 acks:=ads.finance_ack(memo_ids,p->'acknowledgements',actor);
 -- Store the reviewed finding on a separate immutable receipt field during this transition.
 perform set_config('app.finance_confirming_revision',rid::text,true);
 update ads.media_line_revision set reconciliation_acknowledgements=acks where id=rid;
 perform set_config('app.finance_confirming_revision','',true);resource:='media-lines';
 elsif action='line_archive' then
 perform ads.finance_version('ads.media_line',k,(p->>'expected_version')::integer);
 if nullif(btrim(p->>'reason'),'') is null then raise exception 'กรุณาระบุเหตุผล' using errcode='22023';end if;
 update ads.media_line set archived_at=clock_timestamp(),archive_reason=p->>'reason' where id=k;resource:='media-lines';
 elsif action in('assignment_create','assignment_replace','assignment_end','assignment_acknowledge') then
 if action<>'assignment_create' then old:=ads.finance_version('ads.line_assignment',k,(p->>'expected_version')::integer);if old->>'status'<>'ACTIVE' then raise exception 'การเชื่อมสิ้นสุดแล้ว' using errcode='40001';end if;end if;
 if action in('assignment_replace','assignment_end') then
 if nullif(btrim(p->>'reason'),'') is null then raise exception 'กรุณาระบุเหตุผล' using errcode='22023';end if;
 update ads.line_assignment set status='ENDED',ended_at=clock_timestamp(),reason=p->>'reason' where id=k;end if;
 if action in('assignment_create','assignment_replace') then
 if action='assignment_replace' then p:=p||jsonb_build_object('code',old->>'code','month',old->>'month');end if;
 perform ads.finance_assignment_check(p->>'code',(p->>'month')::date,(p->>'line_id')::uuid,(p->>'expected_revision_id')::uuid);
 if p->>'correction_target_id' is not null and not exists(select 1 from ads.correction_target ct join ads.campaign_registration cr on cr.code=p->>'code' where ct.id=(p->>'correction_target_id')::uuid and ct.status='APPLIED' and ct.month=(p->>'month')::date and ct.line_id=(p->>'line_id')::uuid and ct.agency=cr.agency) then raise exception 'รายการแก้ไขรหัสยังไม่ถูกนำไปใช้หรือไม่ตรงกัน' using errcode='22023';end if;
 result:=ads.finance_put('ads.line_assignment',ads.finance_pick(p,array['code','month','line_id','reason','correction_target_id'])||jsonb_build_object('acknowledged_revision_id',p->>'expected_revision_id'));k:=(result->>'id')::uuid;
 elsif action='assignment_acknowledge' then
 perform ads.finance_assignment_check(old->>'code',(old->>'month')::date,(old->>'line_id')::uuid,(p->>'expected_revision_id')::uuid,true);
 update ads.line_assignment set acknowledged_revision_id=(p->>'expected_revision_id')::uuid where id=k;end if;resource:='line-assignments';
 elsif action='correction_create' then
 if not ads.active_vocab('AGENCY',p->>'agency') then raise exception 'เอเจนซียังไม่พร้อมใช้งาน' using errcode='22023';end if;
 result:=ads.finance_put('ads.correction',ads.finance_pick(p,array['observed_code','agency','month_from','month_to','reason','evidence_ref']));k:=(result->>'id')::uuid;
 for x in select value from jsonb_array_elements(p->'targets') loop perform ads.finance_put('ads.correction_target',ads.finance_pick(x,array['month','line_id'])||jsonb_build_object('correction_id',k,'observed_code',p->>'observed_code','agency',p->>'agency'));end loop;resource:='corrections';
 elsif action in('correction_review','correction_apply','correction_retire') then
 if action<>'correction_apply' then perform hub.require_actor(array['admin']);end if;
 old:=ads.finance_version('ads.correction',k,(p->>'expected_version')::integer);
 if nullif(btrim(p->>'reason'),'') is null then raise exception 'กรุณาระบุเหตุผล' using errcode='22023';end if;
 if old->>'observed_code' in('C-MIBF-BNGPU','C-MIGD-BNGPU') and action<>'correction_retire' then raise exception 'รหัสที่ขัดแย้งต้องรอหลักฐานจากผู้ดูแลข้อมูลหลัก' using errcode='23514';end if;
 if action='correction_review' then
 if old->>'status'<>'PROPOSED' or p->>'decision' not in('APPROVE','REJECT') then raise exception 'รายการไม่พร้อมพิจารณา' using errcode='22023';end if;
 if p->>'decision'='APPROVE' then
 if(select count(*) from generate_series((old->>'month_from')::date,(old->>'month_to')::date,interval '1 month'))<>(select count(*) from ads.correction_target where correction_id=k) then raise exception 'ต้องระบุปลายทางครบทุกเดือน' using errcode='22023';end if;
 for x in select to_jsonb(t) from ads.correction_target t where correction_id=k loop
 select * into l from ads.media_line where id=(x->>'line_id')::uuid;
 if(x->>'month')::date not between(old->>'month_from')::date and(old->>'month_to')::date or not(coalesce(l.month=(x->>'month')::date and l.agency=old->>'agency',false) or coalesce((x->>'month')::date between l.period_start_month and l.period_end_month and exists(select 1 from ads.media_line_revision where line_id=l.id and status='APPROVED' and old->>'agency'=any(permitted_agencies)),false)) then raise exception 'ปลายทางไม่ตรงกับเดือนหรือเอเจนซี' using errcode='22023';end if;end loop;end if;
 update ads.correction set status=case p->>'decision' when 'APPROVE' then 'APPROVED' else 'REJECTED' end,reviewed_by=actor,reviewed_at=clock_timestamp(),review_reason=p->>'reason' where id=k;
 update ads.correction_target set status=case p->>'decision' when 'APPROVE' then 'APPROVED' else 'REJECTED' end where correction_id=k;
 elsif action='correction_apply' then
 if old->>'status'<>'APPROVED' or jsonb_array_length(coalesce(p->'months','[]'))=0 then raise exception 'ต้องเลือกเดือนจากรายการที่อนุมัติแล้ว' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(p->'months') loop
 update ads.correction_target set status='APPLIED',applied_by=actor,applied_at=clock_timestamp(),application_reason=p->>'reason' where correction_id=k and month=(x#>>'{}')::date and status='APPROVED';if not found then raise exception 'เดือนนี้ไม่พร้อมนำไปใช้' using errcode='40001';end if;end loop;
 update ads.correction set updated_by=actor where id=k;
 else update ads.correction set status='RETIRED',review_reason=p->>'reason' where id=k;update ads.correction_target set status='RETIRED' where correction_id=k;end if;resource:='corrections';
 elsif action='ledger_import' then return ads.finance_ledger_import(p);
 elsif action='card_import' then return ads.finance_card_import(p);
 else
 return ads.finance_extended_command(action,p,actor);
 end if;
 return ads.finance_read(resource,k::text);
end $$;

create function ads.finance_cost_check(k uuid) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare c ads.cost_record;m ads.account_mapping;o ads.commitment_occurrence;v ads.commitment_version;begin
 select * into c from ads.cost_record where id=k;
 if c.bud is not null then perform ads.finance_bud(c.bud);end if;
 if c.scope_id is not null and not exists(select 1 from ads.scope_code where scope_id=c.scope_id and status='ACTIVE') then raise exception 'ขอบเขตค่าใช้จ่ายไม่พร้อมใช้งาน' using errcode='22023';end if;
 if c.account_mapping_id is not null then
 select * into m from ads.account_mapping where id=c.account_mapping_id and status='CONFIRMED' and valid_from<=c.charge_date and(least(valid_to,closed_on) is null or least(valid_to,closed_on)>c.charge_date);
 if m.id is null or(c.scope_id is not null and c.scope_id<>m.scope_id) or(c.bud is not null and c.bud is distinct from m.bud and not exists(select 1 from jsonb_array_elements(m.bud_splits) x where x->>'bud'=c.bud)) then raise exception 'บัญชี BUD หรือวันเรียกเก็บไม่ตรงกับผังที่ยืนยันแล้ว' using errcode='22023';end if;end if;
 if c.memo_id is not null and not exists(select 1 from ads.memo where id=c.memo_id and record_status='CONFIRMED' and mirrored_status='APPROVED' and(c.bud is null or requesting_bud=c.bud)) then raise exception 'Memo ของค่าใช้จ่ายยังไม่พร้อมใช้งาน' using errcode='22023';end if;
 if c.commitment_occurrence_id is not null then
 select * into o from ads.commitment_occurrence where id=c.commitment_occurrence_id;select * into v from ads.commitment_version where id=o.commitment_version_id;
 if v.id is null or v.status<>'CONFIRMED' or v.cost_type<>c.cost_type or v.payment_method<>c.payment_method or(c.scope_id is not null and c.scope_id<>v.scope_id) then raise exception 'ค่าใช้จ่ายไม่ตรงกับรอบภาระผูกพันที่ยืนยันแล้ว' using errcode='22023';end if;
 if c.direction='DEBIT' and exists(select 1 from ads.cost_record x where x.commitment_occurrence_id=o.id and x.id<>k and x.source_row_id is distinct from c.source_row_id and x.status='CONFIRMED' and x.direction='DEBIT'
 and not exists(select 1 from staging.ads_card_row incoming_row join staging.ads_card_batch incoming_batch on incoming_batch.id=incoming_row.batch_id join staging.ads_card_row prior_row on prior_row.id=x.source_row_id join staging.ads_card_batch prior_batch on prior_batch.id=prior_row.batch_id where incoming_row.id=c.source_row_id and incoming_batch.statement_control_id=prior_batch.statement_control_id and incoming_batch.id<>prior_batch.id and incoming_batch.status in('APPLIED_DRAFT','QUARANTINED')))
 then raise exception 'รอบนี้เชื่อมยอดเรียกเก็บแล้ว ต้องตรวจสอบก่อนเพิ่ม' using errcode='23505';end if;end if;
 if c.refund_of is not null and(c.direction<>'CREDIT' or not exists(select 1 from ads.cost_record x where x.id=c.refund_of and x.direction='DEBIT' and x.status='CONFIRMED' and x.cost_type=c.cost_type and x.payment_method=c.payment_method and x.commitment_occurrence_id is not distinct from c.commitment_occurrence_id and x.scope_id is not distinct from c.scope_id and x.bud is not distinct from c.bud and x.memo_id is not distinct from c.memo_id)) then raise exception 'รายการคืนเงินต้องอ้างอิงยอดและบริบทเดิมที่ยืนยันแล้ว' using errcode='22023';end if;
end $$;
create function ads.finance_extended_command(action text,p jsonb,actor uuid) returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare k uuid:=(p->>'id')::uuid;rid uuid;current_id uuid;previous uuid;result jsonb;old jsonb;x jsonb;y jsonb;z jsonb;resource text;target regclass;
 version_data jsonb;rowdata staging.ads_card_row;b staging.ads_card_batch;s ads.card_statement_control;c ads.cost_record;map ads.account_mapping;
 total numeric;sum_value numeric;parts jsonb;shares jsonb;approved_shares jsonb;mapped_scope uuid;month_group record;count_months integer;idx integer;month_value date;money_value numeric;alloc_id uuid;newversion integer;newcost uuid;statement_id uuid;
begin
 if action in('ad_account_create','channel_account_create','ad_account_version_create','channel_account_version_create') then
 resource:=case when action like 'ad_%' then 'ad-accounts' else 'channel-accounts' end;
 target:=case when resource='ad-accounts' then 'ads.ad_account'::regclass else 'ads.channel_account'::regclass end;
 if action like '%_version_create' then perform ads.finance_version(target,k,(p->>'expected_version')::integer);
 else
 if resource='ad-accounts' and not ads.active_vocab('PLATFORM',p->>'platform') then raise exception 'แพลตฟอร์มยังไม่พร้อมใช้งาน' using errcode='22023';end if;
 result:=ads.finance_put(target,ads.finance_pick(p,case resource when 'ad-accounts' then array['platform','account_id','label'] else array['channel','account_id','label','steward_ref'] end));k:=(result->>'id')::uuid;end if;
 x:=p->'mapping';perform ads.finance_evidence(x->>'evidence_ref');perform ads.finance_splits(x->>'bud',coalesce(x->'bud_splits','[]'),(x->>'scope_id')::uuid);
 result:=ads.finance_put('ads.account_mapping',ads.finance_pick(x,array['scope_id','agency','bud','bud_splits','plan','expected_amount','valid_from','valid_to','evidence_ref'])||jsonb_build_object(case resource when 'ad-accounts' then 'ad_account_id' else 'channel_account_id' end,k));
 elsif action in('ad_account_version_confirm','channel_account_version_confirm') then
 rid:=(p->>'mapping_id')::uuid;old:=ads.finance_version('ads.account_mapping',rid,(p->>'expected_version')::integer);
 if old->>'status'<>'DRAFT' or coalesce(old->>'ad_account_id',old->>'channel_account_id')<>k::text then raise exception 'ไม่พบผังบัญชีร่าง' using errcode='22023';end if;
 select * into map from ads.account_mapping where id=rid;
 if not exists(select 1 from ads.scope_code where scope_id=map.scope_id and status='ACTIVE') or(map.ad_account_id is not null and not ads.active_vocab('AGENCY',map.agency)) then raise exception 'ขอบเขตหรือเอเจนซียังไม่พร้อมใช้งาน' using errcode='22023';end if;
 if map.channel_account_id is not null and not exists(select 1 from ads.channel_account where id=map.channel_account_id and nullif(btrim(account_id),'') is not null) then raise exception 'ต้องยืนยันรหัสบัญชีช่องทางก่อน' using errcode='22023';end if;
 if exists(select 1 from ads.account_mapping x where x.id<>rid and x.status='CONFIRMED' and coalesce(x.ad_account_id,x.channel_account_id)=k and daterange(x.valid_from,least(x.valid_to,x.closed_on),'[)') && daterange(map.valid_from,least(map.valid_to,map.closed_on),'[)')) then raise exception 'ช่วงเวลาผังบัญชีซ้อนกัน' using errcode='23505';end if;
 update ads.account_mapping set status='CONFIRMED',confirmed_by=actor,confirmed_at=clock_timestamp() where id=rid;
 resource:=case when action like 'ad_%' then 'ad-accounts' else 'channel-accounts' end;
 elsif action in('ad_account_version_close','channel_account_version_close') then
 rid:=(p->>'mapping_id')::uuid;old:=ads.finance_version('ads.account_mapping',rid,(p->>'expected_version')::integer);
 select * into map from ads.account_mapping where id=rid;
 if map.status<>'CONFIRMED' or coalesce(map.ad_account_id,map.channel_account_id)<>k or map.closed_on is not null or(p->>'effective_to')::date<=map.valid_from or(map.valid_to is not null and(p->>'effective_to')::date>map.valid_to) or nullif(btrim(p->>'reason'),'') is null then raise exception 'วันปิดช่วงผังบัญชีไม่ถูกต้องหรือปิดแล้ว' using errcode='22023';end if;
 if exists(select 1 from ads.cost_record where account_mapping_id=rid and status='CONFIRMED' and charge_date>=(p->>'effective_to')::date)
 or exists(select 1 from ads.commitment_version cv join ads.recurring_commitment rc on rc.id=cv.commitment_id where cv.account_mapping_id=rid and cv.status='CONFIRMED' and rc.state='ACTIVE' and cv.end_date>=(p->>'effective_to')::date) then raise exception 'มีค่าใช้จ่ายที่ยืนยันหรือภาระผูกพันที่ครอบคลุมวันปิด กรุณาตรวจสอบก่อน' using errcode='22023';end if;
 update ads.account_mapping set closed_on=(p->>'effective_to')::date,closed_by=actor,closed_at=clock_timestamp(),close_reason=p->>'reason' where id=rid;
 resource:=case when action like 'ad_%' then 'ad-accounts' else 'channel-accounts' end;
 elsif action in('commitment_create','commitment_revise') then
 if action='commitment_create' then result:=ads.finance_put('ads.recurring_commitment',ads.finance_pick(p,array['vendor']));k:=(result->>'id')::uuid;
 else perform ads.finance_version('ads.recurring_commitment',k,(p->>'expected_version')::integer);update ads.recurring_commitment set updated_by=actor where id=k;end if;
 perform ads.finance_commitment_draft(k,p->'version');resource:='commitments';
 elsif action in('commitment_cover_create','commitment_occurrence_create') then
 rid:=(p->>'version_id')::uuid;old:=ads.finance_version('ads.commitment_version',rid,(p->>'expected_version')::integer);
 if old->>'status'<>'DRAFT' or old->>'commitment_id'<>k::text then raise exception 'เพิ่มได้เฉพาะรุ่นร่าง' using errcode='22023';end if;
 if action='commitment_cover_create' then x:=p->'cover';perform ads.finance_evidence(x->>'evidence_ref');perform ads.finance_put('ads.commitment_memo_cover',ads.finance_pick(x,array['memo_id','bud','coverage_start','coverage_end','cap_amount','component_id','budget_item_id','evidence_ref'])||jsonb_build_object('commitment_version_id',rid));
 else perform ads.finance_put('ads.commitment_occurrence',ads.finance_pick(p->'occurrence',array['cycle_no','charge_date','coverage_start','coverage_end','expected_amount'])||jsonb_build_object('commitment_version_id',rid));end if;
 update ads.commitment_version set updated_by=actor where id=rid;resource:='commitments';
 elsif action='commitment_activate' then
 perform ads.finance_version('ads.recurring_commitment',k,(p->>'expected_version')::integer);
 if not(p ? 'expected_current_version_id') then raise exception 'ต้องระบุรุ่นปัจจุบัน' using errcode='22023';end if;
 perform ads.finance_commitment_activate(k,(p->>'version_id')::uuid,(p->>'expected_current_version_id')::uuid,p->'acknowledgements',actor);resource:='commitments';
 elsif action='commitment_suspend' then
 perform ads.finance_version('ads.recurring_commitment',k,(p->>'expected_version')::integer);if nullif(btrim(p->>'reason'),'') is null then raise exception 'กรุณาระบุเหตุผล' using errcode='22023';end if;
 update ads.recurring_commitment set state='SUSPENDED',reason=p->>'reason' where id=k;update ads.commitment_memo_cover set status='SUSPENDED' where commitment_version_id in(select id from ads.commitment_version where commitment_id=k and status='CONFIRMED') and status='CONFIRMED';resource:='commitments';
 elsif action in('statement_create','statement_update') then
 x:=ads.finance_pick(p,array['operator_ref','issuer','cycle_start','cycle_end','due_date','declared_total','total_meaning','evidence_ref','review_status']);
 if action='statement_update' then perform ads.finance_version('ads.card_statement_control',k,(p->>'expected_version')::integer);if exists(select 1 from staging.ads_card_batch where statement_control_id=k) then raise exception 'ใบแจ้งยอดที่นำเข้าแล้วแก้ไขไม่ได้ ให้ตรวจสอบชุดข้อมูลใหม่' using errcode='23514';end if;end if;
 if x->>'review_status'='CONFIRMED' and(nullif(btrim(x->>'evidence_ref'),'') is null or x->>'total_meaning'<>'NET_CHARGES') then raise exception 'ต้องยืนยันความหมายยอดและหลักฐานก่อน' using errcode='22023';end if;
 result:=ads.finance_put('ads.card_statement_control',x,case when action='statement_update' then k else null end);k:=(result->>'id')::uuid;resource:='statement-controls';
 elsif action='cost_classify' then
 old:=ads.finance_version('staging.ads_card_row',(p->>'source_row_id')::uuid,(p->>'expected_version')::integer);
 select * into rowdata from staging.ads_card_row where id=(p->>'source_row_id')::uuid;select * into b from staging.ads_card_batch where id=rowdata.batch_id;
 if b.status not in('APPLIED_DRAFT','QUARANTINED') or jsonb_array_length(p->'costs') not between 1 and 100 then raise exception 'ชุดข้อมูลไม่พร้อมแก้ไขการจัดประเภท' using errcode='22023';end if;
 select sum((entry->>'amount')::numeric) into total from jsonb_array_elements(p->'costs') entry;
 if total<>rowdata.amount or exists(select 1 from jsonb_array_elements(p->'costs') entry where coalesce(entry->>'direction',rowdata.direction)<>rowdata.direction) then raise exception 'ยอดแยกประเภทต้องตรงกับรายการต้นทาง' using errcode='22023';end if;
 update ads.cost_record set status='SUPERSEDED' where source_row_id=rowdata.id and status='DRAFT';
 update staging.ads_card_row set interpretation=interpretation+1 where id=rowdata.id returning interpretation into newversion;idx:=0;
 for x in select value from jsonb_array_elements(p->'costs') loop idx:=idx+1;
 result:=ads.finance_put('ads.cost_record',ads.finance_pick(x,array['cost_type','amount','direction','vendor','scope_id','bud','account_mapping_id','memo_id','observed_memo_no','commitment_occurrence_id','line_id','evidence_refs','refund_of'])||jsonb_build_object('source_row_id',rowdata.id,'interpretation',newversion,'item_no',idx,'payment_method','CORPORATE_CARD','charge_date',rowdata.charge_date,'posting_date',rowdata.posting_date,'direction',rowdata.direction));
 perform ads.finance_cost_check((result->>'id')::uuid);end loop;
 k:=b.id;resource:='card-imports';
 elsif action in('card_batch_confirm','card_batch_replace') then
 old:=ads.finance_version('staging.ads_card_batch',k,(p->>'expected_version')::integer);select * into b from staging.ads_card_batch where id=k;select * into s from ads.card_statement_control where id=b.statement_control_id;
 select id into previous from staging.ads_card_batch where statement_control_id=b.statement_control_id and status='CONFIRMED';
 if not(p ? 'expected_previous_batch_id') or previous is distinct from(p->>'expected_previous_batch_id')::uuid then raise exception 'ชุดใบแจ้งยอดปัจจุบันเปลี่ยนแล้ว' using errcode='40001';end if;
 if b.status not in('APPLIED_DRAFT','QUARANTINED') or nullif(btrim(p->>'reason'),'') is null or s.total_meaning<>'NET_CHARGES' or s.review_status<>'CONFIRMED' or b.net_total<>s.declared_total
 or exists(select 1 from jsonb_array_elements(b.issues) issue where issue->>'code'<>'CONFLICTING_REPLACEMENT') then raise exception 'ชุดข้อมูลหรือยอดควบคุมยังมีข้อขัดแย้ง' using errcode='22023';end if;
 for rowdata in select * from staging.ads_card_row where batch_id=k loop
 select sum(amount) into total from ads.cost_record where source_row_id=rowdata.id and interpretation=rowdata.interpretation and status='DRAFT';
 if total is distinct from rowdata.amount then raise exception 'ทุกรายการต้องแยกประเภทครบและยอดตรงกันก่อนยืนยัน' using errcode='22023';end if;
 for c in select * from ads.cost_record where source_row_id=rowdata.id and interpretation=rowdata.interpretation and status='DRAFT' loop perform ads.finance_cost_check(c.id);end loop;
 end loop;
 if exists(select 1 from ads.cost_record cr join staging.ads_card_row sr on sr.id=cr.source_row_id where sr.batch_id=k and cr.status='DRAFT' and cr.direction='CREDIT' and cr.refund_of is null) then raise exception 'กรุณาระบุยอดเดิมของรายการคืนเงินก่อนยืนยัน' using errcode='22023';end if;
 if exists(select 1 from ads.cost_record cr join staging.ads_card_row sr on sr.id=cr.source_row_id where sr.batch_id=k and cr.status='DRAFT' and cr.direction='DEBIT' and cr.commitment_occurrence_id is not null group by cr.commitment_occurrence_id having count(distinct cr.source_row_id)>1) then raise exception 'หลายรายการเรียกเก็บอ้างอิงรอบเดียวกัน ต้องตรวจสอบก่อนยืนยัน' using errcode='23505';end if;
 update ads.cost_allocation_set set status='SUPERSEDED' where status='CONFIRMED' and cost_id in(select cost.id from ads.cost_record cost join staging.ads_card_row r on r.id=cost.source_row_id where r.batch_id=previous);
 update ads.cost_record set status='SUPERSEDED' where source_row_id in(select id from staging.ads_card_row where batch_id=previous) and status='CONFIRMED';
 update staging.ads_card_batch set status='SUPERSEDED' where id=previous;
 update ads.cost_record set status='CONFIRMED',attribution_status=case when scope_id is not null and bud is not null then 'CONFIRMED' else 'UNRESOLVED' end where source_row_id in(select id from staging.ads_card_row where batch_id=k) and status='DRAFT';
 update staging.ads_card_batch set status='CONFIRMED',confirmed_by=actor,confirmed_at=clock_timestamp() where id=k;resource:='card-imports';
 elsif action='cost_allocate' then
 old:=ads.finance_version('ads.cost_record',k,(p->>'expected_version')::integer);select * into c from ads.cost_record where id=k;
 if c.status<>'CONFIRMED' or(c.direction='CREDIT' and c.refund_of is null) then raise exception 'ต้องยืนยันรายการและอ้างอิงการคืนเงินก่อนจัดสรร' using errcode='22023';end if;
 select id into previous from ads.cost_allocation_set where cost_id=k and status='CONFIRMED';
 if not(p ? 'expected_allocation_set_id') or previous is distinct from(p->>'expected_allocation_set_id')::uuid then raise exception 'รุ่นการจัดสรรเปลี่ยนแล้ว' using errcode='40001';end if;
 perform ads.finance_cost_check(k);parts:=coalesce(p->'allocations','[]');
 if c.account_mapping_id is not null then select * into map from ads.account_mapping where id=c.account_mapping_id;approved_shares:=case when map.bud is not null then jsonb_build_array(jsonb_build_object('bud',map.bud,'weight_bps',10000)) else map.bud_splits end;mapped_scope:=map.scope_id;
 elsif c.commitment_occurrence_id is not null then select cv.scope_id,case when cv.bud is not null then jsonb_build_array(jsonb_build_object('bud',cv.bud,'weight_bps',10000)) else cv.bud_splits end into mapped_scope,approved_shares from ads.commitment_occurrence occ join ads.commitment_version cv on cv.id=occ.commitment_version_id where occ.id=c.commitment_occurrence_id;end if;
 if p->>'method'='EQUAL_MONTHS' then
 if (p->>'coverage_start')::date>(p->>'coverage_end')::date or extract(day from(p->>'coverage_start')::date)<>1 or extract(day from(p->>'coverage_end')::date)<>1 then raise exception 'ช่วงจัดสรรต้องเป็นเดือนเต็ม' using errcode='22023';end if;
 select count(*) into count_months from generate_series((p->>'coverage_start')::date,(p->>'coverage_end')::date,interval '1 month');
 if count_months not between 1 and 120 or p->>'scope_id' is null then raise exception 'กรุณาระบุขอบเขตและช่วงไม่เกิน 120 เดือน' using errcode='22023';end if;
 perform ads.finance_splits(p->>'bud',coalesce(p->'bud_splits','[]'),(p->>'scope_id')::uuid);shares:=case when p->>'bud' is not null then jsonb_build_array(jsonb_build_object('bud',p->>'bud','weight_bps',10000)) else p->'bud_splits' end;
 if approved_shares is not null and((p->>'scope_id')::uuid<>mapped_scope or(select jsonb_agg(e order by e->>'bud') from jsonb_array_elements(shares) e) is distinct from(select jsonb_agg(e order by e->>'bud') from jsonb_array_elements(approved_shares) e)) then raise exception 'สัดส่วนจัดสรรต้องตรงกับผังหรือภาระผูกพันที่ยืนยันแล้ว' using errcode='22023';end if;
 parts:='[]';idx:=0;
 for month_value in select g::date from generate_series((p->>'coverage_start')::date,(p->>'coverage_end')::date,interval '1 month') g loop
 idx:=idx+1;money_value:=(floor(c.amount*100/count_months)+case when idx<=mod(c.amount*100,count_months) then 1 else 0 end)/100;
 for x in select value from jsonb_array_elements(ads.finance_split(money_value,shares)) loop parts:=parts||jsonb_build_array(x||jsonb_build_object('month',month_value,'scope_id',p->>'scope_id'));end loop;end loop;
 elsif p->>'method'<>'EXPLICIT' then raise exception 'วิธีจัดสรรไม่ถูกต้อง' using errcode='22023';end if;
 if jsonb_array_length(parts)=0 or(select sum((entry->>'amount')::numeric) from jsonb_array_elements(parts) entry)<>c.amount then raise exception 'ยอดจัดสรรต้องเท่ากับยอดเรียกเก็บทุกสตางค์' using errcode='22023';end if;
 if approved_shares is not null then
 for month_group in select entry->>'month' as allocation_month,sum((entry->>'amount')::numeric) amount from jsonb_array_elements(parts) entry group by 1 loop
 x:=(select jsonb_agg(jsonb_build_object('bud',e->>'bud','amount',(e->>'amount')::numeric) order by e->>'bud') from jsonb_array_elements(parts) e where e->>'month'=month_group.allocation_month);
 if x is distinct from ads.finance_split(month_group.amount,approved_shares) then raise exception 'ยอดแต่ละเดือนต้องรักษาสัดส่วน BUD ที่อนุมัติทุกสตางค์' using errcode='22023';end if;end loop;end if;
 for x in select value from jsonb_array_elements(parts) loop
 perform ads.finance_bud(x->>'bud');
 if not exists(select 1 from ads.scope_code where scope_id=(x->>'scope_id')::uuid and status='ACTIVE') or(c.scope_id is not null and c.scope_id<>(x->>'scope_id')::uuid) or(c.bud is not null and c.bud<>x->>'bud') then raise exception 'การจัดสรรไม่ตรงกับขอบเขตหรือ BUD ที่ตรวจแล้ว' using errcode='22023';end if;
 if c.account_mapping_id is not null then select * into map from ads.account_mapping where id=c.account_mapping_id;if map.scope_id<>(x->>'scope_id')::uuid or(map.bud is not null and map.bud<>x->>'bud') or(map.bud is null and not exists(select 1 from jsonb_array_elements(map.bud_splits) bs where bs->>'bud'=x->>'bud')) then raise exception 'การจัดสรรไม่ตรงกับผังบัญชี' using errcode='22023';end if;end if;
 end loop;
 result:=ads.finance_put('ads.cost_allocation_set',jsonb_build_object('cost_id',k,'version_no',(select coalesce(max(version_no),0)+1 from ads.cost_allocation_set where cost_id=k),'method',p->>'method','reason',p->>'reason'));alloc_id:=(result->>'id')::uuid;
 for x in select value from jsonb_array_elements(parts) loop perform ads.finance_put('ads.cost_allocation',ads.finance_pick(x,array['month','scope_id','bud','amount'])||jsonb_build_object('allocation_set_id',alloc_id,'cost_id',k,'direction',c.direction,'cost_type',c.cost_type,'payment_method',c.payment_method,'account_mapping_id',c.account_mapping_id,'commitment_occurrence_id',c.commitment_occurrence_id));end loop;
 update ads.cost_allocation_set set status='SUPERSEDED' where id=previous;
 update ads.cost_allocation_set set status='CONFIRMED',confirmed_by=actor,confirmed_at=clock_timestamp() where id=alloc_id;resource:='costs';
 else raise exception 'ไม่พบคำสั่งทางการเงิน' using errcode='22023';end if;
 return ads.finance_read(resource,k::text);
end $$;

alter table ads.memo add check((media_amount is null)=(fee_amount is null));
alter table ads.media_line_component add check((media_amount is null)=(fee_amount is null));
do $$ declare t text;s text;f record;begin
 for s,t in select schemaname,tablename from pg_tables where(schemaname='ads' and tablename in
 ('memo','memo_identifier','media_line','media_line_revision','media_line_component','line_budget_item','correction','correction_target','line_assignment','document_requirement','ad_account','channel_account','account_mapping','recurring_commitment','commitment_version','commitment_memo_cover','commitment_occurrence','card_statement_control','cost_record','cost_allocation_set','cost_allocation'))
 or(schemaname='staging' and tablename in('ads_ledger_batch','ads_ledger_row','ads_card_batch','ads_card_row')) loop
 execute format('create trigger no_delete before delete on %I.%I for each row execute function ads.finance_no_delete()',s,t);
 end loop;
 foreach t in array array['media_line_revision','media_line_component','line_budget_item','account_mapping','commitment_version','commitment_memo_cover','commitment_occurrence','cost_record','cost_allocation_set','cost_allocation'] loop
 execute format('create trigger frozen_financial before update on ads.%I for each row execute function ads.finance_frozen()',t);end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='ads'::regnamespace and proname like 'finance_%' loop
 execute format('revoke all on function %s from public',f.signature);execute format('alter function %s owner to ads_finance_writer',f.signature);end loop;
end $$;
grant execute on function ads.finance_read(text,text,jsonb),ads.finance_command(text,jsonb) to online_staff,admin;

-- The export owner receives named columns only: no subject, approver PII, evidence,
-- actor IDs, raw rows, source filenames, card descriptors or statement documents.
grant select(id,memo_no,series,requesting_bud,gross_amount,media_amount,fee_amount,cost_breakdown,mirrored_status,approval_date,record_status,material_version,source,row_version,created_at,updated_at) on ads.memo to ads_export_owner;
grant select(id,identifier,memo_id,kind,status) on ads.memo_identifier to ads_export_owner;
grant select(id,kind,scope_id,month,agency,program_ref,period_start_month,period_end_month,source_kind,state,archived_at,updated_at) on ads.media_line to ads_export_owner;
grant select(id,line_id,revision_no,status,permitted_scope_ids,permitted_agencies,mapping_verified,confirmed_at) on ads.media_line_revision to ads_export_owner;
grant select(id,revision_id,component_kind,rem_project_id,formatted_mapping,bud,gross_amount,media_amount,fee_amount,fee_po_ref,memo_id,origin,memo_snapshot) on ads.media_line_component to ads_export_owner;
grant select(id,component_id,cost_type,payment_method,amount) on ads.line_budget_item to ads_export_owner;
grant select(id,code,month,line_id,acknowledged_revision_id,status,correction_target_id,ended_at) on ads.line_assignment to ads_export_owner;
grant select(id,observed_code,agency,month_from,month_to,status) on ads.correction to ads_export_owner;
grant select(id,correction_id,month,line_id,status,applied_at) on ads.correction_target to ads_export_owner;
grant select(id,platform,account_id) on ads.ad_account to ads_export_owner;
grant select(id,channel,account_id) on ads.channel_account to ads_export_owner;
grant select(id,ad_account_id,channel_account_id,scope_id,agency,bud,bud_splits,plan,expected_amount,valid_from,valid_to,closed_on,status) on ads.account_mapping to ads_export_owner;
grant select(id,state) on ads.recurring_commitment to ads_export_owner;
grant select(id,commitment_id,version_no,status,account_mapping_id,scope_id,bud,bud_splits,plan,cost_type,payment_method,amount_per_cycle,frequency,start_date,end_date) on ads.commitment_version to ads_export_owner;
grant select(id,commitment_version_id,memo_id,bud,coverage_start,coverage_end,cap_amount,memo_material_version,component_id,budget_item_id,status) on ads.commitment_memo_cover to ads_export_owner;
grant select(id,source_row_id,interpretation,item_no,cost_type,payment_method,direction,amount,charge_date,posting_date,scope_id,bud,account_mapping_id,memo_id,commitment_occurrence_id,line_id,document_status,attribution_status,status,refund_of) on ads.cost_record to ads_export_owner;
grant select(id,batch_id) on staging.ads_card_row to ads_export_owner;
grant select(id,statement_control_id,status) on staging.ads_card_batch to ads_export_owner;
grant select(id,cost_id,version_no,status,method) on ads.cost_allocation_set to ads_export_owner;
grant select(id,allocation_set_id,cost_id,month,scope_id,bud,amount,direction,cost_type,payment_method,account_mapping_id,commitment_occurrence_id) on ads.cost_allocation to ads_export_owner;
grant usage on schema staging to ads_export_owner;
do $$ declare s text;t text;begin
 for s,t in select schemaname,tablename from pg_tables where(schemaname='ads' and tablename in('memo','memo_identifier','media_line','media_line_revision','media_line_component','line_budget_item','line_assignment','correction','correction_target','ad_account','channel_account','account_mapping','recurring_commitment','commitment_version','commitment_memo_cover','cost_record','cost_allocation_set','cost_allocation')) or(schemaname='staging' and tablename in('ads_card_row','ads_card_batch')) loop
 execute format('create policy finance_export on %I.%I for select to ads_export_owner using(true)',s,t);end loop;end $$;
create view ads_export.media_line with(security_barrier=true) as
 select l.id line_id,l.kind,l.scope_id,l.month,l.agency,l.program_ref,l.period_start_month,l.period_end_month,l.source_kind,l.state,l.archived_at,
 r.id revision_id,r.revision_no,r.status revision_status,r.permitted_scope_ids,r.permitted_agencies,
 c.id component_id,c.component_kind,c.rem_project_id,c.formatted_mapping,c.bud,c.gross_amount,c.media_amount,c.fee_amount,c.fee_po_ref,c.memo_id,c.origin,
 c.memo_snapshot->>'memo_no' frozen_memo_no,(c.memo_snapshot->>'material_version')::integer memo_material_version,c.memo_snapshot->>'requesting_bud' frozen_memo_bud,(c.memo_snapshot->>'gross_amount')::numeric(14,2) frozen_memo_gross,c.memo_snapshot->>'mirrored_status' frozen_memo_status,(c.memo_snapshot->>'approval_date')::date frozen_memo_approval_date,l.updated_at,
 (r.status='APPROVED' and l.state='ACTIVE') is_applicable,
 coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'cost_type',b.cost_type,'payment_method',b.payment_method,'amount',b.amount)) from ads.line_budget_item b where b.component_id=c.id),'[]') budget_items
 from ads.media_line l join ads.media_line_revision r on r.line_id=l.id join ads.media_line_component c on c.revision_id=r.id;
create view ads_export.memo with(security_barrier=true) as select id,memo_no,series,requesting_bud,gross_amount,media_amount,fee_amount,cost_breakdown,mirrored_status,approval_date,record_status,material_version,source,row_version,created_at,updated_at from ads.memo;
create view ads_export.line_assignment with(security_barrier=true) as
 select a.id,a.code,a.month,a.line_id,a.acknowledged_revision_id,a.status,a.correction_target_id,a.ended_at,
 (a.status='ACTIVE' and l.state='ACTIVE' and a.acknowledged_revision_id=r.id) is_current
 from ads.line_assignment a join ads.media_line l on l.id=a.line_id left join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED';
create view ads_export.correction with(security_barrier=true) as
 select c.id correction_id,t.id target_id,c.observed_code,c.agency,t.month,t.line_id,c.status review_status,t.status target_status,t.applied_at,(c.status='APPROVED' and t.status='APPLIED') is_applied
 from ads.correction c join ads.correction_target t on t.correction_id=c.id where c.status in('APPROVED','RETIRED');
create view ads_export.ad_account with(security_barrier=true) as
 select a.id,a.platform,a.account_id,m.id mapping_id,m.scope_id,m.agency,m.bud,m.bud_splits,m.valid_from,m.valid_to,m.closed_on,least(m.valid_to,m.closed_on) effective_valid_to,m.status from ads.ad_account a join ads.account_mapping m on m.ad_account_id=a.id where m.status in('CONFIRMED','RETIRED');
create view ads_export.channel_account with(security_barrier=true) as
 select a.id,a.channel,a.account_id,m.id mapping_id,m.scope_id,m.bud,m.plan,m.expected_amount,m.valid_from,m.valid_to,m.closed_on,least(m.valid_to,m.closed_on) effective_valid_to,m.status from ads.channel_account a join ads.account_mapping m on m.channel_account_id=a.id where m.status in('CONFIRMED','RETIRED');
create view ads_export.recurring_commitment with(security_barrier=true) as
 select c.id commitment_id,c.state,v.id version_id,v.version_no,v.status,v.account_mapping_id,v.scope_id,v.bud,v.bud_splits,v.plan,v.cost_type,v.payment_method,v.amount_per_cycle,v.frequency,v.start_date,v.end_date,
 (c.state='ACTIVE' and v.status='CONFIRMED') is_applicable,
 coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'memo_id',m.memo_id,'bud',m.bud,'coverage_start',m.coverage_start,'coverage_end',m.coverage_end,'cap_amount',m.cap_amount,'memo_material_version',m.memo_material_version,'component_id',m.component_id,'budget_item_id',m.budget_item_id,'status',m.status)) from ads.commitment_memo_cover m where m.commitment_version_id=v.id),'[]') memo_covers
 from ads.recurring_commitment c join ads.commitment_version v on v.commitment_id=c.id;
create view ads_export.cost_record with(security_barrier=true) as
 select c.id,c.source_row_id occurrence_id,b.statement_control_id,c.interpretation,c.item_no,c.cost_type,c.payment_method,c.direction,c.amount,c.charge_date,c.posting_date,c.scope_id,c.bud,c.account_mapping_id,c.memo_id,c.commitment_occurrence_id,c.line_id,c.document_status,c.attribution_status,c.status,c.refund_of,
 (c.status='CONFIRMED' and(b.id is null or b.status='CONFIRMED')) is_applicable
 from ads.cost_record c left join staging.ads_card_row r on r.id=c.source_row_id left join staging.ads_card_batch b on b.id=r.batch_id;
create view ads_export.cost_allocation with(security_barrier=true) as
 select a.id,a.cost_id,s.id allocation_set_id,s.version_no,a.month,a.scope_id,a.bud,a.amount,a.direction,a.cost_type,a.payment_method,a.account_mapping_id,a.commitment_occurrence_id,s.method,s.status,
 (s.status='CONFIRMED' and c.status='CONFIRMED') is_applicable
 from ads.cost_allocation a join ads.cost_allocation_set s on s.id=a.allocation_set_id join ads.cost_record c on c.id=a.cost_id;
create view ads_export.memo_identifier with(security_barrier=true) as select id,identifier,memo_id,kind,status from ads.memo_identifier where status in('CONFIRMED','RETIRED');
do $$ declare v text;begin foreach v in array array['media_line','memo','line_assignment','correction','ad_account','channel_account','recurring_commitment','cost_record','cost_allocation','memo_identifier'] loop
 execute format('alter view ads_export.%I owner to ads_export_owner',v);execute format('grant select on ads_export.%I to ads_export_reader',v);end loop;end $$;
comment on view ads_export.media_line is 'hub: revision x financial component. Sum gross only where is_applicable; never sum parent, revisions or SN links. Period budgets occur once.';
comment on view ads_export.cost_record is 'hub: typed cash occurrence leaves, never add monthly allocations to cash. No source text or statement PII.';
comment on view ads_export.cost_allocation is 'hub: monthly management allocation; sum applicable sets, not cash plus monthly amounts.';
comment on view ads_export.correction is 'hub: only is_applied mappings are effective; approval alone is not application.';
commit;
