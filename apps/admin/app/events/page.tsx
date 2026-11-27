import { EventsWorkspace } from "@/components/events-workspace";
import { getHubRole } from "@/lib/hosted-session";
import { isLocalMode } from "@/lib/local-session";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  return <EventsWorkspace localMode={isLocalMode()} initialRole={await getHubRole()} />;
}
