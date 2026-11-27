-- SQL/RLS verification for SENA Event Hub (0100)
begin;

do $$
declare
  t text;
begin
  -- 1. Verify FORCE RLS, owner-only policies, and zero direct table grants
  foreach t in array array[
    'hub.event_sequence', 'hub.events', 'hub.event_attachments',
    'hub.event_participants', 'hub.event_revisions', 'hub.event_acknowledgements'
  ] loop
    assert (select relrowsecurity and relforcerowsecurity from pg_class where oid = t::regclass), t;
    assert not has_table_privilege('hub_app', t, 'SELECT,INSERT,UPDATE,DELETE'), t;
    assert not has_table_privilege('agency', t, 'SELECT,INSERT,UPDATE,DELETE'), t;
    assert not has_table_privilege('service_consumer', t, 'SELECT,INSERT,UPDATE,DELETE'), t;
  end loop;

  -- Ensure editor (0001), viewer (0003), and online_staff (0006) have standard staff capabilities
  insert into hub.account_permission(account_id, tab, can_view, can_edit, can_approve)
  values
    ('00000000-0000-0000-0000-000000000001', 'projects', true, true, false),
    ('00000000-0000-0000-0000-000000000003', 'knowledge', true, false, false),
    ('00000000-0000-0000-0000-000000000006', 'registry', true, true, false)
  on conflict (account_id, tab) do update
  set can_view = excluded.can_view, can_edit = excluded.can_edit;
end $$;

-- Register two synthetic PDF uploads via the real hub.register_uploaded_asset RPC as editor (0001)
set local role hub_app;
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000001', true);
select set_config('app.agency_code', '', true);
select set_config(
  'test.op_asset',
  hub.register_uploaded_asset(jsonb_build_object(
    'original_filename', 'floor-plan-silom.pdf',
    'mime_type', 'application/pdf',
    'storage_path', repeat('e', 63) || '1.pdf',
    'checksum', repeat('e', 63) || '1',
    'file_size', 1024,
    'asset_type', 'document'
  ))#>>'{asset,id}',
  true
);
select set_config(
  'test.fin_asset',
  hub.register_uploaded_asset(jsonb_build_object(
    'original_filename', 'booth-quotation.pdf',
    'mime_type', 'application/pdf',
    'storage_path', repeat('e', 63) || '2.pdf',
    'checksum', repeat('e', 63) || '2',
    'file_size', 2048,
    'asset_type', 'document'
  ))#>>'{asset,id}',
  true
);

-- 2. Agency / external callers must be rejected with 42501
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000007', true);
select set_config('app.agency_code', 'KIN', true);
do $$
begin
  begin
    perform hub.event_list();
    raise exception 'Agency caller was allowed into Event Hub';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Staff Editor (0001) creates a 30-second post-deal event + attaches operational & finance files
select set_config('app.agency_code', '', true);
select set_config('app.actor_id', '00000000-0000-0000-0000-000000000001', true);

do $$
declare
  ev jsonb;
  ev_id uuid;
  op_asset uuid := current_setting('test.op_asset')::uuid;
  fin_asset uuid := current_setting('test.fin_asset')::uuid;
  viewer_ev jsonb;
  part_id uuid;
  alerts jsonb;
  ack_id uuid;
