import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { ProjectContentWorkspace } from "@/components/project-content-workspace";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; brand?: string }> }) {
  const [account, role, query] = await Promise.all([getHubAccount(), getHubRole(), searchParams]);
  const section = query.brand ? "brands" : "projects";
  const allowed = can(account?.capabilities, section);
  return <HubShell section={section} staff={allowed} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>
    {allowed ? <ProjectContentWorkspace projectId={typeof query.project === "string" ? query.project : ""} brandId={typeof query.brand === "string" ? query.brand : ""} /> : <section className="panel"><h1>เนื้อหาเว็บไซต์</h1><p>บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลส่วนนี้</p></section>}
  </HubShell>;
}
