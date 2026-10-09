import { expect, test } from '@playwright/test';

test.beforeEach(async({context})=>{
  await context.addCookies([{name:'sena_local_persona',value:'admin',url:'http://127.0.0.1:3000'}]);
});

test('permission projection and migrated catalog use the account proxy',async({page})=>{
  await page.goto('/admin/accounts');
  const account=(await (await page.request.get('/api/hub/v1/me')).json()).data;
  expect(account.capabilities.can_manage_users).toBe(true);
  expect(account.capabilities.tabs.projects).toEqual({view:true,edit:true,approve:false});
  expect(account.capabilities.published_consumer).toBe(true);
  const response=await page.request.get('/api/hub/v1/admin/permissions/catalog');expect(response.status()).toBe(200);
  const catalog=(await response.json()).data;expect(catalog.tabs).toHaveLength(12);
  expect(catalog.tabs.every((tab:{rollout_state:string})=>tab.rollout_state==='MIGRATED')).toBe(true);
  expect(catalog.templates).toHaveLength(6);
});

test('publisher content reads remain available while project draft edits deny at the API',async({page,context})=>{
  await context.addCookies([{name:'sena_local_persona',value:'publisher',url:'http://127.0.0.1:3000'}]);
  await page.goto('/');
  const response=await page.request.get('/api/hub/v1/admin/projects');expect(response.status()).toBe(200);
  const project=(await response.json()).data[0];expect(project).toBeTruthy();
  const changed=await page.request.patch(`/api/hub/v1/admin/projects/${project.public_project_id}`,{
    headers:{Origin:'http://127.0.0.1:3000'},data:{updated_at:project.updated_at,public_name:{th:'Synthetic denied edit'}},
  });
  expect(changed.status()).toBe(403);
  expect((await page.request.get('/api/hub/v1/admin/brands')).status()).toBe(200);
  const after=(await (await page.request.get(`/api/hub/v1/admin/projects/${project.public_project_id}`)).json()).data;
  expect(after.updated_at).toBe(project.updated_at);expect(after.public_name).toEqual(project.public_name);
});

test('local demo users table, filters and self panel retain persona authority',async({page})=>{
  await page.goto('/admin/accounts');await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();
  await page.getByLabel('กรองแม่แบบ').selectOption('admin');
  const row=page.getByRole('row').filter({has:page.getByText('คุณ',{exact:true})});
  const button=row.getByRole('button',{name:'จัดการ'});await button.click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByText('นี่คือบัญชีของคุณ')).toBeVisible();
  await expect(dialog.getByLabel('แม่แบบสิทธิ์',{exact:true})).toBeDisabled();
  await expect(dialog.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
});

test('local invite creation, duplicate, extension and cancellation use the real API',async({page})=>{
  const email=`local-invite-${Date.now()}@example.test`;await page.goto('/admin/accounts');
  await page.getByRole('button',{name:'+ เพิ่มผู้ใช้',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('อีเมล',{exact:true}).fill(email);await dialog.getByRole('button',{name:'สร้างคำเชิญ',exact:true}).click();await expect(dialog).toHaveCount(0);
  const row=page.getByRole('article').filter({hasText:email});await expect(row).toContainText('รอตอบรับ');
  await expect(row.getByLabel('ลิงก์เข้าสู่ระบบ')).toHaveValue('http://127.0.0.1:3000/login');
  await page.getByRole('button',{name:'+ เพิ่มผู้ใช้',exact:true}).click();await dialog.getByLabel('อีเมล',{exact:true}).fill(email);await dialog.getByRole('button',{name:'สร้างคำเชิญ',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('มีคำเชิญ');
  await expect(dialog.getByLabel('อีเมล',{exact:true})).toHaveValue(email);await page.keyboard.press('Escape');
  await row.getByRole('button',{name:'ต่ออายุ 14 วัน'}).click();await expect(page.locator('.accounts-feedback[role=status]')).toContainText('ต่ออายุ');
  await expect(row.getByRole('button',{name:'ยกเลิกคำเชิญ'})).toBeEnabled();await row.getByRole('button',{name:'ยกเลิกคำเชิญ'}).click();await expect(row).toContainText('ยกเลิกแล้ว');
});

test('400px user table scrolls inside the table region with no animations',async({page})=>{
  await page.setViewportSize({width:400,height:860});await page.goto('/admin/accounts');await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();
  await expect(page.getByRole('table')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.account-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  expect(await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
});
