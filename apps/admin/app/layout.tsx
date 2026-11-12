import { getLocalRole } from "@/lib/local-session";
import { getHubAccount } from "@/lib/hosted-session";
import { AccountDirectory } from "@/components/accounts";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Google_Sans } from "next/font/google";
import { HubMotion } from "@/components/registry-motion";
import { HostedSessionProvider } from "@/components/hosted-session";
import { hostedConfig, isHostedMode } from "@/lib/hosted-config";
import "./globals.css";
import "../styles/motion.css";

const notoSansThai = localFont({
  src: "./fonts/NotoSansThai-Variable.ttf",
  variable: "--font-noto-sans-thai",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["Tahoma", "sans-serif"],
});
const googleSans = Google_Sans({ subsets: ["thai", "latin"], display: "swap", variable: "--font-google-sans", adjustFontFallback: false });

export const metadata: Metadata = {
  title: "SENA Digital Hub · ข้อมูลโครงการและทะเบียนแคมเปญ",
  description: "พื้นที่ทำงานสำหรับจัดการข้อมูลโครงการ แบรนด์ และทะเบียนชื่อแคมเปญ SENA",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reuse this render's verified account read (also used by getHubRole). Only
  // the bounded navigation projection reaches the browser, never the bearer.
  const account = isHostedMode() ? await getHubAccount().catch(() => null) : null;
  const initialAccount = account ? { id: account.id, status: account.status, role: account.role, hub_role: account.hub_role,
    capabilities: account.capabilities, pending_count: account.pending_count,
    content_scope: account.content_scope ? { fingerprint: account.content_scope.fingerprint, expires_at: account.content_scope.expires_at } : undefined } : null;
  return <html lang="th" className={`${googleSans.variable} ${notoSansThai.variable}`}><body><HostedSessionProvider config={hostedConfig()}><AccountDirectory enabled={isHostedMode() || !!(await getLocalRole())} initialAccount={initialAccount}><HubMotion>{children}</HubMotion></AccountDirectory></HostedSessionProvider></body></html>;
}
