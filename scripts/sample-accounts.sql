insert into hub.user_account(id,email,display_name_th,status,hub_role,agency_code) values
('00000000-0000-0000-0000-000000000001', 'demo-1@example.test', 'สมชาย แก้ไข', 'ACTIVE', 'editor', null),
('00000000-0000-0000-0000-000000000002', 'demo-2@example.test', 'สมหญิง ผู้จัดการ', 'ACTIVE', 'publisher', null),
('00000000-0000-0000-0000-000000000003', 'demo-3@example.test', 'วิภา อ่านข้อมูล', 'ACTIVE', 'viewer', null),
('00000000-0000-0000-0000-000000000004', 'demo-4@example.test', 'ระบบตัวอย่าง', 'ACTIVE', 'service_consumer', null),
('00000000-0000-0000-0000-000000000005', 'demo-5@example.test', 'ผู้ดูแล ตัวอย่าง', 'ACTIVE', 'admin', null),
('00000000-0000-0000-0000-000000000006', 'demo-6@example.test', 'ออนไลน์ ตัวอย่าง', 'ACTIVE', 'online_staff', null),
('00000000-0000-0000-0000-000000000007', 'demo-7@example.test', 'กานต์ เอเจนซี', 'ACTIVE', 'agency', 'KIN'),
('00000000-0000-0000-0000-000000000008', 'demo-8@example.test', 'กมล เอเจนซี', 'ACTIVE', 'agency', 'COMBAY')
on conflict(id) do nothing;
