import { notFound } from "next/navigation";
import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { workflowText } from "@/lib/content-workflow";
import { HubShell } from "@/components/hub-shell";
import { PublicationWorkspace } from "@/components/publication-workspace";
import { LocalPersonaPicker } from "@/components/accounts";

export const dynamic = "force-dynamic";
export default async function Page() {
  const [account, role] = await Promise.all([getHubAccount(), getHubRole()]);
  if (account?.status !== "ACTIVE" || !(can(account.capabilities, "knowledge") || can(account.capabilities, "releases"))) notFound();
  return <HubShell workspace section={can(account.capabilities, "knowledge") ? "faq" : "releases"} staff roleLabel={role ? roleLabels[role] : workflowText.permission_required}
    toolbar={isLocalMode() && <LocalPersonaPicker initialRole={role} />}><PublicationWorkspace /></HubShell>;
}
