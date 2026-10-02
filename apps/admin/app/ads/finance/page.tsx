import { getHubRole } from "@/lib/hosted-session";
import { AdsFinance } from "@/components/ads-finance";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { isHostedMode } from "@/lib/hosted-config";
import { isContentStaff, isHubStaff } from "@/lib/staff";
import { HubShell } from "@/components/hub-shell";

export const dynamic = "force-dynamic";
export default async function Page() {
  const role = await getHubRole();
  if (isHostedMode()) return <HubShell section="finance" staff={isHubStaff(role)} residential={isContentStaff(role)} publisher={role === "publisher"} finance={role === "admin" || role === "online_staff"} roleLabel={role ? roleLabels[role] : "ยังไม่ได้เข้าสู่ระบบ"}>{null}</HubShell>;
  return <AdsFinance initialRole={role} localMode={isLocalMode()} />;
}
