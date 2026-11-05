import { can, isContentAdmin } from "@/lib/hub-permissions";
import { getHubRole, getHubAccount } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isHostedMode } from "@/lib/hosted-config";
import { isContentStaff } from "@/lib/staff";
import { HubShell } from "@/components/hub-shell";
import { KnowledgeReview } from "@/components/knowledge-review";
export const dynamic = "force-dynamic";
export default async function Page() {
  const [role, account] = await Promise.all([getHubRole(), getHubAccount()]);
  const allowed = (isLocalMode() || isHostedMode()) && isContentAdmin(account) && can(account?.capabilities, "knowledge");
  return <HubShell section="knowledge" staff={allowed} residential={isContentStaff(role)} publisher={role === "publisher"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เลือกบัญชี"}>
    {allowed && role ? <KnowledgeReview role={role} allowPreview={isLocalMode()} hostedFiles={isHostedMode()} /> : <section className="registry-panel"><h1>คลังความรู้โครงการ</h1><p>บัญชีนี้ยังไม่มีสิทธิ์ดูคลังความรู้</p><a href="/">กลับหน้าหลัก</a></section>}
  </HubShell>;
}
