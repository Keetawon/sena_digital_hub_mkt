import type { ReactNode } from "react";

const sections = [
  { id: "projects", href: "/", label: "โครงการที่อยู่อาศัย", path: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { id: "brands", href: "/?view=brands", label: "แบรนด์ที่อยู่อาศัย", path: "M4 21V6l8-3v18M12 9h8v12M2 21h20M7 8v2M7 13v2M16 12v2M16 17v2" },
  { id: "registry", href: "/ads/registry", label: "ทะเบียนแคมเปญ", path: "M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" },
] as const;

export function HubShell({ section, roleLabel, toolbar, children, registry = false, finance = false }: {
  section: typeof sections[number]["id"] | "finance";
  roleLabel: string;
  toolbar?: ReactNode;
  children: ReactNode;
  registry?: boolean;
  finance?: boolean;
}) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
    <aside className="sidebar" aria-label="พื้นที่ทำงาน">
      <a className="wordmark" href="/" aria-label="SENA Digital Hub หน้ารวมโครงการ"><span className="sena">SENA<span className="brand-dot">.</span></span><span className="wordmark-caption">DIGITAL HUB</span></a>
      <div className="workspace-label">พื้นที่ทำงาน</div>
      <nav aria-label="เมนูหลัก">{sections.map(item => <a key={item.id} href={item.href} className={`nav-link${section === item.id ? " active" : ""}`} aria-current={section === item.id ? "page" : undefined}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg><span>{item.label}</span>
      </a>)}</nav>
      {finance && <nav className="finance-sidebar" aria-label="งานงบและค่าใช้จ่าย"><a className={`nav-link${section === "finance" ? " active" : ""}`} href="/ads/finance" aria-current={section === "finance" ? "page" : undefined}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true"><path d="M4 3h16v18H4zM8 7h8M8 11h8M8 15h3M15 15h1" /></svg><span>งบและค่าใช้จ่าย</span></a></nav>}
      <div className="sidebar-footer"><span className="scope-label">ข้อมูลและแคมเปญ</span><p>พื้นที่ทำงานร่วมกัน<br />สำหรับทีมการตลาด</p><div className="sidebar-rule" /><span className="small-text">ระบบหลังบ้านสำหรับทีมงาน</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>พื้นที่ทำงาน</span><span aria-hidden="true">/</span><span>{section === "finance" ? "งบและค่าใช้จ่าย" : sections.find(item => item.id === section)?.label}</span></div><div className="topbar-right"><span className="locale-tag">ไทย</span><span className="avatar" aria-hidden="true">{roleLabel.charAt(0)}</span><span>{roleLabel}</span></div></header>
      {toolbar}
      <main id="main-content" className={registry ? "registry-shell" : undefined} tabIndex={-1}>{children}</main>
      <footer className="page-footer"><span>SENA Digital Hub</span><span>ข้อมูลโครงการ · ทะเบียนแคมเปญ</span></footer>
    </div>
  </div>;
}
