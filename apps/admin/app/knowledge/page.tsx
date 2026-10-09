import { can } from "@/lib/hub-permissions";
import { getHubRole, getHubAccount } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isContentStaff } from "@/lib/staff";
import { HubShell } from "@/components/hub-shell";
import { KnowledgeReview } from "@/components/knowledge-review";
export const dynamic = "force-dynamic";
export default async function Page() {
  const role = await getHubRole(); const allowed = isLocalMode() && can((await getHubAccount())?.capabilities, "knowledge");
  return <HubShell section="knowledge" staff={allowed} residential={isContentStaff(role)} publisher={role === "publisher"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เลือกบัญชี"}>
    {allowed && role ? <KnowledgeReview role={role} /> : <section className="registry-panel"><h1>คลังความรู้โครงการ</h1><p>ระยะทดลองเปิดให้ทีมงานตรวจข้อมูลเฉพาะในเครื่องเท่านั้น</p><a href="/">กลับหน้าหลัก</a></section>}
  </HubShell>;
}
