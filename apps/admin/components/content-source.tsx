"use client";

import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { dateTime } from "./content-operations-shared";
import { DemoFields } from "./demo-fields";
import { object, records, str, type RecordData } from "./finance-form";

// Citation links select an exact read-only revision. They never fall through to
// the ordinary draft editor when a source has changed or cannot be read.
export function ContentSource({ kind, publicId, version, draftAt, allowed }: { kind: "project" | "brand"; publicId: string; version: string | null; draftAt: string | null; allowed: boolean }) {
  const [source, setSource] = useState<RecordData | null>(null); const [sourceAt, setSourceAt] = useState<string | null>(null); const [published, setPublished] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!allowed) { setError("ไม่มีสิทธิ์อ่านแหล่งข้อมูลนี้"); return; }
    const base = `v1/admin/${kind === "project" ? "projects" : "brands"}/${encodeURIComponent(publicId)}`;
    void (async () => {
      try {
        if ((!version && !draftAt) || Boolean(version && draftAt)) throw new Error("ลิงก์ไม่ได้ระบุรุ่นข้อมูลที่ชัดเจน");
        const current = await request<RecordData>(base);
        if (draftAt) {
          if (current.updated_at !== draftAt) throw new Error("ฉบับร่างเปลี่ยนไปจากที่อ้างอิงแล้ว กรุณาถามผู้ช่วยใหม่เพื่อใช้ข้อมูลล่าสุด");
          if (active) { setSource(current); setSourceAt(draftAt); }
        } else {
          const versions = await request<RecordData[]>(`${base}/versions`); const selected = versions.find(item => item.version_id === version);
          if (!selected || !selected.payload) throw new Error("ไม่พบรุ่นข้อมูลที่อ้างอิงและมีสิทธิ์เข้าถึง ระบบไม่แสดงฉบับร่างแทน");
          if (active) { setSource(object(selected.payload)); setSourceAt(str(selected.published_at)); setPublished(current.published_version_id === version && current.publication_available === true); }
        }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "โหลดแหล่งข้อมูลไม่สำเร็จ"); }
    })();
    return () => { active = false; };
  }, [allowed, draftAt, kind, publicId, version]);
  const fields = kind === "project" ? { public_name: "ชื่อโครงการ", meta_title: "ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล", meta_description: "คำอธิบายย่อ", address: "ที่อยู่", ad_disclaimer: "ข้อความกำกับโฆษณา" } : { public_name: "ชื่อแบรนด์", description: "คำอธิบายแบรนด์" };
  return <section className="panel"><div className="panel-heading"><div><h1>แหล่งข้อมูลที่อ้างอิง</h1><p>{kind === "project" ? "โครงการ" : "แบรนด์"} · <code>{publicId}</code> · อ่านอย่างเดียว</p></div></div><div className="panel-body">{error ? <p role="alert" className="notice error">{error}</p> : !source ? <p role="status" className="hub-loading">กำลังตรวจรุ่นข้อมูลที่อ้างอิง…</p> : <><p className="read-only-note">{draftAt ? "ฉบับร่าง ณ เวลาที่อ้างอิง" : published ? "ฉบับเผยแพร่ที่อ้างอิง" : "ฉบับย้อนหลังที่อ้างอิง · ไม่ใช่ฉบับเผยแพร่ปัจจุบัน"}</p><p>รุ่น <code>{version ?? `draft:${draftAt}`}</code><br />ข้อมูล ณ {sourceAt ? dateTime(sourceAt) : "ยังไม่ทราบ"}</p><DemoFields fields={source.demo_fields} /><dl className="snapshot-list">{Object.entries(fields).map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{str(object(source[field]).th) || "ยังไม่มีข้อมูลในรุ่นนี้"}</dd></div>)}</dl>{kind === "project" && <section><h2>แบบที่อยู่อาศัยในรุ่นนี้</h2>{records(source.models).length ? records(source.models).map((model, index) => <article className="model-card" key={str(model.public_model_id) || index}><h3>{str(object(model.public_name).th) || str(model.rem_model_id) || "แบบที่ยังไม่มีชื่อ"}</h3><dl className="snapshot-list">{Object.entries({ public_model_id: "รหัสแบบ", rem_model_id: "รหัสแบบ REM", bedrooms: "ห้องนอน", bathrooms: "ห้องน้ำ", usable_area_sqm: "พื้นที่ใช้สอย (ตารางเมตร)", parking_spaces: "ที่จอดรถ" }).map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{model[field] == null ? "ยังไม่มีข้อมูล" : String(model[field])}</dd></div>)}</dl></article>) : <p>ยังไม่มีรายการแบบในรุ่นนี้</p>}</section>}</>}<a className="button secondary" href={`/?${kind}=${encodeURIComponent(publicId)}`}>เปิดหน้าทำงานข้อมูลปัจจุบัน</a></div></section>;
}
