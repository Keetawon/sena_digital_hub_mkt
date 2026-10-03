import type { Project } from "./hub-admin";

// Same approach as brand review: compare only fields in the published payload.
// Staff source evidence, audit fields and optional draft modules are excluded.
const localized = (value?: Record<string, string | undefined>) => Object.entries(value ?? {}).filter(([, text]) => text).sort(([a], [b]) => a.localeCompare(b));
export function projectReviewFields(value: Project) {
  return {
    public_name: localized(value.public_name), address: localized(value.address), slug: value.slug || "",
    latitude: value.latitude ?? null, longitude: value.longitude ?? null,
    ad_disclaimer: localized(value.ad_disclaimer), meta_title: localized(value.meta_title), meta_description: localized(value.meta_description),
    brand: [value.brand_id ?? null, value.brand_version_id ?? null],
    models: (value.models ?? []).filter(model => model.match_status !== "REJECTED").map(model => ({
      public_model_id: model.public_model_id, rem_model_id: model.rem_model_id, public_name: localized(model.public_name),
      bedrooms: model.bedrooms, bathrooms: model.bathrooms, usable_area_sqm: model.usable_area_sqm,
      parking_spaces: model.parking_spaces, match_status: model.match_status,
    })).sort((a, b) => a.public_model_id.localeCompare(b.public_model_id)),
    assets: (value.assets ?? []).filter(asset => !asset.public_model_id || value.models?.some(model => model.public_model_id === asset.public_model_id && model.match_status !== "REJECTED")).map(asset => ({
      id: asset.id, public_model_id: asset.public_model_id ?? null, asset_role: asset.asset_role,
      is_primary: Boolean(asset.is_primary), alt_text: localized(asset.alt_text), display_order: asset.display_order,
      public_url: asset.public_url, rights_status: asset.rights_status,
      effective_from: asset.effective_from ?? null, effective_to: asset.effective_to ?? null,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}
const names: Record<keyof ReturnType<typeof projectReviewFields>, string> = {
  public_name: "ชื่อโครงการ", address: "ที่อยู่", slug: "รหัส URL", latitude: "ละติจูด", longitude: "ลองจิจูด",
  ad_disclaimer: "ข้อความกำกับโฆษณา", meta_title: "SEO: ชื่อเรื่อง", meta_description: "SEO: คำอธิบาย",
  brand: "แบรนด์และเวอร์ชัน", models: "แบบบ้านและการจับคู่", assets: "รูปภาพ แปลน และสิทธิ์ใช้งาน",
};
export function projectChanges(target: Project, current?: Project) {
  const next = projectReviewFields(target), previous = current && projectReviewFields(current);
  return (Object.keys(next) as (keyof typeof next)[]).filter(key => !previous || JSON.stringify(next[key]) !== JSON.stringify(previous[key])).map(key => ({ key, label: names[key], before: previous?.[key], after: next[key] }));
}
function display(value: unknown): string {
  if (value == null || value === "") return "ยังไม่มีข้อมูล";
  if (Array.isArray(value)) return value.length ? value.map(item => Array.isArray(item) ? item.join(": ") : typeof item === "object" ? Object.entries(item).map(([key, text]) => `${key}: ${display(text)}`).join(" · ") : display(item)).join("\n") : "ไม่มีรายการ";
  return String(value);
}
export function ProjectComparison({ current, target }: { current?: Project; target: Project }) {
  const changes = projectChanges(target, current);
  return <section className="brand-comparison" aria-label="เปรียบเทียบข้อมูลโครงการ"><h3>{current ? "รายการที่เปลี่ยนจากเวอร์ชันที่เผยแพร่" : "ข้อมูลที่จะเผยแพร่ครั้งแรก"}</h3>{!changes.length && <p>ไม่มีการเปลี่ยนแปลงจากเวอร์ชันที่เผยแพร่</p>}{changes.map(change => <div key={change.key} data-field={change.key} className="brand-comparison-row changed"><h4>{change.label}</h4><div className="brand-comparison-pair"><div><p className="brand-comparison-caption">ที่เผยแพร่ปัจจุบัน</p><p className="project-comparison-value">{display(change.before)}</p></div><div><p className="brand-comparison-caption">ฉบับที่จะเผยแพร่</p><p className="project-comparison-value">{display(change.after)}</p></div></div></div>)}</section>;
}

export function modelActorLabel(id: string | null) {
  // Known local seed accounts; legacy/imported confirmations have no staff profile directory.
  const roles: Record<string, string> = { "00000000-0000-0000-0000-000000000001": "ผู้แก้ไขข้อมูล", "00000000-0000-0000-0000-000000000005": "ผู้ดูแลระบบ" };
  return id && roles[id] || "ผู้ยืนยันแบบ";
}
