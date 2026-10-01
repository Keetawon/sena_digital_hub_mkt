-- Local residential demo: structured promotions, explicit synthetic selection and atomic publication.
begin;
alter table hub.projects add column demo_fields text[] not null default '{}';
alter table hub.brands add column demo_fields text[] not null default '{}';
alter table hub.model_types add column demo_fields text[] not null default '{}';

create function hub.residential_local() returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if current_database()<>'sena_hub_local' or inet_server_addr() is distinct from '127.0.0.1'::inet or inet_server_port()<>55432 then
 raise exception 'ข้อมูลตัวอย่างใช้ได้เฉพาะระบบทดสอบภายในเครื่อง' using errcode='42501';end if;end $$;
create function hub.require_demo_seeder() returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin perform hub.residential_local();if current_setting('role')<>'none' or not exists(select 1 from pg_roles where rolname=session_user and rolsuper) then
 raise exception 'เฉพาะคำสั่งเตรียมข้อมูลตัวอย่างภายในเครื่อง' using errcode='42501';end if;end $$;
create function hub.demo_marker_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if new.demo_fields is distinct from old.demo_fields then perform hub.require_demo_seeder();end if;return new;end $$;
create trigger preserve_demo_marker before update on hub.projects for each row execute function hub.demo_marker_guard();
create trigger preserve_demo_marker before update on hub.brands for each row execute function hub.demo_marker_guard();
create trigger preserve_demo_marker before update on hub.model_types for each row execute function hub.demo_marker_guard();
create function hub.mark_demo_fields(kind text,entity_id uuid,fields text[]) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare table_name text;present boolean;begin perform hub.require_demo_seeder();
 table_name:=case kind when 'project' then 'projects' when 'brand' then 'brands' when 'model' then 'model_types' end;
 if table_name is null or fields is null or cardinality(fields)=0 or exists(select 1 from unnest(fields) f where f is null or f !~ '^[a-z][a-z0-9_.]*$') then raise exception 'Invalid demo marker' using errcode='22023';end if;
 execute format('select exists(select 1 from hub.%I where id=$1)',table_name) into present using entity_id;
 if not present then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 execute format('update hub.%I set demo_fields=(select array_agg(distinct f order by f) from unnest(demo_fields||$2) f) where id=$1 and not demo_fields @> $2',table_name) using entity_id,fields;
end $$;

