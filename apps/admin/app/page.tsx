import { getLocalRole, isLocalMode } from "@/lib/local-session";
import { HubAdmin } from "@/components/hub-admin";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; brand?: string; view?: string; version?: string; draft_at?: string }> }) {
  const query = await searchParams;
  return <HubAdmin key={`${query.brand ?? query.project ?? query.view ?? "overview"}:${query.version ?? query.draft_at ?? "current"}`} localMode={isLocalMode()} initialRole={await getLocalRole()} projectId={query.project ?? null} brandId={query.brand ?? null} view={query.view ?? null} sourceVersion={query.version ?? null} sourceDraftAt={query.draft_at ?? null} />;
}
