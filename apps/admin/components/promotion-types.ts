import type { Localized } from "./content-operations-shared";

export const promotionTiers = {
  campaign: "แคมเปญ",
  corporate: "องค์กร / โปรแกรม",
  brand: "แบรนด์",
  project_group: "กลุ่มโครงการ",
  project: "เฉพาะโครงการ",
} as const;

export type PromotionTier = keyof typeof promotionTiers;

export const promotionTextFields = {
  title: "ชื่อโปรโมชัน",
  summary: "รายละเอียดโดยย่อ",
  conditions_public: "เงื่อนไขสำหรับลูกค้า",
  legal_terms: "ข้อกำหนดทางกฎหมาย",
  disclaimer: "ข้อความสงวนสิทธิ์",
} as const;

export const promotionWindows = {
  booking_from: "เริ่มจอง",
  booking_to: "สิ้นสุดจอง",
  transfer_from: "เริ่มโอน",
  transfer_to: "สิ้นสุดโอน",
} as const;

export const promotionAudiences: Record<string, string> = {
  general: "ลูกค้าทั่วไป",
  investor: "ผู้ลงทุน",
  livnex: "LivNex",
};

export const benefitLabels: Record<string, string> = {
  discount_amount: "ส่วนลดเป็นจำนวนเงิน",
  discount_pct: "ส่วนลดเป็นเปอร์เซ็นต์",
  free_transfer_fee: "ฟรีค่าธรรมเนียมโอน",
  free_common_fee: "ฟรีค่าส่วนกลาง",
  furniture: "เฟอร์นิเจอร์",
  cashback: "เงินคืน",
  rate_subsidy: "สนับสนุนดอกเบี้ย",
  gift: "ของแถม",
  other: "สิทธิประโยชน์อื่น",
};

export const benefitUnits: Record<string, string> = {
  THB: "บาท",
  percent: "เปอร์เซ็นต์",
  months: "เดือน",
  items: "รายการ",
};

export type BenefitItem = {
  benefit_type: string;
  benefit_value: string | null;
  benefit_unit: string | null;
  label: Localized;
};

export type PromotionReference = {
  id: string;
  public_id?: string;
  label: Localized;
  project_id?: string;
  member_project_count?: number;
  phase_count?: number;
  key?: string;
};

export type PromotionReferences = {
  projects?: PromotionReference[];
  brands?: PromotionReference[];
  project_groups?: PromotionReference[];
  commercial_types?: PromotionReference[];
  programmes?: PromotionReference[];
};

export function tierOf(row: {
  promotion_tier?: PromotionTier;
  owning_brand_id?: string | null;
  applies_via?: { scope_level: string };
}): PromotionTier {
  return row.promotion_tier ?? (row.owning_brand_id || row.applies_via?.scope_level === "brand" ? "brand" : "project");
}

export function benefitText(item: Pick<BenefitItem, "benefit_type" | "benefit_value" | "benefit_unit"> & { label?: Localized }) {
  const label = item.label?.th || benefitLabels[item.benefit_type] || "สิทธิประโยชน์อื่น";
  const hasValue = item.benefit_value != null && item.benefit_value !== "";
  const numeric = hasValue ? Number(item.benefit_value) : NaN;
  const amount = !hasValue
    ? ""
    : Number.isFinite(numeric)
      ? numeric.toLocaleString("th-TH", { maximumFractionDigits: 2 })
      : String(item.benefit_value);
  const unit = item.benefit_unit ? benefitUnits[item.benefit_unit] ?? "" : "";
  return `${label}${amount ? ` · ${amount}${unit ? ` ${unit}` : ""}` : ""}`;
}
