import { AdsFinance } from "@/components/ads-finance";
import { getLocalRole, isLocalMode } from "@/lib/local-session";

export const dynamic = "force-dynamic";
export default async function Page() {
  return <AdsFinance initialRole={await getLocalRole()} localMode={isLocalMode()} />;
}
