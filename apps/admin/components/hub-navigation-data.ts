import { can, type CapabilityProjection } from "@/lib/hub-permissions";
export const hubPages = [
  { id: "projects", href: "/", label: "โครงการที่อยู่อาศัย", group: "content", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { id: "brands", href: "/?view=brands", label: "แบรนด์ที่อยู่อาศัย", group: "content", icon: "M4 21V6l8-3v18M12 9h8v12M2 21h20M7 8v2M7 13v2M16 12v2M16 17v2" },
  { id: "promotions", href: "/promotions", label: "โปรโมชั่นโครงการ", group: "content", icon: "M3 3h8l10 10-8 8L3 11V3zM7 7h.01M11 15l4-4" },
  { id: "releases", href: "/releases", label: "ชุดเผยแพร่ข้อมูล", group: "content", icon: "M4 10v10h16V10M12 15V3M7 8l5-5 5 5" },
  { id: "knowledge", href: "/knowledge", label: "ตรวจข้อมูลก่อนนำเข้า", group: "content", icon: "M4 3h16v18H4zM8 7h8M8 11h8M8 15h5" },
  { id: "faq", href: "/faq", permissionTab: "knowledge", label: "คลัง FAQ เว็บไซต์", group: "content", icon: "M4 4h16v13H9l-5 4V4zM8 8h8M8 12h5" },
  { id: "articles", href: "/articles", permissionTab: "knowledge", label: "บทความ", group: "content", icon: "M12 5v16M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1zM5 8h4M15 8h4M5 12h4M15 12h4" },
  { id: "registry", href: "/ads/registry", label: "ทะเบียนแคมเปญ", group: "ads", icon: "M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" },
  { id: "finance", href: "/ads/finance", label: "งบและค่าใช้จ่าย", group: "ads", icon: "M3 6h18v14H3zM3 6V4h15M16 11h5v5h-5zM17 13h.01" },
  { id: "actuals", href: "/ads/actuals", label: "ผลใช้จ่ายรายเดือน", group: "ads", icon: "M4 3v18h17M8 17v-5M13 17V8M18 17V4" },
  { id: "documents", href: "/ads/documents", label: "ติดตามเอกสาร", group: "ads", icon: "M8 4H4v17h16V4h-4M8 2h8v5H8zM8 13l2 2 5-5" },
  { id: "archive", href: "/ads/archive", label: "คลังเอกสาร", group: "ads", icon: "M3 3h18v5H3zM5 8v13h14V8M9 12h6" },
  { id: "exceptions", href: "/ads/exceptions", label: "รายการที่ต้องตรวจสอบ", group: "ads", icon: "M12 3L2 21h20L12 3zM12 9v5M12 17h.01" },
  { id: "questions", href: "/questions", label: "คำถามที่รอคำตอบ", group: null, icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9 9a3 3 0 1 1 4 2.8c-.7.3-1 .7-1 1.7M12 17h.01" },
  { id: "accounts", href: "/admin/accounts", label: "ผู้ใช้และสิทธิ์", group: null, icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M17 11h6" },
] as const;
export const hubGroups = { content: "ข้อมูลเว็บไซต์และ AI", ads: "งานโฆษณาและงบ" } as const;
export type HubSection = typeof hubPages[number]["id"];

// The permission route inventory above stays separate from menu presentation.
// Destinations use the existing workspaces until their unified pages are ready.
export type HubMenuItem = {
  key: string;
  label?: string;
  targets: { section: HubSection; href: string }[];
  icon?: string;
  adminOnly?: boolean;
  projectContext?: boolean;
};
export type HubMenuGroup = { key: string; label?: string; icon?: string; items: HubMenuItem[] };
export type HubService = { key: keyof typeof hubGroups; label: string; icon: string; groups: HubMenuGroup[] };
export const hubServices: HubService[] = [
  { key: "content", label: hubGroups.content, icon: "M4 3h16v18H4zM8 7h8M8 11h8M8 15h5", groups: [
    { key: "content-work", items: [
      { key: "home", label: "หน้าแรก", icon: "m3 10 9-7 9 7v11H3zM9 21v-8h6v8", targets: [{ section: "projects", href: "/" }, { section: "brands", href: "/?view=brands" }, { section: "faq", href: "/faq" }] },
      { key: "website", label: "ข้อมูลเว็บไซต์", targets: [{ section: "projects", href: "/?view=projects" }, { section: "brands", href: "/?view=brands" }, { section: "faq", href: "/faq" }] },
      { key: "promotions", label: "โปรโมชั่น", targets: [{ section: "promotions", href: "/promotions" }] },
      { key: "articles", label: "บทความ", targets: [{ section: "articles", href: "/articles" }] },
      { key: "publishing", label: "เผยแพร่", targets: [{ section: "releases", href: "/releases" }, { section: "faq", href: "/faq?tab=publication" }] },
    ] },
    { key: "settings", label: "ตั้งค่า", icon: "M4 7h16M4 17h16M8 4v6M16 14v6", items: [
      { key: "question-bank", label: "คำถามมาตรฐาน", targets: [{ section: "faq", href: "/faq?tab=bank" }] },
      { key: "glossary", label: "คำแปลมาตรฐาน", icon: "M3 5h12M9 3v2M5 5c0 6 5 10 10 12M13 5c0 6-5 10-10 12M14 21l4-10 4 10M16 17h4", targets: [{ section: "faq", href: "/faq?tab=glossary" }] },
      { key: "fields", label: "ทะเบียนฟิลด์", icon: "M4 4h16v16H4zM4 9h16M9 9v11", targets: [{ section: "projects", href: "/content/fields" }] },
      { key: "media-tags", label: "แท็กรูป", icon: "M3 3h9l9 9-9 9-9-9V3zM8 8h.01", projectContext: true, targets: [{ section: "projects", href: "/media?tab=rules#tags" }] },
      { key: "media-rules", label: "กติการูปที่ต้องมี", icon: "M4 4h16v16H4zM7 8l2 2 3-3M7 15l2 2 3-3M15 8h2M15 15h2", projectContext: true, targets: [{ section: "projects", href: "/media?tab=rules#requirements" }] },
      { key: "legacy-evidence", label: "หลักฐานนำเข้าเดิม", adminOnly: true, targets: [{ section: "knowledge", href: "/knowledge" }] },
    ] },
  ] },
  { key: "ads", label: hubGroups.ads, icon: "M4 3v18h17M8 17v-5M13 17V8M18 17V4", groups: [
    { key: "ads-work", items: hubPages.filter(page => page.group === "ads").map(page => ({ key: page.id, targets: [{ section: page.id, href: page.href }] })) },
  ] },
];
export const hubUtilities: HubMenuItem[] = hubPages.filter(page => page.group === null).map(page => ({ key: page.id, targets: [{ section: page.id, href: page.href }] }));

export function hubCurrentMenuKey(section: HubSection, location = "/") {
  const url = new URL(location, "https://hub.invalid");
  if (url.pathname === "/content/fields") return "fields";
  if (url.pathname === "/media" && url.searchParams.get("tab") === "rules") return url.hash === "#requirements" ? "media-rules" : "media-tags";
  if (section === "faq") {
    const tab = url.searchParams.get("tab");
    return tab === "bank" ? "question-bank" : tab === "glossary" ? "glossary" : tab === "publication" ? "publishing" : "website";
  }
  if (section === "knowledge") return "legacy-evidence";
  if (section === "releases") return "publishing";
  if (section === "brands") return "website";
  if (section === "projects") return url.pathname === "/" && !url.search ? "home" : "website";
  return section;
}

export function hubMenuItem(key: string) {
  return [...hubServices.flatMap(service => service.groups.flatMap(group => group.items)), ...hubUtilities].find(item => item.key === key);
}

export function hubPermissionTab(section: HubSection) {
  const page = hubPages.find(page => page.id === section);
  return page && "permissionTab" in page ? page.permissionTab : section;
}
export const hubRoutes = [...new Set(hubPages.map(p => p.href.split("?")[0])), "/content", "/content/fields", "/media", "/ads/registry/new", "/ads/registry/inbox", "/account/request"];
export function safeNext(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try { const url = new URL(value, "https://hub.invalid"); return url.origin === "https://hub.invalid" && hubRoutes.includes(url.pathname) ? url.pathname + url.search + url.hash : "/"; } catch { return "/"; }
}

export function workspaceLanding(capabilities?: CapabilityProjection) {
  return hubPages.find(page => page.id === "accounts" ? capabilities?.can_manage_users : can(capabilities, hubPermissionTab(page.id)))?.href ?? "/";
}
