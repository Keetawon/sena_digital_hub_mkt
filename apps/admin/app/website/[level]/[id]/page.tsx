import { notFound } from "next/navigation";
import { getHubRole } from "@/lib/hosted-session";
import { isLocalMode, roleLabels } from "@/lib/local-session";
import { HubShell } from "@/components/hub-shell";
import { LocalPersonaPicker } from "@/components/accounts";
import { EntityWorkspace } from "@/components/entity-workspace";
import { workspaceText, type WorkspaceLevel } from "@/lib/unified-workspace";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ level: string; id: string }> }) {
  const [{ level, id }, role] = await Promise.all([params, getHubRole()]);
  if (!["corporate", "business", "brand", "project", "programme", "project_group", "unit_type"].includes(level) || !id || id.length > 200) notFound();
  const section = level === "brand" ? "brands" : level === "project" || level === "unit_type" || level === "project_group" ? "projects" : "faq";
  return <HubShell workspace section={section} staff={Boolean(role)} roleLabel={role ? roleLabels[role] : workspaceText.empty} toolbar={isLocalMode() && <LocalPersonaPicker initialRole={role} />}>
    {role && <EntityWorkspace level={level as WorkspaceLevel} id={id} role={role} />}
  </HubShell>;
}

