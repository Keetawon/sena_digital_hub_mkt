"use client";
import { useEffect, useState, type FormEvent } from "react";
import { request } from "./hub-request";
import { bangkokISO, dateTime, ErrorSummary, Field, localBangkok } from "./content-operations-shared";
import { workspaceName, workspaceText as text } from "@/lib/unified-workspace";
import { contentScopeText } from "@/lib/content-scope-text";
import { benefitLabels, benefitText, benefitUnits, promotionTextFields as textFields, promotionTiers, promotionWindows as windows, tierOf, type BenefitItem, type PromotionReferences, type PromotionTier } from "./promotion-types";
import type { Promotion, Project, Brand, SuggestionInput } from "./promotions-workspace";
import type { CommercialPromotion, PromotionScope } from "./promotion-commercial-fields";

const examples: Record<PromotionTier, string> = { campaign: "เสนาซื้อง่าย จ่าย 0 บาท* · 11.11", corporate: "LivNex เช่าออมบ้าน · SENA Solar", brand: "เสนาคิทท์ ผ่อนล้านละ 2,500 บ./ด.*", project_group: "เฟล็กซี่ สาทร - เจริญนคร ทุกเฟส", project: "เฉพาะแปลงมุม โซนหน้าสวน 5 ยูนิตสุดท้าย" };
const presets = [
  ["discount_amount", "ส่วนลดเงินสด", "THB"], ["free_transfer_fee", "ฟรีค่าโอน", ""],
  ["free_common_fee", "ฟรีค่าส่วนกลาง", "months"], ["furniture", "ฟรีเฟอร์นิเจอร์", ""],
  ["gift", "บัตรกำนัล", "THB"], ["rate_subsidy", "ดอกเบี้ยพิเศษ", "percent"],
] as const;

