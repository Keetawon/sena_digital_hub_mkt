import type { HubAccount } from "./hub-permissions";
export const unavailableMessage = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่";
export class HubApiUnavailable extends Error {
  constructor() { super(unavailableMessage); }
}

export async function readHubAccount(apiOrigin: string, token: string) {
  try {
    const response = await fetch(`${apiOrigin}/v1/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if ([401, 403].includes(response.status)) return { status: response.status, account: null };
    if (!response.ok) throw new HubApiUnavailable();
    const { data } = await response.json();
    if (!data || !["ACTIVE", "PENDING", "REJECTED", "SUSPENDED"].includes(data.status)) throw new HubApiUnavailable();
    return { status: 200, account: data as HubAccount };
  } catch { throw new HubApiUnavailable(); }
}

// Respond directly so an outage cannot trigger another account lookup in a layout.
export function unavailablePage(retryPath = "") {
  const retryHref = retryPath.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${unavailableMessage}</title></head><body style="font-family:Tahoma,sans-serif;line-height:1.6;margin:2rem"><main><h1>${unavailableMessage}</h1><p>ข้อมูลเข้าสู่ระบบของคุณยังคงอยู่ กรุณาลองเปิดหน้านี้อีกครั้ง</p><a href="${retryHref}">ลองใหม่</a></main></body></html>`, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Retry-After": "10" } });
}
