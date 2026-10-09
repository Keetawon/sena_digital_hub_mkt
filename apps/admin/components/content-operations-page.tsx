import { can } from "@/lib/hub-permissions";
import { getHubRole, getHubAccount } from "@/lib/hosted-session";
import { HubShell } from "./hub-shell";
import { PromotionsWorkspace } from "./promotions-workspace";
import { ReleasesWorkspace } from "./releases-workspace";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isContentStaff, isHubStaff } from "@/lib/staff";

export async function ContentOperationsPage({ screen }: { screen: "promotions" | "releases" }) {
  const role = await getHubRole();
  const allowed = can((await getHubAccount())?.capabilities, screen);
  return <HubShell publisher={role === "publisher"} section={screen} registry staff={isHubStaff(role)} residential={allowed} finance={role === "admin"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เลือกบัญชี"}
    toolbar={isLocalMode() && <div className="local-banner" role="note"><strong>พื้นที่ทดสอบในเครื่อง · การเผยแพร่มีผลเฉพาะข้อมูลในระบบทดสอบ</strong></div>}>
    {allowed && role ? screen === "promotions" ? <PromotionsWorkspace role={role} /> : <ReleasesWorkspace role={role} /> : <section className="registry-panel"><h1>ไม่มีสิทธิ์เข้าถึงงานเนื้อหาที่อยู่อาศัย</h1><p>ข้อมูลนี้สำหรับผู้แก้ไข ผู้เผยแพร่ ผู้อ่าน และผู้ดูแลระบบที่ได้รับสิทธิ์</p><a className="registry-button" href="/">กลับหน้าหลัก</a></section>}
  </HubShell>;
}
