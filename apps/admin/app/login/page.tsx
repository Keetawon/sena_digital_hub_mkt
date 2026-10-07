import { HostedLogin } from "@/components/hosted-session";
import { safeNext } from "@/components/hub-navigation-data";
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <HostedLogin next={safeNext((await searchParams).next)} />;
}