begin
  ev := hub.event_save(null, 0, jsonb_build_object(
    'title', 'ออกบูธสีลมคอมเพล็กซ์ ดีลพนักงานออฟฟิศ',
    'venue_name', 'Silom Complex',
    'venue_zone', 'ชั้น G หน้า Tops บูธ A2',
    'starts_at', '2026-12-10T03:00:00Z',
    'ends_at', '2026-12-14T13:00:00Z',
    'host_scope_type', 'bud',
    'host_scope_id', 'BUD-1',
    'host_label', 'BUD 1 คอนโดแนวรถไฟฟ้า',
    'open_for_join', true,
    'max_co_joiners', 3,
    'cost_share_mode', 'proportional_split',
    'estimated_cost_thb', 45000,
    'memo_no', 'MO2611099',
    'campaign_code', 'SN2611001A'
  ));
  assert ev->>'event_code' ~ '^EVT-2612-[0-9]{3}$';
  ev_id := (ev->>'id')::uuid;

  -- Host attaches Floor Plan (operational) and Quotation (finance_restricted)
  perform hub.event_attachment_add(ev_id, jsonb_build_object('asset_id', op_asset, 'doc_kind', 'floor_plan', 'visibility', 'operational'));
  ev := hub.event_attachment_add(ev_id, jsonb_build_object('asset_id', fin_asset, 'doc_kind', 'quotation', 'visibility', 'finance_restricted'));
  assert jsonb_array_length(ev->'attachments') = 2;

  -- Non-finance Viewer (0003, representing เงินสดใจดี team) sees operational floor plan, NOT quotation or estimated_cost_thb!
  perform set_config('app.actor_id', '00000000-0000-0000-0000-000000000003', true);
  viewer_ev := hub.event_read(ev_id);
  assert jsonb_array_length(viewer_ev->'attachments') = 1;
  assert viewer_ev->'estimated_cost_thb' = 'null'::jsonb;
  assert hub.can_read_asset(op_asset) = true;
  assert hub.can_read_asset(fin_asset) = false;

  -- Viewer (0003) requests Co-Join for เงินสดใจดี (with cost sharing)
  viewer_ev := hub.event_join_save(ev_id, jsonb_build_object(
    'participant_scope_type', 'business',
    'participant_scope_id', 'ngernsod_jaidee',
    'participant_label', 'เงินสดใจดี',
    'staff_count', 2,
    'booth_needs', 'โต๊ะให้คำปรึกษาสินเชื่อ 1 ตัว',
    'shares_cost', true,
    'cost_share_thb', 15000
  ));
  part_id := (viewer_ev#>>'{participants,0,id}')::uuid;
  assert viewer_ev#>>'{participants,0,join_state}' = 'requested';

  -- Host (0001) approves เงินสดใจดี co-join -> now Viewer (0003) IS an approved cost-sharer and CAN read quotation!
  perform set_config('app.actor_id', '00000000-0000-0000-0000-000000000001', true);
  ev := hub.event_join_decide(part_id, 'approved', 'ยินดีต้อนรับทีมเงินสดใจดี', 15000);
  assert ev#>>'{participants,0,join_state}' = 'approved';

  perform set_config('app.actor_id', '00000000-0000-0000-0000-000000000003', true);
  assert hub.can_read_asset(fin_asset) = true;

  -- Host tries to move venue WITHOUT change_reason -> MUST FAIL (23514)!
  perform set_config('app.actor_id', '00000000-0000-0000-0000-000000000001', true);
  begin
    perform hub.event_save(ev_id, 1, jsonb_build_object(
      'title', ev->>'title',
      'venue_name', 'Silom Complex',
      'venue_zone', 'ย้ายไปชั้น 2 หน้าธนาคารกรุงเทพ',
      'starts_at', ev->>'starts_at',
      'ends_at', ev->>'ends_at',
      'host_scope_type', 'bud',
      'host_scope_id', 'BUD-1',
      'state', 'scheduled'
    ));
    raise exception 'Venue change succeeded without change_reason';
  exception when check_violation then null;
  end;

  -- Host moves venue WITH change_reason -> increments schedule_revision = 2 and creates Ack rows for เงินสดใจดี + Online Ads!
  ev := hub.event_save(ev_id, 1, jsonb_build_object(
    'title', ev->>'title',
    'venue_name', 'Silom Complex',
    'venue_zone', 'ย้ายไปชั้น 2 หน้าธนาคารกรุงเทพ',
    'starts_at', ev->>'starts_at',
    'ends_at', ev->>'ends_at',
    'host_scope_type', 'bud',
    'host_scope_id', 'BUD-1',
    'campaign_code', 'SN2611001A',
    'state', 'scheduled',
    'change_reason', 'ห้างแจ้งปรับผังพื้นที่โปรโมชันย้ายขึ้นชั้น 2'
  ));
  assert (ev->>'schedule_revision')::int = 2;
  assert jsonb_array_length(ev#>'{revisions,0,acknowledgements}') = 2;

  -- Viewer (0003) sees the unacknowledged alert on /home and clicks Acknowledge!
  perform set_config('app.actor_id', '00000000-0000-0000-0000-000000000003', true);
  alerts := hub.event_ack_alerts(true);
  assert jsonb_array_length(alerts->'items') = 1;
  ack_id := (alerts#>>'{items,0,ack_id}')::uuid;
  perform hub.event_acknowledge(ack_id, 'รับทราบ แจ้งทีมที่ปรึกษาสินเชื่อไปชั้น 2 แล้ว');
  assert jsonb_array_length(hub.event_ack_alerts(true)->'items') = 0;
end $$;

rollback;
