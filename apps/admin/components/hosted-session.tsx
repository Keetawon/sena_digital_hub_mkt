"use client";

import { createBrowserClient } from "@supabase/ssr";
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import { verifiedRole, type HostedConfig } from "@/lib/hosted-config";
import type { SupabaseClient } from "@supabase/supabase-js";

const Context = createContext<HostedConfig | null>(null);
let browser: SupabaseClient | null = null;
let currentConfig: HostedConfig | null = null;
export function hostedBrowser(config: HostedConfig) {
  if (!browser || currentConfig?.supabaseUrl !== config.supabaseUrl) {
    browser = createBrowserClient(config.supabaseUrl, config.publishableKey, { cookieOptions: { secure: !config.simulation, sameSite: "lax" } });
    currentConfig = config;
  }
  return browser;
}
export function HostedSessionProvider({ config, children }: { config: HostedConfig | null; children: ReactNode }) {
  if (config) hostedBrowser(config);
  return <Context value={config}>{children}</Context>;
}
export function useHostedSession() { return useContext(Context); }

export async function assetFetch(path: string, options: RequestInit = {}) {
  if (!currentConfig || !browser) return fetch(`/api/hub/${path}`, options);
  if (!/^v1\/admin\/assets(?:\/[a-zA-Z0-9_-]{1,128}\/file)?$/.test(path)) throw new Error("ไม่รองรับที่อยู่ไฟล์นี้");
  const { data: { session }, error } = await browser.auth.getSession();
  if (error || !session) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(`${currentConfig.apiOrigin}/${path}`, { ...options, headers, credentials: "omit", redirect: "error", cache: "no-store" });
}

export function SignOut() {
  const config = useHostedSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!config) return null;
  return <><button className="button secondary" disabled={pending} onClick={async () => {
    setPending(true); setError("");
    const result = await hostedBrowser(config).auth.signOut();
    if (result.error) { setError("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง"); setPending(false); }
    else window.location.assign("/login");
  }}>{pending ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}</button>{error && <span role="alert">{error}</span>}</>;
}

export function HostedLogin({ next }: { next: string }) {
  const config = useHostedSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!config || pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      const { data: result, error: failure } = await hostedBrowser(config).auth.signInWithPassword({ email: String(data.get("email")).trim(), password: String(data.get("password")) });
      if (failure || !result.user || !verifiedRole(result.user.app_metadata)) throw new Error();
      // Navigation is only a convenience; server getUser and FastAPI enforce access.
      const role = result.user.app_metadata.hub_role;
      const target = next === "/" && ["online_staff", "agency"].includes(role) ? "/ads/registry" : next;
      window.location.assign(target);
    } catch { setError("เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมล รหัสผ่าน และสิทธิ์ที่ผู้ดูแลกำหนด"); setPending(false); }
  }
  return <main className="hosted-login"><section className="registry-panel"><p className="eyebrow">SENA Digital Hub · TEST H1</p><h1>เข้าสู่ระบบพื้นที่ทดสอบ</h1><p>ข้อมูลสมมติเท่านั้น · ยังไม่เปิดการออกชื่อแคมเปญ</p>{config ? <form onSubmit={login}><div className="form-field"><label htmlFor="login-email">อีเมล</label><input id="login-email" name="email" type="email" required autoComplete="username" maxLength={254} autoFocus disabled={pending} /></div><div className="form-field"><label htmlFor="login-password">รหัสผ่าน</label><input id="login-password" name="password" type="password" required autoComplete="current-password" disabled={pending} /></div>{error && <p role="alert" className="field-error">{error}</p>}<button type="submit" className="button primary" disabled={pending}>{pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button><p className="field-help">ใช้บัญชีที่ IT จัดเตรียมตามบทบาทของคุณ ไม่มีการสมัครบัญชีจากหน้านี้</p></form> : <p>หน้านี้เปิดเฉพาะพื้นที่ TEST ที่ตั้งค่าการเข้าสู่ระบบแล้ว</p>}</section></main>;
}
