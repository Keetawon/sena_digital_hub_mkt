-- Migration 0100: SENA Event Hub, Co-Join Marketplace, Private R2 Attachments & Critical Change Read-Receipts
-- 1. Owner-only FORCE RLS tables: hub.event_sequence, hub.events, hub.event_attachments,
--    hub.event_participants, hub.event_revisions, hub.event_acknowledgements.
-- 2. Extends hub.can_read_asset(uuid) so operational event files (floor plans, move-in forms,
--    onsite photos) are readable by internal staff, while finance_restricted files (quotations,
--    contracts, memos) are readable only by the event host/admin, finance viewers, or approved
--    cost-sharing participants. Agencies and public consumers receive zero access.
-- 3. Automatic Critical-Change Detector on venue/zone/schedule/postpone/cancel: writes immutable
--    before->after snapshots and creates mandatory read-receipt (Ack) rows for joined teams and
--    Online Ads (when campaign_code is linked).

begin;

create table if not exists hub.event_sequence (
  yymm text primary key check (yymm ~ '^[0-9]{4}$'),
  last_seq integer not null default 0 check (last_seq >= 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid
);

create table if not exists hub.events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique check (event_code ~ '^EVT-[0-9]{4}-[0-9]{3,6}$'),
  event_category text not null default 'partner_booth'
    check (event_category in ('partner_booth', 'project_onsite', 'corporate_expo', 'sub_business_event')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  venue_name text not null check (char_length(btrim(venue_name)) between 1 and 300),
  venue_zone text not null default '' check (char_length(venue_zone) <= 300),
  province text not null default 'กรุงเทพมหานคร' check (char_length(province) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  setup_notes text not null default '' check (char_length(setup_notes) <= 2000),
  host_scope_type text not null default 'bud'
    check (host_scope_type in ('corporate', 'bud', 'project_group', 'project', 'programme', 'business')),
  host_scope_id text not null check (char_length(btrim(host_scope_id)) between 1 and 200),
  host_label text not null default '' check (char_length(host_label) <= 200),
  partner_org_name text not null default '' check (char_length(partner_org_name) <= 300),
  open_for_join boolean not null default true,
  join_deadline_at timestamptz,
  max_co_joiners integer check (max_co_joiners is null or max_co_joiners between 1 and 100),
  cost_share_mode text not null default 'free_invite'
    check (cost_share_mode in ('free_invite', 'fixed_slot', 'proportional_split')),
  estimated_cost_thb numeric(14,2)
    check (estimated_cost_thb is null or (estimated_cost_thb >= 0 and estimated_cost_thb < 'Infinity'::numeric)),
  memo_no text check (memo_no is null or char_length(btrim(memo_no)) between 1 and 120),
  campaign_code text check (campaign_code is null or char_length(btrim(campaign_code)) between 1 and 120),
  audience_visibility text not null default 'internal_only'
    check (audience_visibility in ('internal_only', 'public_web')),
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  contact_phone text not null default '' check (char_length(contact_phone) <= 80),
  state text not null default 'scheduled'
    check (state in ('scheduled', 'postponed', 'cancelled')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  revision integer not null default 1 check (revision > 0),
  schedule_revision integer not null default 1 check (schedule_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  check (ends_at >= starts_at)
);

create index if not exists events_starts_state_idx on hub.events (starts_at desc, state);
create index if not exists events_open_join_idx on hub.events (open_for_join, starts_at) where state = 'scheduled';
create index if not exists events_host_scope_idx on hub.events (host_scope_type, host_scope_id);

create table if not exists hub.event_attachments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references hub.events on delete cascade,
  asset_id uuid not null references hub.assets,
  doc_kind text not null default 'floor_plan'
    check (doc_kind in ('floor_plan', 'venue_rules', 'quotation', 'artwork', 'onsite_photo', 'other')),
  visibility text not null default 'operational'
    check (visibility in ('operational', 'finance_restricted')),
  title text not null default '' check (char_length(title) <= 300),
  version_no integer not null default 1 check (version_no > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid
);

create index if not exists event_attachments_event_idx on hub.event_attachments (event_id, created_at desc) where deleted_at is null;
create index if not exists event_attachments_asset_idx on hub.event_attachments (asset_id) where deleted_at is null;

create table if not exists hub.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references hub.events on delete cascade,
  participant_scope_type text not null
    check (participant_scope_type in ('bud', 'project_group', 'project', 'programme', 'business', 'corporate')),
  participant_scope_id text not null check (char_length(btrim(participant_scope_id)) between 1 and 200),
  participant_label text not null check (char_length(btrim(participant_label)) between 1 and 200),
  join_state text not null default 'requested'
    check (join_state in ('requested', 'approved', 'declined', 'withdrawn')),
  staff_count integer not null default 1 check (staff_count between 0 and 100),
  booth_needs text not null default '' check (char_length(booth_needs) <= 500),
  shares_cost boolean not null default false,
  cost_share_thb numeric(14,2)
    check (cost_share_thb is null or (cost_share_thb >= 0 and cost_share_thb < 'Infinity'::numeric)),
  memo_no text check (memo_no is null or char_length(btrim(memo_no)) between 1 and 120),
  contact_account_id uuid not null references hub.user_account,
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  contact_phone text not null default '' check (char_length(contact_phone) <= 80),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  unique (event_id, participant_scope_type, participant_scope_id)
);

create index if not exists event_participants_event_idx on hub.event_participants (event_id, join_state);
create index if not exists event_participants_contact_idx on hub.event_participants (contact_account_id);

create table if not exists hub.event_revisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references hub.events on delete cascade,
  schedule_revision integer not null check (schedule_revision > 1),
  change_type text not null
    check (change_type in ('venue_changed', 'time_changed', 'postponed', 'cancelled', 'reopened', 'floor_plan_updated')),
  change_reason text not null check (char_length(btrim(change_reason)) between 1 and 1000),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  unique (event_id, schedule_revision)
);

create index if not exists event_revisions_event_idx on hub.event_revisions (event_id, schedule_revision desc);

create table if not exists hub.event_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  event_revision_id uuid not null references hub.event_revisions on delete cascade,
  event_id uuid not null references hub.events on delete cascade,
  target_kind text not null check (target_kind in ('participant', 'online_ads')),
  participant_id uuid references hub.event_participants on delete cascade,
  target_label text not null check (char_length(btrim(target_label)) between 1 and 200),
  contact_account_id uuid references hub.user_account,
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  contact_phone text not null default '' check (char_length(contact_phone) <= 80),
  acked_by uuid references hub.user_account,
  acked_at timestamptz,
  ack_note text check (ack_note is null or char_length(ack_note) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default nullif(current_setting('app.actor_id', true), '')::uuid
);

create index if not exists event_acknowledgements_pending_idx on hub.event_acknowledgements (event_id, acked_at) where acked_at is null;
create index if not exists event_acknowledgements_revision_idx on hub.event_acknowledgements (event_revision_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'event_sequence', 'events', 'event_attachments',
    'event_participants', 'event_revisions', 'event_acknowledgements'
  ] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('alter table hub.%I force row level security', t);
    execute format('drop policy if exists event_owner on hub.%I', t);
    execute format('create policy event_owner on hub.%I to %I using (true) with check (true)', t, current_user);
    execute format(
      'revoke all on table hub.%I from public, hub_app, viewer, editor, publisher, admin, online_staff, agency, service_consumer',
      t
    );
    if not exists (select 1 from pg_trigger where tgrelid = ('hub.' || t)::regclass and tgname = 'event_audit') then
      execute format(
        'create trigger event_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',
        t
      );
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('hub.' || t)::regclass and tgname = 'event_touch') then
      execute format(
        'create trigger event_touch before update on hub.%I for each row execute function hub.touch_record()',
        t
      );
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'hub.event_attachments'::regclass and tgname = 'remember_asset_binding') then
    create trigger remember_asset_binding after insert or update of asset_id on hub.event_attachments for each row execute function hub.remember_asset_binding();
  end if;
