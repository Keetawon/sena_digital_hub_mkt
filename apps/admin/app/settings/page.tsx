import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { LocalPersonaPicker } from "@/components/accounts";
import { WorkspaceSettings } from "@/components/workspace-settings";
import { workspaceText } from "@/lib/unified-workspace";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const [account, role, query] = await Promise.all([getHubAccount(), getHubRole(), searchParams]);
  const knowledge = query.section === "bank" || query.section === "glossary" || !query.section && can(account?.capabilities, "knowledge");
  return <HubShell workspace section={knowledge ? "faq" : "projects"} staff={Boolean(role)} roleLabel={role ? roleLabels[role] : workspaceText.empty} toolbar={isLocalMode() && <LocalPersonaPicker initialRole={role} />}><WorkspaceSettings /></HubShell>;
}

