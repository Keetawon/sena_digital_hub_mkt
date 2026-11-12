"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { QuestionProvider } from "./pending-question";
import { HubAssistant } from "./hub-assistant";
import { HubNavigation } from "./hub-navigation";
import { hubGroups, hubPages, hubPermissionTab, hubCurrentMenuKey, hubMenuItem, type HubSection } from "./hub-navigation-data";
import { BrandReviewProvider } from "./brand-review";
import { SignOut, useHostedSession } from "./hosted-session";
import { deferredH1Sections, h1Unavailable } from "@/lib/hosted-config";
import { canWorkspace, canOpenPage, capabilityKey } from "@/lib/hub-permissions";
import { accountManagementKey, useHubPermissions } from "./accounts";
import { WorkspaceSearch } from "./workspace-search";
import { workspaceCopy } from "@/lib/workspace-copy";

export function HubShell({ section, roleLabel, toolbar, children, registry = false, workspace = false }: {
  section: HubSection;
  roleLabel: string;
  staff: boolean;
  residential?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
  registry?: boolean;
  finance?: boolean;
  publisher?: boolean;
  workspace?: boolean;
}) {
  const hostedConfig = useHostedSession();
  const hosted = Boolean(hostedConfig);
  const permissions = useHubPermissions();
  const staff = permissions.account?.status === "ACTIVE" && permissions.capabilities.published_consumer;
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [medium, setMedium] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const wasOverlay = useRef(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allowed = workspace
    ? canWorkspace(permissions.capabilities) && Boolean(permissions.account && canOpenPage(permissions.account, pathname, new URLSearchParams(searchParams.toString())))
    : section === "accounts" ? permissions.admin : permissions.can(hubPermissionTab(section));
  const [hash, setHash] = useState("");
  const location = pathname + (searchParams.size ? `?${searchParams}` : "") + hash;
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update(); window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [pathname, searchParams]);
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
  const currentMenu = hubCurrentMenuKey(section, location);
  const menuItem = hubMenuItem(currentMenu);
  const presentation = hubPages.find(item => item.id === section);
  const catalog = permissions.capabilities.catalog?.find(tab => tab.tab === hubPermissionTab(section));
  const page = presentation && { ...presentation, label: menuItem?.label ?? ("permissionTab" in presentation ? presentation.label : catalog?.label_th ?? presentation.label) };
  const sidebar = <>
    {narrow && <button className="hub-menu-close" type="button" onClick={closeMenu}>ปิดเมนู <span aria-hidden="true">×</span></button>}
    <div className="hub-brand-header">
      <a className="hub-brand-logo" href="/home" aria-label="หน้าแรก"><img className="hub-logo-full" src="/brand/sena-development-logo.png" width="1001" height="645" alt="SENA Development" /><img className="hub-logo-mark" src="/brand/sena-development-mark.png" width="1001" height="506" alt="" /></a>
      {!narrow && <button ref={sidebarToggle} type="button" className="hub-sidebar-toggle" aria-label={rail ? "ขยายเมนู" : "ย่อเมนู"} title={rail ? "ขยายเมนู" : "ย่อเมนู"} aria-expanded={!rail} aria-controls={menuId} onClick={toggleSidebar}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={rail ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} /></svg><span className="hub-nav-tooltip" role="tooltip">{rail ? "ขยายเมนู" : "ย่อเมนู"}</span></button>}
    </div>
    <HubNavigation current={currentMenu} location={location} />
  </>;
  return <QuestionProvider enabled={permissions.can("questions")}><BrandReviewProvider key={permissions.account?.id ?? roleLabel} enabled={permissions.can("brands") && (section === "brands" || permissions.can("brands", "approve"))}><div className="app-shell" data-staff={staff} data-sidebar-collapsed={collapsed}>
    <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
    {narrow || overlay ? <dialog ref={drawer} id={menuId} className={`sidebar ${narrow ? "hub-mobile-drawer" : "hub-sidebar-overlay"}`} aria-label="เมนูพื้นที่ทำงาน" onClose={closeMenu} onCancel={closeMenu} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMenu();
    }}>{sidebar}</dialog> : <aside id={menuId} className="sidebar" data-rail={rail} aria-label="พื้นที่ทำงาน">{sidebar}</aside>}
    {staff && !hosted && <HubAssistant key={permissions.account?.id} navigationTarget={null} onNavigationOpen={() => null} />}
    {staff && hosted && <button className="button secondary workspace-assistant-disabled" type="button" disabled title={workspaceCopy.assistant_disabled}>{workspaceCopy.ask}<small>{workspaceCopy.assistant_disabled}</small></button>}
    <div className="main-shell">
      <header className="topbar"><div className="hub-topbar-navigation"><button ref={menuButton} className="button secondary hub-menu-toggle" type="button" aria-label="เปิดเมนู" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg><span>เมนู</span></button><div className="breadcrumb">{page?.group && <><span>{hubGroups[page.group]}</span><span aria-hidden="true">/</span></>}<span>{page?.label}</span></div></div>{staff && canWorkspace(permissions.capabilities) && <WorkspaceSearch key={capabilityKey(permissions.account)} hosted={hosted} />}<div className="topbar-right"><span className="locale-tag">ไทย</span><span className="avatar" aria-hidden="true">{roleLabel.charAt(0)}</span><span>{roleLabel}</span></div></header>
      {hostedConfig && <div className="hosted-h1-note" role="note"><strong>{hostedConfig.label} · {hostedConfig.simulation ? "ข้อมูลสมมติ" : "ตรวจแหล่งข้อมูลและสถานะก่อนใช้งาน"}</strong><span> · ปิดการออกชื่อแคมเปญ</span> <SignOut /></div>}
      {toolbar}
      <main id="main-content" className={registry ? "registry-shell" : undefined} tabIndex={-1}>{!permissions.ready ? <p role="status">กำลังตรวจสิทธิ์การใช้งาน…</p> : permissions.error && !permissions.account ? <p role="alert">{permissions.error}</p> : permissions.signedOut || permissions.account && !allowed ? <section className="registry-panel"><h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1><p>เลือกหน้าที่ได้รับสิทธิ์จากเมนู หรือขอให้ผู้ดูแลปรับสิทธิ์ให้บัญชีนี้</p>{permissions.account?.status !== "ACTIVE" && <a href="/account/request">ตรวจสถานะบัญชี</a>}</section> : hosted && deferredH1Sections.has(section) ? <section className="registry-panel hosted-unavailable"><h1>{page?.label}</h1><p role="note">{h1Unavailable}</p><p>พื้นที่นี้ยังไม่เชื่อมข้อมูลหรือเริ่มงานเบื้องหลังใน TEST H1</p><a className="button secondary" href="/ads/registry">กลับไปทะเบียนแคมเปญ</a></section> : <Fragment key={section === "accounts" ? accountManagementKey(permissions.account) : capabilityKey(permissions.account)}>{children}</Fragment>}</main>
      <footer className="page-footer"><span>SENA Digital Hub</span><span>ข้อมูลโครงการ · ทะเบียนแคมเปญ</span></footer>
    </div>
  </div></BrandReviewProvider></QuestionProvider>;
}
