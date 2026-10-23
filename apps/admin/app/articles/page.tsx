import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { ArticlesWorkspace } from "@/components/articles-workspace";

export const dynamic = "force-dynamic";
export default async function Page() {
  const [account, role] = await Promise.all([getHubAccount(), getHubRole()]);
  const allowed = can(account?.capabilities, "knowledge");
  return <HubShell section="articles" staff={allowed} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>
    {allowed ? <ArticlesWorkspace /> : <section className="panel"><h1>บทความ</h1><p>บัญชีนี้ยังไม่มีสิทธิ์ดูบทความ</p></section>}
  </HubShell>;
}
