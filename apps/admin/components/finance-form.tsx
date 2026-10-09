"use client";
import { useHubPermissions } from "./accounts";
import { canFinanceAction } from "@/lib/hub-permissions";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { request } from "./hub-request";

export type RecordData = Record<string, unknown>;
export type Choice = { value: string; label: string };
export type Choices = Record<string, Choice[]>;
export type Field = { key: string; label: string; type?: "text" | "money" | "percent" | "month" | "date" | "datetime-local" | "integer" | "textarea" | "boolean" | "multi" | "object" | "rows"; required?: boolean; options?: Choice[]; choices?: string; fields?: Field[]; hint?: string; initial?: unknown; show?: (value: RecordData) => boolean };
export const str = (value: unknown) => value == null ? "" : String(value);
export const object = (value: unknown): RecordData => value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {};
export const records = (value: unknown): RecordData[] => Array.isArray(value) ? value.map(object) : [];
export const options = (values: Record<string, string>): Choice[] => Object.entries(values).map(([value, label]) => ({ value, label }));
export const f = (key: string, label: string, extra: Omit<Field, "key" | "label"> = {}): Field => ({ key, label, ...extra });
export function initialValues(fields: Field[], record: RecordData = {}): RecordData {
  return Object.fromEntries(fields.map(field => {
    const current = record[field.key] ?? field.initial;
    if (field.type === "object") return [field.key, initialValues(field.fields ?? [], object(current))];
    if (field.type === "rows") return [field.key, records(current).map(row => initialValues(field.fields ?? [], row))];
    if (field.type === "percent" && current != null) { const digits = str(current).padStart(3, "0"); return [field.key, `${Number(digits.slice(0, -2))}.${digits.slice(-2)}`]; }
    if (field.type === "datetime-local" && current) return [field.key, new Date(new Date(str(current)).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16)];
    return [field.key, current ?? (field.type === "multi" ? [] : field.type === "boolean" ? false : "")];
  }));
}
function payload(fields: Field[], value: RecordData): RecordData {
  const result: RecordData = {};
  for (const field of fields) {
    if (field.show && !field.show(value)) continue;
    const current = value[field.key];
    if (field.type === "object") result[field.key] = payload(field.fields ?? [], object(current));
    else if (field.type === "rows") result[field.key] = records(current).map(row => payload(field.fields ?? [], row));
    else if (field.type === "multi" || field.type === "boolean") result[field.key] = current;
    else if (str(current) !== "") {
      result[field.key] = field.type === "percent" ? Number(`${str(current).split(".")[0]}${(str(current).split(".")[1] ?? "").padEnd(2, "0")}`) : field.type === "integer" ? Number(current) : field.type === "month" ? `${str(current).slice(0, 7)}-01` : field.type === "datetime-local" ? `${str(current).slice(0, 19)}${str(current).length === 16 ? ":00" : ""}+07:00` : current;
    }
  }
  return result;
}

