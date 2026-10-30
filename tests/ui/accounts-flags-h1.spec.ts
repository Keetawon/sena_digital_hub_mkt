import { expect, test } from '@playwright/test';
import { safeNext, hubRoutes } from '../../apps/admin/components/hub-navigation-data';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

test.describe('Account flags and public boundary', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1' || process.env.HUB_AUTH_PASSWORD !== '0', 'Requires loopback flag-off phase');
  test.use({baseURL:process.env.HUB_ADMIN_ORIGIN!});
  test('password signup/recovery and Google hidden; existing password login works', async ({page}) => {
    for (const url of ['/signup','/signup/verify','/login/forgot']) {
      await page.goto(url); await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole('link',{name:'สมัครด้วยอีเมล'})).toHaveCount(0);
      await expect(page.getByRole('link',{name:'ลืมรหัสผ่าน'})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'เข้าสู่ระบบด้วย Google'})).toHaveCount(0);
    }
    await page.getByLabel('อีเมล',{exact:true}).fill('hub-test-viewer@example.test');
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill('H1-synthetic-only!');
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
    await expect(page.locator('.topbar-right')).toContainText('ผู้อ่านข้อมูล');
    await expect(page.locator('.hosted-h1-note')).toContainText('LOCAL H1 · ข้อมูลสมมติ');
  });
  test('shared route list preserves knowledge and blocks open redirect encodings', () => {
    expect(safeNext('/knowledge?project=synthetic#review')).toBe('/knowledge?project=synthetic#review');
    for(const route of hubRoutes) expect(safeNext(route)).toBe(route);
    for(const bad of ['//evil.example','/\\evil.example','/\t/evil.example','https://evil.example','/%2f%2fevil.example','/auth/callback?next=//evil.example','/not-a-route']) expect(safeNext(bad)).toBe('/');
  });
  test('browser assets and app environment contain no service/OAuth/SMTP credential', async () => {
    const privateValues = Object.entries(process.env).filter(([key,value]) => /(?:PASSWORD|TOKEN|DATABASE_URL|STORAGE_KEY)/.test(key) && value && value.length >= 20).map(([,value]) => value!);
    function privilegedToken(text:string) {
      return [...text.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].some(match => {
        try { return JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString()).role === 'service_role'; } catch { return false; }
      });
    }
    async function scan(dir:string):Promise<void> {
      for(const entry of await readdir(dir,{withFileTypes:true})) {
        const file=path.join(dir,entry.name);
        if(entry.isDirectory()) await scan(file);
        else if(/\.(js|json|html)$/.test(entry.name)) {
          const text=await readFile(file,'utf8');
          expect(/sb_secret_[A-Za-z0-9_-]{16,}/.test(text),`Secret pattern in ${file}`).toBe(false);
          expect(text.includes('h1-simulation-storage-key'),`Storage key in ${file}`).toBe(false);
          expect(privilegedToken(text),`Privileged JWT in ${file}`).toBe(false);
          expect(privateValues.some(value=>text.includes(value)),`Private runtime value in ${file}`).toBe(false);
        }
      }
    }
    await scan('apps/admin/.next/static');
    for(const dir of ['apps/admin','apps/api']) for(const entry of await readdir(dir)) if(/^\.env(?:\.|$)/.test(entry)) {
      const contents=await readFile(path.join(dir,entry),'utf8');
      const forbidden=contents.split(/\r?\n/).filter(line=>/^\s*(?:[A-Z_]*SERVICE_(?:ROLE(?:_KEY)?|KEY)|[A-Z_]*(?:SMTP_PASSWORD|GOOGLE_CLIENT_SECRET))\s*=\s*\S+/.test(line));
      expect(forbidden.length,`Forbidden credential variable in ${dir}/${entry}`).toBe(0);
      expect(privilegedToken(contents) || /sb_secret_[A-Za-z0-9_-]{16,}/.test(contents),`Privileged credential in ${dir}/${entry}`).toBe(false);
    }
  });
});
