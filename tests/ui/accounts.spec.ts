import { expect, test } from '@playwright/test';

test.beforeEach(async({context})=>{
  await context.addCookies([{name:'sena_local_persona',value:'admin',url:'http://127.0.0.1:3000'}]);
});

test('local demo users table, filters and self panel retain persona authority',async({page})=>{
  await page.goto('/admin/accounts');await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();
  await page.getByLabel('กรองบทบาท').selectOption('admin');
  const row=page.getByRole('row').filter({has:page.getByText('คุณ',{exact:true})});
  const button=row.getByRole('button',{name:'จัดการ'});await button.click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByText('นี่คือบัญชีของคุณ')).toBeVisible();
  await expect(dialog.getByRole('radio',{name:/ผู้แก้ไขข้อมูล/})).toBeDisabled();
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
