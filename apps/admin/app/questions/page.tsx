import { can } from "@/lib/hub-permissions";
import { getHubRole, getHubAccount } from "@/lib/hosted-session";
import { HubShell } from "@/components/hub-shell";
import { QuestionsList } from "@/components/pending-question";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isHubStaff, isContentStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function Page() {
  const role = await getHubRole();
  const staff = can((await getHubAccount())?.capabilities, "questions");
  return <HubShell publisher={role === "publisher"} section="questions" staff={staff} residential={isContentStaff(role)} finance={role === "online_staff" || role === "admin"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เลือกบัญชี"}
    toolbar={isLocalMode() && <div className="local-banner" role="note"><p><strong>พื้นที่ทดสอบในเครื่อง</strong> · คำถามนโยบายสำหรับทีมงาน</p></div>}>
    <div className="questions-page">{staff ? <><h1>คำถามที่รอคำตอบ</h1><p className="questions-intro">รวมคำถาม ผู้รับผิดชอบ และแนวทางที่ใช้ระหว่างรอคำตอบ การแสดงรายการนี้ไม่ได้หมายถึงอนุมัติการใช้งานจริง</p><QuestionsList /></> : <><h1>ไม่มีสิทธิ์เข้าถึงคำถามของทีมงาน</h1><p className="questions-intro">หน้านี้สำหรับบัญชีทีมงานที่ได้รับสิทธิ์เท่านั้น</p><a className="button" href="/ads/registry">กลับไปทะเบียนแคมเปญ</a></>}</div>
  </HubShell>;
}
