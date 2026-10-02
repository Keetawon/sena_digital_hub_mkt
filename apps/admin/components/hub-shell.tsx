"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { QuestionProvider } from "./pending-question";
import { HubAssistant } from "./hub-assistant";
import { HubNavigation } from "./hub-navigation";
import { hubGroups, hubPages, type HubSection } from "./hub-navigation-data";
import { BrandReviewProvider } from "./brand-review";

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
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantTarget, setAssistantTarget] = useState<HTMLDivElement | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => { setNarrow(media.matches); setMenuOpen(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (narrow && menuOpen) drawer.current?.showModal(); else drawer.current?.close();
  }, [narrow, menuOpen]);
  function closeMenu() { drawer.current?.close(); setMenuOpen(false); }
  function openAssistantFromNavigation() {
    if (!narrow) return null;
    closeMenu(); return menuButton.current;
  }
  const page = hubPages.find(item => item.id === section);
  const sidebar = <>
    {narrow && <button className="hub-menu-close" type="button" onClick={closeMenu}>ปิดเมนู <span aria-hidden="true">×</span></button>}
    <a className="wordmark" href="/" aria-label="SENA Digital Hub หน้ารวมโครงการ"><span className="sena">SENA<span className="brand-dot">.</span></span><span className="wordmark-caption">DIGITAL HUB</span></a>
    <HubNavigation section={section} residential={residential} finance={finance} staff={staff} publisher={publisher} />
    {staff && <div ref={setAssistantTarget} className="hub-assistant-slot" />}
    <div className="sidebar-footer"><span className="scope-label">ข้อมูลและแคมเปญ</span><p>พื้นที่ทำงานร่วมกัน<br />สำหรับทีมการตลาด</p><div className="sidebar-rule" /><span className="small-text">ระบบหลังบ้านสำหรับทีมงาน</span></div>
  </>;
  return <QuestionProvider enabled={staff}><BrandReviewProvider key={roleLabel} enabled={residential && (section === "brands" || publisher)}><div className="app-shell" data-staff={staff}>
    <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
    {narrow ? <dialog ref={drawer} id={menuId} className="sidebar hub-mobile-drawer" aria-label="เมนูพื้นที่ทำงาน" onClose={() => setMenuOpen(false)} onCancel={() => setMenuOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMenu();
    }}>{sidebar}</dialog> : <aside id={menuId} className="sidebar" aria-label="พื้นที่ทำงาน">{sidebar}</aside>}
    {staff && <HubAssistant key={roleLabel} navigationTarget={assistantTarget} onNavigationOpen={openAssistantFromNavigation} />}
    <div className="main-shell">
      <header className="topbar"><div className="hub-topbar-navigation"><button ref={menuButton} className="button secondary hub-menu-toggle" type="button" aria-label="เปิดเมนู" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg><span>เมนู</span></button><div className="breadcrumb">{page?.group && <><span>{hubGroups[page.group]}</span><span aria-hidden="true">/</span></>}<span>{page?.label}</span></div></div><div className="topbar-right"><span className="locale-tag">ไทย</span><span className="avatar" aria-hidden="true">{roleLabel.charAt(0)}</span><span>{roleLabel}</span></div></header>
      {toolbar}
      <main id="main-content" className={registry ? "registry-shell" : undefined} tabIndex={-1}>{children}</main>
      <footer className="page-footer"><span>SENA Digital Hub</span><span>ข้อมูลโครงการ · ทะเบียนแคมเปญ</span></footer>
    </div>
  </div></BrandReviewProvider></QuestionProvider>;
}
