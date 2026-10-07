import { getHubRole } from "@/lib/hosted-session";
import { AccountDirectory } from "@/components/accounts";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Google_Sans } from "next/font/google";
import { HubMotion } from "@/components/registry-motion";
import { HostedSessionProvider } from "@/components/hosted-session";
import { hostedConfig } from "@/lib/hosted-config";
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
  return <html lang="th" className={`${googleSans.variable} ${notoSansThai.variable}`}><body><HostedSessionProvider config={hostedConfig()}><AccountDirectory enabled={!!(await getHubRole())}><HubMotion>{children}</HubMotion></AccountDirectory></HostedSessionProvider></body></html>;
}
