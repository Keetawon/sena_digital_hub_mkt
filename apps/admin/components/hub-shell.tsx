import type { ReactNode } from "react";
import { QuestionProvider } from "./pending-question";
import { HubAssistant } from "./hub-assistant";
import { HubNavigation } from "./hub-navigation";
import { hubGroups, hubPages, type HubSection } from "./hub-navigation-data";

export function HubShell({ section, roleLabel, toolbar, children, staff, residential = false, registry = false, finance = false }: {
  section: HubSection;
  roleLabel: string;
  staff: boolean;
  residential?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
  registry?: boolean;
  finance?: boolean;
}) {
  const page = hubPages.find(item => item.id === section);
  return <QuestionProvider enabled={staff}><div className="app-shell">
    <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
    <aside className="sidebar" aria-label="พื้นที่ทำงาน">
      <a className="wordmark" href="/" aria-label="SENA Digital Hub หน้ารวมโครงการ"><span className="sena">SENA<span className="brand-dot">.</span></span><span className="wordmark-caption">DIGITAL HUB</span></a>
      <HubNavigation section={section} residential={residential} finance={finance} staff={staff} />
      {staff && <HubAssistant key={roleLabel} />}
      <div className="sidebar-footer"><span className="scope-label">ข้อมูลและแคมเปญ</span><p>พื้นที่ทำงานร่วมกัน<br />สำหรับทีมการตลาด</p><div className="sidebar-rule" /><span className="small-text">ระบบหลังบ้านสำหรับทีมงาน</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">{page?.group && <><span>{hubGroups[page.group]}</span><span aria-hidden="true">/</span></>}<span>{page?.label}</span></div><div className="topbar-right"><span className="locale-tag">ไทย</span><span className="avatar" aria-hidden="true">{roleLabel.charAt(0)}</span><span>{roleLabel}</span></div></header>
      {toolbar}
      <main id="main-content" className={registry ? "registry-shell" : undefined} tabIndex={-1}>{children}</main>
      <footer className="page-footer"><span>SENA Digital Hub</span><span>ข้อมูลโครงการ · ทะเบียนแคมเปญ</span></footer>
    </div>
  </div></QuestionProvider>;
}
