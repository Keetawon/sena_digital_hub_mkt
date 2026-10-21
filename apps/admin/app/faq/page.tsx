import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { FaqWorkspace } from "@/components/faq-workspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [account, role] = await Promise.all([getHubAccount(), getHubRole()]);
  const allowed = can(account?.capabilities, "knowledge");
  return <HubShell section="faq" staff={allowed} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>
    {allowed ? <FaqWorkspace /> : <section className="panel"><h1>คลัง FAQ เว็บไซต์</h1><p>บัญชีนี้ยังไม่มีสิทธิ์ดูคลัง FAQ</p></section>}
  </HubShell>;
}
