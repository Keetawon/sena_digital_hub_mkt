"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useHubPermissions } from "./accounts";
import { capabilityKey, isContentAdmin } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import { errorMessage, useFieldCatalog } from "./content-common";
import { useContentLocation } from "./content-operations-shared";
import { ContentFieldRegistry } from "./content-field-registry";
import { FaqWorkspace } from "./faq-workspace";
import { MediaCatalog, type MediaTag, type Rule } from "./media-common";
import { MediaRules } from "./media-rules";
import { workspaceText as text } from "@/lib/unified-workspace";
import "./unified-workspace.css";
function MediaSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const { catalog, error: catalogError } = useFieldCatalog();
  const [tags, setTags] = useState<MediaTag[]>([]), [rules, setRules] = useState<Rule[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  async function read() { return Promise.all([request<MediaTag[]>("v1/admin/media/tags"), request<Rule[]>("v1/admin/media/requirements")]); }
  async function reload() { const [tags, rules] = await read(); setTags(tags); setRules(rules); }
  useEffect(() => {
    let live = true; setLoaded(false); setError("");
    read().then(([tags, rules]) => { if (live) { setTags(tags); setRules(rules); setLoaded(true); } }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [authority]);
  useEffect(() => {
    if (!loaded) return;
    const id = window.location.hash.slice(1);
    if (id !== "tags" && id !== "requirements") return;
    const section = document.getElementById(id); section?.scrollIntoView({ block: "start" }); section?.focus({ preventScroll: true });
  }, [loaded]);
  return <MediaCatalog.Provider value={catalog?.items ?? []}>{(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}</p>}
    {!loaded && !error ? <p role="status">{text.loading}</p> : loaded && <MediaRules tags={tags} rules={rules} canEdit={permissions.can("projects", "edit")} canApprove={permissions.can("projects", "approve")} onChanged={reload} onDirty={onDirty} />}
  </MediaCatalog.Provider>;
}
export function WorkspaceSettings() {
  const permissions = useHubPermissions(), [dirty, setDirty] = useState(false), location = useContentLocation(dirty);
  const account = permissions.account, admin = isContentAdmin(account);
  const choices = [
    ...(permissions.can("knowledge") ? [{ key: "bank", label: text.bank }, { key: "glossary", label: text.glossary }] : []),
    ...(permissions.can("projects") ? [{ key: "fields", label: text.fields }, { key: "media-tags", label: text.tags }, { key: "media-rules", label: text.rules }] : []),
  ];
  const selected = choices.find(item => item.key === location.params.get("section"))?.key ?? choices[0]?.key;
  return <section className="unified-workspace"><h1>{text.settings}</h1><nav className="content-tabs" aria-label={text.settings}>
    {choices.map(item => <Link prefetch={false} className="button secondary" aria-current={item.key === selected ? "page" : undefined} key={item.key} href={`/settings?section=${item.key}${item.key === "media-tags" ? "#tags" : item.key === "media-rules" ? "#requirements" : ""}`}>{item.label}</Link>)}
    {admin && permissions.can("knowledge") && <Link prefetch={false} className="button secondary" href="/knowledge">{text.evidence}</Link>}
    {admin && <Link prefetch={false} className="button secondary" href="/settings/activity">{text.activity}</Link>}
  </nav>
    {selected === "bank" && <FaqWorkspace embedded initialSection="bank" onEditingChange={setDirty} />}
    {selected === "glossary" && <FaqWorkspace embedded initialSection="glossary" onEditingChange={setDirty} />}
    {selected === "fields" && <ContentFieldRegistry />}
    {(selected === "media-tags" || selected === "media-rules") && <MediaSettings onDirty={setDirty} />}
  </section>;
}

