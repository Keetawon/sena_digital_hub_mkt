import { getHubRole } from "@/lib/hosted-session";
import { AdsRegistry } from "@/components/ads-registry";
import { isLocalMode } from "@/lib/local-session";

export const dynamic = "force-dynamic";
export default async function Page() {
  return <AdsRegistry initialRole={await getHubRole()} localMode={isLocalMode()} screen="inbox" />;
}