function Fields({ fields, value, setValue, choices, prefix, errors }: { fields: Field[]; value: RecordData; setValue: (value: RecordData) => void; choices: Choices; prefix: string; errors: Record<string, string> }) {
  const update = (key: string, next: unknown) => setValue({ ...value, [key]: next });
  return <div className="finance-grid">{fields.filter(field => !field.show || field.show(value)).map(field => {
    const id = `${prefix}-${field.key}`;
    const available = field.options ?? (field.choices ? choices[field.choices] ?? [] : undefined);
    const error = errors[id];
    if (field.type === "object") return <fieldset className="finance-fieldset" key={id}><legend>{field.label}</legend>{field.hint && <p className="finance-caption">{field.hint}</p>}<Fields fields={field.fields ?? []} value={object(value[field.key])} setValue={next => update(field.key, next)} choices={choices} prefix={id} errors={errors} /></fieldset>;
    if (field.type === "rows") {
      const rows = records(value[field.key]);
      return <fieldset className="finance-fieldset" key={id}><legend>{field.label}</legend>{field.hint && <p className="finance-caption">{field.hint}</p>}{rows.map((row, index) => <div className="finance-repeat" key={index}><p className="mb-3">{field.label} {index + 1}</p><Fields fields={field.fields ?? []} value={row} setValue={next => update(field.key, rows.map((item, i) => i === index ? next : item))} choices={choices} prefix={`${id}-${index}`} errors={errors} /><button className="registry-button mt-3" type="button" onClick={() => update(field.key, rows.filter((_, i) => i !== index))}>นำ{field.label} {index + 1} ออกจากร่าง</button></div>)}<button className="registry-button mt-3" type="button" onClick={() => update(field.key, [...rows, initialValues(field.fields ?? [])])}>เพิ่ม{field.label}</button></fieldset>;
    }
    if (field.type === "multi") return <fieldset className="finance-fieldset" key={id}><legend>{field.label}</legend>{field.hint && <p className="finance-caption">{field.hint}</p>}{available?.map(option => <label className="registry-check" key={option.value}><input type="checkbox" checked={(value[field.key] as string[] ?? []).includes(option.value)} onChange={event => update(field.key, event.target.checked ? [...value[field.key] as string[] ?? [], option.value] : (value[field.key] as string[] ?? []).filter(item => item !== option.value))} />{option.label}</label>)}{!available?.length && <p>ยังไม่มีรายการให้เลือก</p>}</fieldset>;
    if (field.type === "boolean") return <label className="registry-check" key={id}><input id={id} type="checkbox" checked={Boolean(value[field.key])} onChange={event => update(field.key, event.target.checked)} />{field.label}</label>;
    const common = { id, name: field.key, className: "registry-input", required: field.required, value: str(value[field.key]), "aria-invalid": error ? true as const : undefined, "aria-describedby": `${id}-hint${error ? ` ${id}-error` : ""}`, onChange: (event: { target: { value: string } }) => update(field.key, event.target.value) };
    return <div className="finance-field" key={id}><label htmlFor={id}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>{available ? <select {...common}><option value="">เลือกข้อมูล</option>{available.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea {...common} rows={3} /> : <input {...common} type={field.type === "money" || field.type === "percent" || field.type === "integer" ? "text" : field.type ?? "text"} value={field.type === "month" ? str(value[field.key]).slice(0, 7) : str(value[field.key])} inputMode={field.type === "money" || field.type === "percent" ? "decimal" : field.type === "integer" ? "numeric" : undefined} pattern={field.type === "percent" ? "(?:100(?:\\.0{1,2})?|(?:[0-9]|[1-9][0-9])(?:\\.[0-9]{1,2})?)" : field.type === "money" ? "(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" : field.type === "integer" ? "[0-9]+" : undefined} autoComplete="off" />}<small id={`${id}-hint`}>{field.hint ?? (field.type === "money" ? "บาท · ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่ใส่เครื่องหมายคั่นหลักพัน" : field.type === "datetime-local" ? "เวลาประเทศไทย (Asia/Bangkok)" : !field.required ? "ไม่บังคับ" : "จำเป็นต้องระบุ")}</small>{error && <p className="finance-inline-error" id={`${id}-error`}>{error}</p>}</div>;
  })}</div>;
}

export function FinanceForm({ title, submitLabel = "บันทึกร่าง", path, method = "POST", fields, choices, initial = {}, fixed = {}, note, onSaved, onDirty }: { title: string; submitLabel?: string; path: string; method?: string; fields: Field[]; choices: Choices; initial?: RecordData; fixed?: RecordData; note?: string; onSaved: (record: RecordData) => void; onDirty: (value: boolean) => void }) {
  const [value, setValue] = useState(() => initialValues(fields, initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const prefix = useId();
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  const permissions = useHubPermissions();
  const permitted = canFinanceAction(permissions.capabilities, path, { ...value, review_status: initial.review_status === "CONFIRMED" ? "CONFIRMED" : value.review_status });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permitted) { setError("ไม่มีสิทธิ์ดำเนินการนี้ ข้อความที่กรอกยังอยู่"); return; }
    const invalid = Array.from(event.currentTarget.elements).filter(item => item instanceof HTMLInputElement || item instanceof HTMLSelectElement || item instanceof HTMLTextAreaElement).filter(item => !(item as HTMLInputElement).validity.valid) as HTMLInputElement[];
    if (invalid.length) {
      setErrors(Object.fromEntries(invalid.map(item => [item.id, item.validity.valueMissing ? "กรุณาระบุข้อมูล" : "กรุณาตรวจสอบรูปแบบข้อมูล"] ))); setError("กรุณาตรวจสอบช่องที่ระบุด้านล่างก่อนบันทึก"); return;
    }
    setBusy(true); setError(""); setErrors({});
    try {
      const body = payload(fields, value);
      if (method === "PATCH") for (const field of fields) if (!field.required && initial[field.key] != null && !str(value[field.key]) && field.type !== "object" && field.type !== "rows" && field.type !== "multi") body[field.key] = null;
      const result = await request<RecordData>(path, method, { ...body, ...fixed }); onDirty(false); onSaved(result);
    }
    catch (err) { setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} noValidate className="registry-panel"><h3>{title}</h3>{note && <p className="finance-caption mb-4">{note}</p>}{error && <div className="registry-error" role="alert" ref={summary} tabIndex={-1}><strong>{error}</strong>{Object.entries(errors).map(([id, text]) => <p key={id}><a href={`#${id}`}>{(document.getElementById(id) as HTMLInputElement | null)?.labels?.[0]?.textContent ?? "ช่องข้อมูล"}: {text}</a></p>)}</div>}<fieldset disabled={busy} className="border-0 p-0 min-w-0"><Fields fields={fields} value={value} setValue={next => { setValue(next); onDirty(true); }} choices={choices} prefix={prefix} errors={errors} /><div className="finance-actions"><button className="registry-button primary" aria-busy={busy} disabled={busy || !permitted}>{busy ? "กำลังบันทึก…" : submitLabel}</button></div></fieldset></form>;
}
