import "./demo-fields.css";

const labels: Record<string, string> = {
  promotion: "ข้อมูลโปรโมชัน", review_evidence: "หลักฐานการตรวจตัวอย่าง", asset: "สื่อประกอบตัวอย่าง",
  public_name: "ชื่อที่ใช้สื่อสาร", description: "คำอธิบาย", slug: "ชื่ออ้างอิง", address: "ที่อยู่", latitude: "ละติจูด", longitude: "ลองจิจูด", ad_disclaimer: "ข้อความกำกับโฆษณา", meta_title: "ชื่อเรื่อง", meta_description: "คำอธิบายย่อ",
  bedrooms: "ห้องนอน", bathrooms: "ห้องน้ำ", usable_area_sqm: "พื้นที่ใช้สอย", parking_spaces: "ที่จอดรถ", match_status: "สถานะการตรวจแบบ", title: "ชื่อโปรโมชัน", summary: "รายละเอียดสรุป", conditions_public: "เงื่อนไข", legal_terms: "ข้อกำหนดทางกฎหมาย", disclaimer: "ข้อความกำกับ", starts_at: "เวลาเริ่ม", ends_at: "เวลาสิ้นสุด", benefit_type: "ประเภทสิทธิประโยชน์", benefit_value: "มูลค่าสิทธิประโยชน์", benefit_unit: "หน่วย", assets: "สื่อประกอบ", reviews: "หลักฐานผลตรวจ", source: "ข้อมูลต้นทางสังเคราะห์",
};
export function DemoFields({ fields }: { fields?: unknown }) {
  const names = Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : fields && typeof fields === "object" ? Object.keys(fields) : [];
  if (!names.length) return null;
  const description = names.map(field => { const [base, locale] = field.split("."); return `${labels[base] ?? field}${locale === "th" ? " (ภาษาไทย)" : locale === "en" ? " (ภาษาอังกฤษ)" : ""}`; }).join(" · ");
  return <span className="demo-fields" role="note" aria-label={`ข้อมูลตัวอย่าง: ${description}`}><strong>ข้อมูลตัวอย่าง</strong><span>{description}</span></span>;
}
