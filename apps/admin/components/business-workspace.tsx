"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  return <section className="content-workspace entity-embedded-content" data-business-content={code} aria-label={text.business}>
    {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}<button type="button" className="button secondary" disabled={editing} onClick={() => { reloadCatalog(); setRetry(value => value + 1); }}>{text.retry}</button></p>}
    {!data || !catalog ? !error && !catalogError && <p role="status">{text.loading}</p> : <>
      <nav className="content-tabs" aria-label={text.data}>{tabs.map(value => <button type="button" key={value} aria-current={tab === value ? "page" : undefined} disabled={editing && tab !== value} onClick={() => { if (!editing) location.navigate({ section: value, field: null, item: null }); }}>{text[value]}</button>)}</nav>
      <div key={identity + tab}>
        {tab === "narrative" && <ContentNarrative apiBase={base} heading={text.narrative} sections={data.sections} points={[]} fields={catalog.items} showPoints={false} canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
        {tab === "contacts" && <ContentContacts items={data.contacts} catalog={catalog} apiBase={`${base}/contacts`} canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
        {tab === "english" && <TranslationReviewPanel items={data.translations} fields={catalog.items} canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
      </div>
    </>}
  </section>;
}
