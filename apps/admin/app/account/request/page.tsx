import { AccessRequestPage } from "@/components/accounts";
import { getLocalRole, isLocalMode } from "@/lib/local-session";
export const dynamic = "force-dynamic";
export default async function Page() { return <AccessRequestPage localMode={isLocalMode()} initialRole={await getLocalRole()} />; }
