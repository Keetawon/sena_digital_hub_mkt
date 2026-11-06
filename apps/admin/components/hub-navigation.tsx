"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import "./hub-navigation.css";

import { hubPages, hubServices, hubUtilities, hubPermissionTab, type HubMenuItem } from "./hub-navigation-data";
import { useHubPermissions } from "./accounts";
import { isContentAdmin } from "@/lib/hub-permissions";
import { useBrandReviews } from "./brand-review";

type Item = { key: string; href: string; label: string; icon: string };
function NavIcon({ path }: { path: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

function NavLink({ item, current, count }: { item: Item; current: string; count?: number | null }) {
  const countDescription = item.key === "accounts" ? "บัญชีรออนุมัติ" : typeof count === "number" ? `รอเผยแพร่ ${count} แบรนด์` : "ยังยืนยันจำนวนรอเผยแพร่ไม่ได้ เปิดรายการแบรนด์เพื่อตรวจสอบ";
  const separateQueue = item.key === "website" && count !== undefined;
  const link = <a className={`nav-link${item.key === current ? " active" : ""}`} href={item.href} aria-label={item.label} title={item.label} aria-description={!separateQueue && count !== undefined ? countDescription : undefined} aria-current={item.key === current ? "page" : undefined}>
    <NavIcon path={item.icon} /><span className="hub-nav-label">{item.label}</span><span className="hub-nav-tooltip" role="tooltip">{item.label}</span>
    {!separateQueue && count !== undefined && <span className="hub-nav-count" aria-label={countDescription} title={countDescription}>{count ?? "…"}</span>}
  </a>;
  return separateQueue ? <div className="hub-nav-link-row">{link}<a className="hub-brand-count-link" href="/website?view=brands" aria-label={countDescription} title={countDescription}><span className="hub-nav-count">{count ?? "…"}</span><span className="hub-nav-tooltip" role="tooltip">{countDescription}</span></a></div> : link;
}

function Disclosure({ name, label, icon, current, service = false, children }: { name: string; label: string; icon?: string; current: boolean; service?: boolean; children: ReactNode }) {
  const controls = useId();
  const [open, setOpen] = useState(current);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(`hub-navigation:${name}`); } catch { /* Current service remains usable without storage. */ }
    setOpen(saved === null ? current : saved === "open");
  }, [name, current]);
  function toggle() {
    const next = !open; setOpen(next);
    try { localStorage.setItem(`hub-navigation:${name}`, next ? "open" : "closed"); } catch { /* Navigation remains usable without storage. */ }
  }
  return <section className={service ? "hub-nav-service" : "hub-nav-group"}>
    <button type="button" className={`hub-nav-toggle${service ? " hub-service-toggle" : ""}`} aria-label={label} title={label} aria-description={current && !open ? "มีหน้าที่กำลังใช้งานอยู่ในกลุ่มนี้" : undefined} data-current={current && !open} aria-expanded={open} aria-controls={controls} onClick={toggle}>
      {icon && <NavIcon path={icon} />}<span className="hub-nav-label">{label}</span><span className="hub-nav-tooltip" role="tooltip">{label}</span>
      <svg className="hub-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div id={controls} className="hub-nav-collapse" data-open={open} inert={!open} aria-hidden={!open}><div className="hub-nav-items">{children}</div></div>
  </section>;
}

export function HubNavigation({ current, location }: { current: string; location: string }) {
  const accounts = useHubPermissions();
  const { pendingCount } = useBrandReviews();
  const query = new URL(location, "https://hub.invalid").searchParams;
  const internalAdmin = isContentAdmin(accounts.account);
  function resolve(item: HubMenuItem): Item | null {
    if (item.adminOnly && !internalAdmin) return null;
    const target = item.targets.find(target => target.section === "accounts" ? accounts.admin : accounts.can(hubPermissionTab(target.section)));
    if (!target) return null;
    const page = hubPages.find(page => page.id === target.section)!;
    const tab = accounts.capabilities.catalog?.find(tab => tab.tab === hubPermissionTab(target.section));
    if (target.section !== "accounts" && !tab) return null;
    const href = new URL(target.href, "https://hub.invalid");
    if (item.projectContext && query.get("project")) href.searchParams.set("project", query.get("project")!);
    return { key: item.key, href: href.pathname + href.search + href.hash, label: item.label ?? tab?.label_th ?? page.label, icon: item.icon ?? page.icon };
  }
  const count = (item: Item) => item.key === "website" && accounts.can("brands", "approve") ? pendingCount : item.key === "accounts" ? accounts.pending ?? null : undefined;
  const links = (items: Item[]) => items.map(item => <NavLink key={item.key} item={item} current={current} count={count(item)} />);
  const services = hubServices.map(service => ({ ...service, groups: service.groups.map(group => ({ ...group, items: group.items.map(resolve).filter((item): item is Item => item !== null) })).filter(group => group.items.length) })).filter(service => service.groups.length);
  const utilities = hubUtilities.map(resolve).filter((item): item is Item => item !== null);
  return <nav className="hub-navigation" aria-label="เมนูหลัก">
    <div className="hub-nav-services">{services.map(service => <Disclosure key={service.key} name={service.key} label={service.label} icon={service.icon} current={service.groups.some(group => group.items.some(item => item.key === current))} service>
      {service.groups.map(group => group.label ? <Disclosure key={group.key} name={group.key} label={group.label} icon={group.icon} current={group.items.some(item => item.key === current)}>{links(group.items)}</Disclosure> : <div className="hub-nav-group" key={group.key}>{links(group.items)}</div>)}
    </Disclosure>)}</div>
    {utilities.length > 0 && <div className="hub-nav-standalone">{links(utilities)}</div>}
  </nav>;
}
