import { redirect } from "next/navigation";
import { getHubAccount } from "@/lib/hosted-session";
import { canWorkspace } from "@/lib/hub-permissions";
import { workspaceLanding } from "@/components/hub-navigation-data";
import { legacyWorkspaceHref, queryParameters } from "@/lib/unified-workspace";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = queryParameters(await searchParams);
  if (!query.size) {
    const account = await getHubAccount();
    if (account && !canWorkspace(account.capabilities)) {
      const destination = workspaceLanding(account.capabilities);
      if (destination !== "/") redirect(destination);
    }
  }
  redirect(legacyWorkspaceHref("/", query) ?? "/website");
}
