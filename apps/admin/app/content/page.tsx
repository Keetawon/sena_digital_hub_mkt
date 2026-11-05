import { redirect } from "next/navigation";
import { legacyWorkspaceHref, queryParameters } from "@/lib/unified-workspace";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyWorkspaceHref("/content", queryParameters(await searchParams))!);
}
