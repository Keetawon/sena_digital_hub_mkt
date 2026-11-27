begin;

-- Seed internal active editor, external active agency, pending, and old-rejected accounts
insert into hub.user_account(id, email, sign_in_method, display_name_th, phone, team, company_type, company_name, position, status, hub_role, agency_code)
values
  ('95000000-0000-0000-0000-000000000001', 'staff95@example.test', 'email', 'สมชาย เดิม', '0811111111', 'ดิจิทัล', 'SENA', null, 'ผู้จัดการ', 'ACTIVE', 'editor', null),
  ('95000000-0000-0000-0000-000000000002', 'agency95@example.test', 'email', 'สมหญิง เอเจนซี', '0822222222', 'สื่อสาร', 'AGENCY', 'KIN', 'ผู้ประสานงาน', 'ACTIVE', 'agency', 'KIN'),
  ('95000000-0000-0000-0000-000000000003', 'pending95@example.test', 'email', 'รออนุมัติ ทดสอบ', '0833333333', 'การตลาด', 'SENA', null, 'เจ้าหน้าที่', 'PENDING', null, null),
  ('95000000-0000-0000-0000-000000000004', 'rejected95@example.test', 'email', 'ผู้ถูกปฏิเสธ ทดสอบ', '0844444444', 'ทั่วไป', 'SENA', null, 'พนักงาน', 'REJECTED', null, null);

update hub.user_account
set decided_at = now() - interval '91 days'
where id = '95000000-0000-0000-0000-000000000004';

insert into hub.user_account_avatar(account_id, object_key, sha256, content_type, size_bytes, updated_at)
values (
  '95000000-0000-0000-0000-000000000004',
  'avatars/95000000-0000-0000-0000-000000000004/' || repeat('a', 64) || '.webp',
  repeat('a', 64),
  'image/webp',
  1024,
  now() - interval '91 days'
);

-- 1. Pending caller cannot update own profile or set avatar
set local role viewer;
select set_config('app.actor_id', '95000000-0000-0000-0000-000000000003', true);
do $$ begin
  begin
    perform hub.update_own_profile('{"display_name_th":"ทดสอบ ใหม่","phone":"0812345678","team":"ทีมเอ","position":"หัวหน้า","company_type":"SENA"}'::jsonb);
    raise exception 'Pending profile update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform hub.set_own_avatar('avatars/95000000-0000-0000-0000-000000000003/' || repeat('b', 64) || '.webp', repeat('b', 64), 'image/webp', 512);
    raise exception 'Pending avatar set allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 2. Active staff caller can update own profile, set/clear avatar, and read avatar metadata
set local role editor;
select set_config('app.actor_id', '95000000-0000-0000-0000-000000000001', true);
do $$
declare
  res jsonb;
  av1 jsonb;
  av2 jsonb;
  sha1 text := repeat('1', 64);
  sha2 text := repeat('2', 64);
begin
  res := hub.update_own_profile('{"display_name_th":"สมชาย แก้ไขแล้ว","phone":"0899998888","team":"ฝ่ายกลยุทธ์","position":"ผู้อำนวยการ","company_type":"SENA_SUBSIDIARY","company_name":"เสนาโซลาร์"}'::jsonb);
  if res->>'display_name_th' <> 'สมชาย แก้ไขแล้ว'
     or res->>'company_type' <> 'SENA_SUBSIDIARY'
     or res->>'company_name' <> 'เสนาโซลาร์'
     or (res->>'has_avatar')::boolean is not false
     or res ? 'avatar_object_key' then
    raise exception 'Unexpected profile result: %', res;
  end if;

  av1 := hub.set_own_avatar('avatars/95000000-0000-0000-0000-000000000001/' || sha1 || '.webp', sha1, 'image/webp', 2048);
  if av1->>'previous_object_key' is not null or (av1->>'has_avatar')::boolean is not true then
    raise exception 'Unexpected set_own_avatar 1: %', av1;
  end if;

  av2 := hub.set_own_avatar('avatars/95000000-0000-0000-0000-000000000001/' || sha2 || '.webp', sha2, 'image/webp', 4096);
  if av2->>'previous_object_key' <> ('avatars/95000000-0000-0000-0000-000000000001/' || sha1 || '.webp') then
    raise exception 'Expected superseded key returned: %', av2;
  end if;

  if (hub.read_avatar_metadata('95000000-0000-0000-0000-000000000001')->>'sha256') <> sha2 then
    raise exception 'Own avatar metadata mismatch';
  end if;

  -- Key/actor mismatch refused
  begin
    perform hub.set_own_avatar('avatars/95000000-0000-0000-0000-000000000002/' || sha2 || '.webp', sha2, 'image/webp', 123);
    raise exception 'Cross-actor avatar key allowed';
  exception when check_violation then null;
  end;
