"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { workspaceText } from "@/lib/unified-workspace";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { useContentLocation } from "./content-operations-shared";
import { ContentFacts, type ProjectFact, type RemFacts } from "./content-facts";
import { ContentBuildings, type Building } from "./content-buildings";
import { ContentContacts, type Contact } from "./content-contacts";
import { ProjectAmenities } from "./project-amenities";
import { ContentNarrative, type NarrativeSection, type SellingPoint } from "./content-narrative";
import { ProjectCommercialWorkspace } from "./project-commercial-workspace";
import { WebsiteContentSources } from "./website-content-sources";
import { FieldInfo, TranslationReviewPanel, useFieldCatalog, errorMessage, type Locales, type Translation } from "./content-common";

type Content = { facts: ProjectFact[]; rem: RemFacts & { buildings?: Building[] }; computed: Record<string, number | null>; buildings: Building[]; sections: NarrativeSection[]; selling_points: SellingPoint[]; contacts: Contact[]; translations: Translation[];
  readiness: { required_missing: number; ready: boolean; items: { field_key: string; point_key?: string; label: Locales; required: boolean; complete: boolean }[] } };
const tabs = { facts: "ข้อเท็จจริง", buildings: "อาคาร", narrative: "เนื้อหาและจุดขาย", facilities: "ส่วนกลาง", features: "คุณสมบัติ", places: "ทำเล", contacts: "ช่องทางติดต่อ", commercial: "กฎหมายและการขาย", investor: "ผู้ลงทุน", website: "หลักฐานจากเว็บไซต์", english: "ภาษาอังกฤษ", readiness: "ความพร้อม" };
type Tab = keyof typeof tabs | "identity" | "supplementary";
export function ProjectContentWorkspace({ projectId = "", brandId = "", embedded = false, primary, supplementary, navigationBlocked = false, navigationPending = false, onEditingChange, onWorkflowChanged }: { projectId?: string; brandId?: string; embedded?: boolean; primary?: ReactNode; supplementary?: ReactNode; navigationBlocked?: boolean; navigationPending?: boolean; onEditingChange?: (value: boolean) => void; onWorkflowChanged?: () => void }) {
  const permissions = useHubPermissions(), { catalog, error: catalogError } = useFieldCatalog();
  const brand = Boolean(brandId), id = brandId || projectId, tabKey = brand ? "brands" : "projects";
  const canEdit = permissions.can(tabKey, "edit");
  const [data, setData] = useState<Content | null>(null), [name, setName] = useState(""), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [sourceEditing, setSourceEditing] = useState(false);
  const [entityId, setEntityId] = useState<string | undefined>(undefined);
  const [investorFactEditing, setInvestorFactEditing] = useState(false), [investorNarrativeEditing, setInvestorNarrativeEditing] = useState(false);
  const location = useContentLocation(editing || sourceEditing, !embedded);
  const tabKeyQuery = embedded ? "section" : "tab";
  useEffect(() => { onEditingChange?.(editing || sourceEditing); return () => onEditingChange?.(false); }, [editing, sourceEditing, onEditingChange]);
  const selectedTab = location.params.get(tabKeyQuery) as Tab;
  const queryTab = embedded && selectedTab === "website" ? "narrative" : selectedTab;
  const tab: Tab = queryTab === "identity" && primary ? "identity" : queryTab === "supplementary" && supplementary ? "supplementary" : queryTab in tabs && (!brand || ["contacts", "english"].includes(queryTab)) ? queryTab : primary ? "identity" : brand ? "contacts" : "facts";
  useEffect(() => { if (tab === "investor") setEditing(investorFactEditing || investorNarrativeEditing); }, [tab, investorFactEditing, investorNarrativeEditing]);
  const base = `v1/admin/${tabKey}/${encodeURIComponent(id)}`;
  const reload = useCallback(async () => {
    const value = await request<Content>(`${base}/content`); setData(value); onWorkflowChanged?.();
  }, [base, onWorkflowChanged]);
  useEffect(() => {
    let active = true; setData(null); setError("");
    if (id && permissions.can(tabKey)) Promise.all([request<Content>(`${base}/content`), request<{ id: string; public_name: Locales }>(base)])
      .then(([value, entity]) => { if (active) { setData(value); setEntityId(entity.id); setName(entity.public_name.th ?? id); } })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [base, id, tabKey]);
  const choices: [Tab, string][] = [...(primary ? [["identity", workspaceText.identity] as [Tab, string]] : []), ...(supplementary ? [["supplementary", workspaceText.supplementary] as [Tab, string]] : []), ...Object.entries(tabs).filter(([key]) => (!embedded || !["website", "readiness"].includes(key)) && (!brand || ["contacts", "english"].includes(key))) as [Tab, string][]];
  return <div className={`content-workspace${embedded ? " entity-embedded-content" : ""}`}><header className="content-header"><a href={brand ? `/?view=brands&brand=${encodeURIComponent(id)}` : id ? `/?project=${encodeURIComponent(id)}` : "/"}>กลับไปข้อมูล{brand ? "แบรนด์" : "โครงการ"}</a><h1>เนื้อหาเว็บไซต์{brand ? "แบรนด์" : "โครงการ"}</h1><p>{name || id}</p><p className="content-state">ฉบับร่างภายใน Hub · ยังไม่เผยแพร่บนเว็บไซต์</p>{permissions.can("projects") && <p><a href="/content/fields">ทะเบียนฟิลด์และการใช้งานข้อมูล</a></p>}</header>
    {!canEdit && <p className="read-only-note" role="status">{permissions.can(tabKey, "approve") ? "สิทธิ์ตรวจและอนุมัติข้อมูล" : "สิทธิ์ดูข้อมูลเท่านั้น"}</p>}
    {!id ? <section className="content-section"><p>เลือกโครงการจากหน้ารวม แล้วเปิด “เนื้อหาเว็บไซต์โครงการ”</p><a className="button secondary" href="/">เลือกโครงการ</a></section> : <>
      {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}</p>}
      {!data || !catalog ? !error && !catalogError && <p role="status">กำลังโหลดเนื้อหา…</p> : <>
        {editing && <p className="read-only-note" role="status">กำลังแก้ไขข้อมูล กรุณาบันทึกหรือยกเลิกก่อนเปลี่ยนแท็บ</p>}
        <nav className="content-tabs" aria-label="ส่วนเนื้อหา">{choices.map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} disabled={(editing || sourceEditing || navigationPending || navigationBlocked && !["identity", "supplementary"].includes(key)) && tab !== key} onClick={() => location.navigate({ [tabKeyQuery]: key, field: null, item: null })}>{label}</button>)}</nav>
        <div key={tab}>
          {tab === "identity" && primary}
          {tab === "supplementary" && supplementary}
          {embedded && !brand && !["identity", "supplementary", "english"].includes(tab) && <WebsiteContentSources projectId={id} section={tab} sections={data.sections} disabled={editing} onChanged={reload} onEditingChange={setSourceEditing} />}
          {tab === "website" && <WebsiteContentSources projectId={id} />}
          <div inert={sourceEditing}>
          {(tab === "facilities" || tab === "features" || tab === "places") && <ProjectAmenities key={`${id}:${tab}`} projectId={id} tab={tab} fields={catalog.items} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "facts" && <ContentFacts projectId={id} facts={data.facts} rem={data.rem} computed={data.computed} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "buildings" && <ContentBuildings projectId={id} projectRowId={entityId} items={data.buildings} remBuildings={data.rem.buildings ?? []} remAsOf={data.rem.as_of} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "narrative" && <ContentNarrative projectId={id} projectRowId={entityId} sections={data.sections} points={data.selling_points} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "contacts" && <ContentContacts items={data.contacts} catalog={catalog} apiBase={`${base}/contacts`} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "commercial" && <ProjectCommercialWorkspace projectId={id} fields={catalog.items} onEditingChange={setEditing} {...{ onWorkflowChanged }} />}
          {tab === "investor" && <><p className="inline-warning">ประมาณการ ไม่รับประกัน · ค่าเช่าคาดหมายต่อปี ÷ ราคา ณ วันที่ระบุ · เริ่มต้นใช้บนเว็บไซต์เท่านั้น</p>
            <div inert={investorNarrativeEditing}><ContentFacts projectId={id} facts={data.facts} rem={data.rem} computed={data.computed} fields={catalog.items.filter(field => field.field_key === "project.rental_yield_gross_pct")} canEdit={canEdit && !investorNarrativeEditing} onChanged={reload} onEditingChange={setInvestorFactEditing} /></div>
            <div inert={investorFactEditing}><ContentNarrative projectId={id} projectRowId={entityId} sections={data.sections} points={[]} fields={catalog.items.filter(field => field.field_key === "section.investor_intro")} showPoints={false} canEdit={canEdit && !investorFactEditing} onChanged={reload} onEditingChange={setInvestorNarrativeEditing} /></div>
          </>}
          {tab === "english" && <TranslationReviewPanel items={data.translations} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "readiness" && <section className="content-section"><h2>ความพร้อมของเนื้อหาร่าง</h2><p>{data.readiness.required_missing ? `ยังขาดข้อมูลจำเป็น ${data.readiness.required_missing} รายการ` : "ข้อมูลจำเป็นครบตามทะเบียนฟิลด์"}</p><p className="field-help">การตรวจนี้ใช้เตรียมข้อมูล ยังไม่ใช่การอนุมัติหรือเผยแพร่เว็บไซต์</p><ul className="content-checklist">{data.readiness.items.map((item, index) => <li key={`${item.field_key}-${item.point_key ?? index}`}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span><div><div className="content-label"><strong>{item.label.th}</strong><FieldInfo field={catalog.items.find(field => field.field_key === item.field_key)} /></div><span>{item.complete ? "ข้อมูลครบ" : "ยังไม่ครบหรือถึงกำหนดตรวจ"} · {item.required ? "จำเป็น" : "แนะนำ / เพิ่มเติม"}</span></div></li>)}</ul></section>}
          </div>
        </div>
      </>}
    </>}
  </div>;
}
