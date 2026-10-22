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
  public_commercial_type_id: "รหัสสาธารณะแบบขาย", public_price_id: "รหัสสาธารณะราคา", category: "ประเภทแบบ",
  product_form: "ประเภทที่อยู่อาศัย", area_min_sqm: "พื้นที่ใช้สอยต่ำสุด (ตร.ม.)", area_max_sqm: "พื้นที่ใช้สอยสูงสุด (ตร.ม.)",
  kitchens: "ห้องครัว", storeys: "จำนวนชั้น", land_area_sqm: "พื้นที่ดิน (ตร.ม.)", ceiling_height_m: "ความสูงเพดาน (ม.)",
  special_rooms: "ห้องพิเศษ", furniture_package: "เฟอร์นิเจอร์", highlights: "จุดเด่น", price_mode: "การแสดงราคา",
  ai_exposure: "ช่องทางเผยแพร่", caption: "คำบรรยายภาพ", room_tag: "ประเภทห้องในภาพ", floor_label: "ชื่อชั้น", floor_number: "ชั้นที่",
  tours: "คลิปและทัวร์", url: "ที่อยู่ลิงก์", embed_url: "ที่อยู่แสดงทัวร์", title: "ชื่อ", provider: "ผู้ให้บริการ", kind: "ประเภท",
  amount: "ราคา (บาท)", basis_size_sqm: "ขนาดที่อ้างอิงราคา (ตร.ม.)", display_text: "ข้อความแสดงราคา", basis: "ฐานอ้างอิง",
  condition_text: "เงื่อนไข", promotion_code: "รหัสโปรโมชัน", valid_from: "เริ่มใช้ราคา", valid_to: "วันหมดอายุราคา",
};
const values: Record<string, string> = { active: "เปิดใช้งาน", inactive: "ปิดใช้งาน", hero: "ภาพหลัก", thumbnail: "ภาพย่อ",
  master_plan: "ผังโครงการ", floor_plan: "แปลนชั้น", model_image: "ภาพแบบบ้าน", structural_plan: "แปลนโครงสร้าง", brochure: "โบรชัวร์",
  logo_primary: "โลโก้หลัก", logo_white: "โลโก้สีขาว", logo_mono: "โลโก้ขาวดำ", favicon: "ไอคอนเว็บไซต์" };
const unitValues: Record<string, Record<string, string>> = {
  category: { studio: "สตูดิโอ", "1br": "1 ห้องนอน", "1br_plus": "1 ห้องนอนพลัส", "2br": "2 ห้องนอน", "3br": "3 ห้องนอน", duplex: "ดูเพล็กซ์", single_house: "บ้านเดี่ยว", twin_house: "บ้านแฝด", townhome: "ทาวน์โฮม", shophouse: "อาคารพาณิชย์" },
  product_form: { condominium: "ห้องชุด", house: "บ้าน", townhome: "ทาวน์โฮม", other: "อื่น ๆ" },
  special_rooms: { maid_room: "ห้องแม่บ้าน", multipurpose: "ห้องอเนกประสงค์", family_area: "พื้นที่ครอบครัว", double_living: "ห้องนั่งเล่นสองส่วน", walk_in_closet: "ห้องแต่งตัว" },
  furniture_package: { full: "ครบชุด", partial: "บางส่วน", none: "ไม่มี" },
  price_mode: { hidden: "ซ่อนราคา", manual: "ราคา Marketing", rem_auto: "ราคา REM อัตโนมัติ · ยังไม่เปิดใช้งาน" },
  ai_exposure: { open: "เว็บไซต์และ AI", web_only: "เว็บไซต์เท่านั้น", internal: "ภายในเท่านั้น" },
  kind: { starting: "ราคาเริ่มต้น", unit_type: "ราคาแบบขาย", tour_360: "ทัวร์ 360", clip: "คลิป" },
};

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
  return field === "asset_role" || field === "status" ? values[String(value)] ?? String(value) : unitValues[field ?? ""]?.[String(value)] ?? String(value);
}
export { display as publicationValue };
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