-- All promotion writes are confined to the fixed local demo. Evidence is synthetic.
create function hub.validate_promotion(p jsonb) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare field text;begin
 foreach field in array array['title','summary','conditions_public','legal_terms','disclaimer'] loop
 if jsonb_typeof(p->field) is distinct from 'object' or exists(select 1 from jsonb_each(p->field) where key !~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$' or jsonb_typeof(value)<>'string') then raise exception 'ข้อความแปลและรหัสภาษาไม่ถูกต้อง' using errcode='22023';end if;end loop;
 if p->>'benefit_value' is not null and(jsonb_typeof(p->'benefit_value')<>'string' or p->>'benefit_value' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') then raise exception 'จำนวนต้องเป็นข้อความทศนิยมไม่เกินสองตำแหน่ง' using errcode='22023';end if;
 if (p->>'benefit_type'='discount_pct' and(p->>'benefit_unit' is distinct from 'percent' or p->>'benefit_value' is null or(p->>'benefit_value')::numeric>100))
 or(p->>'benefit_type' in('discount_amount','cashback') and(p->>'benefit_unit' is distinct from 'THB' or p->>'benefit_value' is null)) then raise exception 'ประเภทสิทธิ์และหน่วยไม่สอดคล้องกัน' using errcode='23514';end if;
 if p->>'starts_at' is null or p->>'ends_at' is null or(p->>'starts_at')::timestamptz>=(p->>'ends_at')::timestamptz then raise exception 'ช่วงเวลาโปรโมชั่นไม่ถูกต้อง' using errcode='23514';end if;
end $$;

-- Preserve the full existing payload implementation, adding only provenance.
alter function hub.draft_payload(uuid) rename to draft_payload_before_demo;
alter function hub.brand_draft_payload(uuid) rename to brand_draft_payload_before_demo;
alter function hub.project_detail(text) rename to project_detail_before_demo;
create function hub.demo_model_provenance(items jsonb) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(e||jsonb_build_object('demo_fields',m.demo_fields) order by n),'[]')
 from jsonb_array_elements(items) with ordinality x(e,n) join hub.model_types m on m.id=(e->>'id')::uuid
$$;
create function hub.draft_payload(project_uuid uuid) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select base||jsonb_build_object('demo_fields',p.demo_fields,'models',hub.demo_model_provenance(base->'models'))
 from hub.projects p cross join lateral(select hub.draft_payload_before_demo(p.id) base) d where p.id=project_uuid
$$;
create function hub.brand_draft_payload(brand_uuid uuid) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select hub.brand_draft_payload_before_demo(b.id)||jsonb_build_object('demo_fields',b.demo_fields) from hub.brands b where b.id=brand_uuid
$$;
create function hub.project_detail(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin result:=hub.project_detail_before_demo(public_id);return result||jsonb_build_object('models',hub.demo_model_provenance(result->'models'));end $$;

create table hub.demo_assets(asset_id uuid primary key references hub.assets,checksum text not null,evidence text not null,marked_at timestamptz not null default clock_timestamp());
create table hub.demo_release_selection(entity_type text not null check(entity_type in('brand','project')),entity_id uuid not null,assets jsonb not null,model_ids uuid[] not null default '{}',evidence text not null,created_at timestamptz not null default clock_timestamp(),primary key(entity_type,entity_id));
create function hub.mark_demo_asset(asset_id uuid,expected_checksum text,evidence text) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_demo_seeder();
 if evidence is null or evidence not like 'SYNTHETIC-RESIDENTIAL%' or not exists(select 1 from hub.assets a where a.id=asset_id and a.checksum=expected_checksum and a.created_by='00000000-0000-0000-0000-000000000031' and a.original_filename like 'demo-residential-%' and a.rights_status='approved') then raise exception 'ไฟล์ไม่ได้มาจากชุดข้อมูลสังเคราะห์ที่กำหนด' using errcode='23514';end if;
 if exists(select 1 from hub.demo_assets d where d.asset_id=mark_demo_asset.asset_id and(d.checksum<>expected_checksum or d.evidence<>mark_demo_asset.evidence)) then raise exception 'หลักฐานข้อมูลตัวอย่างขัดแย้ง' using errcode='23514';end if;
 insert into hub.demo_assets values(asset_id,expected_checksum,evidence,clock_timestamp()) on conflict on constraint demo_assets_pkey do nothing;
end $$;
create function hub.configure_demo_selection(kind text,entity_id uuid,assets jsonb,model_ids uuid[],evidence text) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare a jsonb;changed integer;begin perform hub.require_demo_seeder();
 if kind is null or kind not in('brand','project') or model_ids is null or evidence is null or jsonb_typeof(assets) is distinct from 'array' or jsonb_array_length(assets)=0 or evidence not like 'SYNTHETIC-RESIDENTIAL%' then raise exception 'ชุดข้อมูลตัวอย่างไม่ถูกต้อง' using errcode='22023';end if;
 if kind='brand' and not exists(select 1 from hub.brands where id=entity_id) or kind='project' and not exists(select 1 from hub.projects where id=entity_id) then raise exception 'ไม่พบรายการ' using errcode='P0002';end if;
 if kind='brand' then perform 1 from hub.brands where id=entity_id for update;else perform 1 from hub.projects where id=entity_id for update;end if;
 for a in select value from jsonb_array_elements(assets) loop
 if not exists(select 1 from hub.demo_assets da join hub.assets real_asset on real_asset.id=da.asset_id and real_asset.checksum=da.checksum where da.asset_id=(a->>'asset_id')::uuid)
 or a->>'asset_role' not in('hero','thumbnail','logo_primary') or nullif(btrim(a#>>'{alt_text,th}'),'') is null then raise exception 'ไฟล์หรือคำอธิบายข้อมูลตัวอย่างไม่ถูกต้อง' using errcode='23514';end if;
 end loop;
 if(select count(distinct e->>'asset_role') from jsonb_array_elements(assets) e)<>jsonb_array_length(assets) then raise exception 'บทบาทภาพซ้ำ' using errcode='23514';end if;
 if kind='project' and (cardinality(model_ids)=0 or exists(select 1 from unnest(model_ids) mid(value) left join hub.model_types m on m.id=mid.value left join staging.rem_models s on s.rem_project_id=m.rem_project_id and s.rem_model_id=m.rem_model_id where m.id is null or m.project_id<>entity_id or m.match_status<>'CONFIRMED' or cardinality(m.demo_fields)=0 or s.source_record->>'synthetic_only' is distinct from 'true')) then raise exception 'แบบตัวอย่างต้องเป็นข้อมูลสังเคราะห์ที่ยืนยันแล้ว' using errcode='23514';end if;
 insert into hub.demo_release_selection values(kind,entity_id,assets,model_ids,evidence,clock_timestamp()) on conflict on constraint demo_release_selection_pkey do update set assets=excluded.assets,model_ids=excluded.model_ids,evidence=excluded.evidence where (demo_release_selection.assets,demo_release_selection.model_ids,demo_release_selection.evidence) is distinct from(excluded.assets,excluded.model_ids,excluded.evidence);
 get diagnostics changed=row_count;
 if changed>0 then if kind='brand' then update hub.brands set updated_at=clock_timestamp() where id=entity_id;else update hub.projects set updated_at=clock_timestamp() where id=entity_id;end if;end if;
end $$;
create function hub.residential_payload(kind text,entity_id uuid,demo_mode boolean default false) returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare p jsonb;selection hub.demo_release_selection;selected_assets jsonb;models jsonb;begin
 p:=case kind when 'brand' then hub.brand_draft_payload(entity_id) when 'project' then hub.draft_payload(entity_id) end;
 if not demo_mode or p is null then return p;end if;perform hub.residential_local();
 select * into selection from hub.demo_release_selection s where s.entity_type=kind and s.entity_id=residential_payload.entity_id;
 if not found then raise exception 'ยังไม่ได้เตรียมชุดข้อมูลตัวอย่างสำหรับรายการนี้' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('id',a.id,'asset_role',e->>'asset_role','is_primary',true,'alt_text',e->'alt_text','display_order',n,
 'public_url',a.public_url,'original_filename',a.original_filename,'mime_type',a.mime_type,'rights_status',a.rights_status,'effective_from',a.effective_from,'effective_to',a.effective_to,'entity_scope',kind,'model_type_id',null,'public_model_id',null,'demo_fields',jsonb_build_array('asset')) order by n)
 into selected_assets from jsonb_array_elements(selection.assets) with ordinality x(e,n) join hub.demo_assets d on d.asset_id=(e->>'asset_id')::uuid join hub.assets a on a.id=d.asset_id and a.checksum=d.checksum;
 if selected_assets is null or jsonb_array_length(selected_assets)<>jsonb_array_length(selection.assets) then raise exception 'ชุดภาพตัวอย่างเปลี่ยนแล้ว' using errcode='23514';end if;
 p:=p||jsonb_build_object('demo_mode',true,'demo_excluded_asset_count',jsonb_array_length(p->'assets'),'assets',selected_assets,'demo_selection_evidence',selection.evidence);
 if kind='project' then
 if exists(select 1 from unnest(selection.model_ids) mid(value) left join hub.model_types m on m.id=mid.value left join staging.rem_models s on s.rem_project_id=m.rem_project_id and s.rem_model_id=m.rem_model_id where m.id is null or m.project_id<>entity_id or m.deleted_at is not null or m.match_status<>'CONFIRMED' or cardinality(m.demo_fields)=0 or s.source_record->>'synthetic_only' is distinct from 'true') then raise exception 'แบบตัวอย่างเปลี่ยนแล้ว' using errcode='23514';end if;
 select coalesce(jsonb_agg(e),'[]') into models from jsonb_array_elements(p->'models') e where(e->>'id')::uuid=any(selection.model_ids);
 p:=p||jsonb_build_object('demo_excluded_model_count',jsonb_array_length(p->'models')-jsonb_array_length(models),'models',models);end if;
 return p;
end $$;

create table staging.source_offers(source_offer_key text primary key,source_active boolean not null,source_deleted boolean not null default false,source_snapshot_at timestamptz not null,source_updated_at timestamptz,source_record jsonb not null default '{}');
create table hub.public_promotions(
 id uuid primary key default gen_random_uuid(),project_id uuid not null references hub.projects,code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'),
 title jsonb not null default '{}',summary jsonb not null default '{}',conditions_public jsonb not null default '{}',legal_terms jsonb not null default '{}',disclaimer jsonb not null default '{}',
 benefit_type text not null check(benefit_type in('discount_amount','discount_pct','free_transfer_fee','free_common_fee','furniture','cashback','rate_subsidy','gift','other')),
 benefit_value numeric(14,2),benefit_unit text check(benefit_unit in('THB','percent','months','items')),stackable boolean not null default false,priority integer not null default 100 check(priority>=0),
 starts_at timestamptz not null,ends_at timestamptz not null,source_offer_key text references staging.source_offers,
 draft_revision integer not null default 1,published_version_id uuid,rag_eligible boolean not null default false check(not rag_eligible),
 synthetic boolean not null default true check(synthetic),demo_fields text[] not null default '{}',
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),updated_by uuid not null,updated_at timestamptz not null default clock_timestamp(),
 check(ends_at>starts_at),check(benefit_value is null or benefit_value>=0),check(jsonb_typeof(title)='object' and jsonb_typeof(summary)='object' and jsonb_typeof(conditions_public)='object' and jsonb_typeof(legal_terms)='object' and jsonb_typeof(disclaimer)='object')
);
create table hub.promotion_reviews(id uuid primary key default gen_random_uuid(),event_seq bigint generated always as identity unique,promotion_id uuid not null references hub.public_promotions,review_revision integer not null,review_type text not null check(review_type in('DATA','LEGAL')),decision text not null check(decision in('APPROVED','REVOKED')),evidence text not null check(btrim(evidence)<>''),change_reason text not null,reviewed_by uuid not null,reviewed_at timestamptz not null default clock_timestamp());
create table hub.promotion_versions(id uuid primary key default gen_random_uuid(),promotion_id uuid not null references hub.public_promotions,version_no integer not null,draft_revision integer not null,payload jsonb not null,published_by uuid not null,published_at timestamptz not null default clock_timestamp(),change_reason text not null,unique(promotion_id,version_no),unique(promotion_id,id));
alter table hub.public_promotions add foreign key(id,published_version_id) references hub.promotion_versions(promotion_id,id);
create table hub.publication_releases(id uuid primary key default gen_random_uuid(),status text not null default 'PUBLISHED' check(status in('PUBLISHED','ROLLED_BACK')),change_reason text not null,demo_mode boolean not null,published_by uuid not null,published_at timestamptz not null default clock_timestamp(),rolled_back_by uuid,rolled_back_at timestamptz,rollback_reason text);
create table hub.publication_release_members(release_id uuid not null references hub.publication_releases,entity_type text not null check(entity_type in('brand','project','promotion')),entity_id uuid not null,public_id text not null,before_version_id uuid,after_version_id uuid not null,primary key(release_id,entity_type,entity_id));

do $$ declare s text;t text;begin
 for s,t in select * from(values('hub','demo_assets'),('hub','demo_release_selection'),('staging','source_offers'),('hub','public_promotions'),('hub','promotion_reviews'),('hub','promotion_versions'),('hub','publication_releases'),('hub','publication_release_members')) x(s,t) loop
 execute format('alter table %I.%I enable row level security',s,t);execute format('alter table %I.%I force row level security',s,t);
 execute format('create trigger residential_audit after insert or update or delete on %I.%I for each row execute function audit.record_change()',s,t);
 execute format('create trigger residential_no_delete before delete on %I.%I for each row execute function hub.reject_version_change()',s,t);
 if t in('promotion_reviews','promotion_versions','publication_release_members','demo_assets') then execute format('create trigger residential_immutable before update on %I.%I for each row execute function hub.reject_version_change()',s,t);end if;
 end loop;
end $$;
create trigger promotion_touch before update on hub.public_promotions for each row execute function hub.touch_record();
create trigger preserve_demo_marker before update on hub.public_promotions for each row execute function hub.demo_marker_guard();

create function hub.promotion_approvals_ok(p_id uuid,revision integer) returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
 select count(*)=2 and bool_and(decision='APPROVED') from(select distinct on(review_type) decision from hub.promotion_reviews where promotion_id=p_id and review_revision=revision order by review_type,event_seq desc) reviews
$$;
create function hub.promotion_payload(p_id uuid) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select (to_jsonb(p)-array['created_by','created_at','updated_by','updated_at','published_version_id'])||jsonb_build_object('benefit_value',p.benefit_value::text,'public_project_id',project.public_project_id,'source_snapshot_at',s.source_snapshot_at,'applies_via',jsonb_build_object('scope_level','project','project_id',project.public_project_id))
 from hub.public_promotions p join hub.projects project on project.id=p.project_id left join staging.source_offers s on s.source_offer_key=p.source_offer_key where p.id=p_id
$$;
create function hub.promotion_readiness(payload jsonb) returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare missing jsonb:='[]';field text;begin
 foreach field in array array['title','summary','conditions_public','legal_terms','disclaimer'] loop
 if jsonb_typeof(payload#>array[field,'th']) is distinct from 'string' or nullif(btrim(payload#>>array[field,'th']),'') is null then missing:=missing||jsonb_build_array(jsonb_build_object('field',field||'.th','message','กรุณากรอกข้อความภาษาไทยและเงื่อนไขให้ครบ'));end if;end loop;
 if not hub.promotion_approvals_ok((payload->>'id')::uuid,(payload->>'draft_revision')::integer) then missing:=missing||jsonb_build_array(jsonb_build_object('field','reviews','message','ต้องมีหลักฐานตรวจข้อมูลและเงื่อนไขทางกฎหมายของฉบับนี้'));end if;
 if (payload->>'ends_at')::timestamptz<=now() then missing:=missing||jsonb_build_array(jsonb_build_object('field','ends_at','message','โปรโมชั่นหมดอายุแล้ว'));end if;
 if not exists(select 1 from public_api.projects where public_project_id=promotion_readiness.payload->>'public_project_id') then missing:=missing||jsonb_build_array(jsonb_build_object('field','project','message','โครงการต้องมีฉบับเผยแพร่ที่ใช้งานได้'));end if;
 if payload->>'source_offer_key' is not null and not exists(select 1 from staging.source_offers where source_offer_key=payload->>'source_offer_key' and source_active and not source_deleted) then missing:=missing||jsonb_build_array(jsonb_build_object('field','source_offer_key','message','สิทธิ์อ้างอิงต้นทางไม่พร้อมใช้งาน'));end if;
 return jsonb_build_object('ready',jsonb_array_length(missing)=0,'missing',missing);
end $$;

create view public_api.promotions with(security_barrier=true) as
with eligible as (
 select p.id promotion_id,p.project_id,project.public_project_id,p.code,v.id version_id,v.payload,v.published_at,
 (v.payload->>'priority')::integer priority,(v.payload->>'stackable')::boolean stackable,v.payload->>'benefit_type' benefit_type
 from hub.public_promotions p join hub.promotion_versions v on v.id=p.published_version_id and v.promotion_id=p.id
 join hub.projects project on project.id=p.project_id join public_api.projects live on live.public_project_id=project.public_project_id
 where (select count(*)=2 and bool_and(decision='APPROVED') from(select distinct on(review_type) decision from hub.promotion_reviews r where r.promotion_id=p.id and r.review_revision=v.draft_revision order by review_type,event_seq desc) latest_reviews) and (v.payload->>'starts_at')::timestamptz<=now() and now()<(v.payload->>'ends_at')::timestamptz
 and(v.payload->>'source_offer_key' is null or exists(select 1 from staging.source_offers s where s.source_offer_key=v.payload->>'source_offer_key' and s.source_active and not s.source_deleted))
), ranked as(select *,row_number() over(partition by project_id,benefit_type order by priority,promotion_id) position,first_value(stackable) over(partition by project_id,benefit_type order by priority,promotion_id) winner_stackable from eligible)
select promotion_id,project_id,public_project_id,code,version_id,payload,published_at,priority,stackable,benefit_type from ranked where(position=1 and not winner_stackable) or(winner_stackable and stackable);

create function hub.promotion_read(p_id uuid default null,p_filters jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin perform hub.require_actor(array['editor','admin','publisher','viewer']);
 if p_id is null then return jsonb_build_object('items',coalesce((select jsonb_agg(hub.promotion_read(p.id) order by p.updated_at desc,p.id) from(select * from hub.public_promotions where p_filters->>'project_id' is null or project_id=(p_filters->>'project_id')::uuid order by updated_at desc,id limit least(coalesce((p_filters->>'limit')::int,50),100) offset coalesce((p_filters->>'offset')::int,0)) p),'[]'),'total',(select count(*) from hub.public_promotions where p_filters->>'project_id' is null or project_id=(p_filters->>'project_id')::uuid));end if;
 select hub.promotion_payload(p.id)||jsonb_build_object('updated_at',p.updated_at,'published_version_id',p.published_version_id,'publication_available',exists(select 1 from public_api.promotions live where live.promotion_id=p.id),'readiness',hub.promotion_readiness(hub.promotion_payload(p.id)),
 'reviews',coalesce((select jsonb_agg(to_jsonb(r)-'event_seq'-'promotion_id' order by r.review_type) from(select distinct on(review_type) * from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision order by review_type,event_seq desc) r),'[]'),
 'review_history',coalesce((select jsonb_agg(to_jsonb(r)-'event_seq'-'promotion_id' order by r.event_seq desc) from hub.promotion_reviews r where r.promotion_id=p.id),'[]'),
 'published',(select jsonb_build_object('id',v.id,'version_no',v.version_no,'payload',v.payload,'published_at',v.published_at) from hub.promotion_versions v where v.id=p.published_version_id),
 'versions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'version_no',v.version_no,'draft_revision',v.draft_revision,'published_at',v.published_at) order by v.version_no desc) from hub.promotion_versions v where v.promotion_id=p.id),'[]')) into result from hub.public_promotions p where p.id=p_id;
 if result is null then raise exception 'ไม่พบโปรโมชั่นที่มีสิทธิ์เข้าถึง' using errcode='P0002';end if;return result;
end $$;

create function hub.promotion_command(action text,p_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;r hub.public_promotions;merged jsonb;field text;allowed text[];v uuid;review_revision integer;
begin
 perform hub.residential_local();
 actor:=hub.require_actor(case when action in('create','update') then array['editor','admin'] else array['publisher'] end);
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'ข้อมูลไม่ถูกต้อง' using errcode='22023';end if;
 allowed:=case action
 when 'create' then array['project_id','code','title','summary','conditions_public','legal_terms','disclaimer','benefit_type','benefit_value','benefit_unit','stackable','priority','starts_at','ends_at','source_offer_key']
 when 'update' then array['expected_revision','title','summary','conditions_public','legal_terms','disclaimer','benefit_type','benefit_value','benefit_unit','stackable','priority','starts_at','ends_at','source_offer_key']
 when 'review' then array['expected_revision','review_revision','review_type','decision','evidence','change_reason']
 when 'publish' then array['expected_revision','expected_published_version_id','change_reason']
 when 'withdraw' then array['expected_revision','expected_published_version_id','change_reason'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then raise exception 'มีช่องข้อมูลที่ไม่ได้รับอนุญาต' using errcode='22023';end if;
 foreach field in array array['starts_at','ends_at'] loop
 if p?field and(jsonb_typeof(p->field) is distinct from 'string' or p->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'เวลาต้องระบุเขตเวลา' using errcode='22023';end if;end loop;
 perform set_config('app.change_reason',coalesce(nullif(btrim(p->>'change_reason'),''),'Synthetic promotion draft'),true);
 if action='create' then
 merged:=jsonb_build_object('title','{}'::jsonb,'summary','{}'::jsonb,'conditions_public','{}'::jsonb,'legal_terms','{}'::jsonb,'disclaimer','{}'::jsonb,'stackable',false,'priority',100)||p;
 perform hub.validate_promotion(merged);
 insert into hub.public_promotions(project_id,code,title,summary,conditions_public,legal_terms,disclaimer,benefit_type,benefit_value,benefit_unit,stackable,priority,starts_at,ends_at,source_offer_key,created_by,updated_by,demo_fields)
 values((p->>'project_id')::uuid,p->>'code',merged->'title',merged->'summary',merged->'conditions_public',merged->'legal_terms',merged->'disclaimer',p->>'benefit_type',(p->>'benefit_value')::numeric,p->>'benefit_unit',(merged->>'stackable')::boolean,(merged->>'priority')::integer,(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,p->>'source_offer_key',actor,actor,array['promotion','review_evidence']) returning * into r;
 return hub.promotion_read(r.id);
 end if;
 -- Parent first, matching release lock order; project withdrawal cannot race this publication.
 perform 1 from hub.projects where id=(select project_id from hub.public_promotions where id=p_id) for update;
 select * into r from hub.public_promotions where id=p_id for update;
 if not found then raise exception 'ไม่พบโปรโมชั่น' using errcode='P0002';end if;
 if (p->>'expected_revision')::integer is distinct from r.draft_revision then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;
 if action='update' then
 merged:=hub.promotion_payload(r.id)||(p-'expected_revision');perform hub.validate_promotion(merged);
 update hub.public_promotions set title=merged->'title',summary=merged->'summary',conditions_public=merged->'conditions_public',legal_terms=merged->'legal_terms',disclaimer=merged->'disclaimer',benefit_type=merged->>'benefit_type',benefit_value=(merged->>'benefit_value')::numeric,benefit_unit=merged->>'benefit_unit',stackable=(merged->>'stackable')::boolean,priority=(merged->>'priority')::integer,starts_at=(merged->>'starts_at')::timestamptz,ends_at=(merged->>'ends_at')::timestamptz,source_offer_key=merged->>'source_offer_key',draft_revision=draft_revision+1 where id=r.id;
 elsif action='review' then
 if nullif(btrim(p->>'change_reason'),'') is null or nullif(btrim(p->>'evidence'),'') is null then raise exception 'ต้องระบุหลักฐานและเหตุผล' using errcode='23514';end if;
 review_revision:=coalesce((p->>'review_revision')::integer,r.draft_revision);
 if review_revision<>r.draft_revision and(p->>'decision'<>'REVOKED' or not exists(select 1 from hub.promotion_versions pv where pv.promotion_id=r.id and pv.draft_revision=review_revision)) then raise exception 'ตรวจทานได้เฉพาะฉบับปัจจุบัน หรือเพิกถอนฉบับที่เคยเผยแพร่' using errcode='23514';end if;
 insert into hub.promotion_reviews(promotion_id,review_revision,review_type,decision,evidence,change_reason,reviewed_by) values(r.id,review_revision,p->>'review_type',p->>'decision',p->>'evidence',p->>'change_reason',actor);
 else
 if not p?'expected_published_version_id' or (p->>'expected_published_version_id')::uuid is distinct from r.published_version_id then raise exception 'ฉบับเผยแพร่เปลี่ยนแล้ว' using errcode='40001';end if;
 if nullif(btrim(p->>'change_reason'),'') is null then raise exception 'ต้องระบุเหตุผล' using errcode='23514';end if;
 if action='publish' then
 merged:=hub.promotion_payload(r.id);
 if not(hub.promotion_readiness(merged)->>'ready')::boolean then raise exception 'โปรโมชั่นยังไม่พร้อมเผยแพร่' using errcode='23514',detail=hub.promotion_readiness(merged)::text;end if;
 insert into hub.promotion_versions(promotion_id,version_no,draft_revision,payload,published_by,change_reason) select r.id,coalesce(max(version_no),0)+1,r.draft_revision,merged,actor,p->>'change_reason' from hub.promotion_versions where promotion_id=r.id returning id into v;
 update hub.public_promotions set published_version_id=v where id=r.id;
 else update hub.public_promotions set published_version_id=null where id=r.id;end if;
 end if;
 return hub.promotion_read(r.id);
end $$;

create function hub.release_read(p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin perform hub.require_actor(array['editor','admin','publisher','viewer']);
 if p_id is null then return jsonb_build_object('items',coalesce((select jsonb_agg(hub.release_read(id) order by published_at desc,id) from hub.publication_releases),'[]'),'total',(select count(*) from hub.publication_releases));end if;
 select to_jsonb(r)||jsonb_build_object('members',coalesce((select jsonb_agg(to_jsonb(m)-'release_id' order by entity_type,entity_id) from hub.publication_release_members m where release_id=r.id),'[]')) into result from hub.publication_releases r where id=p_id;
 if result is null then raise exception 'ไม่พบชุดเผยแพร่' using errcode='P0002';end if;return result;
end $$;

create function hub.release_candidates(demo_mode boolean default false) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare items jsonb:='[]';r record;p jsonb;readiness jsonb;begin
 perform hub.require_actor(array['editor','admin','publisher','viewer']);if demo_mode then perform hub.residential_local();end if;
 for r in select 'brand'::text kind,id,public_brand_id public_id,updated_at,null::integer revision,published_version_id from hub.brands where deleted_at is null
 union all select 'project',id,public_project_id,updated_at,null,published_version_id from hub.projects where deleted_at is null
 union all select 'promotion',id,code,updated_at,draft_revision,published_version_id from hub.public_promotions order by kind,public_id loop
 if demo_mode and r.kind<>'promotion' and not exists(select 1 from hub.demo_release_selection where entity_type=r.kind and entity_id=r.id) then continue;end if;
 p:=case when r.kind='promotion' then hub.promotion_payload(r.id) else hub.residential_payload(r.kind,r.id,demo_mode) end;
 readiness:=case r.kind when 'brand' then hub.brand_snapshot_readiness(p) when 'project' then hub.snapshot_readiness(p) else hub.promotion_readiness(p) end;
 items:=items||jsonb_build_array(jsonb_build_object('entity_type',r.kind,'entity_id',r.id,'public_id',r.public_id,'title',coalesce(p->'title',p->'public_name'),'expected_updated_at',case when r.kind<>'promotion' then r.updated_at end,'expected_revision',r.revision,'expected_published_version_id',r.published_version_id,'readiness',readiness,'demo_fields',coalesce(p->'demo_fields','[]'),'demo_mode',coalesce((p->>'demo_mode')::boolean,false),'demo_excluded_asset_count',p->'demo_excluded_asset_count','demo_excluded_model_count',p->'demo_excluded_model_count'));
 end loop;return jsonb_build_object('items',items);
end $$;

-- Lock dependencies and members in one order, including normal single-entity publishers.
create function hub.lock_release_members(members jsonb) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 perform b.id from hub.brands b where b.id in(select (e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='brand')
 or b.id in(select p.brand_id from hub.projects p where p.id in(select (e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='project') or p.id in(select pr.project_id from hub.public_promotions pr where pr.id in(select(e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='promotion'))) order by b.id for update;
 perform p.id from hub.projects p where p.id in(select(e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='project') or p.id in(select pr.project_id from hub.public_promotions pr where pr.id in(select(e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='promotion')) order by p.id for update;
 perform pr.id from hub.public_promotions pr where pr.id in(select(e->>'entity_id')::uuid from jsonb_array_elements(members) e where e->>'entity_type'='promotion') order by pr.id for update;
end $$;

create function hub.release_publish(members jsonb,reason text,demo_mode boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;e jsonb;kind text;entity uuid;pointer uuid;stamp timestamptz;revision integer;public_id text;release_id uuid;version_id uuid;p jsonb;readiness jsonb;result jsonb;
begin
 perform hub.residential_local();actor:=hub.require_actor(array['publisher']);
 if nullif(btrim(reason),'') is null or demo_mode is null or jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members) not between 1 and 100 then raise exception 'ต้องเลือกรายการและระบุเหตุผล' using errcode='22023';end if;
 if(select count(distinct (x.value->>'entity_type',x.value->>'entity_id')) from jsonb_array_elements(members) x(value))<>jsonb_array_length(members) then raise exception 'เลือกรายการซ้ำ' using errcode='22023';end if;
 for e in select value from jsonb_array_elements(members) loop
 if jsonb_typeof(e) is distinct from 'object' or e->>'entity_type' is null or e->>'entity_type' not in('brand','project','promotion') or e->>'entity_id' is null or not e?'expected_published_version_id'
 or exists(select 1 from jsonb_object_keys(e) k where k not in('entity_type','entity_id','expected_updated_at','expected_revision','expected_published_version_id')) then raise exception 'รายการเผยแพร่ไม่ถูกต้อง' using errcode='22023';end if;end loop;
 perform hub.lock_release_members(members);
 -- Check all expected state before writing any member.
 for e in select value from jsonb_array_elements(members) loop
 kind:=e->>'entity_type';entity:=(e->>'entity_id')::uuid;
 if kind='brand' then select b.published_version_id,b.updated_at into pointer,stamp from hub.brands b where b.id=entity and b.deleted_at is null;
 elsif kind='project' then select pr.published_version_id,pr.updated_at into pointer,stamp from hub.projects pr where pr.id=entity and pr.deleted_at is null;
 else select pr.published_version_id,pr.draft_revision into pointer,revision from hub.public_promotions pr where pr.id=entity;end if;
 if not found then raise exception 'ไม่พบรายการในชุดเผยแพร่' using errcode='P0002';end if;
 if pointer is distinct from(e->>'expected_published_version_id')::uuid or(kind='promotion' and revision is distinct from(e->>'expected_revision')::integer) or(kind<>'promotion' and stamp is distinct from(e->>'expected_updated_at')::timestamptz) then raise exception 'ข้อมูลในชุดเผยแพร่เปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001';end if;end loop;
 perform set_config('app.change_reason',reason,true);
 insert into hub.publication_releases(change_reason,demo_mode,published_by) values(reason,demo_mode,actor) returning id into release_id;
 for e in select value from jsonb_array_elements(members) order by case value->>'entity_type' when 'brand' then 1 when 'project' then 2 else 3 end,value->>'entity_id' loop
 kind:=e->>'entity_type';entity:=(e->>'entity_id')::uuid;
 if kind='promotion' then result:=hub.promotion_command('publish',entity,jsonb_build_object('expected_revision',e->'expected_revision','expected_published_version_id',e->'expected_published_version_id','change_reason',reason));version_id:=(result->>'published_version_id')::uuid;public_id:=result->>'code';
 else
 p:=hub.residential_payload(kind,entity,demo_mode);
 perform a.id from hub.assets a where a.id in(select(x->>'id')::uuid from jsonb_array_elements(coalesce(p->'assets','[]')) x union select(x->>'id')::uuid from jsonb_array_elements(coalesce(p#>'{brand,assets}','[]')) x) order by a.id for share;
 if not demo_mode then version_id:=case kind when 'brand' then hub.publish_brand(entity,reason) else hub.publish_project(entity,reason) end;
 else
 readiness:=case kind when 'brand' then hub.brand_snapshot_readiness(p) else hub.snapshot_readiness(p) end;
 if not(readiness->>'ready')::boolean then raise exception 'ข้อมูลตัวอย่างยังไม่พร้อมเผยแพร่' using errcode='23514',detail=readiness::text;end if;
 if kind='brand' then insert into hub.brand_versions(brand_id,version_no,payload,publisher,change_reason) select entity,coalesce(max(version_no),0)+1,p,actor,reason from hub.brand_versions where brand_id=entity returning id into version_id;update hub.brands set published_version_id=version_id where id=entity;
 else insert into hub.entity_versions(project_id,version_no,payload,publisher,change_reason) select entity,coalesce(max(version_no),0)+1,p,actor,reason from hub.entity_versions where project_id=entity returning id into version_id;update hub.projects set published_version_id=version_id where id=entity;end if;
 end if;public_id:=case kind when 'brand' then p->>'public_brand_id' else p->>'public_project_id' end;
 end if;
 insert into hub.publication_release_members values(release_id,kind,entity,public_id,(e->>'expected_published_version_id')::uuid,version_id);
 end loop;return hub.release_read(release_id);
end $$;

create function hub.release_rollback(p_id uuid,reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;r hub.publication_releases;m hub.publication_release_members;members jsonb;pointer uuid;p jsonb;
begin
 perform hub.residential_local();actor:=hub.require_actor(array['publisher']);if nullif(btrim(reason),'') is null then raise exception 'ต้องระบุเหตุผล' using errcode='23514';end if;
 select * into r from hub.publication_releases where id=p_id for update;
 if not found then raise exception 'ไม่พบชุดเผยแพร่' using errcode='P0002';end if;
 if r.status<>'PUBLISHED' then raise exception 'ชุดนี้ถูกย้อนกลับแล้ว' using errcode='40001';end if;
 select jsonb_agg(to_jsonb(x)) into members from hub.publication_release_members x where release_id=p_id;
 perform hub.lock_release_members(members);
 for m in select * from hub.publication_release_members where release_id=p_id loop
 if m.entity_type='brand' then select published_version_id into pointer from hub.brands where id=m.entity_id;
 elsif m.entity_type='project' then select published_version_id into pointer from hub.projects where id=m.entity_id;
 else select published_version_id into pointer from hub.public_promotions where id=m.entity_id;end if;
 if pointer is distinct from m.after_version_id then raise exception 'มีการเผยแพร่ภายหลัง ไม่สามารถทับฉบับใหม่' using errcode='40001';end if;
 end loop;
 perform set_config('app.change_reason',reason,true);
 for m in select * from hub.publication_release_members where release_id=p_id order by case entity_type when 'brand' then 1 when 'project' then 2 else 3 end,entity_id loop
 if m.entity_type='brand' then
 if m.before_version_id is null then perform hub.withdraw_brand(m.entity_id,reason);else perform hub.rollback_brand(m.entity_id,m.before_version_id,reason);end if;
 elsif m.entity_type='project' then
 if m.before_version_id is null then perform hub.withdraw_project(m.entity_id,reason);else perform hub.rollback_project(m.entity_id,m.before_version_id,reason);end if;
 else
 if m.before_version_id is not null then
 select payload into p from hub.promotion_versions where id=m.before_version_id and promotion_id=m.entity_id;
 if p is null or not(hub.promotion_readiness(p)->>'ready')::boolean then raise exception 'โปรโมชั่นฉบับเดิมไม่พร้อมใช้งานแล้ว' using errcode='23514';end if;
 end if;update hub.public_promotions set published_version_id=m.before_version_id where id=m.entity_id;
 end if;
 end loop;
 update hub.publication_releases set status='ROLLED_BACK',rolled_back_by=actor,rolled_back_at=clock_timestamp(),rollback_reason=reason where id=p_id;
 return hub.release_read(p_id);
end $$;

-- Explicit grants preserve the existing source-mirror and publication boundaries.
revoke all on hub.demo_assets,hub.demo_release_selection,staging.source_offers,hub.public_promotions,hub.promotion_reviews,hub.promotion_versions,hub.publication_releases,hub.publication_release_members from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
revoke all on function hub.project_detail_before_demo(text) from public,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname in('residential_local','require_demo_seeder','demo_marker_guard','mark_demo_fields','demo_model_provenance','draft_payload','brand_draft_payload','project_detail','mark_demo_asset','configure_demo_selection','residential_payload','promotion_approvals_ok','promotion_payload','promotion_readiness','promotion_read','validate_promotion','promotion_command','release_read','release_candidates','lock_release_members','release_publish','release_rollback') loop execute format('revoke all on function %s from public',f);end loop;
end $$;
grant execute on function hub.project_detail(text),hub.promotion_read(uuid,jsonb),hub.release_read(uuid),hub.release_candidates(boolean) to editor,publisher,viewer,admin;
grant execute on function hub.promotion_command(text,uuid,jsonb) to editor,publisher,admin;
grant execute on function hub.release_publish(jsonb,text,boolean),hub.release_rollback(uuid,text) to publisher;
grant select on public_api.promotions to service_consumer;
comment on view public_api.promotions is 'Immutable eligible synthetic local promotions; live expiry, source, project and review gates. Never RAG.';
commit;