end $$;

-- Internal staff gate: active SENA staff only; agencies and public consumers never pass.
create or replace function hub.event_staff_allowed()
returns boolean
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  acct hub.user_account;
begin
  if actor is null or nullif(current_setting('app.agency_code', true), '') is not null then
    return false;
  end if;
  select * into acct from hub.user_account where id = actor;
  if not found or acct.status <> 'ACTIVE' or acct.agency_code is not null
     or acct.hub_role not in ('viewer', 'editor', 'publisher', 'admin', 'online_staff') then
    return false;
  end if;
  return hub.can('projects', 'view') or hub.can('brands', 'view') or hub.can('knowledge', 'view')
      or hub.can('promotions', 'view') or hub.can('releases', 'view')
      or hub.can('registry', 'view') or hub.can('finance', 'view');
end $$;

create or replace function hub.event_require_staff(require_write boolean default false)
returns uuid
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  acct hub.user_account;
begin
  if not hub.event_staff_allowed() then
    raise exception 'Event Hub internal staff permission required' using errcode = '42501';
  end if;
  select * into acct from hub.user_account where id = actor;
  if require_write and not (
    acct.hub_role in ('editor', 'publisher', 'admin', 'online_staff')
    or hub.can('projects', 'edit') or hub.can('knowledge', 'edit')
    or hub.can('promotions', 'edit') or hub.can('registry', 'edit') or hub.can('finance', 'edit')
  ) then
    raise exception 'Event write permission required' using errcode = '42501';
  end if;
  return actor;
end $$;

create or replace function hub.event_can_manage(ev hub.events)
returns boolean
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  acct hub.user_account;
begin
  if not hub.event_staff_allowed() then return false; end if;
  select * into acct from hub.user_account where id = actor;
  return ev.created_by = actor
      or acct.hub_role = 'admin'
      or hub.can('projects', 'approve')
      or hub.can('knowledge', 'approve')
      or hub.can('promotions', 'approve');
end $$;

create or replace function hub.event_can_read_finance(ev hub.events)
returns boolean
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
begin
  if not hub.event_staff_allowed() then return false; end if;
  if hub.event_can_manage(ev) or hub.can('finance', 'view') then return true; end if;
  return exists (
    select 1 from hub.event_participants ep
    where ep.event_id = ev.id
      and ep.join_state = 'approved'
      and ep.shares_cost = true
      and (ep.contact_account_id = actor or ep.created_by = actor)
  );
end $$;

create or replace function hub.event_next_code(start_ts timestamptz)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  ym text := to_char(start_ts at time zone 'Asia/Bangkok', 'YYMM');
  seq_no integer;
begin
  insert into hub.event_sequence(yymm, last_seq)
  values (ym, 1)
  on conflict (yymm) do update set last_seq = hub.event_sequence.last_seq + 1
  returning last_seq into seq_no;
  return 'EVT-' || ym || '-' || lpad(seq_no::text, 3, '0');
end $$;

-- Extend hub.can_read_asset(uuid) while retaining its OID for existing hub.assets RLS policies
do $$
declare
  has_before boolean;
  definition text;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'hub' and p.proname = 'can_read_asset_before_events'
  ) into has_before;
  if not has_before then
    definition := replace(pg_get_functiondef('hub.can_read_asset(uuid)'::regprocedure), E'\r\n', E'\n');
    execute replace(definition, 'FUNCTION hub.can_read_asset(', 'FUNCTION hub.can_read_asset_before_events(');
  end if;
end $$;

