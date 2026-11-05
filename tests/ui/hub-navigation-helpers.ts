import { expect, type Page } from '@playwright/test';

export async function openMobileMenu(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) > 720) return;
  const trigger = page.locator('.hub-menu-toggle');
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(page.locator('.hub-mobile-drawer')).toBeVisible();
}

export async function closeMobileMenu(page: Page) {
  if (await page.locator('.hub-mobile-drawer[open]').count()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.hub-mobile-drawer')).not.toBeVisible();
  }
}
