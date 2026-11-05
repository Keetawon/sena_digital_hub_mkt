import { notFound } from "next/navigation";
import { can, isContentAdmin } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { LocalPersonaPicker } from "@/components/accounts";
import { ContentActivityLog } from "@/components/content-activity-log";
import { workspaceText } from "@/lib/unified-workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const [account, role] = await Promise.all([getHubAccount(), getHubRole()]);
  if (!isContentAdmin(account)) notFound();
  const section = can(account?.capabilities, "projects") ? "projects" : can(account?.capabilities, "brands") ? "brands" : "faq";
  return <HubShell workspace section={section} staff roleLabel={role ? roleLabels[role] : workspaceText.empty} toolbar={isLocalMode() && <LocalPersonaPicker initialRole={role} />}><ContentActivityLog /></HubShell>;
}