create or replace function hub.can_read_asset(asset_uuid uuid)
returns boolean
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if exists (select 1 from hub.event_attachments ea where ea.asset_id = asset_uuid and ea.deleted_at is null) then
    if exists (
      select 1 from hub.event_attachments ea
      where ea.asset_id = asset_uuid and ea.deleted_at is null and ea.visibility = 'operational'
    ) and hub.event_staff_allowed() then
      return true;
    end if;
    if exists (
      select 1 from hub.event_attachments ea
      join hub.events ev on ev.id = ea.event_id
      where ea.asset_id = asset_uuid and ea.deleted_at is null and ea.visibility = 'finance_restricted'
        and hub.event_can_read_finance(ev)
    ) then
      return true;
    end if;
    -- If exclusively bound as a finance_restricted event document, do not fall through to generic intake read!
    if not exists (
      select 1 from hub.entity_assets where asset_id = asset_uuid and deleted_at is null
      union all select 1 from hub.asset_links where asset_id = asset_uuid and deleted_at is null
      union all select 1 from hub.brand_assets where asset_id = asset_uuid and deleted_at is null
      union all select 1 from hub.commercial_type_assets where asset_id = asset_uuid and deleted_at is null
    ) then
      return false;
    end if;
  end if;
  return hub.can_read_asset_before_events(asset_uuid);
end $$;

-- Also allow event writers to upload intake files for event attachments while preserving OID
do $$
declare
  has_upload_before boolean;
  definition text;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'hub' and p.proname = 'can_upload_asset_before_events'
  ) into has_upload_before;
  if not has_upload_before then
    definition := replace(pg_get_functiondef('hub.can_upload_asset()'::regprocedure), E'\r\n', E'\n');
    execute replace(definition, 'FUNCTION hub.can_upload_asset(', 'FUNCTION hub.can_upload_asset_before_events(');
  end if;
end $$;

create or replace function hub.can_upload_asset()
returns boolean
language sql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select hub.can_upload_asset_before_events()
      or (hub.event_staff_allowed() and (hub.can('promotions', 'edit') or hub.can('registry', 'edit') or hub.can('finance', 'edit')))
$$;

create or replace function hub.event_live_status(ev hub.events)
returns text
language sql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select case
    when ev.state = 'cancelled' then 'cancelled'
    when ev.state = 'postponed' then 'postponed'
    when now() > ev.ends_at then 'completed'
    when now() between ev.starts_at and ev.ends_at then 'live_now'
    when ev.open_for_join and (ev.join_deadline_at is null or ev.join_deadline_at > now()) then 'upcoming_open'
    else 'upcoming_closed'
  end
$$;

create or replace function hub.event_references()
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  acct hub.user_account;
  buds jsonb;
  projects jsonb;
  businesses jsonb;
  programmes jsonb;
begin
  select * into acct from hub.user_account where id = actor;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', coalesce(nullif(btrim(coalesce(code, '') || ' ' || coalesce(name, '')), ''), id)) order by id), '[]'::jsonb)
  into buds
  from (
    select distinct bu.rem_bu_id as id, bu.rem_bu_code as code, bu.rem_bu_name as name
    from hub.workspace_project_bu() bu
    where bu.rem_bu_id is not null
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.public_project_id,
    'rem_project_id', p.rem_project_id,
    'label', coalesce(nullif(btrim(p.public_name->>'th'), ''), nullif(btrim(p.public_name->>'en'), ''), p.rem_project_id)
  ) order by p.public_project_id), '[]'::jsonb)
  into projects
  from (
    select x.public_project_id, x.rem_project_id, x.public_name
    from hub.projects x
    where x.deleted_at is null
    order by x.public_project_id
    limit 120
  ) p;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.code,
    'label', coalesce(b.label->>'th', b.label->>'en', b.code)
  ) order by case b.code when 'solar' then 1 when 'senx' then 2 when 'ngernsod_jaidee' then 3 else 9 end, b.code), '[]'::jsonb)
  into businesses
  from hub.businesses b
  where b.code <> 'residential';

  programmes := jsonb_build_array(
    jsonb_build_object('id', 'LIVNEX', 'label', 'LivNex เช่าออมบ้าน'),
    jsonb_build_object('id', 'RENTNEX', 'label', 'RentNex เช่าตรงพร้อมอยู่'),
    jsonb_build_object('id', 'RENTNEX_INVEST', 'label', 'RentNex Invest ลงทุนปล่อยเช่า')
  );

  return jsonb_build_object(
    'actor', jsonb_build_object(
      'id', acct.id,
      'display_name_th', coalesce(nullif(btrim(acct.display_name_th), ''), acct.email),
      'phone', coalesce(acct.phone, ''),
      'team', coalesce(acct.team, ''),
      'can_write', (
        acct.hub_role in ('editor', 'publisher', 'admin', 'online_staff')
        or hub.can('projects', 'edit') or hub.can('knowledge', 'edit')
        or hub.can('promotions', 'edit') or hub.can('registry', 'edit') or hub.can('finance', 'edit')
      )
    ),
    'buds', buds,
    'projects', projects,
    'businesses', businesses,
    'programmes', programmes
  );
end $$;

