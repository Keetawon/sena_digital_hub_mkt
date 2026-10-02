import { getHubRole } from "@/lib/hosted-session";
import { HubShell } from "./hub-shell";
import { AdsOperations, type OperationScreen } from "./ads-operations";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isHubStaff, isContentStaff } from "@/lib/staff";

export async function AdsOperationsPage({ screen }: { screen: OperationScreen }) {
  const role = await getHubRole();
  const allowed = isLocalMode() && (role === "online_staff" || role === "admin");
  return <HubShell publisher={role === "publisher"} section={screen} registry staff={isHubStaff(role)} residential={isContentStaff(role)} finance={role === "admin" || role === "online_staff"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เลือกบัญชี"}
    toolbar={isLocalMode() && <div className="local-banner" role="note"><strong>พื้นที่ทดสอบในเครื่อง · ข้อมูลตัวอย่าง</strong></div>}>
    {allowed ? <AdsOperations screen={screen} /> : <section className="registry-panel"><h1>ไม่มีสิทธิ์เข้าถึงผลการตลาดและเอกสาร</h1><p>ข้อมูลนี้สำหรับทีมออนไลน์และผู้ดูแลระบบที่ได้รับสิทธิ์เท่านั้น</p><a className="registry-button" href="/ads/registry">กลับไปทะเบียนแคมเปญ</a></section>}
  </HubShell>;
}
