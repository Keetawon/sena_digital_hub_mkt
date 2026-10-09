import { getHubRole, getHubAccount } from "@/lib/hosted-session";
import { HubShell } from "@/components/hub-shell";
import { AdminAccounts } from "@/components/admin-accounts";
import { roleLabels } from "@/lib/roles";
export const dynamic = "force-dynamic";
export default async function Page() {
  const role = await getHubRole(); const manager = (await getHubAccount())?.capabilities?.can_manage_users === true;
  return <HubShell section="accounts" staff={manager} residential={manager} finance={manager} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>{manager ? <AdminAccounts /> : <section className="registry-panel"><h1>เฉพาะผู้ดูแลระบบ</h1></section>}</HubShell>;
}