create or replace function hub.event_list(
  filter_mode text default 'all',
  search_q text default '',
  scope_filter text default null,
  limit_rows integer default 50,
  offset_rows integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  needle text := lower(btrim(coalesce(search_q, '')));
  items jsonb := '[]'::jsonb;
  counts jsonb;
  total_matched integer := 0;
  r record;
  can_fin boolean;
  can_mgr boolean;
begin
  if filter_mode not in ('all', 'open_join', 'upcoming', 'changed', 'mine')
     or limit_rows not between 1 and 100 or offset_rows not between 0 and 100000 then
    raise exception 'Invalid event list filters' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'all', count(*),
    'open_join', count(*) filter (
      where ev.state = 'scheduled' and ev.ends_at >= now() and ev.open_for_join
        and (ev.join_deadline_at is null or ev.join_deadline_at > now())
    ),
    'upcoming', count(*) filter (where ev.state = 'scheduled' and ev.ends_at >= now()),
    'changed', count(*) filter (where ev.schedule_revision > 1 or ev.state in ('postponed', 'cancelled')),
    'mine', count(*) filter (
      where ev.created_by = actor or exists (
        select 1 from hub.event_participants ep
        where ep.event_id = ev.id and ep.join_state <> 'withdrawn'
          and (ep.contact_account_id = actor or ep.created_by = actor)
      )
    )
  ) into counts
  from hub.events ev;

  for r in
    with matched as (
      select ev.*,
        hub.event_live_status(ev) as live_status,
        (select count(*)::int from hub.event_participants ep where ep.event_id = ev.id and ep.join_state = 'approved') as approved_join_count,
        (select count(*)::int from hub.event_participants ep where ep.event_id = ev.id and ep.join_state = 'requested') as pending_join_count,
        (select count(*)::int from hub.event_acknowledgements ea where ea.event_id = ev.id and ea.acked_at is null) as pending_ack_count,
        (select coalesce(jsonb_agg(ep.participant_label order by ep.created_at), '[]'::jsonb)
         from hub.event_participants ep where ep.event_id = ev.id and ep.join_state = 'approved') as joined_labels
      from hub.events ev
      where (
        filter_mode = 'all'
        or (filter_mode = 'open_join' and ev.state = 'scheduled' and ev.ends_at >= now() and ev.open_for_join and (ev.join_deadline_at is null or ev.join_deadline_at > now()))
        or (filter_mode = 'upcoming' and ev.state = 'scheduled' and ev.ends_at >= now())
        or (filter_mode = 'changed' and (ev.schedule_revision > 1 or ev.state in ('postponed', 'cancelled')))
        or (filter_mode = 'mine' and (
          ev.created_by = actor or exists (
            select 1 from hub.event_participants ep
            where ep.event_id = ev.id and ep.join_state <> 'withdrawn'
              and (ep.contact_account_id = actor or ep.created_by = actor)
          )
        ))
      )
      and (
        needle = ''
        or position(needle in lower(
          ev.event_code || ' ' || ev.title || ' ' || ev.venue_name || ' ' || ev.venue_zone || ' ' ||
          ev.province || ' ' || ev.host_label || ' ' || ev.partner_org_name || ' ' || coalesce(ev.memo_no, '')
        )) > 0
      )
      and (
        scope_filter is null or btrim(scope_filter) = ''
        or ev.host_scope_type || ':' || ev.host_scope_id = scope_filter
        or ev.host_scope_type = scope_filter
        or exists (
          select 1 from hub.event_participants ep
          where ep.event_id = ev.id and ep.join_state <> 'withdrawn'
            and (ep.participant_scope_type || ':' || ep.participant_scope_id = scope_filter or ep.participant_scope_type = scope_filter)
        )
      )
    )
    select *, count(*) over ()::int as full_count
    from matched
    order by
      case when state in ('postponed', 'cancelled') and updated_at >= now() - interval '7 days' then 0
           when live_status = 'live_now' then 1
           when live_status = 'upcoming_open' then 2
           when live_status = 'upcoming_closed' then 3
           else 4 end,
      starts_at asc,
      created_at desc
    limit limit_rows offset offset_rows
  loop
    total_matched := r.full_count;
    can_fin := hub.event_can_read_finance((select x from hub.events x where x.id = r.id));
    can_mgr := hub.event_can_manage((select x from hub.events x where x.id = r.id));
    items := items || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'event_code', r.event_code,
      'event_category', r.event_category,
      'title', r.title,
      'venue_name', r.venue_name,
      'venue_zone', r.venue_zone,
      'province', r.province,
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'host_scope_type', r.host_scope_type,
      'host_scope_id', r.host_scope_id,
      'host_label', r.host_label,
      'partner_org_name', r.partner_org_name,
      'open_for_join', r.open_for_join,
      'join_deadline_at', r.join_deadline_at,
      'max_co_joiners', r.max_co_joiners,
      'cost_share_mode', r.cost_share_mode,
      'estimated_cost_thb', case when can_fin then r.estimated_cost_thb else null end,
      'memo_no', case when can_fin then r.memo_no else null end,
      'campaign_code', r.campaign_code,
      'audience_visibility', r.audience_visibility,
      'contact_name', r.contact_name,
      'contact_phone', r.contact_phone,
      'state', r.state,
      'live_status', r.live_status,
      'cancel_reason', r.cancel_reason,
      'revision', r.revision,
      'schedule_revision', r.schedule_revision,
      'approved_join_count', r.approved_join_count,
      'pending_join_count', r.pending_join_count,
      'pending_ack_count', r.pending_ack_count,
      'joined_labels', r.joined_labels,
      'attachment_count', (
        select count(*)::int from hub.event_attachments ea
        where ea.event_id = r.id and ea.deleted_at is null
          and (ea.visibility = 'operational' or can_fin)
      ),
      'has_floor_plan', exists (
        select 1 from hub.event_attachments ea
        where ea.event_id = r.id and ea.deleted_at is null and ea.doc_kind = 'floor_plan'
      ),
      'can_manage', can_mgr,
      'can_read_finance', can_fin,
      'updated_at', r.updated_at
    ));
  end loop;

  return jsonb_build_object(
    'items', items,
    'total', total_matched,
    'counts', counts
  );
end $$;

