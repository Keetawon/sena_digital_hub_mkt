"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { QuestionProvider } from "./pending-question";
import { HubAssistant } from "./hub-assistant";
import { HubNavigation } from "./hub-navigation";
import { hubGroups, hubPages, type HubSection } from "./hub-navigation-data";
import { BrandReviewProvider } from "./brand-review";
import { SignOut, useHostedSession } from "./hosted-session";
import { deferredH1Sections, h1Unavailable } from "@/lib/hosted-config";

export function HubShell({ section, roleLabel, toolbar, children, staff, residential = false, registry = false, finance = false, publisher = false }: {
  section: HubSection;
  roleLabel: string;
  staff: boolean;
  residential?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
  registry?: boolean;
  finance?: boolean;
  publisher?: boolean;
}) {
  const hosted = Boolean(useHostedSession());
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [medium, setMedium] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const wasOverlay = useRef(false);
  const [assistantTarget, setAssistantTarget] = useState<HTMLDivElement | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const tablet = window.matchMedia("(min-width: 721px) and (max-width: 1199px)");
    const update = () => { setNarrow(media.matches); setMedium(tablet.matches); setMenuOpen(false); setOverlay(false); };
    try { setCollapsed(localStorage.getItem("hub-sidebar:collapsed") === "true"); } catch { /* Default layout works without storage. */ }
    update(); media.addEventListener("change", update); tablet.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); tablet.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    if ((narrow && menuOpen) || overlay) drawer.current?.showModal(); else drawer.current?.close();
    if (!overlay && wasOverlay.current) sidebarToggle.current?.focus();
    wasOverlay.current = overlay;
  }, [narrow, menuOpen, overlay]);
  function closeMenu() { drawer.current?.close(); setMenuOpen(false); setOverlay(false); }
  function toggleSidebar() {
    if (medium) { setOverlay(!overlay); return; }
    const next = !collapsed; setCollapsed(next);
    try { localStorage.setItem("hub-sidebar:collapsed", String(next)); } catch { /* Toggle still works. */ }
  }
  const rail = !narrow && (medium || collapsed) && !overlay;
  function openAssistantFromNavigation() {
    if (overlay) { closeMenu(); return sidebarToggle.current; }
    if (!narrow) return null;
    closeMenu(); return menuButton.current;
  }
  const page = hubPages.find(item => item.id === section);
  const sidebar = <>
    {narrow && <button className="hub-menu-close" type="button" onClick={closeMenu}>ปิดเมนู <span aria-hidden="true">×</span></button>}
    <a className="wordmark" href="/" aria-label="SENA Digital Hub หน้ารวมโครงการ"><span className="sena">S<span className="wordmark-full">ENA</span><span className="brand-dot">.</span></span><span className="wordmark-caption">DIGITAL HUB</span></a>
    <HubNavigation section={section} residential={residential} finance={finance} staff={staff} publisher={publisher} />
    {staff && !hosted && <div ref={setAssistantTarget} className="hub-assistant-slot" />}
    {staff && hosted && <button className="nav-link assistant-trigger" type="button" aria-label="ผู้ช่วย Hub" aria-disabled="true" aria-description={h1Unavailable}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5" /></svg><span className="hub-nav-label">ผู้ช่วย: {h1Unavailable}</span><span className="hub-nav-tooltip" role="tooltip">ผู้ช่วย: {h1Unavailable}</span></button>}
    {!narrow && <button ref={sidebarToggle} type="button" className="hub-sidebar-toggle" aria-label={rail ? "ขยายเมนู" : "ย่อเมนู"} aria-expanded={!rail} aria-controls={menuId} onClick={toggleSidebar}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={rail ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} /></svg><span className="hub-nav-label">{rail ? "ขยายเมนู" : "ย่อเมนู"}</span><span className="hub-nav-tooltip" role="tooltip">{rail ? "ขยายเมนู" : "ย่อเมนู"}</span></button>}
  </>;
  return <QuestionProvider enabled={staff}><BrandReviewProvider key={roleLabel} enabled={residential && (section === "brands" || publisher)}><div className="app-shell" data-staff={staff} data-sidebar-collapsed={collapsed}>
    <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
    {narrow || overlay ? <dialog ref={drawer} id={menuId} className={`sidebar ${narrow ? "hub-mobile-drawer" : "hub-sidebar-overlay"}`} aria-label="เมนูพื้นที่ทำงาน" onClose={closeMenu} onCancel={closeMenu} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMenu();
    }}>{sidebar}</dialog> : <aside id={menuId} className="sidebar" data-rail={rail} aria-label="พื้นที่ทำงาน">{sidebar}</aside>}
    {staff && !hosted && <HubAssistant key={roleLabel} navigationTarget={assistantTarget} onNavigationOpen={openAssistantFromNavigation} />}
    <div className="main-shell">
      <header className="topbar"><div className="hub-topbar-navigation"><button ref={menuButton} className="button secondary hub-menu-toggle" type="button" aria-label="เปิดเมนู" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg><span>เมนู</span></button><div className="breadcrumb">{page?.group && <><span>{hubGroups[page.group]}</span><span aria-hidden="true">/</span></>}<span>{page?.label}</span></div></div><div className="topbar-right"><span className="locale-tag">ไทย</span><span className="avatar" aria-hidden="true">{roleLabel.charAt(0)}</span><span>{roleLabel}</span></div></header>
      {hosted && <div className="hosted-h1-note" role="note"><strong>พื้นที่ TEST H1 · ข้อมูลสมมติ</strong><span> · ปิดการออกชื่อแคมเปญ</span> <SignOut /></div>}
      {toolbar}
      <main id="main-content" className={registry ? "registry-shell" : undefined} tabIndex={-1}>{hosted && deferredH1Sections.has(section) ? <section className="registry-panel hosted-unavailable"><h1>{page?.label}</h1><p role="note">{h1Unavailable}</p><p>พื้นที่นี้ยังไม่เชื่อมข้อมูลหรือเริ่มงานเบื้องหลังใน TEST H1</p><a className="button secondary" href="/ads/registry">กลับไปทะเบียนแคมเปญ</a></section> : children}</main>
      <footer className="page-footer"><span>SENA Digital Hub</span><span>ข้อมูลโครงการ · ทะเบียนแคมเปญ</span></footer>
    </div>
  </div></BrandReviewProvider></QuestionProvider>;
}
