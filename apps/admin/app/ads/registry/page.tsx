import { AdsRegistry } from "@/components/ads-registry";
import { getLocalRole, isLocalMode } from "@/lib/local-session";

export const dynamic = "force-dynamic";
export default async function Page() {
  return <AdsRegistry initialRole={await getLocalRole()} localMode={isLocalMode()} screen="list" />;
}
