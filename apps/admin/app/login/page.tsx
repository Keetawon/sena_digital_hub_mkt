import { HostedLogin } from "@/components/hosted-session";

export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  let safe = "/";
  if (next?.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(next)) {
    const target = new URL(next, "https://hub.invalid");
    const page = /^(?:\/|\/(?:promotions|releases|questions)|\/ads\/(?:finance|actuals|documents|archive|exceptions|registry(?:\/(?:new|inbox))?))$/;
    if (target.origin === "https://hub.invalid" && page.test(target.pathname)) safe = target.pathname + target.search + target.hash;
  }
  return <HostedLogin next={safe} />;
}
