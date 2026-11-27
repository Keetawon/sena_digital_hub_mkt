"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { capabilityKey } from "@/lib/hub-permissions";
import { businessWorkspaceText as text } from "@/lib/business-workspace-text";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { useContentLocation } from "./content-operations-shared";
import { ContentNarrative, type NarrativeSection } from "./content-narrative";
import { ContentContacts, type Contact } from "./content-contacts";
import { TranslationReviewPanel, errorMessage, useFieldCatalog, type Translation } from "./content-common";

type BusinessContent = {
  scope_type: "business"; scope_id: string; sections: NarrativeSection[];
  contacts: Contact[]; translations: Translation[];
};
const tabs = ["narrative", "contacts", "english"] as const;
type Tab = typeof tabs[number];

export function BusinessWorkspace({ code, onEditingChange, onWorkflowChanged }: {
  code: string; onEditingChange?: (value: boolean) => void; onWorkflowChanged?: () => void;
}) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const canView = permissions.can("knowledge"), canEdit = permissions.can("knowledge", "edit");
  const { catalog, error: catalogError, reload: reloadCatalog } = useFieldCatalog();
  const base = `v1/admin/content/businesses/${encodeURIComponent(code)}`, identity = base + authority;
  const active = useRef<string | null>(identity); active.current = identity;
  const [loaded, setLoaded] = useState<{ identity: string; value: BusinessContent } | null>(null);
  const [error, setError] = useState(""), [retry, setRetry] = useState(0), [editing, setEditing] = useState(false);
  const location = useContentLocation(editing, false), selected = location.params.get("section");
  const tab: Tab = tabs.includes(selected as Tab) ? selected as Tab : "narrative";
  const data = loaded?.identity === identity ? loaded.value : null;
  useEffect(() => { onEditingChange?.(editing); return () => onEditingChange?.(false); }, [editing, onEditingChange]);
  const read = useCallback(async () => {
    const value = await request<BusinessContent>(`${base}/content`);
    if (value.scope_type !== "business" || value.scope_id !== code) throw new Error(text.loadError);
    return value;
  }, [base, code]);
  const changed = useCallback(async () => {
    const value = await read();
    if (active.current !== identity) return;
    setLoaded({ identity, value }); setError(""); onWorkflowChanged?.();
  }, [read, identity, onWorkflowChanged]);
  useEffect(() => {
    let live = true; active.current = identity; setLoaded(null); setEditing(false); setError("");
    if (canView) read().then(value => { if (live && active.current === identity) setLoaded({ identity, value }); })
      .catch(error => { if (live && active.current === identity) setError(errorMessage(error)); });
    return () => { live = false; if (active.current === identity) active.current = null; };
  }, [read, identity, canView, retry]);
  if (!canView) return <p role="alert" className="notice error">{text.permissionRequired}</p>;
  const stepIndex = tabs.indexOf(tab);
  const prevStep = stepIndex > 0 ? tabs[stepIndex - 1] : null;
  const nextStep = stepIndex >= 0 && stepIndex < tabs.length - 1 ? tabs[stepIndex + 1] : null;
  const stepDescriptions: Record<Tab, { sub: string; count: (v: BusinessContent) => string; done: (v: BusinessContent) => boolean }> = {
    narrative: { sub: "ข้อมูลแนะนำหน่วยธุรกิจและบริการหลัก", count: v => `${v.sections.length} หมวด`, done: v => v.sections.length > 0 },
    contacts: { sub: "เบอร์โทร อีเมล และช่องทางติดต่อเฉพาะธุรกิจ", count: v => `${v.contacts.length} ช่องทาง`, done: v => v.contacts.length > 0 },
    english: { sub: "ตรวจคำแปลภาษาอังกฤษก่อนส่งอนุมัติ", count: v => `${v.translations.length} รายการ`, done: v => v.translations.length === 0 || v.translations.every(t => t.translation_state === "reviewed") },
  };
  return <section className="content-workspace entity-embedded-content" data-business-content={code} aria-label={text.business}>
    {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}<button type="button" className="button secondary" disabled={editing} onClick={() => { reloadCatalog(); setRetry(value => value + 1); }}>{text.retry}</button></p>}
    {!data || !catalog ? !error && !catalogError && <p role="status">{text.loading}</p> : <>
      <div className="km-step-groups" role="group" aria-label="ขั้นตอนการกรอกข้อมูลหน่วยธุรกิจ">
        {tabs.map((value, idx) => {
          const meta = stepDescriptions[value];
          return (
            <button
              type="button"
              key={value}
              className="km-step-group-btn"
              aria-pressed={tab === value}
              disabled={editing && tab !== value}
              onClick={() => { if (!editing) location.navigate({ section: value, field: null, item: null }); }}
            >
              <span className="km-step-group-top">
                <span className="km-step-group-num">ขั้นที่ {idx + 1}</span>
                <span className={`km-step-group-badge ${meta.done(data) ? "is-done" : ""}`}>{meta.count(data)}</span>
              </span>
              <span className="km-step-group-title">{text[value]}</span>
              <span className="km-step-group-sub">{meta.sub}</span>
            </button>
          );
        })}
      </div>
      <nav className="content-tabs" aria-label={text.data}>{tabs.map(value => <button type="button" key={value} aria-current={tab === value ? "page" : undefined} disabled={editing && tab !== value} onClick={() => { if (!editing) location.navigate({ section: value, field: null, item: null }); }}>{text[value]}</button>)}</nav>
      <div key={identity + tab}>
        {tab === "narrative" && <ContentNarrative key={identity} apiBase={base} heading={text.narrative} standaloneBusiness={code !== "residential"} sections={data.sections} points={[]} fields={catalog.items} showPoints={false} canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
        {tab === "contacts" && <ContentContacts items={data.contacts} catalog={catalog} apiBase={`${base}/contacts`} canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
        {tab === "english" && <TranslationReviewPanel items={data.translations} fields={catalog.items} canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
      </div>
      <div className="km-substep-bar">
        <p className="km-substep-bar-note">ขั้นตอนย่อยที่ {stepIndex + 1} จาก {tabs.length}: <strong>{text[tab]}</strong></p>
        <div className="km-substep-actions">
          {prevStep && <button type="button" className="button secondary" disabled={editing} onClick={() => { if (!editing) location.navigate({ section: prevStep, field: null, item: null }); }}>← {text[prevStep]}</button>}
          {nextStep ? (
            <button type="button" className="button secondary" disabled={editing} onClick={() => { if (!editing) location.navigate({ section: nextStep, field: null, item: null }); }}>ถัดไป: {text[nextStep]} →</button>
          ) : (
            <Link prefetch={false} className="button secondary" href={`/website/business/${encodeURIComponent(code)}?tab=faq`}>
              ไปจัดการคลังคำถาม FAQ ธุรกิจนี้ →
            </Link>
          )}
        </div>
      </div>
    </>}
  </section>;
}
