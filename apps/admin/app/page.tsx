import { getLocalRole, isLocalMode } from "@/lib/local-session";
import { HubAdmin } from "@/components/hub-admin";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; brand?: string; view?: string }> }) {
  const query = await searchParams;
  return <HubAdmin key={query.brand ?? query.project ?? query.view ?? "overview"} localMode={isLocalMode()} initialRole={await getLocalRole()} projectId={query.project ?? null} brandId={query.brand ?? null} view={query.view ?? null} />;
}
