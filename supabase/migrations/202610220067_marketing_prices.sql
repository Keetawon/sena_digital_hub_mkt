-- E2/E3: Marketing amounts only; source values are private comparisons.
begin;
create table hub.project_prices (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 public_price_id text not null unique default ('price_'||replace(gen_random_uuid()::text,'-','')),
 kind text not null check(kind in ('starting','unit_type')),
 commercial_type_id uuid not null,
 amount numeric(14,2) not null check(amount>0 and amount<'Infinity'::numeric),
 basis_size_sqm numeric not null check(basis_size_sqm>0 and basis_size_sqm<100000),
 display_text jsonb not null check(hub.content_locales(display_text,1000,true)),
 basis jsonb not null check(hub.content_locales(basis,2000,true)),
 condition_text jsonb not null check(hub.content_locales(condition_text,4000,true)),
 promotion_id uuid references hub.public_promotions,
 valid_from date not null,valid_to date not null,
 rem_min_available numeric,rem_as_of timestamptz,
 state text not null default 'draft' check(state in ('draft','in_review','approved','withdrawn')),
 ai_exposure text not null default 'web_only' check(ai_exposure in ('open','web_only','internal')),
 revision integer not null default 1 check(revision>0),editors uuid[] not null default '{}',
 approved_by uuid,approved_at timestamptz,
 unique(project_id,id),foreign key(project_id,commercial_type_id) references hub.commercial_types(project_id,id),
 check(valid_to>=valid_from and valid_to<=valid_from+60)
);
create table hub.project_price_versions (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references hub.projects,price_id uuid not null,
 revision integer not null check(revision>0),payload jsonb not null,source_snapshot jsonb not null,editors uuid[] not null,
 state text not null default 'in_review' check(state in ('in_review','approved','returned','withdrawn')),
 approved_by uuid,approved_at timestamptz,
 foreign key(project_id,price_id) references hub.project_prices(project_id,id),unique(price_id,revision)
);
do $$ declare name text;begin
 foreach name in array array['project_prices','project_price_versions'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);execute format('alter table hub.%I force row level security',name);
  execute format('create policy unit_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create policy unit_read on hub.%I for select to hub_app using(hub.can(''projects'',''view''))',name);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger unit_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger unit_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;
create trigger unit_immutable before update or delete on hub.project_price_versions for each row execute function hub.unit_version_guard();

