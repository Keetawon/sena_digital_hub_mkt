import { expect, test } from '@playwright/test';

test.describe('Authentication design on loopback H1', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Synthetic loopback only');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => ['http:', 'https:'].includes(new URL(route.request().url()).protocol) && new URL(route.request().url()).hostname !== '127.0.0.1' ? route.abort() : route.continue());
  });

  test('auth screens fit desktop, tablet, phone and enlarged text without animation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [1440, 1024, 400, 375]) {
      await page.setViewportSize({ width, height: width > 760 ? 1000 : 860 });
      await page.emulateMedia({ reducedMotion: width === 375 ? 'reduce' : 'no-preference' });
      for (const [url, name] of [['/login', 'login'], ['/signup', 'signup'], ['/signup/verify', 'verify'], ['/login/forgot', 'recovery']]) {
        await page.goto(url);
        await expect(page.locator('.auth-heading h1')).toBeVisible();
        await expect(page.locator('.auth-environment')).toContainText('LOCAL H1');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator('.auth-page').evaluate(el => [el, ...el.querySelectorAll('*')].every(n => {
          const s = getComputedStyle(n); return s.animationName === 'none' && s.transitionDuration.split(',').every(v => parseFloat(v) === 0);
        }))).toBe(true);
        if (width === 1440 || width === 400) await page.screenshot({ path: `artifacts/auth-${name}-${width}.png`, fullPage: true });
      }
    }
    await page.goto('/signup');
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'ส่งรหัสยืนยัน' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('password visibility is keyboard accessible and invalid forms retain entered text', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('อีเมล', { exact: true })).toBeFocused();
    await page.getByLabel('อีเมล', { exact: true }).fill('auth-design-missing@example.test');
    const password = page.getByLabel('รหัสผ่าน', { exact: true });
    await password.fill('Synthetic-typed-password!');
    const reveal = page.getByRole('button', { name: 'แสดงรหัสผ่าน', exact: true });
    await reveal.focus(); await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'ซ่อนรหัสผ่าน', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space'); await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(page.locator('.auth-form').getByRole('alert')).toContainText('เข้าสู่ระบบไม่สำเร็จ');
    await expect(password).toHaveValue('Synthetic-typed-password!');
    await expect(page.getByLabel('อีเมล', { exact: true })).toHaveValue('auth-design-missing@example.test');
    await page.getByRole('link', { name: 'สมัครด้วยอีเมล' }).click();
    await expect(page.getByRole('list', { name: 'ขั้นตอนสมัครใช้งาน' }).locator('[aria-current="step"]')).toContainText('สร้างบัญชี');
    await page.getByLabel('อีเมล', { exact: true }).fill('auth-design-signup@example.test');
    await page.getByLabel('รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', { exact: true }).fill('Synthetic-password-one!');
    const confirm = page.getByLabel('ยืนยันรหัสผ่าน', { exact: true });
    await confirm.fill('Synthetic-password-two!');
    await page.getByRole('button', { name: 'ส่งรหัสยืนยัน' }).click();
    await expect(page.getByRole('status')).toContainText('ตรงกันทั้งสองช่อง');
    await expect(confirm).toHaveValue('Synthetic-password-two!');
    await expect(confirm).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'แสดงยืนยันรหัสผ่าน', exact: true }).click();
    await expect(confirm).toHaveAttribute('type', 'text');
  });

  test('registration remains usable when the browser refuses OTP session storage', async ({ page }) => {
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) { if (key.startsWith('hub-otp-')) throw new DOMException('Blocked', 'SecurityError'); return get.call(this, key); };
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('hub-otp-')) throw new DOMException('Blocked', 'SecurityError'); return set.call(this, key, value); };
    });
    await page.goto('/signup');
    await page.getByLabel('อีเมล', { exact: true }).fill(`auth-storage-${Date.now()}@example.test`);
    await page.getByLabel('รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', { exact: true }).fill('Synthetic-storage-test!');
    await page.getByLabel('ยืนยันรหัสผ่าน', { exact: true }).fill('Synthetic-storage-test!');
    await page.getByRole('button', { name: 'ส่งรหัสยืนยัน' }).click();
    await expect(page).toHaveURL(/\/signup\/verify$/);
    await expect(page.getByLabel('อีเมล', { exact: true })).toBeEditable();
    await expect(page.getByLabel('รหัส 6 หลัก')).toBeEditable();
  });
});
