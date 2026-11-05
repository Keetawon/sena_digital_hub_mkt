import { WorkspaceHome } from "@/components/workspace-home";
import { getHubRole } from "@/lib/hosted-session";
import { isLocalMode } from "@/lib/local-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <WorkspaceHome localMode={isLocalMode()} initialRole={await getHubRole()} />;
}