create function hub.unit_price_comparison(type_uuid uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with c as(select * from hub.commercial_types where id=type_uuid),
 refs as(select m.rem_model_id from hub.commercial_type_sources s join hub.model_types m on m.id=s.model_id where s.commercial_type_id=type_uuid and m.deleted_at is null and m.match_status<>'REJECTED'),
 matched as(select g from c,jsonb_array_elements(hub.unit_source_comparison(c.project_id)->'groups') g
  where not(g->>'unavailable')::boolean and exists(select 1 from refs where g->'model_ids'?refs.rem_model_id))
 select jsonb_build_object('rem_min_available',min(hub.content_number(g->>'rem_min_available')),
  'rem_as_of',min((g->>'as_of')::timestamptz),'groups',coalesce(jsonb_agg(g),'[]'),
  'allocation_verified',false,'comparison_only',true) from matched
$$;

create function hub.project_price_readiness(price_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.project_prices;f hub.field_catalog;items jsonb:='[]';complete boolean;begin
 select * into p from hub.project_prices where id=price_uuid;
 if not found then raise exception 'Price not found' using errcode='P0002';end if;
 for f in select * from hub.field_catalog where entity='price' and status='active' and 'en'=any(locales_required) loop
  complete:=hub.translation_complete('price',p.id::text,f.field_key,to_jsonb(p)->split_part(f.field_key,'.',2));
  items:=items||jsonb_build_array(jsonb_build_object('field_key',f.field_key,'label',f.label,'complete',complete,'required',true));
 end loop;
 items:=items||jsonb_build_array(jsonb_build_object('field_key','price.valid_to','label','{"th":"ราคายังไม่หมดอายุ"}'::jsonb,
  'complete',p.valid_to>=(current_timestamp at time zone 'Asia/Bangkok')::date,'required',true));
 return jsonb_build_object('items',items,'ready',not exists(select 1 from jsonb_array_elements(items) i where not(i->>'complete')::boolean));
end $$;

create function hub.project_price_snapshot(price_uuid uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('public_price_id',p.public_price_id,'kind',p.kind,'public_commercial_type_id',c.public_commercial_type_id,
  'amount',p.amount,'basis_size_sqm',p.basis_size_sqm,'display_text',p.display_text,'basis',p.basis,'condition_text',p.condition_text,
  'promotion_code',(select code from hub.public_promotions where id=p.promotion_id),
  'valid_from',p.valid_from,'valid_to',p.valid_to,'ai_exposure',p.ai_exposure)
 from hub.project_prices p join hub.commercial_types c on c.id=p.commercial_type_id where p.id=price_uuid
$$;

create function hub.save_project_price(public_id text,price_uuid uuid,expected_stamp timestamptz,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;p hub.projects;prior hub.project_prices;edited hub.project_prices;c hub.commercial_types;compare jsonb;key uuid;begin
 actor:=hub.require_permission('projects','edit');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if p.updated_at is distinct from expected_stamp then raise exception 'Project changed' using errcode='40001';end if;
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('kind','commercial_type_id','amount','basis_size_sqm','display_text','basis','condition_text','promotion_id','valid_from','valid_to','ai_exposure')) then
  raise exception 'Only Marketing price fields may be changed' using errcode='23514';end if;
 if price_uuid is not null then
  select * into prior from hub.project_prices where id=price_uuid and project_id=p.id for update;
  if not found then raise exception 'Price not found' using errcode='P0002';end if;
  if prior.state='in_review' then raise exception 'Return the submitted price before editing' using errcode='23514';end if;
 end if;
 edited:=jsonb_populate_record(prior,body);
 select * into c from hub.commercial_types where id=edited.commercial_type_id and project_id=p.id and deleted_at is null;
 if not found then raise exception 'Choose a type in this project' using errcode='23514';end if;
 if edited.promotion_id is not null then
  perform hub.require_permission('promotions','view');
  if not exists(select 1 from hub.public_promotions where id=edited.promotion_id and project_id=p.id
    and (starts_at at time zone 'Asia/Bangkok')::date<=edited.valid_from and (ends_at at time zone 'Asia/Bangkok')::date>=edited.valid_to) then
   raise exception 'Choose a project promotion covering the price dates' using errcode='23514';end if;
 end if;
 if (body?'amount' and jsonb_typeof(body->'amount')<>'number') or (body?'basis_size_sqm' and jsonb_typeof(body->'basis_size_sqm')<>'number') then
  raise exception 'Prices and size must be finite numbers' using errcode='23514';end if;
 compare:=hub.unit_price_comparison(c.id);key:=coalesce(prior.id,gen_random_uuid());
 insert into hub.project_prices(id,project_id,kind,commercial_type_id,amount,basis_size_sqm,display_text,basis,condition_text,promotion_id,
  valid_from,valid_to,ai_exposure,rem_min_available,rem_as_of,editors)
 values(key,p.id,edited.kind,c.id,edited.amount,edited.basis_size_sqm,edited.display_text,edited.basis,edited.condition_text,edited.promotion_id,
  edited.valid_from,edited.valid_to,coalesce(edited.ai_exposure,'web_only'),(compare->>'rem_min_available')::numeric,(compare->>'rem_as_of')::timestamptz,array[actor])
 on conflict(id) do update set kind=excluded.kind,commercial_type_id=excluded.commercial_type_id,amount=excluded.amount,basis_size_sqm=excluded.basis_size_sqm,
  display_text=excluded.display_text,basis=excluded.basis,condition_text=excluded.condition_text,promotion_id=excluded.promotion_id,
  valid_from=excluded.valid_from,valid_to=excluded.valid_to,ai_exposure=excluded.ai_exposure,rem_min_available=excluded.rem_min_available,
  rem_as_of=excluded.rem_as_of,state='draft',revision=hub.project_prices.revision+1,approved_by=null,approved_at=null,
  editors=array(select distinct e from unnest(prior.editors||array[prior.created_by,actor]) e where e is not null);
 update hub.projects set updated_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('price_id',key,'updated_at',(select updated_at from hub.projects where id=p.id));
end $$;

create function hub.project_price_review(public_id text,price_uuid uuid,expected_stamp timestamptz,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;p hub.projects;c hub.project_prices;v hub.project_price_versions;begin
 if decision not in ('submit','approve','return','withdraw') then raise exception 'Invalid price decision' using errcode='23514';end if;
 actor:=hub.require_permission('projects',case when decision='submit' then 'edit' else 'approve' end);
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if expected_stamp is distinct from p.updated_at then raise exception 'Project changed' using errcode='40001';end if;
 select * into c from hub.project_prices where project_id=p.id and id=price_uuid for update;
 if not found then raise exception 'Price not found' using errcode='P0002';end if;
 if decision='submit' then
  if c.state<>'draft' or not(hub.project_price_readiness(c.id)->>'ready')::boolean then raise exception 'Complete price details and reviewed English before submission' using errcode='23514';end if;
  insert into hub.project_price_versions(project_id,price_id,revision,payload,source_snapshot,editors)
   values(p.id,c.id,c.revision,hub.project_price_snapshot(c.id),hub.unit_price_comparison(c.commercial_type_id),
    array(select distinct e from unnest(c.editors||array[c.created_by,actor]) e where e is not null));
  update hub.project_prices set state='in_review' where id=c.id;
 elsif decision in ('approve','return') then
  select * into v from hub.project_price_versions where price_id=c.id and revision=c.revision for update;
  if c.state<>'in_review' or v.state<>'in_review' or v.id is null then raise exception 'No submitted price revision' using errcode='23514';end if;
  if decision='approve' and actor=any(v.editors) then raise exception 'Another person must approve this revision' using errcode='42501';end if;
  if decision='approve' and not(hub.project_price_readiness(c.id)->>'ready')::boolean then raise exception 'Price expired or requirements changed' using errcode='23514';end if;
  update hub.project_price_versions set state=case when decision='approve' then 'approved' else 'returned' end,
   approved_by=case when decision='approve' then actor end,approved_at=case when decision='approve' then clock_timestamp() end where id=v.id;
  update hub.project_prices set state=case when decision='approve' then 'approved' else 'draft' end,
   revision=revision+case when decision='return' then 1 else 0 end,approved_by=case when decision='approve' then actor end,
   approved_at=case when decision='approve' then clock_timestamp() end where id=c.id;
 else
  if c.state<>'approved' then raise exception 'Only approved prices can be withdrawn' using errcode='23514';end if;
  update hub.project_price_versions set state='withdrawn' where price_id=c.id and state='approved';
  update hub.project_prices set state='withdrawn',approved_by=null,approved_at=null where id=c.id;
 end if;
 update hub.projects set updated_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('price_id',c.id,'updated_at',(select updated_at from hub.projects where id=p.id));
end $$;

-- Phase 8 may compose this private, explicit projection after its page approval.
-- Expiry and hidden/internal states are checked at read time, not just submission.
create function hub.project_current_prices(project_uuid uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(v.payload order by p.kind,p.public_price_id),'[]') from hub.project_prices p
 join hub.project_price_versions v on v.price_id=p.id and v.revision=p.revision and v.state='approved'
 join hub.commercial_types c on c.id=p.commercial_type_id
 where p.project_id=project_uuid and p.state='approved' and p.ai_exposure<>'internal'
  and c.deleted_at is null and c.status='approved' and c.price_mode='manual' and c.ai_exposure<>'internal'
  and (current_timestamp at time zone 'Asia/Bangkok')::date between p.valid_from and p.valid_to
$$;

create function hub.unit_type_workspace(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;begin
 perform hub.require_permission('projects','view');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 return jsonb_build_object('project',jsonb_build_object('public_project_id',p.public_project_id,'public_name',p.public_name,'updated_at',p.updated_at),
  'types',(select coalesce(jsonb_agg(c||jsonb_build_object('workflow',hub.unit_type_readiness((c->>'id')::uuid),
   'comparison',hub.unit_price_comparison((c->>'id')::uuid),
   'history',coalesce((select jsonb_agg(to_jsonb(v) order by revision desc) from hub.commercial_type_versions v where commercial_type_id=(c->>'id')::uuid),'[]'))),'[]')
   from jsonb_array_elements(hub.asset_permission_projection(hub.commercial_types_payload(p.id))) c),
  'prices',coalesce((select jsonb_agg((to_jsonb(price)-case when hub.can('promotions','view') then array[]::text[] else array['promotion_id'] end)||jsonb_build_object(
   'comparison',hub.unit_price_comparison(price.commercial_type_id),'readiness',hub.project_price_readiness(price.id),
   'rem_difference',price.rem_min_available is not null and price.amount<>price.rem_min_available,
   'expired',price.valid_to<(current_timestamp at time zone 'Asia/Bangkok')::date,
   'history',coalesce((select jsonb_agg(case when hub.can('promotions','view') then to_jsonb(v)-'source_snapshot'
    else jsonb_set(to_jsonb(v)-'source_snapshot','{payload}',v.payload-'promotion_code') end order by revision desc) from hub.project_price_versions v where price_id=price.id),'[]')) order by price.created_at,price.id)
   from hub.project_prices price where price.project_id=p.id),'[]'),
  'source',hub.unit_source_comparison(p.id),'translations',hub.content_translation_list('projects',public_id),
  'room_tags',coalesce((select jsonb_agg(jsonb_build_object('code',code,'label',label) order by code) from hub.media_tags where tag_group='room' and status='active'),'[]'),
  'promotions',case when hub.can('promotions','view') then coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'title',title,'starts_at',starts_at,'ends_at',ends_at)) from hub.public_promotions where project_id=p.id),'[]') else '[]'::jsonb end,
  'tours',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('targets',(select jsonb_agg(to_jsonb(t)) from hub.media_link_targets t where media_link_id=l.id))) from hub.media_links l where l.project_id=p.id and l.state<>'WITHDRAWN' and exists(select 1 from hub.media_link_targets where media_link_id=l.id and target_type='commercial_type')),'[]'));
