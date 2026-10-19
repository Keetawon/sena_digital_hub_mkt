"use client";

import { safeNext, workspaceLanding } from "./hub-navigation-data";
import { canOpenPage } from "@/lib/hub-permissions";
import { createBrowserClient } from "@supabase/ssr";
import { createContext, useContext, useState, useEffect, type FormEvent, type ReactNode } from "react";
import { type HostedConfig } from "@/lib/hosted-config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthLayout, AuthApprovalNote, AuthArrow, PasswordField } from "./auth-layout";

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
  return <Context value={config}><SessionNotice />{children}</Context>;
}
export function useHostedSession() { return useContext(Context); }

export async function assetFetch(path: string, options: RequestInit = {}) {
  if (!currentConfig || !browser) return fetch(`/api/hub/${path}`, options);
  if (!/^v1\/admin\/assets(?:\/[a-zA-Z0-9_-]{1,128}\/(?:file|thumbnail))?$/.test(path)) throw new Error("ไม่รองรับที่อยู่ไฟล์นี้");
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

export function SessionNotice() {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      const input = args[0]; const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (response.status === 401 && (url.startsWith("/api/hub/") || currentConfig && url.startsWith(currentConfig.apiOrigin + "/v1/"))) setExpired(true);
      return response;
    };
    return () => { window.fetch = original; };
  }, []);
  return expired ? <aside className="session-expired" role="alert">เซสชันหมดอายุ ข้อความที่ยังไม่บันทึกยังอยู่ในหน้านี้ <a href={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} target="_blank" rel="noopener">เข้าสู่ระบบอีกครั้งในแท็บใหม่</a> แล้วกลับมาบันทึกงาน <button onClick={() => setExpired(false)}>ปิดข้อความ</button></aside> : null;
}

export async function afterSignIn(next: string) {
  const response = await fetch("/api/hub/v1/me", { cache: "no-store" });
  if (!response.ok) throw new Error();
  const { data } = await response.json();
  const requested = new URL(safeNext(next), window.location.origin);
  window.location.assign(data.status !== "ACTIVE" ? "/account/request" : canOpenPage(data, requested.pathname, requested.searchParams) ? requested.pathname + requested.search : workspaceLanding(data.capabilities));
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
      const { error: failure } = await hostedBrowser(config).auth.signInWithPassword({ email: String(data.get("email")).trim(), password: String(data.get("password")) });
      if (failure) throw new Error();
      await afterSignIn(next);
    } catch { setError("เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมลและรหัสผ่าน"); setPending(false); }
  }
  return <AuthLayout title="เข้าสู่ระบบ" description="ยินดีต้อนรับกลับมา เริ่มต้นงานของคุณได้ที่นี่" label={config?.label}>{config ? <>
    {config.google && <><button type="button" className="auth-google" disabled={pending} onClick={async () => {
      if (pending) return;
      setPending(true); setError("");
      try {
        const { error } = await hostedBrowser(config).auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${config.adminOrigin}/auth/callback?next=${encodeURIComponent(next)}`, scopes: "openid email profile" } });
        if (error) throw error;
      } catch { setError("เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่"); setPending(false); }
    }}><img src="/auth/google-g.png" width={20} height={20} alt="" />เข้าสู่ระบบด้วย Google</button><div className="auth-divider">หรือใช้อีเมลของคุณ</div></>}
    <form className="auth-form" onSubmit={login} aria-busy={pending}>
      <div className="form-field auth-field"><label htmlFor="login-email">อีเมล</label><input id="login-email" name="email" type="email" placeholder="name@company.com" required autoComplete="username" maxLength={254} disabled={pending} /></div>
      <PasswordField id="login-password" name="password" label="รหัสผ่าน" required autoComplete="current-password" disabled={pending} action={config.password && <a className="auth-link" href="/login/forgot">ลืมรหัสผ่าน</a>} />
      {error && <p role="alert" className="auth-feedback" data-error="true">{error}</p>}
      <button type="submit" className="button primary auth-submit" disabled={pending}>{pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}{!pending && <AuthArrow />}</button>
    </form>
    {config.password && <p className="auth-switch">ยังไม่มีบัญชี? <a className="auth-link" href="/signup">สมัครด้วยอีเมล</a></p>}
    <AuthApprovalNote />
  </> : <p className="auth-feedback">หน้านี้เปิดเมื่อกำหนดการเข้าสู่ระบบแล้ว</p>}</AuthLayout>;
}