create or replace function hub.event_read(event_uuid uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  ev hub.events;
  can_fin boolean;
  can_mgr boolean;
  attachments jsonb;
  participants jsonb;
  revisions jsonb;
  acks jsonb;
begin
  select * into ev from hub.events where id = event_uuid;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  can_fin := hub.event_can_read_finance(ev);
  can_mgr := hub.event_can_manage(ev);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ea.id,
    'asset_id', ea.asset_id,
    'doc_kind', ea.doc_kind,
    'visibility', ea.visibility,
    'title', coalesce(nullif(btrim(ea.title), ''), a.original_filename),
    'original_filename', a.original_filename,
    'mime_type', a.mime_type,
    'file_size', a.file_size,
    'version_no', ea.version_no,
    'download_url', '/api/hub/v1/admin/assets/' || ea.asset_id::text || '/file',
    'created_at', ea.created_at
  ) order by ea.doc_kind = 'floor_plan' desc, ea.created_at desc), '[]'::jsonb)
  into attachments
  from hub.event_attachments ea
  join hub.assets a on a.id = ea.asset_id
  where ea.event_id = ev.id and ea.deleted_at is null and a.deleted_at is null
    and (ea.visibility = 'operational' or can_fin);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ep.id,
    'participant_scope_type', ep.participant_scope_type,
    'participant_scope_id', ep.participant_scope_id,
    'participant_label', ep.participant_label,
    'join_state', ep.join_state,
    'staff_count', ep.staff_count,
    'booth_needs', ep.booth_needs,
    'shares_cost', ep.shares_cost,
    'cost_share_thb', case when can_fin or ep.contact_account_id = actor or ep.created_by = actor then ep.cost_share_thb else null end,
    'memo_no', case when can_fin or ep.contact_account_id = actor or ep.created_by = actor then ep.memo_no else null end,
    'contact_account_id', ep.contact_account_id,
    'contact_name', ep.contact_name,
    'contact_phone', ep.contact_phone,
    'decision_note', ep.decision_note,
    'is_mine', (ep.contact_account_id = actor or ep.created_by = actor),
    'qr_registration_url', 'https://www.sena.co.th/event-register?event=' || ev.event_code || '&scope=' || ep.participant_scope_type || ':' || ep.participant_scope_id || '&utm_source=offline_event&utm_medium=qr_standee&utm_campaign=' || ev.event_code,
    'created_at', ep.created_at
  ) order by case ep.join_state when 'approved' then 0 when 'requested' then 1 else 2 end, ep.created_at), '[]'::jsonb)
  into participants
  from hub.event_participants ep
  where ep.event_id = ev.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', er.id,
    'schedule_revision', er.schedule_revision,
    'change_type', er.change_type,
    'change_reason', er.change_reason,
    'before_snapshot', er.before_snapshot,
    'after_snapshot', er.after_snapshot,
    'created_at', er.created_at,
    'acknowledgements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ack.id,
        'target_kind', ack.target_kind,
        'target_label', ack.target_label,
        'contact_name', ack.contact_name,
        'contact_phone', ack.contact_phone,
        'acked_at', ack.acked_at,
        'ack_note', ack.ack_note,
        'can_ack', (
          ack.acked_at is null and (
            ack.contact_account_id = actor
            or can_mgr
            or (ack.target_kind = 'online_ads' and (hub.can('registry', 'edit') or hub.can('finance', 'edit')))
          )
        )
      ) order by ack.acked_at is not null, ack.target_label), '[]'::jsonb)
      from hub.event_acknowledgements ack
      where ack.event_revision_id = er.id
    )
  ) order by er.schedule_revision desc), '[]'::jsonb)
  into revisions
  from hub.event_revisions er
  where er.event_id = ev.id;

  return jsonb_build_object(
    'id', ev.id,
    'event_code', ev.event_code,
    'event_category', ev.event_category,
    'title', ev.title,
    'venue_name', ev.venue_name,
    'venue_zone', ev.venue_zone,
    'province', ev.province,
    'starts_at', ev.starts_at,
    'ends_at', ev.ends_at,
    'setup_notes', ev.setup_notes,
    'host_scope_type', ev.host_scope_type,
    'host_scope_id', ev.host_scope_id,
    'host_label', ev.host_label,
    'partner_org_name', ev.partner_org_name,
    'open_for_join', ev.open_for_join,
    'join_deadline_at', ev.join_deadline_at,
    'max_co_joiners', ev.max_co_joiners,
    'cost_share_mode', ev.cost_share_mode,
    'estimated_cost_thb', case when can_fin then ev.estimated_cost_thb else null end,
    'memo_no', case when can_fin then ev.memo_no else null end,
    'campaign_code', ev.campaign_code,
    'audience_visibility', ev.audience_visibility,
    'contact_name', ev.contact_name,
    'contact_phone', ev.contact_phone,
    'state', ev.state,
    'live_status', hub.event_live_status(ev),
    'cancel_reason', ev.cancel_reason,
    'revision', ev.revision,
    'schedule_revision', ev.schedule_revision,
    'can_manage', can_mgr,
    'can_read_finance', can_fin,
    'qr_registration_url', 'https://www.sena.co.th/event-register?event=' || ev.event_code || '&utm_source=offline_event&utm_medium=qr_standee&utm_campaign=' || ev.event_code,
    'attachments', attachments,
    'participants', participants,
    'revisions', revisions,
    'created_at', ev.created_at,
    'updated_at', ev.updated_at
  );
end $$;

