import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { ContentFieldRegistry } from "@/components/content-field-registry";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [account, role] = await Promise.all([getHubAccount(), getHubRole()]);
  const allowed = can(account?.capabilities, "projects");
  return <HubShell section="projects" staff={allowed} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>
    {allowed ? <ContentFieldRegistry /> : <section className="panel"><h1>ทะเบียนฟิลด์</h1><p>บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลโครงการ</p></section>}
  </HubShell>;
}
