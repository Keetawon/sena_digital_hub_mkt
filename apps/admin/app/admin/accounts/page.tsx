import { getHubRole } from "@/lib/hosted-session";
import { HubShell } from "@/components/hub-shell";
import { AdminAccounts } from "@/components/accounts";
import { roleLabels } from "@/lib/roles";
export const dynamic = "force-dynamic";
export default async function Page() {
  const role = await getHubRole();
  return <HubShell section="accounts" staff={role === "admin"} residential={role === "admin"} finance={role === "admin"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>{role === "admin" ? <AdminAccounts /> : <section className="registry-panel"><h1>เฉพาะผู้ดูแลระบบ</h1></section>}</HubShell>;
}