create or replace function hub.event_record_critical_change(
  ev hub.events,
  c_type text,
  reason text,
  before_snap jsonb,
  after_snap jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  rev_id uuid;
begin
  if btrim(coalesce(reason, '')) = '' then
    raise exception 'Change reason is required for venue, schedule, or cancellation updates' using errcode = '23514';
  end if;

  insert into hub.event_revisions(event_id, schedule_revision, change_type, change_reason, before_snapshot, after_snapshot)
  values (ev.id, ev.schedule_revision, c_type, btrim(reason), before_snap, after_snap)
  returning id into rev_id;

  -- Fan out mandatory read-receipts to every active/requested participant
  insert into hub.event_acknowledgements(
    event_revision_id, event_id, target_kind, participant_id, target_label,
    contact_account_id, contact_name, contact_phone
  )
  select
    rev_id, ev.id, 'participant', ep.id, ep.participant_label,
    ep.contact_account_id, ep.contact_name, ep.contact_phone
  from hub.event_participants ep
  where ep.event_id = ev.id and ep.join_state in ('approved', 'requested');

  -- If an ad campaign code is linked, also create an Online Ads alert receipt
  if nullif(btrim(coalesce(ev.campaign_code, '')), '') is not null then
    insert into hub.event_acknowledgements(
      event_revision_id, event_id, target_kind, participant_id, target_label,
      contact_account_id, contact_name, contact_phone
    )
    values (
      rev_id, ev.id, 'online_ads', null, 'ทีม Online Marketing / Ads (' || btrim(ev.campaign_code) || ')',
      null, 'ทีมดูแลแคมเปญโฆษณา', ''
    );
  end if;

  return rev_id;
end $$;

create or replace function hub.event_save(
  event_uuid uuid,
  expected_revision integer,
  body jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(true);
  acct hub.user_account;
  prior hub.events;
  updated hub.events;
  new_code text;
  new_title text := btrim(coalesce(body->>'title', ''));
  new_venue text := btrim(coalesce(body->>'venue_name', ''));
  new_zone text := btrim(coalesce(body->>'venue_zone', ''));
  new_prov text := coalesce(nullif(btrim(body->>'province'), ''), 'กรุงเทพมหานคร');
  new_cat text := coalesce(nullif(btrim(body->>'event_category'), ''), 'partner_booth');
  new_starts timestamptz := (body->>'starts_at')::timestamptz;
  new_ends timestamptz := (body->>'ends_at')::timestamptz;
  new_setup text := coalesce(body->>'setup_notes', '');
  new_host_type text := coalesce(nullif(btrim(body->>'host_scope_type'), ''), 'bud');
  new_host_id text := btrim(coalesce(body->>'host_scope_id', ''));
  new_host_label text := btrim(coalesce(body->>'host_label', ''));
  new_partner text := btrim(coalesce(body->>'partner_org_name', ''));
  new_open boolean := coalesce((body->>'open_for_join')::boolean, true);
  new_deadline timestamptz := nullif(btrim(coalesce(body->>'join_deadline_at', '')), '')::timestamptz;
  new_max integer := nullif(btrim(coalesce(body->>'max_co_joiners', '')), '')::integer;
  new_cost_mode text := coalesce(nullif(btrim(body->>'cost_share_mode'), ''), 'free_invite');
  new_cost numeric(14,2) := nullif(btrim(coalesce(body->>'estimated_cost_thb', '')), '')::numeric(14,2);
  new_memo text := nullif(btrim(coalesce(body->>'memo_no', '')), '');
  new_camp text := nullif(btrim(coalesce(body->>'campaign_code', '')), '');
  new_vis text := coalesce(nullif(btrim(body->>'audience_visibility'), ''), 'internal_only');
  new_cname text;
  new_cphone text;
  new_state text := coalesce(nullif(btrim(body->>'state'), ''), 'scheduled');
  reason text := btrim(coalesce(body->>'change_reason', ''));
  venue_diff boolean;
  time_diff boolean;
  state_diff boolean;
  c_type text;
  before_snap jsonb;
  after_snap jsonb;
begin
  select * into acct from hub.user_account where id = actor;
  new_cname := coalesce(nullif(btrim(body->>'contact_name'), ''), nullif(btrim(acct.display_name_th), ''), acct.email);
  new_cphone := coalesce(nullif(btrim(body->>'contact_phone'), ''), coalesce(acct.phone, ''));
  if new_host_label = '' then new_host_label := new_host_id; end if;

  if event_uuid is null then
    if coalesce(expected_revision, 0) <> 0 then
      raise exception 'New event expected_revision must be 0' using errcode = '40001';
    end if;
    new_code := hub.event_next_code(new_starts);
    insert into hub.events(
      event_code, event_category, title, venue_name, venue_zone, province,
      starts_at, ends_at, setup_notes, host_scope_type, host_scope_id, host_label,
      partner_org_name, open_for_join, join_deadline_at, max_co_joiners,
      cost_share_mode, estimated_cost_thb, memo_no, campaign_code,
      audience_visibility, contact_name, contact_phone, state
    )
    values (
      new_code, new_cat, new_title, new_venue, new_zone, new_prov,
      new_starts, new_ends, new_setup, new_host_type, new_host_id, new_host_label,
      new_partner, new_open, new_deadline, new_max,
      new_cost_mode, new_cost, new_memo, new_camp,
      new_vis, new_cname, new_cphone, 'scheduled'
    )
    returning * into updated;
    return hub.event_read(updated.id);
  end if;

  select * into prior from hub.events where id = event_uuid for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not hub.event_can_manage(prior) then
    raise exception 'Only the event owner or manager can update this event' using errcode = '42501';
  end if;
  if prior.revision is distinct from expected_revision then
    raise exception 'Event changed by another user' using errcode = '40001';
  end if;

  venue_diff := (prior.venue_name is distinct from new_venue) or (prior.venue_zone is distinct from new_zone) or (prior.province is distinct from new_prov);
  time_diff := (prior.starts_at is distinct from new_starts) or (prior.ends_at is distinct from new_ends);
  state_diff := (prior.state is distinct from new_state);

  before_snap := jsonb_build_object(
    'state', prior.state,
    'venue_name', prior.venue_name,
    'venue_zone', prior.venue_zone,
    'province', prior.province,
    'starts_at', prior.starts_at,
    'ends_at', prior.ends_at
  );

  update hub.events set
    event_category = new_cat,
    title = new_title,
    venue_name = new_venue,
    venue_zone = new_zone,
    province = new_prov,
    starts_at = new_starts,
    ends_at = new_ends,
    setup_notes = new_setup,
    host_scope_type = new_host_type,
    host_scope_id = new_host_id,
    host_label = new_host_label,
    partner_org_name = new_partner,
    open_for_join = case when new_state = 'cancelled' then false else new_open end,
    join_deadline_at = new_deadline,
    max_co_joiners = new_max,
    cost_share_mode = new_cost_mode,
    estimated_cost_thb = case when body ? 'estimated_cost_thb' then new_cost else prior.estimated_cost_thb end,
    memo_no = case when body ? 'memo_no' then new_memo else prior.memo_no end,
    campaign_code = new_camp,
    audience_visibility = new_vis,
    contact_name = new_cname,
    contact_phone = new_cphone,
    state = new_state,
    cancel_reason = case when new_state in ('cancelled', 'postponed') then coalesce(nullif(reason, ''), prior.cancel_reason) else prior.cancel_reason end,
    revision = prior.revision + 1,
    schedule_revision = prior.schedule_revision + case when (venue_diff or time_diff or state_diff) then 1 else 0 end
  where id = prior.id
  returning * into updated;

  if venue_diff or time_diff or state_diff then
    c_type := case
      when new_state = 'cancelled' and prior.state <> 'cancelled' then 'cancelled'
      when new_state = 'postponed' and prior.state <> 'postponed' then 'postponed'
      when prior.state in ('cancelled', 'postponed') and new_state = 'scheduled' then 'reopened'
      when venue_diff then 'venue_changed'
      else 'time_changed'
    end;
    after_snap := jsonb_build_object(
      'state', updated.state,
      'venue_name', updated.venue_name,
      'venue_zone', updated.venue_zone,
      'province', updated.province,
      'starts_at', updated.starts_at,
      'ends_at', updated.ends_at
    );
    perform hub.event_record_critical_change(updated, c_type, reason, before_snap, after_snap);
  end if;

  return hub.event_read(updated.id);
end $$;

create or replace function hub.event_attachment_add(
  event_uuid uuid,
  body jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(true);
  ev hub.events;
  a hub.assets;
  d_kind text := coalesce(nullif(btrim(body->>'doc_kind'), ''), 'floor_plan');
  vis text := coalesce(nullif(btrim(body->>'visibility'), ''), case when coalesce(body->>'doc_kind', '') = 'quotation' then 'finance_restricted' else 'operational' end);
  doc_title text := btrim(coalesce(body->>'title', ''));
  notify_change boolean := coalesce((body->>'notify_change')::boolean, false);
  reason text := btrim(coalesce(body->>'change_reason', ''));
  next_ver integer;
begin
  select * into ev from hub.events where id = event_uuid for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not hub.event_can_manage(ev) then
    raise exception 'Only the event owner or manager can attach files' using errcode = '42501';
  end if;

  select * into a from hub.assets where id = (body->>'asset_id')::uuid and deleted_at is null for update;
  if not found then raise exception 'Uploaded asset not found' using errcode = 'P0002'; end if;

  select coalesce(max(version_no), 0) + 1 into next_ver
  from hub.event_attachments
  where event_id = ev.id and doc_kind = d_kind and deleted_at is null;

  insert into hub.event_attachments(event_id, asset_id, doc_kind, visibility, title, version_no)
  values (ev.id, a.id, d_kind, vis, coalesce(nullif(doc_title, ''), a.original_filename), next_ver);

  if notify_change and d_kind = 'floor_plan' then
    update hub.events set revision = revision + 1, schedule_revision = schedule_revision + 1
    where id = ev.id returning * into ev;
    perform hub.event_record_critical_change(
      ev,
      'floor_plan_updated',
      coalesce(nullif(reason, ''), 'อัปเดตผังบูธ / จุดตั้งบูธฉบับใหม่ (' || a.original_filename || ')'),
      jsonb_build_object('floor_plan_version', greatest(1, next_ver - 1)),
      jsonb_build_object('floor_plan_version', next_ver, 'filename', a.original_filename)
    );
  end if;

  return hub.event_read(ev.id);
end $$;

create or replace function hub.event_attachment_remove(attachment_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(true);
  att hub.event_attachments;
  ev hub.events;
begin
  select * into att from hub.event_attachments where id = attachment_uuid and deleted_at is null for update;
  if not found then raise exception 'Attachment not found' using errcode = 'P0002'; end if;
  select * into ev from hub.events where id = att.event_id for update;
  if not hub.event_can_manage(ev) then
    raise exception 'Only the event owner or manager can remove attachments' using errcode = '42501';
  end if;
  update hub.event_attachments set deleted_at = clock_timestamp() where id = att.id;
  return hub.event_read(ev.id);
end $$;

create or replace function hub.event_join_save(
  event_uuid uuid,
  body jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  acct hub.user_account;
  ev hub.events;
  p_type text := btrim(coalesce(body->>'participant_scope_type', ''));
  p_id text := btrim(coalesce(body->>'participant_scope_id', ''));
  p_label text := btrim(coalesce(body->>'participant_label', ''));
  s_count integer := coalesce((body->>'staff_count')::integer, 1);
  needs text := btrim(coalesce(body->>'booth_needs', ''));
  s_cost boolean := coalesce((body->>'shares_cost')::boolean, false);
  c_thb numeric(14,2) := nullif(btrim(coalesce(body->>'cost_share_thb', '')), '')::numeric(14,2);
  m_no text := nullif(btrim(coalesce(body->>'memo_no', '')), '');
  c_name text;
  c_phone text;
  approved_cnt integer;
  initial_state text;
begin
  select * into acct from hub.user_account where id = actor;
  select * into ev from hub.events where id = event_uuid for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if ev.state = 'cancelled' then
    raise exception 'Cannot join a cancelled event' using errcode = '23514';
  end if;
  if not ev.open_for_join and not hub.event_can_manage(ev) then
    raise exception 'Event is closed for new co-joiners' using errcode = '23514';
  end if;

  select count(*) into approved_cnt from hub.event_participants where event_id = ev.id and join_state = 'approved';
  if ev.max_co_joiners is not null and approved_cnt >= ev.max_co_joiners and not hub.event_can_manage(ev) then
    raise exception 'Event co-joiner quota is full' using errcode = '23514';
  end if;

  c_name := coalesce(nullif(btrim(body->>'contact_name'), ''), nullif(btrim(acct.display_name_th), ''), acct.email);
  c_phone := coalesce(nullif(btrim(body->>'contact_phone'), ''), coalesce(acct.phone, ''));
  if p_label = '' then p_label := p_id; end if;
  initial_state := case when hub.event_can_manage(ev) then 'approved' else 'requested' end;

  insert into hub.event_participants(
    event_id, participant_scope_type, participant_scope_id, participant_label,
    join_state, staff_count, booth_needs, shares_cost, cost_share_thb, memo_no,
    contact_account_id, contact_name, contact_phone
  )
  values (
    ev.id, p_type, p_id, p_label,
    initial_state, s_count, needs, s_cost, c_thb, m_no,
    actor, c_name, c_phone
  )
  on conflict (event_id, participant_scope_type, participant_scope_id) do update set
    participant_label = excluded.participant_label,
    join_state = initial_state,
    staff_count = excluded.staff_count,
    booth_needs = excluded.booth_needs,
    shares_cost = excluded.shares_cost,
    cost_share_thb = excluded.cost_share_thb,
    memo_no = excluded.memo_no,
    contact_account_id = actor,
    contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone;

  return hub.event_read(ev.id);
end $$;

create or replace function hub.event_join_decide(
  participant_uuid uuid,
  decision text,
  note text default null,
  cost_share numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  ep hub.event_participants;
  ev hub.events;
begin
  if decision not in ('approved', 'declined', 'withdrawn') then
    raise exception 'Invalid join decision' using errcode = '22023';
  end if;
  select * into ep from hub.event_participants where id = participant_uuid for update;
  if not found then raise exception 'Participant request not found' using errcode = 'P0002'; end if;
  select * into ev from hub.events where id = ep.event_id for update;

  if decision = 'withdrawn' then
    if ep.contact_account_id is distinct from actor and ep.created_by is distinct from actor and not hub.event_can_manage(ev) then
      raise exception 'Only the participant or event owner can withdraw' using errcode = '42501';
    end if;
  elsif not hub.event_can_manage(ev) then
    raise exception 'Only the event owner or manager can decide co-join requests' using errcode = '42501';
  end if;

  update hub.event_participants set
    join_state = decision,
    decision_note = coalesce(nullif(btrim(note), ''), decision_note),
    cost_share_thb = coalesce(cost_share::numeric(14,2), cost_share_thb),
    shares_cost = case when cost_share is not null and cost_share > 0 then true else shares_cost end
  where id = ep.id;

  return hub.event_read(ev.id);
end $$;

create or replace function hub.event_ack_alerts(only_mine boolean default true)
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  is_ads boolean := hub.can('registry', 'edit') or hub.can('finance', 'edit');
  items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'ack_id', ack.id,
    'event_id', ev.id,
    'event_code', ev.event_code,
    'event_title', ev.title,
    'state', ev.state,
    'venue_name', ev.venue_name,
    'venue_zone', ev.venue_zone,
    'starts_at', ev.starts_at,
    'ends_at', ev.ends_at,
    'schedule_revision', er.schedule_revision,
    'change_type', er.change_type,
    'change_reason', er.change_reason,
    'before_snapshot', er.before_snapshot,
    'after_snapshot', er.after_snapshot,
    'target_kind', ack.target_kind,
    'target_label', ack.target_label,
    'changed_at', er.created_at
  ) order by (ev.state = 'cancelled') desc, er.created_at desc), '[]'::jsonb)
  into items
  from hub.event_acknowledgements ack
  join hub.event_revisions er on er.id = ack.event_revision_id
  join hub.events ev on ev.id = ack.event_id
  where ack.acked_at is null
    and er.schedule_revision = ev.schedule_revision
    and (
      not only_mine
      or ack.contact_account_id = actor
      or (ack.target_kind = 'online_ads' and is_ads)
      or hub.event_can_manage(ev)
    );

  return jsonb_build_object('items', items);
end $$;

create or replace function hub.event_acknowledge(
  ack_uuid uuid,
  note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor uuid := hub.event_require_staff(false);
  ack hub.event_acknowledgements;
  ev hub.events;
  allowed boolean;
begin
  select * into ack from hub.event_acknowledgements where id = ack_uuid for update;
  if not found then raise exception 'Acknowledgement record not found' using errcode = 'P0002'; end if;
  select * into ev from hub.events where id = ack.event_id;

  allowed := ack.contact_account_id = actor
          or (ack.target_kind = 'online_ads' and (hub.can('registry', 'edit') or hub.can('finance', 'edit')))
          or hub.event_can_manage(ev);
  if not allowed then
    raise exception 'Not authorized to acknowledge for this team' using errcode = '42501';
  end if;

  if ack.acked_at is null then
    update hub.event_acknowledgements
    set acked_by = actor, acked_at = clock_timestamp(), ack_note = nullif(btrim(note), '')
    where id = ack.id;
  end if;

  return hub.event_read(ev.id);
end $$;

revoke all on function
  hub.event_staff_allowed(),
  hub.event_require_staff(boolean),
  hub.event_can_manage(hub.events),
  hub.event_can_read_finance(hub.events),
  hub.event_next_code(timestamptz),
  hub.event_live_status(hub.events),
  hub.event_record_critical_change(hub.events, text, text, jsonb, jsonb),
  hub.can_read_asset_before_events(uuid),
  hub.can_upload_asset_before_events(),
  hub.event_references(),
  hub.event_list(text, text, text, integer, integer),
  hub.event_read(uuid),
  hub.event_save(uuid, integer, jsonb),
  hub.event_attachment_add(uuid, jsonb),
  hub.event_attachment_remove(uuid),
  hub.event_join_save(uuid, jsonb),
  hub.event_join_decide(uuid, text, text, numeric),
  hub.event_ack_alerts(boolean),
  hub.event_acknowledge(uuid, text)
from public, hub_app, viewer, editor, publisher, admin, online_staff, agency, service_consumer;

grant execute on function
  hub.event_references(),
  hub.event_list(text, text, text, integer, integer),
  hub.event_read(uuid),
  hub.event_save(uuid, integer, jsonb),
  hub.event_attachment_add(uuid, jsonb),
  hub.event_attachment_remove(uuid),
  hub.event_join_save(uuid, jsonb),
  hub.event_join_decide(uuid, text, text, numeric),
  hub.event_ack_alerts(boolean),
  hub.event_acknowledge(uuid, text)
to hub_app;

commit;
