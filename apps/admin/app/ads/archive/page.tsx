import { can } from "@/lib/hub-permissions";
import { getHubRole, getHubAccount } from "@/lib/hosted-session";
import { ArchiveWorkspace } from "@/components/archive-workspace";
import { HubShell } from "@/components/hub-shell";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isContentStaff, isHubStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";
export default async function Page() {
  const role = await getHubRole();
  const allowed = isLocalMode() && can((await getHubAccount())?.capabilities, "archive");
  return <HubShell publisher={role === "publisher"} section="archive" registry staff={isHubStaff(role)} residential={isContentStaff(role)} finance={role === "admin" || role === "online_staff"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เลือกบัญชี"}
    toolbar={isLocalMode() && <div className="local-banner" role="note"><strong>พื้นที่ทดสอบในเครื่อง · รับเฉพาะเอกสารตัวอย่างที่ระบบจัดเตรียม</strong></div>}>
    {allowed && role ? <ArchiveWorkspace role={role} /> : <section className="registry-panel"><h1>ไม่มีสิทธิ์เข้าถึงคลังเอกสาร</h1><p>เอกสารนี้สำหรับทีมออนไลน์และผู้ดูแลระบบที่ได้รับสิทธิ์เท่านั้น</p><a className="registry-button" href="/ads/registry">กลับไปทะเบียนแคมเปญ</a></section>}
  </HubShell>;
}
