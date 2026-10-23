"use client";
import type { ReactNode } from "react";
import { BilingualInput, ContentLabel, type ContentField, type Locales } from "./content-common";

export type AmenityRow = { id?: string; code?: string; revision: number; [key: string]: unknown };
export type MetricDef = { type: "number" | "integer" | "text" | "enum"; label: Locales; unit?: string; min?: number; max?: number; required?: boolean; options?: string[] };
export type FeatureDefinition = AmenityRow & { code: string; label: Locales; explanation: Locales; category: string; active: boolean; metric_defs: Record<string, MetricDef> };
export type References = { rail_lines: AmenityRow[]; rail_stations: AmenityRow[]; expressways: AmenityRow[]; expressway_ramps: AmenityRow[]; features: FeatureDefinition[]; facilities: AmenityRow[] };
export const localized = (row: AmenityRow, key: string): Locales => (row[key] && typeof row[key] === "object" ? row[key] : {}) as Locales;
export const stringValue = (row: AmenityRow, key: string) => row[key] == null ? "" : String(row[key]);
export const presence = { unknown: "ยังไม่ทราบ", present: "มี", absent: "ไม่มี", planned: "อยู่ในแผน" };
export const placeStatus = { operating: "เปิดใช้งาน", construction: "กำลังก่อสร้าง", planned: "อยู่ในแผน" };
export const placeCategories = { rail: "รถไฟฟ้า", expressway: "ทางด่วน", mall: "ศูนย์การค้า", school: "โรงเรียน", university: "มหาวิทยาลัย", hospital: "โรงพยาบาล", airport: "สนามบิน", park: "สวนสาธารณะ", office: "สำนักงาน", market: "ตลาด" };

export function AmenityField({ entity, name, fields, children, label }: { entity: string; name: string; fields: ContentField[]; children: ReactNode; label?: string }) {
  const registryName = entity === "facility_taxonomy" ? ({ group_code: "group", icon_code: "icon" } as Record<string, string>)[name] ?? name : name;
  return <div className="content-input"><ContentLabel htmlFor={`c4-${entity}-${name}`} field={fields.find(f => f.field_key === `${entity}.${registryName}`)}>{label}</ContentLabel>{children}</div>;
}
export function AmenityText({ row, entity, name, fields, change, manual = false }: { row: AmenityRow; entity: string; name: string; fields: ContentField[]; change: (key: string, value: unknown) => void; manual?: boolean }) {
  const field = fields.find(f => f.field_key === `${entity}.${name}`);
  return <BilingualInput id={`c4-${entity}-${name}`} field={field} value={localized(row, name)} onChange={value => change(name, value)} maxLength={field?.validation.max_length ?? 2000} rows={name === "detail" || name === "assumptions" ? 4 : 2} translationHint={!manual} />;
}
export function AmenityNumber({ row, entity, name, fields, change, required, min = 0, max, step = "any" }: { row: AmenityRow; entity: string; name: string; fields: ContentField[]; change: (key: string, value: unknown) => void; required?: boolean; min?: number; max?: number; step?: string }) {
  const field = fields.find(f => f.field_key === `${entity}.${name}`);
  return <AmenityField {...{ entity, name, fields }} label={field?.unit ? `${field.label.th ?? name} (${field.unit})` : undefined}><input id={`c4-${entity}-${name}`} type="number" min={min} max={max} step={step} required={required} value={stringValue(row, name)} onChange={e => change(name, e.target.value === "" ? null : Number(e.target.value))} /></AmenityField>;
}
export function AmenitySelect({ row, entity, name, fields, change, choices, required = false }: { row: AmenityRow; entity: string; name: string; fields: ContentField[]; change: (key: string, value: unknown) => void; choices: Record<string, string>; required?: boolean }) {
  return <AmenityField {...{ entity, name, fields }}><select id={`c4-${entity}-${name}`} required={required} value={stringValue(row, name)} onChange={e => change(name, e.target.value || null)}><option value="">ยังไม่ระบุ</option>{Object.entries(choices).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></AmenityField>;
}
export function AmenityDate({ row, entity, name, fields, change, required }: { row: AmenityRow; entity: string; name: string; fields: ContentField[]; change: (key: string, value: unknown) => void; required?: boolean }) {
  return <AmenityField {...{ entity, name, fields }}><input id={`c4-${entity}-${name}`} type="date" required={required} value={stringValue(row, name)} onChange={e => change(name, e.target.value || null)} /></AmenityField>;
}

export function FeatureMetrics({ definition, row, change }: { definition?: FeatureDefinition; row: AmenityRow; change: (key: string, value: unknown) => void }) {
  const metrics = (row.metrics ?? {}) as Record<string, string | number | Locales>;
  function update(key: string, value: unknown) { const next = { ...metrics }; if (value === null || value === "") delete next[key]; else next[key] = value as string | number | Locales; change("metrics", next); }
  return <fieldset><legend>ตัวชี้วัดตามนิยามคุณสมบัติ</legend>{Object.entries(definition?.metric_defs ?? {}).map(([key, def]) => {
    const label = `${def.label.th ?? key}${def.unit ? ` (${def.unit})` : ""}`, id = `c4-metric-${key}`;
    if (def.type === "text") return <BilingualInput key={key} id={id} label={label} value={(metrics[key] ?? {}) as Locales} onChange={value => update(key, value)} rows={2} translationHint={false} />;
    return <label className="content-input" key={key} htmlFor={id}>{label}{def.type === "enum" ? <select id={id} value={String(metrics[key] ?? "")} required={def.required && row.status === "present"} onChange={e => update(key, e.target.value)}><option value="">ยังไม่ระบุ</option>{def.options?.map(option => <option key={option}>{option}</option>)}</select>
      : <input id={id} type="number" min={def.min} max={def.max} step={def.type === "integer" ? "1" : "any"} required={def.required && row.status === "present"} value={String(metrics[key] ?? "")} onChange={e => update(key, e.target.value === "" ? null : Number(e.target.value))} />}</label>;
  })}{!Object.keys(definition?.metric_defs ?? {}).length && <p>คุณสมบัตินี้ไม่มีตัวชี้วัดเพิ่มเติม</p>}</fieldset>;
}