end $$;
reset role;

set local role hub_app;
select set_config('app.actor_id', '95000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (hub.account_identity('staff95@example.test', 'email', '')->>'has_avatar')::boolean is not true then
    raise exception 'account_identity missing has_avatar=true';
  end if;
end $$;
reset role;

-- 3. Agency caller company lock + cannot read internal staff avatar
set local role agency;
select set_config('app.actor_id', '95000000-0000-0000-0000-000000000002', true);
do $$
declare
  detail text;
  res jsonb;
begin
  begin
    perform hub.update_own_profile('{"display_name_th":"สมหญิง เอเจนซี","phone":"0822222222","team":"สื่อสาร","position":"ผู้ประสานงาน","company_type":"SENA"}'::jsonb);
    raise exception 'Agency changed company_type to SENA';
  exception when insufficient_privilege then
    get stacked diagnostics detail = pg_exception_detail;
    if detail <> 'account_company_locked' then raise exception 'Wrong detail: %', detail; end if;
  end;

  begin
    perform hub.update_own_profile('{"display_name_th":"สมหญิง เอเจนซี","phone":"0822222222","team":"สื่อสาร","position":"ผู้ประสานงาน","company_type":"AGENCY","company_name":"OTHER"}'::jsonb);
    raise exception 'Agency changed company_name';
  exception when insufficient_privilege then
    get stacked diagnostics detail = pg_exception_detail;
    if detail <> 'account_company_locked' then raise exception 'Wrong detail 2: %', detail; end if;
  end;

  res := hub.update_own_profile('{"display_name_th":"สมหญิง อัปเดต","phone":"0820001111","team":"ทีมสื่อ","position":"ผู้ประสานงานอาวุโส","company_type":"AGENCY","company_name":"KIN"}'::jsonb);
  if res->>'display_name_th' <> 'สมหญิง อัปเดต' then
    raise exception 'Agency valid update failed';
  end if;

  begin
    perform hub.read_avatar_metadata('95000000-0000-0000-0000-000000000001');
    raise exception 'Agency read staff avatar metadata';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 4. Staff can clear avatar & read audit events preserved, and purge clears rejected avatar rows
set local role editor;
select set_config('app.actor_id', '95000000-0000-0000-0000-000000000001', true);
do $$
declare
  cleared jsonb;
begin
  cleared := hub.clear_own_avatar();
  if cleared->>'previous_object_key' is null or (cleared->>'has_avatar')::boolean is not false then
    raise exception 'Unexpected clear result: %', cleared;
  end if;
  if hub.read_avatar_metadata('95000000-0000-0000-0000-000000000001') is not null then
    raise exception 'Metadata should be null after clear';
  end if;
end $$;
reset role;

select hub.purge_rejected_accounts();
do $$ begin
  if exists (
    select 1 from hub.user_account_avatar
    where account_id = '95000000-0000-0000-0000-000000000004'
  ) then
    raise exception 'Purge did not delete rejected avatar row';
  end if;
  if not exists (
    select 1 from hub.user_account_event
    where account_id = '95000000-0000-0000-0000-000000000001'
      and action in ('PROFILE_UPDATED', 'AVATAR_UPDATED', 'AVATAR_REMOVED')
  ) then
    raise exception 'Profile/avatar events missing';
  end if;
end $$;

rollback;
