import type { ReactNode } from "react";

export type PublicationPayload = Record<string, unknown>;

const labels: Record<string, string> = {
  public_project_id: "รหัสสาธารณะโครงการ", public_brand_id: "รหัสสาธารณะแบรนด์", public_model_id: "รหัสสาธารณะแบบบ้าน",
  public_asset_id: "รหัสสาธารณะไฟล์", public_name: "ชื่อที่ใช้เผยแพร่", description: "คำอธิบาย", address: "ที่อยู่",
  slug: "รหัส URL", latitude: "ละติจูด", longitude: "ลองจิจูด", ad_disclaimer: "ข้อความกำกับโฆษณา",
  meta_title: "ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล", meta_description: "คำอธิบายย่อ", status: "สถานะ",
  brand: "แบรนด์และเวอร์ชัน", models: "แบบบ้าน", assets: "รูปภาพ แปลน และไฟล์", model_catalogue_complete: "แบบบ้านจากต้นทางครบ",
  bedrooms: "ห้องนอน", bathrooms: "ห้องน้ำ", usable_area_sqm: "พื้นที่ใช้สอย (ตร.ม.)", parking_spaces: "ที่จอดรถ",
  asset_role: "หน้าที่ของไฟล์", is_primary: "ไฟล์หลัก", alt_text: "คำอธิบายภาพ", display_order: "ลำดับแสดง",
  public_url: "ที่อยู่ไฟล์สาธารณะ", mime_type: "ชนิดไฟล์", effective_from: "เริ่มใช้", effective_to: "สิ้นสุด",
  synthetic: "ข้อมูลสังเคราะห์สำหรับทดสอบ", version_no: "เวอร์ชัน", published_at: "เวลาเผยแพร่", th: "ภาษาไทย", en: "ภาษาอังกฤษ",
};
const values: Record<string, string> = { active: "เปิดใช้งาน", inactive: "ปิดใช้งาน", hero: "ภาพหลัก", thumbnail: "ภาพย่อ",
  master_plan: "ผังโครงการ", floor_plan: "แปลนชั้น", model_image: "ภาพแบบบ้าน", structural_plan: "แปลนโครงสร้าง", brochure: "โบรชัวร์",
  logo_primary: "โลโก้หลัก", logo_white: "โลโก้สีขาว", logo_mono: "โลโก้ขาวดำ", favicon: "ไอคอนเว็บไซต์" };

// Objects are canonicalized only for equality; array order is published order.
export function publicationKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export function publicationChanges(next: PublicationPayload, previous?: PublicationPayload) {
  return [...new Set([...Object.keys(next), ...Object.keys(previous ?? {})])].map(key => ({
    key, label: labels[key] ?? key, before: previous?.[key], after: next[key],
    changed: !previous || publicationKey(previous[key]) !== publicationKey(next[key]),
  }));
}
function display(value: unknown, field?: string): string {
  if (value == null || value === "") return "ยังไม่มีข้อมูล";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (Array.isArray(value)) return value.length ? value.map((item, index) => `${index + 1}. ${display(item, field)}`).join("\n\n") : "ไม่มีรายการ";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${labels[key] ?? key}: ${display(item, key)}`).join("\n");
  return field === "asset_role" || field === "status" ? values[String(value)] ?? String(value) : String(value);
}
export function PublicationComparison({ current, target, label, rollback = false, redacted = false, currentMedia, targetMedia }: {
  current?: PublicationPayload; target?: PublicationPayload; label: string; rollback?: boolean; redacted?: boolean;
  currentMedia?: ReactNode; targetMedia?: ReactNode;
}) {
  if (!target) return <p role="alert">โหลดข้อมูลสำหรับเปรียบเทียบไม่สำเร็จ กรุณาโหลดใหม่ก่อนเผยแพร่</p>;
  const fields = publicationChanges(target, current);
  return <section className="brand-comparison" aria-label={label}>
    <h3>{current ? "ตรวจการเปลี่ยนแปลงก่อนยืนยัน" : "ตัวอย่างข้อมูลที่จะเผยแพร่"}</h3>
    {redacted ? <p role="alert">สิทธิ์ปัจจุบันไม่ครอบคลุมข้อมูลบางส่วนที่ส่งออก กรุณาให้ผู้มีสิทธิ์ตรวจข้อมูลครบก่อนยืนยัน</p> : <p className="field-help">แสดงทุกช่องข้อมูลที่ส่งออก รวมภาษาไทยและภาษาอังกฤษ ช่องที่เปลี่ยนแปลงมีแถบกำกับ</p>}
    {current && !fields.some(field => field.changed) && <p>ไม่มีการเปลี่ยนแปลงจากเวอร์ชันที่เผยแพร่</p>}
    {fields.map(field => <div key={field.key} data-field={field.key} className={`brand-comparison-row${field.changed ? " changed" : ""}`}>
      <h4>{field.label} {field.changed && <span className="brand-change-mark">{current ? "เปลี่ยนแปลง" : "เผยแพร่ใหม่"}</span>}</h4>
      <div className="brand-comparison-pair"><div><p className="brand-comparison-caption">ที่เผยแพร่ปัจจุบัน</p>{field.key === "assets" && currentMedia}<p className="project-comparison-value">{display(field.before, field.key)}</p></div>
        <div><p className="brand-comparison-caption">{rollback ? "เวอร์ชันที่จะคืนค่า" : "ฉบับที่จะเผยแพร่"}</p>{field.key === "assets" && targetMedia}<p className="project-comparison-value">{display(field.after, field.key)}</p></div></div>
    </div>)}
  </section>;
}
