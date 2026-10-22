import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { ProjectMediaWorkspace } from "@/components/project-media-workspace";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const [account, role, query] = await Promise.all([getHubAccount(), getHubRole(), searchParams]);
  const allowed = can(account?.capabilities, "projects");
  return <HubShell section="projects" staff={allowed} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>
    {allowed ? <ProjectMediaWorkspace projectId={typeof query.project === "string" ? query.project : ""} /> : <section className="panel"><h1>สื่อโครงการ</h1><p>บัญชีนี้ไม่มีสิทธิ์ดูสื่อโครงการ</p></section>}
  </HubShell>;
}
