import { NextRequest, NextResponse } from "next/server";
import { getLocalRole, getRoleToken, hasSameLocalOrigin, isLocalMode, isLoopback, localRequestOrigin } from "@/lib/local-session";

const id = "[a-zA-Z0-9_-]{1,128}";
const maxUploadBytes = 10 * 1024 * 1024;
const uploadTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const allowed = {
  GET: new RegExp(`^v1/(?:admin/(?:assets(?:/${id}(?:/file)?)?|sources/(?:projects|brands)|brands(?:/${id}(?:/versions)?)?|brand-requests|projects(?:/${id}(?:/(?:versions|source-models|models/${id}|commercial-types))?)?)|assets/${id}/file|(?:projects|brands)(?:/${id})?)$`),
  PATCH: new RegExp(`^v1/admin/(?:projects/${id}(?:/(?:models|commercial-types)/${id})?|brands/${id})$`),
  POST: new RegExp(`^v1/admin/(?:assets(?:/${id}/review)?|brand-requests(?:/${id}/resolve)?|brands(?:/${id}/(?:publish|withdraw|rollback|assets(?:/${id}/remove)?))?|projects(?:/${id}/(?:brand|prefill|publish|withdraw|rollback|models(?:/${id}/(?:review|assets(?:/${id}/remove)?))?|commercial-types(?:/${id}/assets(?:/${id}/remove)?)?|assets(?:/${id}/remove)?))?)$`),
  PUT: new RegExp(`^v1/admin/projects/${id}/facilities/${id}$`),
};

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const error = (message: string, status: number) => NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
  if (!isLocalMode() || !localRequestOrigin(request)) {
    return error("ยังไม่เปิดใช้งานการยืนยันตัวตนสำหรับสภาพแวดล้อมนี้", 503);
  }
  const role = await getLocalRole();
  if (!role) return error("กรุณาเลือกบัญชีทดสอบก่อนใช้งาน", 401);
  const path = (await context.params).path.join("/");
  const method = request.method as keyof typeof allowed;
  const adsRead = /^v1\/admin\/ads\/(?:settings|vocab|scopes|registrations(?:\/SN\d{7}[A-Z0-9])?)$/.test(path);
  const adsWrite = /^v1\/admin\/ads\/(?:registrations(?:\/preview|\/SN\d{7}[A-Z0-9]\/(?:names|bindings))?|names\/(?:validate|explain))$/.test(path);
  if (!(allowed[method]?.test(path) || (method === "GET" && adsRead) || (method === "POST" && adsWrite))) return error("ไม่รองรับคำขอนี้", 404);
  // Only the public project collection accepts one explicit brand filter.
  const query = request.nextUrl.searchParams;
  const adsFilters = path === "v1/admin/ads/scopes" ? ["kind", "parent_group_id"] : path === "v1/admin/ads/registrations" ? ["q", "limit", "offset", "agency", "status", "binding_status"] : [];
  const validAdsQuery = method === "GET" && adsRead && [...query.keys()].every(key => adsFilters.includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200);
  if (request.nextUrl.search && !validAdsQuery && !(method === "GET" && path === "v1/projects"
    && [...query.keys()].length === 1 && query.has("brand_id")
    && new RegExp(`^${id}$`).test(query.get("brand_id") ?? ""))) {
    return error("ไม่รองรับตัวกรองนี้", 404);
  }
  if (method !== "GET" && !hasSameLocalOrigin(request)) {
    return error("ไม่อนุญาตคำขอจากต้นทางนี้", 403);
  }
  const token = getRoleToken(path.startsWith("v1/admin/") ? role : "service_consumer");
  if (!token) return error("ยังไม่ได้ตั้งค่าสิทธิ์เชื่อมต่อบนเซิร์ฟเวอร์", 503);
  let base: URL;
  try {
    base = new URL(process.env.HUB_API_URL ?? "http://127.0.0.1:8000");
    if (!isLoopback(base.hostname) || !["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error();
  } catch {
    return error("การตั้งค่าที่อยู่บริการข้อมูลไม่ถูกต้อง", 503);
  }
  const upload = method === "POST" && path === "v1/admin/assets";
  let body: string | ArrayBuffer | undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (method !== "GET") {
    if (upload && role === "viewer") return error("บัญชีผู้อ่านไม่สามารถอัปโหลดไฟล์ได้", 403);
    const limit = upload ? maxUploadBytes : 100_000;
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return error("ข้อมูลมีขนาดเกินกำหนด", 413);
    if (upload) {
      const type = request.headers.get("content-type") ?? "";
      if (!uploadTypes.has(type)) return error("รองรับเฉพาะ PNG, JPEG, WebP และ PDF", 415);
      const filename = request.headers.get("x-filename") ?? "";
      if (!filename || filename.length > 2400) return error("กรุณาระบุชื่อไฟล์ที่ถูกต้อง", 422);
      headers["Content-Type"] = type;
      headers["X-Filename"] = filename;
    } else headers["Content-Type"] = "application/json";
    const chunks: Uint8Array[] = [];
    const reader = request.body?.getReader();
    let size = 0;
    if (!reader) return error("ไม่พบข้อมูลที่ส่งมา", 400);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); return error("ข้อมูลมีขนาดเกินกำหนด", 413); }
        chunks.push(chunk.value);
      }
    } catch { return error("รับข้อมูลไม่ครบ กรุณาลองส่งอีกครั้ง", 400); }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (upload) body = bytes.buffer;
    else {
      body = new TextDecoder().decode(bytes);
      try { JSON.parse(body); } catch { return error("รูปแบบข้อมูลไม่ถูกต้อง", 400); }
    }
  }
  try {
    const upstream = await fetch(new URL(`${path}${request.nextUrl.search}`, `${base.origin}/`), {
      method, body, cache: "no-store", redirect: "error",
      headers,
      signal: AbortSignal.timeout(upload ? 30_000 : 15_000),
    });
    if (upstream.ok && method === "GET" && path.endsWith("/file")) {
      const downloadHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'", "X-Frame-Options": "DENY" });
      for (const name of ["Content-Type", "Content-Disposition", "Content-Length"]) {
        const value = upstream.headers.get(name);
        if (value) downloadHeaders.set(name, value);
      }
      return new NextResponse(upstream.body, { status: upstream.status, headers: downloadHeaders });
    }
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("เชื่อมต่อบริการข้อมูลไม่ได้ กรุณาตรวจสอบว่าเปิดบริการ API แล้ว และลองอีกครั้ง", 502);
  }
}

export { proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
