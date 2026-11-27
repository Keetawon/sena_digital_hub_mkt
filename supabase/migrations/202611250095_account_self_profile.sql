begin;

create table hub.user_account_avatar (
  account_id uuid primary key references hub.user_account(id) on delete cascade,
  object_key text not null check (object_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 2097152),
  updated_at timestamptz not null default clock_timestamp()
);
alter table hub.user_account_avatar enable row level security;
alter table hub.user_account_avatar force row level security;
revoke all on hub.user_account_avatar from public, editor, publisher, viewer, admin, online_staff, agency, service_consumer, hub_app;
create policy avatar_owner on hub.user_account_avatar for all to current_user using (true) with check (true);

create or replace function hub.account_identity(p_email text, p_provider text, p_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a hub.user_account;
  av hub.user_account_avatar;
  actor uuid := hub.permission_actor();
begin
  if actor is null then
    raise exception 'Identity required' using errcode = '42501';
  end if;
  select * into a from hub.user_account where id = actor;
  if not found then
    perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions', 0));
    insert into hub.user_account(id, email, sign_in_method, display_name_th)
    values (
      actor,
      lower(btrim(left(p_email, 254))),
      case when p_provider = 'google' then 'google' else 'email' end,
      left(coalesce(p_name, ''), 200)
    )
    on conflict (id) do nothing;
    select * into a from hub.user_account where id = actor;
  end if;
  select * into av from hub.user_account_avatar where account_id = a.id;
  return (to_jsonb(a) - 'legacy_hub_role')
    || case
      when hub.account_admin()
      then jsonb_build_object('pending_count', (select count(*) from hub.user_account where status = 'PENDING' and privacy_acknowledged_at is not null))
      else '{}'::jsonb
    end
    || jsonb_build_object(
      'has_avatar', av.account_id is not null,
      'avatar_updated_at', av.updated_at,
      'capabilities', hub.permission_projection(a),
      'can_manage_users', a.status = 'ACTIVE' and a.can_manage_users and a.hub_role in ('viewer', 'editor', 'publisher', 'admin', 'online_staff'),
      'invite', case
        when a.status = 'PENDING' and a.privacy_acknowledged_at is null and lower(btrim(p_email)) = lower(btrim(a.email))
        then hub.match_account_invite()
      end
    );
end $$;

create function hub.update_own_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a hub.user_account;
  av hub.user_account_avatar;
  actor uuid := hub.permission_actor();
  expected_company text;
begin
  if actor is null then
    raise exception 'Identity required' using errcode = '42501';
  end if;
  select * into a from hub.user_account where id = actor and status = 'ACTIVE' for update;
  if not found or a.anonymised_at is not null then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if a.hub_role = 'agency' or a.company_type = 'AGENCY' then
    expected_company := nullif(btrim(coalesce(a.company_name, a.agency_code, '')), '');
    if p->>'company_type' is distinct from 'AGENCY'
       or (expected_company is not null and btrim(coalesce(p->>'company_name', '')) is distinct from expected_company) then
      raise exception 'Agency company is locked' using errcode = '42501', detail = 'account_company_locked';
    end if;
  end if;
  perform hub.validate_account_profile(p || jsonb_build_object('privacy_acknowledged', true));
  update hub.user_account
  set display_name_th = btrim(p->>'display_name_th'),
      phone = btrim(p->>'phone'),
      team = btrim(p->>'team'),
      position = btrim(p->>'position'),
      company_type = p->>'company_type',
      company_name = case when p->>'company_type' = 'SENA' then null else btrim(p->>'company_name') end,
      updated_at = clock_timestamp()
  where id = actor
  returning * into a;
  insert into hub.user_account_event(account_id, actor_id, action, old_status, new_status, old_role, new_role)
  values (actor, actor, 'PROFILE_UPDATED', a.status, a.status, a.hub_role, a.hub_role);
  select * into av from hub.user_account_avatar where account_id = actor;
  return (to_jsonb(a) - 'legacy_hub_role')
    || jsonb_build_object(
      'has_avatar', av.account_id is not null,
      'avatar_updated_at', av.updated_at,
      'capabilities', hub.permission_projection(a),
      'can_manage_users', a.status = 'ACTIVE' and a.can_manage_users and a.hub_role in ('viewer', 'editor', 'publisher', 'admin', 'online_staff')
    );
end $$;
revoke all on function hub.update_own_profile(jsonb) from public;
grant execute on function hub.update_own_profile(jsonb) to hub_app, admin, editor, publisher, viewer, online_staff, agency;

create function hub.set_own_avatar(p_key text, p_sha text, p_mime text, p_size integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a hub.user_account;
  av hub.user_account_avatar;
  actor uuid := hub.permission_actor();
  prev_key text;
begin
  if actor is null then
    raise exception 'Identity required' using errcode = '42501';
  end if;
  select * into a from hub.user_account where id = actor and status = 'ACTIVE' for update;
  if not found or a.anonymised_at is not null then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if coalesce(p_sha, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_mime, '') <> 'image/webp'
     or p_size is null or p_size < 1 or p_size > 2097152
     or coalesce(p_key, '') <> ('avatars/' || actor::text || '/' || p_sha || '.webp') then
    raise exception 'Invalid avatar metadata' using errcode = '23514';
  end if;
  select object_key into prev_key from hub.user_account_avatar where account_id = actor for update;
  insert into hub.user_account_avatar(account_id, object_key, sha256, content_type, size_bytes, updated_at)
  values (actor, p_key, p_sha, p_mime, p_size, clock_timestamp())
  on conflict (account_id) do update
    set object_key = excluded.object_key,
        sha256 = excluded.sha256,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        updated_at = clock_timestamp()
  returning * into av;
  update hub.user_account set updated_at = clock_timestamp() where id = actor;
  insert into hub.user_account_event(account_id, actor_id, action, old_status, new_status, old_role, new_role)
  values (actor, actor, 'AVATAR_UPDATED', a.status, a.status, a.hub_role, a.hub_role);
  return jsonb_build_object(
    'previous_object_key', prev_key,
    'avatar_updated_at', av.updated_at,
    'has_avatar', true
  );
end $$;
revoke all on function hub.set_own_avatar(text, text, text, integer) from public;
grant execute on function hub.set_own_avatar(text, text, text, integer) to hub_app, admin, editor, publisher, viewer, online_staff, agency;

create function hub.clear_own_avatar() returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a hub.user_account;
  actor uuid := hub.permission_actor();
  prev_key text;
begin
  if actor is null then
    raise exception 'Identity required' using errcode = '42501';
  end if;
  select * into a from hub.user_account where id = actor and status = 'ACTIVE' for update;
  if not found or a.anonymised_at is not null then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  delete from hub.user_account_avatar where account_id = actor returning object_key into prev_key;
  if prev_key is not null then
    update hub.user_account set updated_at = clock_timestamp() where id = actor;
    insert into hub.user_account_event(account_id, actor_id, action, old_status, new_status, old_role, new_role)
    values (actor, actor, 'AVATAR_REMOVED', a.status, a.status, a.hub_role, a.hub_role);
  end if;
  return jsonb_build_object(
    'previous_object_key', prev_key,
    'avatar_updated_at', null,
    'has_avatar', false
  );
end $$;
revoke all on function hub.clear_own_avatar() from public;
grant execute on function hub.clear_own_avatar() to hub_app, admin, editor, publisher, viewer, online_staff, agency;

create function hub.read_avatar_metadata(target uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  me hub.user_account;
  av hub.user_account_avatar;
  actor uuid := hub.permission_actor();
begin
  if actor is null or target is null then
    raise exception 'Identity required' using errcode = '42501';
  end if;
  select * into me from hub.user_account where id = actor and status = 'ACTIVE';
  if not found or me.anonymised_at is not null then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if target <> actor and coalesce(me.hub_role, '') not in ('admin', 'editor', 'publisher', 'viewer', 'online_staff') then
    raise exception 'Staff only' using errcode = '42501';
  end if;
  select av_row.* into av
  from hub.user_account_avatar av_row
  join hub.user_account u on u.id = av_row.account_id
  where av_row.account_id = target and u.anonymised_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'object_key', av.object_key,
    'sha256', av.sha256,
    'content_type', av.content_type,
    'size_bytes', av.size_bytes,
    'updated_at', av.updated_at
  );
end $$;
revoke all on function hub.read_avatar_metadata(uuid) from public;
grant execute on function hub.read_avatar_metadata(uuid) to hub_app, admin, editor, publisher, viewer, online_staff, agency;

create or replace function hub.purge_rejected_accounts() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a record;
  total integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions', 0));
  for a in
    select id from hub.user_account
    where status = 'REJECTED' and decided_at < now() - interval '90 days' and anonymised_at is null
    for update
  loop
    update hub.user_account
    set email = '',
        display_name_th = '',
        phone = '',
        company_name = null,
        position = null,
        company_type = null,
        team = '',
        requested_tasks = '{}',
        reason = '',
        decision_note = '',
        anonymised_at = now()
    where id = a.id;
    delete from hub.user_account_avatar where account_id = a.id;
    -- Anonymisation is the sole operator-only exception to append-only event storage.
    update hub.user_account_event set account_id = null, actor_id = null, decision_note = '', previous_decision_note = '' where account_id = a.id or actor_id = a.id;
    update hub.permission_event set account_id = null, actor_id = null, before_value = '{}', after_value = '{}' where account_id = a.id or actor_id = a.id;
    delete from hub.permission_notice_ack where actor_id = a.id;
    delete from hub.account_permission where account_id = a.id;
    insert into hub.user_account_event(action, new_status) values ('ANONYMISED', 'REJECTED');
    total := total + 1;
  end loop;
  return total;
end $$;
revoke all on function hub.purge_rejected_accounts() from public;

commit;
