import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3000";

async function enterAs(page: Page, role: "admin" | "editor" | "viewer" | "agency_kin", path = "/events") {
  const response = await page.request.post("/api/local-session", {
    headers: { Origin: origin },
    data: { role },
  });
  expect(response.ok()).toBeTruthy();
  return await page.goto(path);
}

test("agency persona is denied from /events and /api/hub/v1/admin/events", async ({ page }) => {
  const nav = await enterAs(page, "agency_kin", "/events");
  expect(nav?.status()).toBe(403);
  const apiResp = await page.request.get("/api/hub/v1/admin/events");
  expect(apiResp.status()).toBe(403);
});

test("staff creates a 30-second event, approves co-join, moves zone, and acknowledges alert on /home", async ({ page }) => {
  await enterAs(page, "editor", "/events");
  await expect(page.getByRole("heading", { name: "ตลาดกลางดีลอีเวนต์ & บูธเครือเสนา" })).toBeVisible();

  const uniqueTitle = `บูธทดสอบ Playwright ${Date.now()}`;
  await page.getByRole("button", { name: "+ ลงอีเวนต์ด่วน (30 วินาที)" }).click();
  await page.getByPlaceholder("เช่น ออกบูธ SENA Expo เซ็นทรัล พระราม 9").fill(uniqueTitle);
  await page.getByPlaceholder("เช่น เซ็นทรัล พระราม 9").fill("เซ็นทรัล พระราม 9");
  await page.getByPlaceholder("เช่น ชั้น 1 ลานโปรโมชั่น โซน A หน้า Starbucks").fill("ชั้น 1 โซน A");
  await page.getByRole("button", { name: "บันทึกและเปิดประกาศอีเวนต์" }).click();

  await expect(page.locator("#detail-modal-title")).toHaveText(uniqueTitle);
  await expect(page.getByText("SENA DEVELOPMENT · EVENT REGISTRATION")).toBeVisible();
  await page.getByRole("button", { name: "ปิดหน้าต่าง" }).click();

  // Viewer co-joins the event
  await enterAs(page, "viewer", "/events");
  const card = page.locator(".event-card", { hasText: uniqueTitle });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "ขอแจมบูธนี้" }).click();
  await page.getByPlaceholder(/โต๊ะให้คำปรึกษา/).fill("โต๊ะให้คำปรึกษา Solar 1 ชุด");
  await page.getByRole("button", { name: "ยืนยันส่งคำขอแจมบูธ" }).click();
  await expect(page.getByRole("dialog").getByText("รอเจ้าภาพอนุมัติ")).toBeVisible();
  await page.getByRole("button", { name: "ปิดหน้าต่าง" }).click();

  // Editor approves co-join and updates booth zone -> triggers alert on /home for Viewer
  await enterAs(page, "editor", "/events");
  const hostCard = page.locator(".event-card", { hasText: uniqueTitle });
  await hostCard.getByRole("button", { name: "ดูผังบูธ · รายละเอียด · QR" }).click();
  await page.getByRole("tab", { name: /ทีมร่วมแจม & หารงบ/ }).click();
  await page.getByRole("button", { name: "อนุมัติให้แจม" }).click();
  await expect(page.getByRole("dialog").getByText("อนุมัติร่วมบูธแล้ว")).toBeVisible();

  await page.getByRole("tab", { name: /แจ้งย้ายโซน/ }).click();
  await page.getByLabel("จุดตั้งบูธ / ชั้น / โซนล่าสุด").fill("ชั้น G หน้าลิฟต์แก้ว");
  await page.getByPlaceholder(/ห้างแจ้งย้ายจุดโปรโมชั่น/).fill("ห้างปรับผังย้ายลงชั้น G เพื่อรับลูกค้าทางเข้าหลัก");
  await page.getByRole("button", { name: /บันทึกการเปลี่ยนแปลง & ส่งเช็กชื่อรับทราบทุกทีม/ }).click();
  await expect(page.getByRole("dialog").getByText("Revision 2")).toBeVisible();
  await page.getByRole("button", { name: "ปิดหน้าต่าง" }).click();

  // Viewer visits /home, sees the urgent banner, and clicks acknowledge
  await enterAs(page, "viewer", "/home");
  const banner = page.getByRole("region", { name: "แจ้งเตือนการเปลี่ยนแปลงอีเวนต์เครือ" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(uniqueTitle);
  const targetRow = banner.locator("div", { hasText: uniqueTitle }).first();
  await targetRow.getByRole("button", { name: "รับทราบการเปลี่ยนแปลง" }).click();
  await expect(banner).toHaveCount(0);

  // Mobile 390px layout check on /events
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "ตลาดกลางดีลอีเวนต์ & บูธเครือเสนา" })).toBeVisible();
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);
});
