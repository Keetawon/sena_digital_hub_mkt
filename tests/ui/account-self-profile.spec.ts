import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

const origin = 'http://127.0.0.1:3000';

function makePngBytes(): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const kind = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([kind, data])), 0);
    return Buffer.concat([len, kind, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([
    0, 15, 118, 110, 15, 118, 110,
    0, 15, 118, 110, 15, 118, 110,
  ]);
  const idat = deflateSync(raw);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

async function enter(page: Page, role: 'admin' | 'agency_kin', path = '/home') {
  const response = await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } });
  expect(response.ok()).toBeTruthy();
  await page.goto(path);
}

test('top-right account menu, theme switcher, permissions, profile edit and avatar lifecycle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enter(page, 'admin', '/admin/accounts');

  const trigger = page.locator('.account-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const popover = page.getByRole('menu', { name: 'เมนูบัญชีผู้ใช้' });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('จัดการผู้ใช้และสิทธิ์');
  await expect(popover).toContainText('ธีมหน้าจอ');

  // Escape closes popover and restores focus
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();

  // Theme switcher toggles dark / light / system and persists across reload
  await trigger.click();
  await popover.getByRole('button', { name: 'มืด', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await trigger.click();
  await popover.getByRole('button', { name: 'ตามระบบ', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  // My permissions dialog
  await popover.getByRole('menuitem', { name: /สิทธิ์และขอบเขตการใช้งานของฉัน/ }).click();
  const permDialog = page.getByRole('dialog', { name: 'สิทธิ์และขอบเขตการใช้งานของฉัน' });
  await expect(permDialog).toBeVisible();
  await permDialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(permDialog).toBeHidden();

  // Security dialog
  await trigger.click();
  await popover.getByRole('menuitem', { name: /ความปลอดภัยและรหัสผ่าน/ }).click();
  const secDialog = page.getByRole('dialog', { name: 'ความปลอดภัยและรหัสผ่าน' });
  await expect(secDialog).toBeVisible();
  await secDialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(secDialog).toBeHidden();

  // Profile edit + avatar upload + remove
  await trigger.click();
  await popover.getByRole('menuitem', { name: /ข้อมูลส่วนตัวและรูปโปรไฟล์/ }).click();
  const profDialog = page.getByRole('dialog', { name: 'ข้อมูลส่วนตัวและรูปโปรไฟล์' });
  await expect(profDialog).toBeVisible();

  await profDialog.getByLabel('ชื่อและนามสกุลภาษาไทย').fill('ผู้ดูแล ทดสอบเมนู');
  await profDialog.getByLabel('เบอร์โทรศัพท์ที่ทำงาน').fill('0891234567');
  await profDialog.getByLabel('ทีม / ฝ่าย').fill('ดิจิทัล');
  await profDialog.getByLabel('ตำแหน่ง').fill('ผู้ดูแลระบบ');
  await profDialog.getByRole('button', { name: 'บันทึกข้อมูลส่วนตัว', exact: true }).click();
  await expect(profDialog).toContainText('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
  await expect(trigger).toContainText('ผู้ดูแล ทดสอบเมนู');

  // Upload PNG avatar
  const uploadPromise = page.waitForResponse((res) => res.url().includes('/api/hub/v1/me/avatar') && res.request().method() === 'POST');
  await profDialog.locator('input[type="file"]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: makePngBytes(),
  });
  const upRes = await uploadPromise;
  expect(upRes.status()).toBe(200);
  await expect(profDialog.locator('img[alt="รูปโปรไฟล์"]')).toBeVisible();
  await expect(trigger.locator('img[alt="รูปโปรไฟล์"]')).toBeVisible();

  // Reload persistence
  await page.reload();
  await expect(trigger).toContainText('ผู้ดูแล ทดสอบเมนู');
  await expect(trigger.locator('img[alt="รูปโปรไฟล์"]')).toBeVisible();

  // Remove avatar
  await trigger.click();
  await page.getByRole('menu', { name: 'เมนูบัญชีผู้ใช้' }).getByRole('menuitem', { name: /ข้อมูลส่วนตัวและรูปโปรไฟล์/ }).click();
  const delPromise = page.waitForResponse((res) => res.url().includes('/api/hub/v1/me/avatar/remove') && res.request().method() === 'POST');
  await profDialog.getByRole('button', { name: 'ลบรูปโปรไฟล์', exact: true }).click();
  expect((await delPromise).status()).toBe(200);
  await expect(profDialog).toContainText('ลบรูปโปรไฟล์เรียบร้อยแล้ว');
  await expect(trigger.locator('img[alt="รูปโปรไฟล์"]')).toHaveCount(0);

  // Restore seeded admin display_name_th so downstream specs see canonical demo identity
  await profDialog.getByLabel('ชื่อและนามสกุลภาษาไทย').fill('ผู้ดูแล ตัวอย่าง');
  await profDialog.getByRole('button', { name: 'บันทึกข้อมูลส่วนตัว', exact: true }).click();
  await expect(profDialog).toContainText('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
  await expect(trigger).toContainText('ผู้ดูแล ตัวอย่าง');
  await profDialog.getByRole('button', { name: 'ปิด', exact: true }).click();

  // Mobile 390px layout check + no overflow
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(page.getByRole('menu', { name: 'เมนูบัญชีผู้ใช้' })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(391);
});

test('agency profile keeps company fields locked', async ({ page }) => {
  await enter(page, 'agency_kin', '/ads/registry');
  await page.locator('.account-trigger').click();
  await page.getByRole('menu', { name: 'เมนูบัญชีผู้ใช้' }).getByRole('menuitem', { name: /ข้อมูลส่วนตัวและรูปโปรไฟล์/ }).click();
  const dialog = page.getByRole('dialog', { name: 'ข้อมูลส่วนตัวและรูปโปรไฟล์' });
  await expect(dialog.getByLabel('ประเภทบริษัท')).toBeDisabled();
  await expect(dialog.getByLabel('ชื่อบริษัท')).toHaveAttribute('readonly', '');
});
