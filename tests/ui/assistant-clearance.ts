import { expect, type Locator, type Page } from '@playwright/test';
import { workspaceCopy } from '../../apps/admin/lib/workspace-copy';

export async function expectAssistantClearance(page: Page, lastContent: Locator, disabled = false) {
  const opener = page.locator(disabled ? '.workspace-assistant-disabled' : '.assistant-floating, .assistant-editor-trigger');
  await expect(opener).toBeVisible();
  await expect(lastContent).toBeVisible();
  if (disabled) {
    await expect(opener).toBeDisabled();
    await expect(opener).toHaveText(workspaceCopy.assistant_disabled);
    await expect(opener).toHaveAccessibleName(`${workspaceCopy.ask} · ${workspaceCopy.assistant_disabled}`);
    expect((await opener.boundingBox())!.height).toBeLessThanOrEqual(48);
  }
  const inline = await opener.evaluate(element => element.classList.contains('assistant-editor-trigger'));
  if (inline) expect(await opener.evaluate(element => getComputedStyle(element).position)).toBe('static');
  await expect.poll(() => page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight);
  })).toBeLessThanOrEqual(1);
  const floating = (await opener.boundingBox())!;
  const last = inline ? lastContent.locator('button:visible:not(.assistant-editor-trigger), a:visible, input:visible, select:visible, textarea:visible').last() : lastContent;
  const targets = [last, ...await page.locator('.page-footer > span').all()];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    const overlaps = box!.x < floating.x + floating.width && box!.x + box!.width > floating.x
      && box!.y < floating.y + floating.height && box!.y + box!.height > floating.y;
    expect(overlaps, 'last content and footer remain clear of the assistant').toBe(false);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
