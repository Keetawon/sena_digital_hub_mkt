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
const tabs = { narrative: "เนื้อหาและจุดขาย", facts: "ข้อเท็จจริง", buildings: "อาคาร", facilities: "ส่วนกลาง", features: "คุณสมบัติ", places: "ทำเล", contacts: "ช่องทางติดต่อ", commercial: "กฎหมายและการขาย", investor: "ผู้ลงทุน", website: "หลักฐานจากเว็บไซต์", english: "ภาษาอังกฤษ", readiness: "ความพร้อม" };
type Tab = keyof typeof tabs | "identity" | "supplementary";
const sectionHints: Record<Tab, { title: string; detail: string }> = {
  identity: { title: "ข้อมูลหลักและพิกัด", detail: "ตรวจชื่อการตลาด URL Slug ที่อยู่ พิกัดแผนที่ และการผูกแบรนด์จากต้นทาง" },
  narrative: { title: "เรื่องเล่าและจุดขายหลัก", detail: "เขียนบทนำโครงการ แนวคิดการออกแบบ และจุดขายเด่นสำหรับหน้าเว็บและ AI" },
  facts: { title: "ข้อเท็จจริงตัวเลขของเฟสนี้", detail: "ตรวจจำนวนยูนิต พื้นที่โครงการ ที่จอดรถ และค่าส่วนกลางเทียบกับข้อมูล REM" },
  buildings: { title: "อาคารและจำนวนชั้น", detail: "ระบุรายชื่ออาคาร จำนวนชั้น และจำนวนยูนิตต่ออาคารสำหรับเชื่อมผังชั้นและรูปภาพ" },
  facilities: { title: "สิ่งอำนวยความสะดวกส่วนกลาง", detail: "เลือกและอธิบายพื้นที่ส่วนกลาง เช่น สระว่ายน้ำ ฟิตเนส Co-working และระบบรักษาความปลอดภัย" },
  features: { title: "คุณสมบัติเด่นและนวัตกรรม", detail: "ระบุจุดเด่นด้านพลังงานสะอาด SENA Solar นวัตกรรมการอยู่อาศัย และมาตรฐานโครงการ" },
  places: { title: "ทำเลและสถานที่ใกล้เคียง", detail: "เพิ่มสถานีรถไฟฟ้า ทางด่วน ห้างสรรพสินค้า โรงพยาบาล และสถานศึกษาพร้อมระยะทาง" },
  supplementary: { title: "ข้อมูลเสริมและ SEO เดิม", detail: "ตรวจทานข้อมูล Meta Title / Meta Description และรายการสิ่งอำนวยความสะดวกชุดเดิม" },
  contacts: { title: "ช่องทางติดต่อโครงการ", detail: "กำหนดเบอร์โทรสำนักงานขาย LINE Official แผนที่นำทาง และอีเมลติดต่อ" },
  commercial: { title: "ข้อมูลขาย กฎหมาย และความคืบหน้าก่อสร้าง", detail: "บันทึกข้อมูลโฉนด/EIA โปรแกรมบริการ (LivNex/RentNex) และเปอร์เซ็นต์งานก่อสร้าง" },
  investor: { title: "ข้อมูลสำหรับผู้ลงทุน", detail: "ระบุประมาณการผลตอบแทนค่าเช่า (Gross Rental Yield) และคำแนะนำการลงทุน" },
  website: { title: "หลักฐานเนื้อหาจากเว็บไซต์เดิม", detail: "คัดเลือกข้อความจากหน้าเว็บเดิมเพื่อนำมาปรับใช้หรือปฏิเสธพร้อมเหตุผล" },
  english: { title: "ตรวจทานคำแปลภาษาอังกฤษ", detail: "ตรวจและยืนยันคำแปลภาษาอังกฤษทุกรายการก่อนส่งเนื้อหาให้ผู้อนุมัติ" },
  readiness: { title: "สรุปความพร้อมของเนื้อหาร่าง", detail: "ตรวจสอบรายการฟิลด์บังคับและฟิลด์แนะนำตามทะเบียนฟิลด์" },
};
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
  const tab: Tab = queryTab === "identity" && primary ? "identity" : queryTab === "supplementary" && supplementary ? "supplementary" : queryTab in tabs && (!brand || ["narrative", "contacts", "english"].includes(queryTab)) ? queryTab : primary ? "identity" : brand ? "narrative" : "facts";
  useEffect(() => { if (tab === "investor") setEditing(investorFactEditing || investorNarrativeEditing); }, [tab, investorFactEditing, investorNarrativeEditing]);
  const base = `v1/admin/${tabKey}/${encodeURIComponent(id)}`;
  const reload = useCallback(async () => {
    const value = await request<Content>(`${base}/content`);
    setData({ ...value, sections: value.sections ?? [], selling_points: value.selling_points ?? [], contacts: value.contacts ?? [], translations: value.translations ?? [] });
    onWorkflowChanged?.();
  }, [base, onWorkflowChanged]);
  useEffect(() => {
    let active = true; setData(null); setError("");
    if (id && permissions.can(tabKey)) Promise.all([request<Content>(`${base}/content`), request<{ id: string; public_name: Locales }>(base)])
      .then(([value, entity]) => { if (active) { setData({ ...value, sections: value.sections ?? [], selling_points: value.selling_points ?? [], contacts: value.contacts ?? [], translations: value.translations ?? [] }); setEntityId(entity.id); setName(entity.public_name?.th ?? id); } })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [base, id, tabKey]);
  const orderedProjectKeys: Tab[] = [
    ...(primary ? (["identity"] as Tab[]) : []),
    "narrative", "facts", "buildings",
    "facilities", "features", "places",
    ...(supplementary ? (["supplementary"] as Tab[]) : []),
    "contacts", "commercial", "investor",
    ...(!embedded ? (["website"] as Tab[]) : []),
    "english",
    ...(!embedded ? (["readiness"] as Tab[]) : []),
  ];
  const orderedBrandKeys: Tab[] = [
    ...(primary ? (["identity"] as Tab[]) : []),
    "narrative", "contacts", "english",
  ];
  const activeOrder = brand ? orderedBrandKeys : orderedProjectKeys;
  const choices: [Tab, string][] = activeOrder.map((key): [Tab, string] => [
    key,
    key === "identity" ? workspaceText.identity
      : key === "supplementary" ? workspaceText.supplementary
      : brand && key === "narrative" ? "เนื้อหา KM แบรนด์"
      : tabs[key as keyof typeof tabs],
  ]);
  const stepGroups: { id: string; title: string; subtitle: string; members: Tab[]; badge: string; done: boolean }[] = data ? (brand ? [
    ...(primary ? [{ id: "brand-identity", title: "ข้อมูลหลักและโลโก้", subtitle: "ชื่อแบรนด์ คำอธิบาย และโลโก้หลัก", members: ["identity"] as Tab[], badge: "ตัวตนแบรนด์", done: true }] : []),
    { id: "brand-narrative", title: "เนื้อหา KM แบรนด์", subtitle: "เรื่องเล่าและจุดยืนแบรนด์", members: ["narrative"], badge: `${data.sections.length} หมวด`, done: data.sections.length > 0 },
    { id: "brand-contacts", title: "ช่องทางติดต่อแบรนด์", subtitle: "เบอร์โทร LINE และโซเชียล", members: ["contacts"], badge: `${data.contacts.length} ช่องทาง`, done: data.contacts.length > 0 },
    { id: "brand-english", title: "ภาษาอังกฤษ", subtitle: "ตรวจคำแปลก่อนส่งอนุมัติ", members: ["english"], badge: `${data.translations.length} รายการ`, done: data.translations.length === 0 || data.translations.every(t => t.translation_state === "reviewed") },
  ] : [
    ...(primary ? [{ id: "prj-identity", title: "ตัวตนและพิกัดโครงการ", subtitle: "ชื่อโครงการ ที่อยู่ แผนที่ และแบรนด์", members: ["identity"] as Tab[], badge: "ข้อมูลหลัก", done: true }] : []),
    { id: "prj-story", title: "เรื่องเล่าและข้อมูลจำเพาะ", subtitle: "จุดขาย ตัวเลขยูนิต และอาคาร", members: ["narrative", "facts", "buildings"], badge: `${data.sections.length + data.selling_points.length + data.facts.length + data.buildings.length} รายการ`, done: data.sections.length > 0 && data.facts.length > 0 },
    { id: "prj-living", title: "ส่วนกลาง คุณสมบัติ และทำเล", subtitle: "Facility โซลาร์ สถานที่ใกล้เคียง", members: ["facilities", "features", "places", ...(supplementary ? (["supplementary"] as Tab[]) : [])], badge: supplementary ? "4 หมวดย่อย" : "3 หมวดย่อย", done: false },
    { id: "prj-commercial", title: "ติดต่อ กฎหมาย และการลงทุน", subtitle: "เบอร์ติดต่อ โฉนด/ก่อสร้าง Yield", members: ["contacts", "commercial", "investor"], badge: `${data.contacts.length} ช่องทาง`, done: data.contacts.length > 0 },
    { id: "prj-english", title: "ตรวจทานภาษาอังกฤษ", subtitle: "ยืนยันคำแปลก่อนส่งอนุมัติ", members: ["english", ...(!embedded ? (["website", "readiness"] as Tab[]) : [])], badge: `${data.translations.length} รายการ`, done: data.translations.length === 0 || data.translations.every(t => t.translation_state === "reviewed") },
  ]) : [];
  const activeGroup = stepGroups.find(group => group.members.includes(tab));
  const choiceIdx = choices.findIndex(([key]) => key === tab);
  const prevChoice = choiceIdx > 0 ? choices[choiceIdx - 1] : null;
  const nextChoice = choiceIdx >= 0 && choiceIdx < choices.length - 1 ? choices[choiceIdx + 1] : null;
  const canNavigateTo = (targetKey: Tab) => !(editing || sourceEditing || navigationPending || (navigationBlocked && !["identity", "supplementary"].includes(targetKey)));
  return <div className={`content-workspace${embedded ? " entity-embedded-content" : ""}`}><header className="content-header"><a href={brand ? `/?view=brands&brand=${encodeURIComponent(id)}` : id ? `/?project=${encodeURIComponent(id)}` : "/"}>กลับไปข้อมูล{brand ? "แบรนด์" : "โครงการ"}</a><h1>เนื้อหาเว็บไซต์{brand ? "แบรนด์" : "โครงการ"}</h1><p>{name || id}</p><p className="content-state">ฉบับร่างภายใน Hub · ยังไม่เผยแพร่บนเว็บไซต์</p>{permissions.can("projects") && <p><a href="/content/fields">ทะเบียนฟิลด์และการใช้งานข้อมูล</a></p>}</header>
    {!canEdit && <p className="read-only-note" role="status">{permissions.can(tabKey, "approve") ? "สิทธิ์ตรวจและอนุมัติข้อมูล" : "สิทธิ์ดูข้อมูลเท่านั้น"}</p>}
    {!id ? <section className="content-section"><p>เลือกโครงการจากหน้ารวม แล้วเปิด “เนื้อหาเว็บไซต์โครงการ”</p><a className="button secondary" href="/">เลือกโครงการ</a></section> : <>
      {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}</p>}
      {!data || !catalog ? !error && !catalogError && <p role="status">กำลังโหลดเนื้อหา…</p> : <>
        {editing && <p className="read-only-note" role="status">กำลังแก้ไขข้อมูล กรุณาบันทึกหรือยกเลิกก่อนเปลี่ยนแท็บ</p>}
        {stepGroups.length > 1 && (
          <div className="km-step-groups" role="group" aria-label={brand ? "ขั้นตอนข้อมูลแบรนด์" : "ขั้นตอนข้อมูลโครงการ"}>
            {stepGroups.map((group, idx) => {
              const firstMember = group.members[0];
              const isCurrentGroup = group.members.includes(tab);
              return (
                <button
                  type="button"
                  key={group.id}
                  className="km-step-group-btn"
                  aria-pressed={isCurrentGroup}
                  disabled={!canNavigateTo(firstMember) && !isCurrentGroup}
                  onClick={() => { if (!isCurrentGroup && canNavigateTo(firstMember)) location.navigate({ [tabKeyQuery]: firstMember, field: null, item: null }); }}
                >
                  <span className="km-step-group-top">
                    <span className="km-step-group-num">ขั้นที่ {idx + 1}</span>
                    <span className={`km-step-group-badge ${group.done ? "is-done" : ""}`}>{group.badge}</span>
                  </span>
                  <span className="km-step-group-title">{group.title}</span>
                  <span className="km-step-group-sub">{group.subtitle}</span>
                </button>
              );
            })}
          </div>
        )}
        <nav className="content-tabs" aria-label="ส่วนเนื้อหา">{choices.map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} data-in-active-group={activeGroup ? String(activeGroup.members.includes(key)) : undefined} disabled={!canNavigateTo(key) && tab !== key} onClick={() => location.navigate({ [tabKeyQuery]: key, field: null, item: null })}>{label}</button>)}</nav>
        {!(brand && tab === "identity") && (
          <div className="km-section-guide">
            <div>
              <strong>{brand && tab === "narrative" ? "เนื้อหา KM แบรนด์" : sectionHints[tab].title}</strong>
              <p>{brand && tab === "narrative" ? "เขียนเรื่องเล่า จุดยืนแบรนด์ และแนวคิดหลักที่ใช้ร่วมกันบนหน้าแบรนด์และผู้ช่วย AI" : sectionHints[tab].detail}</p>
            </div>
            <span className="km-code-badge">หมวด {choiceIdx + 1}/{choices.length}</span>
          </div>
        )}
        <div key={tab}>
          {tab === "identity" && primary}
          {tab === "supplementary" && supplementary}
          {embedded && !brand && !["identity", "supplementary", "english"].includes(tab) && <WebsiteContentSources projectId={id} section={tab} sections={data.sections} disabled={editing} onChanged={reload} onEditingChange={setSourceEditing} />}
          {tab === "website" && <WebsiteContentSources projectId={id} />}
          <div inert={sourceEditing}>
          {(tab === "facilities" || tab === "features" || tab === "places") && <ProjectAmenities key={`${id}:${tab}`} projectId={id} tab={tab} fields={catalog.items} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "facts" && <ContentFacts projectId={id} facts={data.facts} rem={data.rem} computed={data.computed} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "buildings" && <ContentBuildings projectId={id} projectRowId={entityId} items={data.buildings} remBuildings={data.rem.buildings ?? []} remAsOf={data.rem.as_of} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
          {tab === "narrative" && <ContentNarrative projectId={brand ? "" : id} projectRowId={brand ? undefined : entityId} apiBase={brand ? base : undefined} heading={brand ? "เนื้อหา KM แบรนด์" : undefined} sections={data.sections} points={brand ? [] : data.selling_points} showPoints={!brand} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
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
        {choices.length > 1 && !(brand && tab === "identity") && (
          <div className="km-substep-bar">
            <p className="km-substep-bar-note">
              หมวดย่อยที่ {choiceIdx + 1} จาก {choices.length}: <strong>{choices[choiceIdx]?.[1]}</strong>
            </p>
            <div className="km-substep-actions">
              {prevChoice && (
                <button type="button" className="button secondary" disabled={!canNavigateTo(prevChoice[0])} onClick={() => location.navigate({ [tabKeyQuery]: prevChoice[0], field: null, item: null })}>
                  ← {prevChoice[1]}
                </button>
              )}
              {nextChoice && (
                <button type="button" className="button secondary" disabled={!canNavigateTo(nextChoice[0])} onClick={() => location.navigate({ [tabKeyQuery]: nextChoice[0], field: null, item: null })}>
                  หมวดถัดไป: {nextChoice[1]} →
                </button>
              )}
            </div>
          </div>
        )}
      </>}
    </>}
  </div>;
}
