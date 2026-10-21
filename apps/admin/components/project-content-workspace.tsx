"use client";
import { useCallback, useEffect, useState } from "react";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { useContentLocation } from "./content-operations-shared";
import { ContentFacts, type ProjectFact, type RemFacts } from "./content-facts";
import { ContentBuildings, type Building } from "./content-buildings";
import { ContentContacts, type Contact } from "./content-contacts";
import { ContentNarrative, type NarrativeSection, type SellingPoint } from "./content-narrative";
import { FieldInfo, TranslationReviewPanel, useFieldCatalog, errorMessage, type Locales, type Translation } from "./content-common";

type Content = { facts: ProjectFact[]; rem: RemFacts & { buildings?: Building[] }; computed: Record<string, number | null>; buildings: Building[]; sections: NarrativeSection[]; selling_points: SellingPoint[]; contacts: Contact[]; translations: Translation[];
  readiness: { required_missing: number; ready: boolean; items: { field_key: string; point_key?: string; label: Locales; required: boolean; complete: boolean }[] } };
const tabs = { facts: "ข้อเท็จจริง", buildings: "อาคาร", narrative: "เนื้อหาและจุดขาย", contacts: "ช่องทางติดต่อ", english: "ภาษาอังกฤษ", readiness: "ความพร้อม" };
type Tab = keyof typeof tabs;
export function ProjectContentWorkspace({ projectId = "", brandId = "" }: { projectId?: string; brandId?: string }) {
  const permissions = useHubPermissions(), { catalog, error: catalogError } = useFieldCatalog();
  const brand = Boolean(brandId), id = brandId || projectId, tabKey = brand ? "brands" : "projects";
  const canEdit = permissions.can(tabKey, "edit");
  const [data, setData] = useState<Content | null>(null), [name, setName] = useState(""), [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const location = useContentLocation(editing);
  const queryTab = location.params.get("tab") as Tab;
  const tab: Tab = queryTab in tabs && (!brand || ["contacts", "english"].includes(queryTab)) ? queryTab : brand ? "contacts" : "facts";
  const base = `v1/admin/${tabKey}/${encodeURIComponent(id)}`;
  const reload = useCallback(async () => {
    const value = await request<Content>(`${base}/content`); setData(value);
  }, [base]);
  useEffect(() => {
    let active = true; setData(null); setError("");
    if (id && permissions.can(tabKey)) Promise.all([request<Content>(`${base}/content`), request<{ public_name: Locales }>(base)])
      .then(([value, entity]) => { if (active) { setData(value); setName(entity.public_name.th ?? id); } })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [base, id, tabKey]);
  const choices = Object.entries(tabs).filter(([key]) => !brand || ["contacts", "english"].includes(key)) as [Tab, string][];
  return <div className="content-workspace"><header className="content-header"><a href={brand ? `/?view=brands&brand=${encodeURIComponent(id)}` : id ? `/?project=${encodeURIComponent(id)}` : "/"}>กลับไปข้อมูล{brand ? "แบรนด์" : "โครงการ"}</a><h1>เนื้อหาเว็บไซต์{brand ? "แบรนด์" : "โครงการ"}</h1><p>{name || id}</p><p className="content-state">ฉบับร่างภายใน Hub · ยังไม่เผยแพร่บนเว็บไซต์</p>{!canEdit && <p>สิทธิ์ดูข้อมูลเท่านั้น</p>}{permissions.can("projects") && <p><a href="/content/fields">ทะเบียนฟิลด์และการใช้งานข้อมูล</a></p>}</header>
    {!id ? <section className="content-section"><p>เลือกโครงการจากหน้ารวม แล้วเปิด “เนื้อหาเว็บไซต์โครงการ”</p><a className="button secondary" href="/">เลือกโครงการ</a></section> : <>
      {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}</p>}
      {!data || !catalog ? !error && !catalogError && <p role="status">กำลังโหลดเนื้อหา…</p> : <>
        {editing && <p className="read-only-note" role="status">กำลังแก้ไขข้อมูล กรุณาบันทึกหรือยกเลิกก่อนเปลี่ยนแท็บ</p>}
        <nav className="content-tabs" aria-label="ส่วนเนื้อหา">{choices.map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} disabled={editing && tab !== key} onClick={() => location.navigate({ tab: key })}>{label}</button>)}</nav>
        <div key={tab}>
          {tab === "facts" && <ContentFacts projectId={id} facts={data.facts} rem={data.rem} computed={data.computed} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "buildings" && <ContentBuildings projectId={id} items={data.buildings} remBuildings={data.rem.buildings ?? []} remAsOf={data.rem.as_of} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "narrative" && <ContentNarrative projectId={id} sections={data.sections} points={data.selling_points} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "contacts" && <ContentContacts items={data.contacts} catalog={catalog} apiBase={`${base}/contacts`} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "english" && <TranslationReviewPanel items={data.translations} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "readiness" && <section className="content-section"><h2>ความพร้อมของเนื้อหาร่าง</h2><p>{data.readiness.required_missing ? `ยังขาดข้อมูลจำเป็น ${data.readiness.required_missing} รายการ` : "ข้อมูลจำเป็นครบตามทะเบียนฟิลด์"}</p><p className="field-help">การตรวจนี้ใช้เตรียมข้อมูล ยังไม่ใช่การอนุมัติหรือเผยแพร่เว็บไซต์</p><ul className="content-checklist">{data.readiness.items.map((item, index) => <li key={`${item.field_key}-${item.point_key ?? index}`}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span><div><div className="content-label"><strong>{item.label.th}</strong><FieldInfo field={catalog.items.find(field => field.field_key === item.field_key)} /></div><span>{item.complete ? "ข้อมูลครบ" : "ยังไม่ครบหรือถึงกำหนดตรวจ"} · {item.required ? "จำเป็น" : "แนะนำ / เพิ่มเติม"}</span></div></li>)}</ul></section>}
        </div>
      </>}
    </>}
  </div>;
}
