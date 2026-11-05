import { can } from "@/lib/hub-permissions";
import { getHubAccount, getHubRole } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { LocalPersonaPicker } from "@/components/accounts";
import { WebsiteTree } from "@/components/website-tree";
import { workspaceText } from "@/lib/unified-workspace";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [account, role, query] = await Promise.all([getHubAccount(), getHubRole(), searchParams]);
  const section = query.view === "brands" && can(account?.capabilities, "brands") ? "brands"
    : can(account?.capabilities, "projects") ? "projects" : can(account?.capabilities, "brands") ? "brands" : "faq";
  return <HubShell workspace section={section} staff={Boolean(role)} roleLabel={role ? roleLabels[role] : workspaceText.empty} toolbar={isLocalMode() && <LocalPersonaPicker initialRole={role} />}>{role && <WebsiteTree role={role} />}</HubShell>;
}

