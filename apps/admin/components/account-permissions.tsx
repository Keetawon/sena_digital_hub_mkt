"use client";
import { useId } from "react";
import type { AccountAccess, PermissionCatalogTab, PermissionTemplate, TemplateRef } from "@/lib/hub-permissions";
import "./account-permissions.css";

export type Catalog = { tabs: PermissionCatalogTab[]; templates: PermissionTemplate[]; catalog_digest: string; web_publisher_count?: number };
export type Tabs = Record<string, string[]>;
export const levelLabels: Record<string, string> = { view: "ดู", edit: "แก้ไข", approve: "อนุมัติ" };
export const emptyAccess = (): AccountAccess => ({ tabs: {}, can_manage_users: false, template: null, customised: false });
export const copyTabs = (tabs: Tabs): Tabs => Object.fromEntries(Object.entries(tabs).map(([tab, values]) => [tab, [...values]]));
export const templateKey = (template: TemplateRef | null) => template ? `${template.code}:${template.version}` : "";
export const latestTemplates = (catalog: Catalog) => catalog.templates.filter(t => !catalog.templates.some(other => other.code === t.code && other.version > t.version));
export const templateRef = (template: PermissionTemplate): TemplateRef => ({ code: template.code, version: template.version });
export function normalTabs(tabs: Tabs): string { return JSON.stringify(Object.entries(tabs).filter(([, values]) => values.length).sort(([a], [b]) => a.localeCompare(b)).map(([tab, values]) => [tab, [...new Set(values)].sort()])); }
export function accessChanged(before: AccountAccess, after: AccountAccess) { return normalTabs(before.tabs) !== normalTabs(after.tabs) || before.can_manage_users !== after.can_manage_users || templateKey(before.template) !== templateKey(after.template); }
export function templateLabel(access: AccountAccess, catalog: Catalog) {
  const template = catalog.templates.find(t => templateKey(t) === templateKey(access.template));
  const name = template?.label_th || access.template?.code || "ไม่มีแม่แบบ";
  return access.customised ? `กำหนดเอง (จาก ${name})` : name;
}
export function TemplateSelect({ catalog, value, onChange, agency = false, admin = true, disabled = false, label = "แม่แบบสิทธิ์" }: { catalog: Catalog; value: string; onChange: (key: string) => void; agency?: boolean; admin?: boolean; disabled?: boolean; label?: string }) {
  const id = useId();
  return <div className="form-field"><label htmlFor={id}>{label}</label><select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="" disabled>เลือกแม่แบบสิทธิ์</option>{latestTemplates(catalog).filter(t => (agency || t.code !== "agency") && (admin || t.code !== "admin")).map(t => <option key={templateKey(t)} value={templateKey(t)}>{t.label_th} · รุ่น {t.version}</option>)}</select></div>;
}
export function PermissionGrid({ catalog, tabs, onChange, disabled = false }: { catalog: Catalog; tabs: Tabs; onChange: (tabs: Tabs) => void; disabled?: boolean }) {
  const id = useId();
  function toggle(tab: PermissionCatalogTab, level: string, checked: boolean) {
    const selected = new Set(tabs[tab.tab] || []);
    if (checked) selected.add(level); else selected.delete(level);
    if (level === "view" && !checked) selected.clear();
    if (tab.tab === "knowledge" && level === "approve" && !checked) selected.delete("knowledge.publish_web");
    onChange({ ...tabs, [tab.tab]: [...selected] });
  }
  return <div>{catalog.web_publisher_count !== undefined && catalog.web_publisher_count < 2 && <p className="notice warning" role="status">ผู้มีสิทธิ์เผยแพร่ขึ้นเว็บที่ใช้งานได้มี {catalog.web_publisher_count} คน ควรมีอย่างน้อย 2 คนเพื่อแยกผู้จัดทำกับผู้อนุมัติ</p>}<div className="permission-grid-scroll" tabIndex={0} role="region" aria-label="ตารางสิทธิ์รายแท็บ"><table className="permission-grid"><thead><tr><th scope="col">แท็บ</th>{Object.entries(levelLabels).map(([code, label]) => <th scope="col" key={code}>{label}</th>)}</tr></thead><tbody>{catalog.tabs.map(tab => {
    const values = tabs[tab.tab] || []; const hasView = values.includes("view");
    const separated = tab.separate_edit_approve && (values.includes("edit") || values.includes("approve"));
    const locked = tab.rollout_state !== "MIGRATED";
    return <PermissionRows key={tab.tab} tab={tab} values={values} hasView={hasView} separated={separated} locked={locked} disabled={disabled} id={`${id}-${tab.tab}`} onToggle={(level, checked) => toggle(tab, level, checked)} />;
  })}</tbody></table></div></div>;
}
function PermissionRows({ tab, values, hasView, separated, locked, disabled, id, onToggle }: { tab: PermissionCatalogTab; values: string[]; hasView: boolean; separated: boolean; locked: boolean; disabled: boolean; id: string; onToggle: (level: string, checked: boolean) => void }) {
  return <><tr><th scope="row">{tab.label_th}{locked && <small>ยังไม่เปิดให้ปรับสิทธิ์</small>}{separated && <small id={`${id}-separation`}>เลือกแก้ไขหรืออนุมัติได้อย่างใดอย่างหนึ่ง</small>}</th>{Object.keys(levelLabels).map(level => {
    if (!tab.levels.includes(level as "view" | "edit" | "approve")) return <td key={level} aria-label={`${tab.label_th} ไม่มีสิทธิ์${levelLabels[level]}`}>—</td>;
    const conflict = tab.separate_edit_approve && (level === "edit" && values.includes("approve") || level === "approve" && values.includes("edit"));
    const reason = conflict ? "เลือกแก้ไขหรืออนุมัติได้อย่างใดอย่างหนึ่ง" : level !== "view" && !hasView ? "ต้องเลือกดูก่อน" : "";
    return <td key={level}><label className="permission-cell" title={reason}><input type="checkbox" aria-label={`${tab.label_th} ${levelLabels[level]}`} aria-describedby={conflict ? `${id}-separation` : undefined} checked={values.includes(level)} disabled={disabled || locked || !!reason} onChange={event => onToggle(level, event.target.checked)} /><span className="sr-only">{levelLabels[level]}</span></label></td>;
  })}</tr>{tab.special_actions.map(action => <tr key={action} className="permission-special"><td colSpan={4}><label><input type="checkbox" aria-label={tab.special_labels?.[action] || action} checked={values.includes(action)} disabled={disabled || locked || !hasView || action === "knowledge.publish_web" && !values.includes("approve")} onChange={event => onToggle(action, event.target.checked)} /><span>{tab.special_labels?.[action] || action}{!hasView && <small>ต้องเลือกดูแท็บนี้ก่อน</small>}{action === "knowledge.publish_web" && !values.includes("approve") && <small>ต้องมีสิทธิ์อนุมัติคลังความรู้ก่อน</small>}</span></label></td></tr>)}</>;
}
function describe(values: string[], tab?: PermissionCatalogTab) { return values.length ? values.map(value => levelLabels[value] || tab?.special_labels?.[value] || value).join(" · ") : "ไม่มีสิทธิ์"; }
export function PermissionDiff({ before, after, catalog }: { before: AccountAccess; after: AccountAccess; catalog: Catalog }) {
  const tabs = catalog.tabs.filter(tab => normalTabs({ [tab.tab]: before.tabs[tab.tab] || [] }) !== normalTabs({ [tab.tab]: after.tabs[tab.tab] || [] }));
  const templateChanged = templateKey(before.template) !== templateKey(after.template);
  const manageChanged = before.can_manage_users !== after.can_manage_users;
  const versionedLabel = (access: AccountAccess) => `${templateLabel(access, catalog)}${access.template ? ` · รุ่น ${access.template.version}` : ""}`;
  return <div className="permission-diff" aria-label="ความแตกต่างของสิทธิ์">{!tabs.length && !templateChanged && !manageChanged ? <p>ยังไม่มีการเปลี่ยนแปลง</p> : <><p><strong>ตรวจการเปลี่ยนแปลงก่อนบันทึก</strong></p><ul>{templateChanged && <li>แม่แบบ: {versionedLabel(before)} → {versionedLabel(after)}</li>}{tabs.map(tab => <li key={tab.tab}>{tab.label_th}: {describe(before.tabs[tab.tab] || [], tab)} → {describe(after.tabs[tab.tab] || [], tab)}</li>)}{manageChanged && <li>จัดการผู้ใช้: {before.can_manage_users ? "ได้" : "ไม่ได้"} → {after.can_manage_users ? "ได้" : "ไม่ได้"}</li>}</ul></>}</div>;
}
export function PermissionChips({ access, catalog }: { access: AccountAccess; catalog: Catalog }) { return <div className="permission-chips">{catalog.tabs.filter(tab => (access.tabs[tab.tab] || []).length).map(tab => <span key={tab.tab} className="account-pill">{tab.label_th} · {(access.tabs[tab.tab] || []).map(level => levelLabels[level] || "พิเศษ").join("/")}</span>)}{access.can_manage_users && <span className="account-pill">จัดการผู้ใช้</span>}</div>; }
