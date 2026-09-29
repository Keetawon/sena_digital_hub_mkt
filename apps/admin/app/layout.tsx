import type { Metadata } from "next";
import localFont from "next/font/local";
import { Google_Sans } from "next/font/google";
import { HubMotion } from "@/components/registry-motion";
import "./globals.css";

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
  title: "SENA Digital Hub · จัดการข้อมูลโครงการ",
  description: "ระบบหลังบ้านสำหรับจัดเตรียม ตรวจสอบ และเผยแพร่ข้อมูลโครงการที่อยู่อาศัย SENA",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th" className={`${googleSans.variable} ${notoSansThai.variable}`}><body><HubMotion>{children}</HubMotion></body></html>;
}
