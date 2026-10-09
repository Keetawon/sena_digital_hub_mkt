import { PermissionBoundary } from "@/components/accounts";
import { getHubRole } from "@/lib/hosted-session";
import { isLocalMode } from "@/lib/local-session";
import { HubAdmin } from "@/components/hub-admin";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; brand?: string; view?: string; version?: string; draft_at?: string }> }) {
  const query = await searchParams;
  const localMode = isLocalMode(), initialRole = await getHubRole();
  return <PermissionBoundary localMode={localMode} initialRole={initialRole} tab={query.brand || query.view === "brands" ? "brands" : "projects"}><HubAdmin key={`${query.brand ?? query.project ?? query.view ?? "overview"}:${query.version ?? query.draft_at ?? "current"}`} localMode={localMode} initialRole={initialRole} projectId={query.project ?? null} brandId={query.brand ?? null} view={query.view ?? null} sourceVersion={query.version ?? null} sourceDraftAt={query.draft_at ?? null} /></PermissionBoundary>;
}
