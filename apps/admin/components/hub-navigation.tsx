"use client";

import { useEffect, useId, useState } from "react";
import "./hub-navigation.css";

import { hubPages, hubGroups, type HubSection } from "./hub-navigation-data";
import { useHubPermissions } from "./accounts";
import { useBrandReviews } from "./brand-review";
import { useHostedSession } from "./hosted-session";
type Item = { id: HubSection; href: string; label: string; group: "content" | "ads" | null; icon: string };
function NavIcon({ path }: { path: string }) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>; }
function NavLink({ item, section, pendingBrands, pendingAccounts }: { item: Item; section: HubSection; pendingBrands?: number | null; pendingAccounts?: number | null }) {
  const count = item.id === "brands" ? pendingBrands : item.id === "accounts" ? pendingAccounts : undefined;
  const countDescription = item.id === "accounts" ? "บัญชีรออนุมัติ" : typeof count === "number" ? `รอเผยแพร่ ${count} แบรนด์` : "ยังยืนยันจำนวนรอเผยแพร่ไม่ได้ เปิดรายการแบรนด์เพื่อตรวจสอบ";
  return <a className={`nav-link${item.id === section ? " active" : ""}`} href={item.href} aria-label={item.label} aria-description={count !== undefined ? countDescription : undefined} aria-current={item.id === section ? "page" : undefined}><NavIcon path={item.icon} /><span className="hub-nav-label">{item.label}</span><span className="hub-nav-tooltip" role="tooltip">{item.label}</span>{count !== undefined && <span className="hub-nav-count" aria-label={countDescription} title={countDescription}>{count ?? "…"}</span>}</a>;
}
function Group({ name, items, section, pendingBrands }: { name: keyof typeof hubGroups; items: Item[]; section: HubSection; pendingBrands?: number | null }) {
  const controls = useId(); const current = items.some(item => item.id === section); const [open, setOpen] = useState(current);
  useEffect(() => { let saved: string | null = null; try { saved = localStorage.getItem(`hub-navigation:${name}`); } catch { /* Unavailable storage keeps the default. */ } setOpen(saved === null ? current : saved === "open"); }, [name, current]);
  if (!items.length) return null;
  if (items.length === 1) return <NavLink item={items[0]} section={section} pendingBrands={pendingBrands} />;
  function toggle() { const next = !open; setOpen(next); try { localStorage.setItem(`hub-navigation:${name}`, next ? "open" : "closed"); } catch { /* Navigation remains usable without storage. */ } }
  return <section className="hub-nav-group"><button type="button" className="hub-nav-toggle" aria-label={hubGroups[name]} aria-description={current && !open ? "มีหน้าที่กำลังใช้งานอยู่ในกลุ่มนี้" : undefined} data-current={current && !open} aria-expanded={open} aria-controls={controls} onClick={toggle}><span className="hub-nav-label">{hubGroups[name]}</span><span className="hub-nav-tooltip" role="tooltip">{hubGroups[name]}</span><svg className="hub-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button><div id={controls} className="hub-nav-collapse" data-open={open} inert={!open} aria-hidden={!open}><div className="hub-nav-items">{items.map(item => <NavLink key={item.id} item={item} section={section} pendingBrands={pendingBrands} />)}</div></div></section>;
}
export function HubNavigation({ section }: { section: HubSection }) {
  const accounts = useHubPermissions();
  const { pendingCount } = useBrandReviews();
  const hosted = Boolean(useHostedSession());
  const items: Item[] = hubPages.flatMap(item => {
    const tab = accounts.capabilities.catalog?.find(tab => tab.tab === item.id);
    if (!tab || !accounts.can(item.id) || item.id === "knowledge" && hosted) return [];
    return [{ ...item, label: tab.label_th, group: tab.nav_group === "content" || tab.nav_group === "ads" ? tab.nav_group : null }];
  });
  const content = items.filter(item => item.group === "content"), ads = items.filter(item => item.group === "ads");
  return <nav className="hub-navigation" aria-label="เมนูหลัก"><Group name="content" items={content} section={section} pendingBrands={accounts.can("brands", "approve") ? pendingCount : undefined} /><Group name="ads" items={ads} section={section} />{items.filter(item => item.group === null).map(item => <div className="hub-nav-standalone" key={item.id}><NavLink item={item} section={section} /></div>)}{accounts.admin && <NavLink item={hubPages.find(item => item.id === "accounts")!} section={section} pendingAccounts={accounts.pending ?? null} />}</nav>;
}
