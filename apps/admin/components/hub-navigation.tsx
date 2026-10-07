"use client";

import { useEffect, useId, useState } from "react";
import "./hub-navigation.css";

import { hubPages, hubGroups, type HubSection } from "./hub-navigation-data";
import { useAccountDirectory } from "./accounts";
import { useBrandReviews } from "./brand-review";
import { useHostedSession } from "./hosted-session";
type Item = typeof hubPages[number];
function NavIcon({ path }: { path: string }) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>; }
function NavLink({ item, section, pendingBrands }: { item: Item; section: HubSection; pendingBrands?: number | null }) {
  const showCount = item.id === "brands" && pendingBrands !== undefined;
  const countDescription = typeof pendingBrands === "number" ? `รอเผยแพร่ ${pendingBrands} แบรนด์` : "ยังยืนยันจำนวนรอเผยแพร่ไม่ได้ เปิดรายการแบรนด์เพื่อตรวจสอบ";
  return <a className={`nav-link${item.id === section ? " active" : ""}`} href={item.href} aria-label={item.label} aria-description={showCount ? countDescription : undefined} aria-current={item.id === section ? "page" : undefined}><NavIcon path={item.icon} /><span>{item.label}</span>{showCount && <span className="hub-nav-count" aria-hidden="true" title={countDescription}>{pendingBrands ?? "…"}</span>}</a>;
}
function Group({ name, items, section, pendingBrands }: { name: keyof typeof hubGroups; items: Item[]; section: HubSection; pendingBrands?: number | null }) {
  const controls = useId(); const current = items.some(item => item.id === section); const [open, setOpen] = useState(current);
  useEffect(() => { let saved: string | null = null; try { saved = localStorage.getItem(`hub-navigation:${name}`); } catch { /* Unavailable storage keeps the current section open. */ } setOpen(current || saved === "open"); }, [name, current]);
  if (!items.length) return null;
  if (items.length === 1) return <NavLink item={items[0]} section={section} pendingBrands={pendingBrands} />;
  function toggle() { const next = !open; setOpen(next); try { localStorage.setItem(`hub-navigation:${name}`, next ? "open" : "closed"); } catch { /* Navigation remains usable without storage. */ } }
  return <section className="hub-nav-group"><button type="button" className="hub-nav-toggle" aria-expanded={open} aria-controls={controls} onClick={toggle}><span>{hubGroups[name]}</span><svg className="hub-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button><div id={controls} className="hub-nav-collapse" data-open={open} inert={!open} aria-hidden={!open}><div className="hub-nav-items">{items.map(item => <NavLink key={item.id} item={item} section={section} pendingBrands={pendingBrands} />)}</div></div></section>;
}
export function HubNavigation({ section, residential, finance, staff, publisher = false }: { section: HubSection; residential: boolean; finance: boolean; staff: boolean; publisher?: boolean }) {
  const accounts = useAccountDirectory();
  const { pendingCount } = useBrandReviews();
  const hosted = Boolean(useHostedSession());
  // Preserve the three existing workspace entry links; their landing pages still
  // explain account choices. Domain data and additional links keep their ACLs.
  const content = hubPages.filter(item => item.group === "content" && (item.id !== "knowledge" || !hosted) && (residential || item.id === "projects" || item.id === "brands"));
  const ads = hubPages.filter(item => item.group === "ads" && (finance || item.id === "registry"));
  return <nav className="hub-navigation" aria-label="เมนูหลัก"><Group name="content" items={content} section={section} pendingBrands={publisher ? pendingCount : undefined} /><Group name="ads" items={ads} section={section} />{staff && <div className="hub-nav-standalone"><NavLink item={hubPages.find(item => item.id === "questions")!} section={section} /></div>}{accounts.admin && <a className="nav-link" href="/admin/accounts" aria-current={section === "accounts" ? "page" : undefined}>ผู้ใช้และสิทธิ์ <span className="hub-nav-count" aria-label="บัญชีรออนุมัติ">{accounts.pending ?? "…"}</span></a>}</nav>;
}