export function PromotionEditor({ promotion, projects, brands, references, defaultProject, defaultBrand = "", defaultGroup = "", defaultTier, contextLocked = false, excludeProject, suggestion, onSaved, onDirty, disabled = false }: {
  promotion?: Promotion; projects: Project[]; brands: Brand[]; references: PromotionReferences; defaultProject: string; defaultBrand?: string; defaultGroup?: string;
  defaultTier?: PromotionTier; contextLocked?: boolean; excludeProject?: string | null; suggestion?: SuggestionInput | null;
  onSaved: (row: Promotion) => void; onDirty: (dirty: boolean) => void; disabled?: boolean;
}) {
  const [tier, setTier] = useState<PromotionTier>(promotion ? tierOf(promotion) : defaultTier ?? (defaultBrand ? "brand" : defaultGroup ? "project_group" : "project"));
  const [projectId, setProjectId] = useState(promotion?.project_id ?? defaultProject);
  const [brandId, setBrandId] = useState(promotion?.owning_brand_id ?? defaultBrand);
  const [groupId, setGroupId] = useState(promotion?.owning_project_group_id ?? defaultGroup);
  const [programme, setProgramme] = useState(promotion?.programme_key ?? "");
  const [allProjects, setAllProjects] = useState(promotion?.all_active_projects ?? false);
  const [targets, setTargets] = useState<PromotionScope[]>(promotion?.targets ?? []);
  const [excluded, setExcluded] = useState([...new Set([...(promotion?.excluded_project_ids ?? []), ...(excludeProject ? [excludeProject] : [])])]);
  const [audience, setAudience] = useState(promotion?.audience ?? "general");
  const [scopeOpen, setScopeOpen] = useState(!promotion || Boolean(excludeProject));
  const [scopeDirty, setScopeDirty] = useState(Boolean(excludeProject));
  const [copyDirty, setCopyDirty] = useState(false);
  const [scope, setScope] = useState(promotion?.scope), [scopeError, setScopeError] = useState("");
  const [scopeQuery, setScopeQuery] = useState("");
  const [dates, setDates] = useState<Record<keyof typeof windows, string>>({ booking_from: promotion?.booking_from ?? "", booking_to: promotion?.booking_to ?? "", transfer_from: promotion?.transfer_from ?? "", transfer_to: promotion?.transfer_to ?? "" });
  const [items, setItems] = useState<BenefitItem[]>(promotion?.benefit_items?.length ? promotion.benefit_items : [{ benefit_type: promotion?.benefit_type ?? "other", benefit_value: promotion?.benefit_value ?? null, benefit_unit: promotion?.benefit_unit ?? null, label: {} }]);
  const [english, setEnglish] = useState<Record<string, string>>(() => Object.fromEntries(Object.keys(textFields).map(key => [key, promotion?.[key as keyof typeof textFields]?.en ?? ""])));
  const [englishOpen, setEnglishOpen] = useState(() => Object.values(english).some(value => value.trim()));
  const [value, setValue] = useState(() => ({ code: promotion?.code ?? "", title: promotion?.title?.th ?? suggestion?.text.title ?? "", summary: promotion?.summary?.th ?? suggestion?.text.summary ?? "", conditions_public: promotion?.conditions_public?.th ?? suggestion?.text.conditions_public ?? "", legal_terms: promotion?.legal_terms?.th ?? "", disclaimer: promotion?.disclaimer?.th ?? "", highlight: promotion?.highlight_badge?.th ?? "", unitNote: promotion?.unit_scope_note?.th ?? "", campaignName: promotion?.campaign_name?.th ?? "", campaignSlug: promotion?.campaign_slug ?? "", adsCode: promotion?.ads_campaign_code ?? "", starts_at: localBangkok(promotion?.starts_at), ends_at: localBangkok(promotion?.ends_at), priority: String(promotion?.priority ?? 0), source_offer_key: promotion?.source_offer_key ?? "" }));
  const [stackable, setStackable] = useState(promotion?.stackable ?? false), [synthetic, setSynthetic] = useState(promotion?.synthetic ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [invalid, setInvalid] = useState<{ id: string; label: string }[]>([]);
  const locked = Boolean(promotion || suggestion || contextLocked);
  const globalTier = tier === "campaign" || tier === "corporate";
  const programmeScope = tier === "corporate" && Boolean(programme);
  function changed() { setCopyDirty(true); onDirty(true); }
  function update(key: keyof typeof value, next: string) { setValue(previous => ({ ...previous, [key]: next })); changed(); }
  function scopeChanged() { setScopeDirty(true); onDirty(true); }
  function chooseTier(next: PromotionTier) { setTier(next); setTargets([]); setExcluded([]); setProgramme(""); setAllProjects(false); scopeChanged(); }
  function benefit(index: number, patch: Partial<BenefitItem>) { setItems(previous => previous.map((item, i) => i === index ? { ...item, ...patch } : item)); changed(); }
  function addBenefit(type = "other", label = "", unit = "") { if (items.length < 20) { setItems(previous => [...previous, { benefit_type: type, benefit_value: null, benefit_unit: unit || null, label: label ? { th: label } : {} }]); changed(); } }
  useEffect(() => { if (excludeProject) onDirty(true); }, [excludeProject, onDirty]);
  useEffect(() => {
    if (promotion && !scopeOpen) { setScope(promotion.scope); setScopeError(""); return; }
    let active = true; setScopeError("");
    if (!promotion && (tier === "project" && !projectId || tier === "brand" && !brandId || tier === "project_group" && !groupId)) { setScope(undefined); return; }
    const body = promotion ? { promotion_id: promotion.id, expected_revision: promotion.draft_revision, targets, excluded_project_ids: excluded,
      ...(tier === "corporate" ? { programme_key: programme || null } : {}), ...(["campaign", "corporate"].includes(tier) ? { all_active_projects: allProjects } : {}) } : {
      promotion_tier: tier, project_id: tier === "project" ? projectId : null, owning_brand_id: tier === "brand" ? brandId : null,
      owning_project_group_id: tier === "project_group" ? groupId : null, programme_key: tier === "corporate" ? programme || null : null,
      all_active_projects: ["campaign", "corporate"].includes(tier) && allProjects, targets, excluded_project_ids: excluded,
    };
    setScope(undefined);
    request<NonNullable<CommercialPromotion["scope"]>>("v1/admin/promotions/resolve", "POST", body).then(result => { if (active) setScope(result); }).catch(e => { if (active) setScopeError(e.message); });
    return () => { active = false; };
  }, [promotion, scopeOpen, tier, projectId, brandId, groupId, programme, allProjects, targets, excluded]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Array.from(event.currentTarget.elements).filter((field): field is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement);
    const errors = fields.filter(field => !field.validity.valid).map(field => ({ id: field.id, label: field.labels?.[0]?.textContent ?? "ตรวจสอบช่องข้อมูล" }));
    if (value.starts_at && value.ends_at && value.starts_at >= value.ends_at) errors.push({ id: "promotion-ends_at", label: "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น" });
    for (const [from, to] of [["booking_from", "booking_to"], ["transfer_from", "transfer_to"]] as const) {
      if (Boolean(dates[from]) !== Boolean(dates[to]) || dates[from] > dates[to]) errors.push({ id: `promotion-${from}`, label: "ระบุวันเริ่มและสิ้นสุดเป็นคู่ โดยวันสิ้นสุดไม่อยู่ก่อนวันเริ่ม" });
    }
    if (items.some(item => item.benefit_type === "discount_pct" && Number(item.benefit_value) > 100)) errors.push({ id: "promotion-benefit_value", label: "ส่วนลดร้อยละต้องไม่เกิน 100" });
    setInvalid(errors); if (errors.length) { setError("กรุณาตรวจสอบข้อมูลก่อนบันทึก"); return; }
    setBusy(true); setError("");
    const cleanLocale = (prior: Record<string, string | undefined> | undefined, thText: string) => {
      if (!thText.trim()) return {};
      const next: Record<string, string> = {};
      for (const [loc, textVal] of Object.entries({ ...(prior ?? {}), th: thText })) {
        if (typeof textVal === "string" && textVal.trim()) next[loc] = textVal;
      }
      return next;
    };
    const payload = {
      ...(promotion ? { expected_revision: promotion.draft_revision } : { promotion_tier: tier, project_id: tier === "project" ? projectId : null, owning_brand_id: tier === "brand" ? brandId : null, owning_project_group_id: tier === "project_group" ? groupId : null, code: value.code, synthetic,
        ...(suggestion ? { suggestion: { kind: suggestion.kind, ref: suggestion.ref, phase: suggestion.phase, candidate_id: suggestion.candidate_id, source: suggestion.source } } : {}) }),
      ...Object.fromEntries(Object.keys(textFields).map(key => [key, { ...(promotion?.[key as keyof typeof textFields] ?? {}), th: value[key as keyof typeof textFields], en: english[key] }])),
      ...(["corporate", "campaign"].includes(tier) ? { all_active_projects: allProjects } : {}), ...(tier === "corporate" ? { programme_key: programme || null } : {}),
      campaign_name: cleanLocale(promotion?.campaign_name, value.campaignName), campaign_slug: value.campaignSlug || null, ads_campaign_code: value.adsCode || null,
      highlight_badge: cleanLocale(promotion?.highlight_badge, value.highlight),
      unit_scope_note: tier === "project" ? cleanLocale(promotion?.unit_scope_note, value.unitNote) : {},
      benefit_items: items, benefit_type: items[0]?.benefit_type ?? "other", benefit_value: items[0]?.benefit_value ?? null, benefit_unit: items[0]?.benefit_unit ?? null,
      audience, targets, excluded_project_ids: excluded, ...Object.fromEntries(Object.entries(dates).map(([key, val]) => [key, val || null])),
      stackable, priority: Number(value.priority), source_offer_key: value.source_offer_key || null,
      starts_at: promotion && value.starts_at === localBangkok(promotion.starts_at) ? promotion.starts_at : bangkokISO(value.starts_at),
      ends_at: promotion && value.ends_at === localBangkok(promotion.ends_at) ? promotion.ends_at : bangkokISO(value.ends_at),
    };
    try { const row = await request<Promotion>(promotion ? `v1/admin/promotions/${promotion.id}` : "v1/admin/promotions", promotion ? "PATCH" : "POST", payload); onDirty(false); onSaved(row); }
    catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่"); } finally { setBusy(false); }
  }
  const allowedTargets = promotion?.scope_target_types ?? (promotion ? ["project", "brand", "project_group", "commercial_type"] : tier === "project" ? ["commercial_type"] : ["brand", "project_group"].includes(tier) ? [] : ["project", "brand", "project_group", "commercial_type"]);
  const visibleReferences = (source: keyof PromotionReferences) => (references[source] ?? []).filter(ref => {
    if (source === "commercial_types" && tier === "project" && allowedTargets.length === 1 && ref.project_id && ![projectId, projects.find(p => p.id === projectId)?.public_project_id].includes(ref.project_id)) return false;
    return !scopeQuery || `${ref.label.th ?? ""} ${ref.label.en ?? ""}`.toLocaleLowerCase("th").includes(scopeQuery.toLocaleLowerCase("th"));
  });
  const banner = promotion?.banners?.[0];
  const invalidField = (id: string) => invalid.some(field => field.id === id) || undefined;
  return <div className="promo-editor-layout">
    <form className="content-form registry-panel promo-section-card promo-unified-form" noValidate onSubmit={submit}>
      <h3>{promotion ? `แก้ไขร่างโปรโมชัน · รุ่น ${promotion.draft_revision}` : "สร้างร่างโปรโมชัน"}</h3>
      {promotion && <p className="content-muted">{promotion.synthetic === false ? "โปรโมชันจริง · ตรวจ DATA และ LEGAL ของรุ่นนี้ก่อนเผยแพร่" : "ข้อมูลสังเคราะห์สำหรับทดสอบ"}</p>}
      <p className="content-muted">บันทึกร่างที่ยังกรอกไม่ครบไว้ก่อนได้ เมื่อพร้อมเผยแพร่จึงส่งตรวจข้อมูลและข้อกฎหมายของรุ่นปัจจุบัน</p>
      {suggestion && <p className="notice">{text.promotion_suggestion_source} · {text.promotion_confirm_numbers}</p>}
      <ErrorSummary message={error} fields={invalid} />
      <fieldset disabled={busy || disabled}>
        {!promotion && <fieldset className="promo-tier-choices"><legend>เลือกระดับโปรโมชัน</legend>{Object.entries(promotionTiers).map(([key, label]) => <label key={key} className="promo-tier-choice" data-selected={tier === key}><input type="radio" name="promotion-tier" value={key} checked={tier === key} disabled={locked} onChange={() => { chooseTier(key as PromotionTier); }} /><strong>{label}</strong><span>{examples[key as PromotionTier]}</span></label>)}</fieldset>}
        <section className="promo-form-group"><h4 className="promo-form-group-title">1. ข้อมูลและเจ้าของโปรโมชัน</h4><div className="content-grid">
          <Field id="promotion-owner" label={text.promotion_owner}><select id="promotion-owner" className="registry-input" value={tier} disabled={locked} onChange={e => { chooseTier(e.target.value as PromotionTier); }}>{Object.entries(promotionTiers).map(([key, label]) => <option key={key} value={key}>{key === "project" ? text.promotion_owner_project : key === "brand" ? text.promotion_owner_brand : label}</option>)}</select></Field>
          {tier === "project" && <Field id="promotion-project" label="โครงการ"><select id="promotion-project" className="registry-input" value={projectId} required disabled={locked} onChange={e => { setProjectId(e.target.value); setTargets([]); setExcluded([]); scopeChanged(); }}><option value="">เลือกโครงการ</option>{projects.map(project => <option key={project.id} value={project.id}>{project.public_name?.th || project.public_name?.en || project.source_name || text.project}</option>)}</select></Field>}
          {tier === "brand" && <Field id="promotion-brand" label={text.brand}><select id="promotion-brand" className="registry-input" value={brandId} required disabled={locked} onChange={e => { setBrandId(e.target.value); setTargets([]); setExcluded([]); scopeChanged(); }}><option value="">เลือกแบรนด์</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{workspaceName(brand.label)}</option>)}</select></Field>}
          {tier === "project_group" && <Field id="promotion-project-group" label="กลุ่มโครงการ"><select id="promotion-project-group" className="registry-input" value={groupId} required disabled={locked} onChange={e => { setGroupId(e.target.value); setTargets([]); setExcluded([]); scopeChanged(); }}><option value="">เลือกกลุ่มโครงการ</option>{references.project_groups?.map(group => <option key={group.id} value={group.id}>{workspaceName(group.label)}</option>)}</select></Field>}
          {tier === "corporate" && <Field id="promotion-programme" label="โปรแกรมขององค์กร"><select id="promotion-programme" className="registry-input" value={programme} onChange={e => { setProgramme(e.target.value); if (e.target.value) { setTargets([]); setAllProjects(false); } scopeChanged(); }}><option value="">ทุกโครงการที่เปิดใช้งาน หรือเลือกขอบเขตเอง</option>{references.programmes?.map(programme => <option key={programme.id ?? programme.key} value={programme.id ?? programme.key}>{workspaceName(programme.label)}</option>)}</select></Field>}
          <Field id="promotion-code" label="รหัสโปรโมชัน" hint="ภาษาอังกฤษตัวพิมพ์ใหญ่ ตัวเลข หรือขีด - _ (กำหนดครั้งเดียว)"><input id="promotion-code" className="registry-input" value={value.code} required disabled={Boolean(promotion)} maxLength={80} pattern="[A-Z0-9][A-Z0-9_-]{0,79}" aria-invalid={invalidField("promotion-code")} onChange={e => update("code", e.target.value)} /></Field>
          {tier === "campaign" && <><Field id="promotion-campaign-name" label="ชื่อแคมเปญ (ภาษาไทย)"><textarea id="promotion-campaign-name" className="registry-input promo-autogrow" rows={2} maxLength={300} value={value.campaignName} onChange={e => update("campaignName", e.target.value.replace(/[\r\n]+/g, " "))} /></Field><Field id="promotion-campaign-slug" label="ชื่อแคมเปญในลิงก์" hint="ภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง"><input id="promotion-campaign-slug" className="registry-input" maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={value.campaignSlug} onChange={e => update("campaignSlug", e.target.value)} /></Field><Field id="promotion-ads-code" label="รหัสแคมเปญโฆษณาอ้างอิง" hint="ข้อมูลอ้างอิง ไม่เชื่อมการอนุมัติงบโฆษณา"><input id="promotion-ads-code" className="registry-input" maxLength={200} value={value.adsCode} onChange={e => update("adsCode", e.target.value)} /></Field></>}
          {tier === "project" && <Field id="promotion-unit-note" label="เงื่อนไขแปลงหรือยูนิตที่ร่วมรายการ"><textarea id="promotion-unit-note" className="registry-input promo-autogrow" rows={2} maxLength={2000} value={value.unitNote} onChange={e => update("unitNote", e.target.value)} /></Field>}
        </div></section>
        <section className="promo-form-group promo-scope-editor"><div className="promo-section-head"><h4>กลุ่มเป้าหมายและขอบเขตโครงการ</h4>{!scopeOpen && <button type="button" className="button secondary" onClick={() => setScopeOpen(true)}>แก้ไขขอบเขตและช่วงเวลา</button>}</div>
          <div className="promo-resolved-box"><h4>{text.promotion_resolved_projects} ({scope?.count ?? promotion?.scope?.count ?? 0})</h4>{scopeError && <p role="alert">{scopeError}</p>}<ul className="promo-resolved-pills">{scope?.items.map(project => <li key={project.id}>{workspaceName(project.label)}</li>)}</ul></div>
          <p>{text.promotion_owner}: {promotionTiers[tier]}</p>
          {(promotion?.applicability_complete === false || scope?.applicability_complete === false) && <p className="notice">{contentScopeText.scope_references_partial}</p>}
          {scopeDirty && <p className="notice">{text.promotion_scope_pending}</p>}
          {scopeOpen && <><div className="content-grid"><Field id="promotion-audience" label="กลุ่มเป้าหมาย"><select id="promotion-audience" className="registry-input" value={audience} onChange={e => { setAudience(e.target.value); scopeChanged(); }}><option value="general">ลูกค้าทั่วไป</option><option value="investor">ผู้ลงทุน</option><option value="livnex">LivNex</option></select></Field><Field id="promotion-scope-search" label="ค้นหารายชื่อโครงการ / แบรนด์ / แบบห้อง"><input id="promotion-scope-search" className="registry-input" type="search" value={scopeQuery} onChange={e => setScopeQuery(e.target.value)} /></Field></div>
            {globalTier && !programmeScope && <label className="registry-check"><input type="checkbox" checked={allProjects} onChange={e => { setAllProjects(e.target.checked); if (e.target.checked) setTargets([]); scopeChanged(); }} />ทุกโครงการที่เปิดใช้งาน</label>}
            <fieldset className="content-checks promo-checks-scroll"><legend>{text.promotion_excluded_projects}</legend>{visibleReferences("projects").map(project => <label key={project.id}><input type="checkbox" checked={excluded.includes(project.id)} onChange={e => { setExcluded(previous => e.target.checked ? [...previous, project.id] : previous.filter(id => id !== project.id)); scopeChanged(); }} />{workspaceName(project.label)}</label>)}</fieldset>
            {(!(globalTier && allProjects) && !programmeScope) && ([['project', 'projects', 'โครงการเพิ่มเติม'], ['brand', 'brands', 'แบรนด์'], ['project_group', 'project_groups', 'กลุ่มโครงการ'], ['commercial_type', 'commercial_types', 'แบบที่อยู่อาศัย']] as const).filter(([type]) => allowedTargets.includes(type)).map(([type, source, label]) => <fieldset key={type} className="content-checks promo-checks-scroll"><legend>{label}</legend>{visibleReferences(source).length ? visibleReferences(source).map(ref => <label key={ref.id}><input type="checkbox" checked={targets.some(target => target.type === type && target.id === ref.id)} onChange={e => { setTargets(previous => e.target.checked ? [...previous, { type, id: ref.id }] : previous.filter(target => target.type !== type || target.id !== ref.id)); scopeChanged(); }} />{workspaceName(ref.label)}</label>) : <p className="content-muted">ไม่มีรายการที่มีสิทธิ์ดู</p>}</fieldset>)}
            {promotion && <div className="content-actions"><button type="button" className="button secondary" onClick={() => { setAudience(promotion.audience ?? "general"); setTargets(promotion.targets ?? []); setExcluded(promotion.excluded_project_ids ?? []); setDates({ booking_from: promotion.booking_from ?? "", booking_to: promotion.booking_to ?? "", transfer_from: promotion.transfer_from ?? "", transfer_to: promotion.transfer_to ?? "" }); setProgramme(promotion.programme_key ?? ""); setAllProjects(promotion.all_active_projects ?? false); setScopeOpen(false); setScopeDirty(false); onDirty(copyDirty); }}>ยกเลิก</button><button type="submit" className="button primary">บันทึกขอบเขตและช่วงเวลา</button></div>}
          </>}
        </section>
        <section className="promo-form-group"><h4 className="promo-form-group-title">2. สิทธิประโยชน์และระยะเวลาแคมเปญ</h4>
          <div className="promo-presets" aria-label="สิทธิประโยชน์ที่ใช้บ่อย">{presets.map(([type, label, unit]) => <button key={type} type="button" className="promo-pill" disabled={items.length >= 20} onClick={() => addBenefit(type, label, unit)}>{label}</button>)}</div>
          {items.map((item, index) => <fieldset key={index} className="promo-benefit-item"><legend>สิทธิประโยชน์รายการที่ {index + 1}</legend><div className="content-grid">
            <Field id={index ? `promotion-benefit_type-${index}` : "promotion-benefit_type"} label={index ? `ประเภทสิทธิประโยชน์ ${index + 1}` : "ประเภทสิทธิประโยชน์"}><select id={index ? `promotion-benefit_type-${index}` : "promotion-benefit_type"} className="registry-input" value={item.benefit_type} onChange={e => benefit(index, { benefit_type: e.target.value })}>{Object.entries(benefitLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <Field id={index ? `promotion-benefit_value-${index}` : "promotion-benefit_value"} label={index ? `มูลค่าสิทธิประโยชน์ ${index + 1}` : "มูลค่าสิทธิประโยชน์"} hint="วางตัวเลขมีลูกน้ำได้ · ทศนิยมไม่เกิน 2 ตำแหน่ง"><input id={index ? `promotion-benefit_value-${index}` : "promotion-benefit_value"} className="registry-input" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?" value={item.benefit_value ?? ""} onChange={e => benefit(index, { benefit_value: e.target.value.replaceAll(",", "") || null })} /></Field>
            <Field id={index ? `promotion-benefit_unit-${index}` : "promotion-benefit_unit"} label={index ? `หน่วยสิทธิประโยชน์ ${index + 1}` : "หน่วยสิทธิประโยชน์"}><select id={index ? `promotion-benefit_unit-${index}` : "promotion-benefit_unit"} className="registry-input" value={item.benefit_unit ?? ""} onChange={e => benefit(index, { benefit_unit: e.target.value || null })}><option value="">ไม่ระบุ</option>{Object.entries(benefitUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <Field id={`promotion-benefit-label-${index}`} label={`ข้อความสิทธิประโยชน์ ${index + 1} (ภาษาไทย)`}><textarea id={`promotion-benefit-label-${index}`} className="registry-input promo-autogrow" rows={2} maxLength={300} value={item.label.th ?? ""} onChange={e => benefit(index, { label: { ...item.label, th: e.target.value.replace(/[\r\n]+/g, " ") } })} /></Field>
          </div>{items.length > 1 && <button type="button" className="button secondary" onClick={() => { setItems(previous => previous.filter((_, i) => i !== index)); changed(); }}>ลบรายการที่ {index + 1}</button>}</fieldset>)}
          <button type="button" className="button secondary" disabled={items.length >= 20} onClick={() => addBenefit()}>+ เพิ่มรายการสิทธิประโยชน์</button>
          <div className="content-grid"><Field id="promotion-highlight" label="คำโปรยไฮไลต์บนการ์ด"><textarea id="promotion-highlight" className="registry-input promo-autogrow" rows={2} maxLength={300} value={value.highlight} onChange={e => update("highlight", e.target.value.replace(/[\r\n]+/g, " "))} /></Field><Field id="promotion-priority" label="ลำดับความสำคัญ"><input id="promotion-priority" className="registry-input" inputMode="numeric" pattern="[0-9]+" value={value.priority} onChange={e => update("priority", e.target.value)} /></Field>
            {(["starts_at", "ends_at"] as const).map(key => <Field key={key} id={`promotion-${key}`} label={key === "starts_at" ? "เริ่มใช้สิทธิ์" : "สิ้นสุดสิทธิ์ (ไม่รวมเวลานี้)"} hint="เวลาประเทศไทย"><input id={`promotion-${key}`} className="registry-input" type="datetime-local" required value={value[key]} aria-invalid={invalidField(`promotion-${key}`)} onChange={e => update(key, e.target.value)} /></Field>)}
            {Object.entries(windows).map(([key, label]) => <Field key={key} id={`promotion-${key}`} label={label}><input id={`promotion-${key}`} className="registry-input" type="date" value={dates[key as keyof typeof dates]} onChange={e => { setDates(previous => ({ ...previous, [key]: e.target.value })); scopeChanged(); }} /></Field>)}
            <Field id="promotion-source_offer_key" label="รหัสข้อเสนอจากต้นทาง"><input id="promotion-source_offer_key" className="registry-input" value={value.source_offer_key} onChange={e => update("source_offer_key", e.target.value)} /></Field>
            <label className="registry-check"><input type="checkbox" checked={stackable} onChange={e => { setStackable(e.target.checked); changed(); }} />ใช้ร่วมกับโปรโมชันอื่นได้ตามเงื่อนไข</label>
          </div>
        </section>
        <section className="promo-form-group"><h4 className="promo-form-group-title">3. ข้อความสื่อสารโปรโมชัน (ภาษาไทย)</h4><div className="content-grid">{Object.entries(textFields).map(([key, label]) => <Field key={key} id={`promotion-${key}`} label={`${label} (ภาษาไทย)`}>{key === "title" ? <textarea id={`promotion-${key}`} className="registry-input promo-autogrow" rows={2} maxLength={20000} value={value[key]} required aria-invalid={invalidField(`promotion-${key}`)} onChange={e => update(key, e.target.value.replace(/[\r\n]+/g, " "))} /> : <textarea id={`promotion-${key}`} className="registry-input promo-autogrow" rows={3} value={value[key as keyof typeof textFields]} maxLength={20000} onChange={e => update(key as keyof typeof textFields, e.target.value)} />}</Field>)}</div></section>
        <details className="promo-subdrawer" open={englishOpen} onToggle={event => setEnglishOpen(event.currentTarget.open)}><summary>4. คำแปลภาษาอังกฤษ (ไม่บังคับตอนร่าง)</summary><div className="content-grid">{Object.entries(textFields).map(([key, label]) => <Field key={key} id={`promotion-${key}-en`} label={`${label} (ภาษาอังกฤษ)`}><textarea id={`promotion-${key}-en`} className="registry-input promo-autogrow" rows={key === "title" ? 2 : 3} lang="en" maxLength={20000} value={english[key]} onChange={e => { setEnglish(previous => ({ ...previous, [key]: key === "title" ? e.target.value.replace(/[\r\n]+/g, " ") : e.target.value })); changed(); }} /></Field>)}</div></details>
        {!promotion && <label className="registry-check"><input type="checkbox" checked={synthetic} onChange={e => { setSynthetic(e.target.checked); changed(); }} />ใช้ข้อมูลสังเคราะห์สำหรับทดสอบระบบเท่านั้น (ไม่ต้องเลือกสำหรับโปรโมชันจริง)</label>}
        <div className="content-actions"><button type="submit" className="registry-button primary" aria-busy={busy}>{busy ? "กำลังบันทึก…" : "บันทึกร่างโปรโมชัน"}</button></div>
      </fieldset>
    </form>
    <aside className="promo-preview" aria-label="ตัวอย่างการ์ดบนเว็บไซต์"><h3>ตัวอย่างการ์ดบนเว็บไซต์</h3><p className="content-muted">ตัวอย่างจากร่างที่กำลังแก้ไข</p><article className="promo-preview-card"><span className="promo-badge">{promotionTiers[tier]}</span>{banner ? <img src={`/api/hub/v1/admin/assets/${encodeURIComponent(banner.asset_id)}/file`} alt={workspaceName(banner.caption) || "แบนเนอร์โปรโมชัน"} width={400} height={225} loading="lazy" decoding="async" /> : <div className="promo-preview-banner">ยังไม่ได้เลือกแบนเนอร์</div>}{value.highlight && <strong className="promo-highlight">{value.highlight}</strong>}<h4>{value.title || "ชื่อโปรโมชัน"}</h4><p>{value.summary}</p><ul>{items.map((item, index) => <li key={index}>{benefitText(item)}</li>)}</ul>{value.unitNote && <p>{value.unitNote}</p>}{value.starts_at && value.ends_at && <p>ช่วงแคมเปญ: {dateTime(bangkokISO(value.starts_at))} – {dateTime(bangkokISO(value.ends_at))}</p>}{dates.booking_from && <p>จอง: {dateTime(`${dates.booking_from}T00:00:00+07:00`)} – {dates.booking_to && dateTime(`${dates.booking_to}T00:00:00+07:00`)}</p>}{dates.transfer_from && <p>โอน: {dateTime(`${dates.transfer_from}T00:00:00+07:00`)} – {dates.transfer_to && dateTime(`${dates.transfer_to}T00:00:00+07:00`)}</p>}<small>* {value.disclaimer || "เงื่อนไขเป็นไปตามที่บริษัทกำหนด"}</small></article>{!promotion && <p className="field-help">บันทึกร่างก่อนเพื่ออัปโหลดหรือเลือกแบนเนอร์</p>}{promotion && (promotion.public_project_id || scope?.items[0]?.public_id) && <a className="button secondary" href={`/media?project=${encodeURIComponent(promotion.public_project_id || scope!.items[0].public_id)}&tab=upload&target_type=promotion&target_key=${promotion.id}&category=promotion_ad&usage=banner`}>จัดการภาพแบนเนอร์</a>}</aside>
  </div>;
}