end $$;

update hub.field_catalog set status='active',required_for='{"all":"required"}',
 locales_required=case when field_key in ('price.display_text','price.basis','price.condition_text') then array['th','en'] else array[]::text[] end,
 validation=validation||'{"ai_translation":false}',default_ai_exposure=case when field_key like 'price.rem_%' or field_key like 'price.approved_%' then 'internal' else 'web_only' end,
 surfaces=case when field_key like 'price.rem_%' or field_key like 'price.approved_%' then array['hub_only'] else array['web.unit_type','web.project.prices'] end,
 help=jsonb_build_object('th','ราคา Marketing พร้อมแบบและขนาดที่อ้างอิง เงื่อนไข และวันหมดอายุไม่เกิน 60 วัน ราคา REM ใช้เปรียบเทียบภายในเท่านั้น')
 where entity='price';
insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy,default_ai_exposure,surfaces,status,help,required_for)
 values('price.basis_size_sqm','price','prices','{"th":"ขนาดที่อ้างอิงราคา (ตร.ม.)"}','area','mkt','web_only',array['web.unit_type','web.project.prices'],'active',
 '{"th":"ขนาดของแบบห้องหรือแบบบ้านที่ใช้เป็นฐานราคาเริ่มต้น ไม่ใช่พื้นที่เฉลี่ยจาก REM"}','{"all":"required"}');

