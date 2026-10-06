import { NextRequest, NextResponse } from "next/server";
import { getLocalRole, getRoleToken, hasSameLocalOrigin, isLocalMode, isLoopback, localRequestOrigin } from "@/lib/local-session";
import { isContentStaff, isHubStaff } from "@/lib/staff";
import { getHostedCaller } from "@/lib/hosted-session";
import { h1AllowsApi, h1Unavailable, hostedConfig, isHostedMode } from "@/lib/hosted-config";

const id = "[a-zA-Z0-9_-]{1,128}";
const maxUploadBytes = 10 * 1024 * 1024;
const uploadTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/pdf"]);
const allowed = {
  GET: new RegExp(`^v1/(?:admin/(?:assets(?:/${id}(?:/file)?)?|sources/(?:projects|brands)|brands(?:/${id}(?:/versions)?)?|brand-requests|projects(?:/${id}(?:/(?:versions|source-models|models/${id}|commercial-types))?)?)|assets/${id}/file|(?:projects|brands)(?:/${id})?)$`),
  PATCH: new RegExp(`^v1/admin/(?:projects/${id}(?:/(?:models|commercial-types)/${id})?|brands/${id})$`),
  POST: new RegExp(`^v1/admin/(?:assets(?:/${id}/review)?|brand-requests(?:/${id}/resolve)?|brands(?:/${id}/(?:publish|withdraw|rollback|assets(?:/${id}/remove)?))?|projects(?:/${id}/(?:brand|prefill|publish|withdraw|rollback|models(?:/${id}/(?:review|assets(?:/${id}/remove)?))?|commercial-types(?:/${id}/assets(?:/${id}/remove)?)?|assets(?:/${id}/remove)?))?)$`),
  PUT: new RegExp(`^v1/admin/projects/${id}/facilities/${id}$`),
};
const financeId = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const financeCollections = "memos|memo-identifiers|media-lines|line-assignments|corrections|ledger-imports|ad-accounts|channel-accounts|commitments|card-statements|card-imports|cost-records|document-requirements";
const financeList = new RegExp(`^v1/admin/ads/(?:${financeCollections})$`);
const financeAllowed = {
  GET: new RegExp(`^v1/admin/ads/(?:(?:${financeCollections})(?:/${financeId})?|registrations/SN\\d{7}[A-Z0-9]/(?:monthly-lines|line-candidates))$`),
  POST: new RegExp(`^v1/admin/ads/(?:memos(?:/${financeId}/confirm-record)?|memo-identifiers(?:/${financeId}/(?:review|retire))?|media-lines(?:/${financeId}/(?:archive|revisions(?:/${financeId}/confirm)?))?|line-assignments(?:/${financeId}/(?:replace|end|acknowledge))?|corrections(?:/${financeId}/(?:review|apply|retire))?|(?:ad-accounts|channel-accounts)(?:/${financeId}/versions(?:/(?:confirm|close))?)?|commitments(?:/${financeId}/(?:revisions|activate|suspend|covers|occurrences))?|card-statements|card-imports/${financeId}/(?:confirm|replace)|card-import-rows/${financeId}/classify|cost-records/${financeId}/allocations)$`),
  PATCH: new RegExp(`^v1/admin/ads/(?:(?:memos|card-statements)/${financeId}|media-lines/${financeId}/revisions/${financeId})$`),
};

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const error = (message: string, status: number) => NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
  const hosted = isHostedMode();
  const configuration = hosted ? hostedConfig() : null;
  if (!hosted && (!isLocalMode() || !localRequestOrigin(request))) {
    return error("ยังไม่เปิดใช้งานการยืนยันตัวตนสำหรับสภาพแวดล้อมนี้", 503);
  }
  const caller = hosted ? await getHostedCaller() : null;
  const role = hosted ? caller?.role : await getLocalRole();
  if (!role) return error("กรุณาเลือกบัญชีทดสอบก่อนใช้งาน", 401);
  const path = (await context.params).path.join("/");
  const method = request.method as keyof typeof allowed;
  if (hosted && !h1AllowsApi(path, method)) return error(h1Unavailable, 403);
  // Asset bytes use a bearer-authenticated direct API request, outside Vercel limits.
  if (hosted && (method === "POST" && path === "v1/admin/assets" || method === "GET" && /\/assets\/[^/]+\/file$/.test(path))) return error("กรุณาใช้ช่องทางรับส่งไฟล์ส่วนตัวของ TEST H1", 400);
  const questionsRead = method === "GET" && path === "v1/admin/questions";
  const knowledgeRead = method === "GET" && new RegExp(`^v1/admin/knowledge/(?:projects(?:/${id})?|candidates/${financeId}/file)$`).test(path);
  const knowledgeWrite = method === "POST" && new RegExp(`^v1/admin/knowledge/(?:preview|rights/approve|candidates/${financeId}/review)$`).test(path);
  if ((knowledgeRead || knowledgeWrite) && (hosted || !isContentStaff(role))) return error("คลังความรู้เปิดให้ทีมงานตรวจข้อมูลเฉพาะในเครื่อง", 403);
  const brandDashboard = method === "GET" && /^v1\/admin\/brands\/completeness(?:\.csv)?$/.test(path);
  const brandBulk = method === "GET" && path === "v1/admin/brands/bulk-preview" || method === "POST" && path === "v1/admin/brands/bulk-create";
  const brandConfirm = method === "POST" && new RegExp(`^v1/admin/brands/${id}/confirm-source-names$`).test(path);
  if (brandDashboard && !isContentStaff(role) || brandBulk && (hosted || role !== "admin") || brandConfirm && !["editor", "admin"].includes(role)) return error("ไม่มีสิทธิ์ดำเนินการกับแบรนด์", 403);
  if (questionsRead && !isHubStaff(role)) return error("ไม่มีสิทธิ์เข้าถึงคำถามของทีมงาน", 403);
  const assistantRead = method === "GET" && new RegExp(`^v1/admin/assistant/(?:config|runs/${financeId}(?:/citations/${financeId})?|proposals/${financeId})$`).test(path);
  const assistantWrite = method === "POST" && new RegExp(`^v1/admin/assistant/(?:runs(?:/${financeId}/cancel)?|proposals(?:/(?:suggest|${financeId}/confirm))?)$`).test(path);
  const assistantRun = assistantWrite && path === "v1/admin/assistant/runs";
  if ((assistantRead || assistantWrite) && !isHubStaff(role)) return error("ไม่มีสิทธิ์ใช้งานผู้ช่วยภายใน", 403);
  const contentRead = method === "GET" && new RegExp(`^v1/admin/(?:promotions(?:/${financeId})?|releases(?:/(?:candidates|${financeId}))?)$`).test(path);
  const promotionDraft = method === "POST" && path === "v1/admin/promotions" || method === "PATCH" && new RegExp(`^v1/admin/promotions/${financeId}$`).test(path);
  const contentPublish = method === "POST" && new RegExp(`^v1/admin/(?:promotions/${financeId}/(?:review|publish|withdraw)|releases/(?:publish|${financeId}/rollback))$`).test(path);
  if (contentRead && !isContentStaff(role) || promotionDraft && !["editor", "admin"].includes(role) || contentPublish && role !== "publisher") return error("ไม่มีสิทธิ์ดำเนินการกับเนื้อหาที่อยู่อาศัย", 403);
  const operationsRead = method === "GET" && new RegExp(`^v1/admin/ads/(?:actuals(?:/${financeId})?|(?:document-tracking|findings)(?:/[a-f0-9]{64})?)$`).test(path);
  const operationsWrite = method === "POST" && /^v1\/admin\/ads\/(?:document-tracking\/[a-f0-9]{64}\/follow-ups|findings\/[a-f0-9]{64}\/workflow)$/.test(path);
  if ((operationsRead || operationsWrite) && !["online_staff", "admin"].includes(role)) return error("ไม่มีสิทธิ์เข้าถึงผลการตลาดและเอกสาร", 403);
  const archiveRead = method === "GET" && new RegExp(`^v1/admin/ads/archive(?:/(?:fixtures|search|${financeId}(?:/(?:file|page))?))?$`).test(path);
  const archiveWrite = method === "POST" && new RegExp(`^v1/admin/ads/archive(?:/${financeId}/(?:retry|confirm|apply|hold))?$`).test(path);
  const archiveFile = archiveRead && path.endsWith("/file");
  const archivePage = archiveRead && path.endsWith("/page");
  if ((archiveRead || archiveWrite) && !["online_staff", "admin"].includes(role)) return error("ไม่มีสิทธิ์เข้าถึงคลังเอกสาร", 403);
  if (archiveWrite && path.endsWith("/hold") && role !== "admin") return error("การกำหนดให้เก็บรักษาเอกสารต้องดำเนินการโดยผู้ดูแลระบบ", 403);
  const adsRead = /^v1\/admin\/ads\/(?:settings|vocab|scopes|registrations(?:\/SN\d{7}[A-Z0-9])?)$/.test(path);
  const adsWrite = /^v1\/admin\/ads\/(?:registrations(?:\/preview|\/SN\d{7}[A-Z0-9]\/(?:names|bindings))?|names\/(?:validate|explain))$/.test(path);
  const financeRoute = financeAllowed[method as keyof typeof financeAllowed]?.test(path) ?? false;
  if (!(allowed[method]?.test(path) || knowledgeRead || knowledgeWrite || brandDashboard || brandBulk || brandConfirm || questionsRead || assistantRead || assistantWrite || contentRead || promotionDraft || contentPublish || operationsRead || operationsWrite || archiveRead || archiveWrite || (method === "GET" && adsRead) || (method === "POST" && adsWrite) || financeRoute)) return error("ไม่รองรับคำขอนี้", 404);
  // Only the public project collection accepts one explicit brand filter.
  const query = request.nextUrl.searchParams;
  const validBrandQuery = brandDashboard && [...query.keys()].every(key => ["status", "missing", "search"].includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200);
  const adsFilters = path === "v1/admin/ads/scopes" ? ["kind", "parent_group_id"] : path === "v1/admin/ads/registrations" ? ["q", "limit", "offset", "agency", "status", "binding_status"] : [];
  const validAdsQuery = method === "GET" && adsRead && [...query.keys()].every(key => adsFilters.includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200);
  const financeFilters = financeList.test(path) ? ["q", "month", "agency", "bud", "scope_id", "status", "limit", "offset"] : path.endsWith("/line-candidates") ? ["month"] : [];
  const validFinanceQuery = method === "GET" && financeRoute && [...query.keys()].every(key => financeFilters.includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200);
  const operationsFilters = path === "v1/admin/ads/actuals" ? ["month", "agency", "scope", "bud", "limit", "offset"] : path === "v1/admin/ads/document-tracking" ? ["month", "agency", "owner", "status", "overdue", "limit", "offset"] : path === "v1/admin/ads/findings" ? ["month", "agency", "owner", "control_code", "state", "condition", "limit", "offset"] : /^v1\/admin\/ads\/(?:actuals|document-tracking)\//.test(path) ? ["month"] : [];
  const validOperationsQuery = operationsRead && [...query.keys()].every(key => operationsFilters.includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200)
    && (!query.has("limit") || /^(?:[1-9][0-9]?|100)$/.test(query.get("limit")!)) && (!query.has("offset") || /^\d{1,8}$/.test(query.get("offset")!));
  const contentFilters = path === "v1/admin/promotions" ? ["project_id", "limit", "offset"] : path === "v1/admin/releases/candidates" ? ["demo_mode"] : [];
  const validContentQuery = contentRead && [...query.keys()].every(key => contentFilters.includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200)
    && (!query.has("project_id") || new RegExp(`^${financeId}$`).test(query.get("project_id")!))
    && (!query.has("limit") || /^(?:[1-9][0-9]?|100)$/.test(query.get("limit")!))
    && (!query.has("offset") || /^(?:\d{1,5}|100000)$/.test(query.get("offset")!))
    && (!query.has("demo_mode") || /^(?:true|false)$/.test(query.get("demo_mode")!));
  const archiveFilters = path === "v1/admin/ads/archive" ? ["document_type", "month", "bud", "status", "limit", "offset"] : path === "v1/admin/ads/archive/search" ? ["q", "series", "bud", "month", "limit", "offset"] : archiveFile ? ["version_id", "page", "download"] : archivePage ? ["version_id", "page"] : [];
  const validArchiveQuery = archiveRead && [...query.keys()].every(key => archiveFilters.includes(key) && query.getAll(key).length === 1 && (query.get(key)?.length ?? 0) <= 200)
    && (!query.has("limit") || /^(?:[1-9][0-9]?|100)$/.test(query.get("limit")!))
    && (!query.has("offset") || /^(?:\d{1,5}|100000)$/.test(query.get("offset")!))
    && (!query.has("version_id") || new RegExp(`^${financeId}$`).test(query.get("version_id")!))
    && (!query.has("page") || /^[1-9]\d{0,2}$/.test(query.get("page")!))
    && (!query.has("download") || /^(?:true|false)$/.test(query.get("download")!));
  if (request.nextUrl.search && !validBrandQuery && !validAdsQuery && !validFinanceQuery && !validOperationsQuery && !validContentQuery && !validArchiveQuery && !(method === "GET" && path === "v1/projects"
    && [...query.keys()].length === 1 && query.has("brand_id")
    && new RegExp(`^${id}$`).test(query.get("brand_id") ?? ""))) {
    return error("ไม่รองรับตัวกรองนี้", 404);
  }
  if (method !== "GET" && !(hosted ? request.headers.get("origin") === configuration!.adminOrigin : hasSameLocalOrigin(request))) {
    return error("ไม่อนุญาตคำขอจากต้นทางนี้", 403);
  }
  const token = hosted ? caller?.token : getRoleToken(path.startsWith("v1/admin/") ? role : "service_consumer");
  if (!token) return error("ยังไม่ได้ตั้งค่าสิทธิ์เชื่อมต่อบนเซิร์ฟเวอร์", 503);
  let base: URL;
  try {
    base = new URL(configuration?.apiOrigin ?? process.env.HUB_API_URL ?? "http://127.0.0.1:8000");
    if (!hosted && (!isLoopback(base.hostname) || !["http:", "https:"].includes(base.protocol) || base.username || base.password)) throw new Error();
  } catch {
    return error("การตั้งค่าที่อยู่บริการข้อมูลไม่ถูกต้อง", 503);
  }
  const upload = method === "POST" && path === "v1/admin/assets";
  let body: string | ArrayBuffer | undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (archiveFile && request.headers.has("range")) {
    const range = request.headers.get("range")!;
    if (!/^bytes=(?:\d{1,12}-\d{0,12}|-\d{1,12})$/.test(range)) return error("ไม่รองรับช่วงข้อมูลไฟล์นี้", 416);
    headers.Range = range;
  }
  if (method !== "GET") {
    if (upload && role === "viewer") return error("บัญชีผู้อ่านไม่สามารถอัปโหลดไฟล์ได้", 403);
    const limit = upload ? maxUploadBytes : assistantWrite ? 20_000 : 100_000;
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return error("ข้อมูลมีขนาดเกินกำหนด", 413);
    if (upload) {
      const type = request.headers.get("content-type") ?? "";
      if (!uploadTypes.has(type)) return error("รองรับเฉพาะ PNG, JPEG, WebP, SVG และ PDF", 415);
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
  const streamAbort = assistantRun ? new AbortController() : null;
  const cancelStream = () => streamAbort?.abort();
  const streamTimer = assistantRun ? setTimeout(cancelStream, 75_000) : null;
  if (assistantRun) request.signal.addEventListener("abort", cancelStream, { once: true });
  const releaseStream = () => { if (streamTimer) clearTimeout(streamTimer); request.signal.removeEventListener("abort", cancelStream); };
  try {
    const upstream = await fetch(new URL(`${path}${request.nextUrl.search}`, `${base.origin}/`), {
      method, body, cache: "no-store", redirect: "error",
      headers,
      signal: streamAbort ? AbortSignal.any([request.signal, streamAbort.signal]) : AbortSignal.timeout(upload ? 30_000 : 15_000),
    });
    if (assistantRun && upstream.ok) {
      if (!upstream.body || !upstream.headers.get("Content-Type")?.startsWith("text/event-stream")) { releaseStream(); streamAbort?.abort(); return error("ไม่ได้รับข้อมูลผู้ช่วยในรูปแบบที่รองรับ", 502); }
      const reader = upstream.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try { const chunk = await reader.read(); if (chunk.done) { releaseStream(); reader.releaseLock(); controller.close(); } else controller.enqueue(chunk.value); }
          catch (failure) { releaseStream(); streamAbort?.abort(); controller.error(failure); }
        },
        async cancel() { releaseStream(); streamAbort?.abort(); await reader.cancel().catch(() => {}); },
      });
      return new NextResponse(stream, { status: upstream.status, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
    }
    releaseStream();
    if (upstream.ok && brandDashboard && path.endsWith(".csv")) {
      if (!upstream.headers.get("Content-Type")?.startsWith("text/csv")) return error("รูปแบบ CSV ไม่ถูกต้อง", 502);
      return new NextResponse(upstream.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="brand-completeness.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (upstream.ok && archivePage) {
      if (upstream.headers.get("Content-Type")?.split(";")[0] !== "image/png") return error("รูปแบบหน้าหลักฐานไม่ถูกต้อง กรุณาเปิดไฟล์ต้นฉบับ", 502);
      return new NextResponse(upstream.body, { status: upstream.status, headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'" } });
    }
    if ((upstream.ok || archiveFile && upstream.status === 416) && method === "GET" && path.endsWith("/file")) {
      const downloadHeaders = new Headers({ "Cache-Control": archiveFile ? "private, no-store" : "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": archiveFile ? "default-src 'none'; sandbox; frame-ancestors 'self'" : "default-src 'none'; sandbox; frame-ancestors 'none'", "X-Frame-Options": archiveFile ? "SAMEORIGIN" : "DENY" });
      for (const name of ["Content-Type", "Content-Disposition", "Content-Length", ...(archiveFile ? ["Content-Range", "Accept-Ranges"] : [])]) {
        const value = upstream.headers.get(name);
        if (value) downloadHeaders.set(name, value);
      }
      return new NextResponse(upstream.body, { status: upstream.status, headers: downloadHeaders });
    }
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    releaseStream(); streamAbort?.abort();
    return error("เชื่อมต่อบริการข้อมูลไม่ได้ กรุณาตรวจสอบว่าเปิดบริการ API แล้ว และลองอีกครั้ง", 502);
  }
}

export { proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