do $$ declare d text;begin
 d:=pg_get_functiondef('hub.track_content_translation()'::regprocedure);
 d:=replace(d,'else raise exception ''Unsupported translation source''',
  'elsif tg_table_name=''project_prices'' then kind:=''price'';owner:=data->>''id'';tab:=''projects'';
   select public_project_id into scope from hub.projects where id=(data->>''project_id'')::uuid;
   keys:=array[''display_text'',''basis'',''condition_text''];ref:=jsonb_build_object(''id'',owner,''project_id'',data->''project_id'');
   else raise exception ''Unsupported translation source''');execute d;
 d:=pg_get_functiondef('hub.translation_editable(hub.content_translations)'::regprocedure);
 d:=replace(d,'return t.owner_type in','if t.owner_type=''price'' then return exists(select 1 from hub.project_prices where id=t.owner_key::uuid and state<>''in_review'');end if;return t.owner_type in');execute d;
 d:=pg_get_functiondef('hub.review_content_translation(uuid,integer,integer,text)'::regprocedure);
 d:=replace(d,'''selling_point'',''commercial_type'') then','''selling_point'',''commercial_type'',''price'') then');
 d:=replace(d,'else raise exception ''Unsupported translation target''',
  'elsif t.owner_type=''price'' then
   if col not in (''display_text'',''basis'',''condition_text'') then raise exception ''Invalid price text'' using errcode=''23514'';end if;
   execute format(''update hub.project_prices set %I=jsonb_set(%I,''''{en}'''',to_jsonb($1::text),true),state=''''draft'''',revision=revision+1,approved_by=null,approved_at=null,
    editors=array(select distinct e from unnest(editors||array[$3]) e where e is not null) where id=$2'',col,col) using english,t.owner_key::uuid,actor;
   update hub.projects set updated_at=clock_timestamp() where id=(t.row_ref->>''project_id'')::uuid;
   else raise exception ''Unsupported translation target''');execute d;
end $$;
create trigger content_translation after insert or update on hub.project_prices for each row execute function hub.track_content_translation();

revoke all on function hub.unit_price_comparison(uuid),hub.project_price_readiness(uuid),hub.project_price_snapshot(uuid),
 hub.save_project_price(text,uuid,timestamptz,jsonb),hub.project_price_review(text,uuid,timestamptz,text),hub.project_current_prices(uuid),hub.unit_type_workspace(text) from public;
grant execute on function hub.save_project_price(text,uuid,timestamptz,jsonb),hub.project_price_review(text,uuid,timestamptz,text),hub.unit_type_workspace(text) to hub_app;
commit;
