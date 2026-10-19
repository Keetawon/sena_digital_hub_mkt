"use client";
import { useEffect, useState, type FormEvent } from "react";
import { hostedBrowser, useHostedSession } from "./hosted-session";
import { AuthLayout, AuthApprovalNote, AuthArrow, PasswordField } from "./auth-layout";

const sent = "หากอีเมลนี้สามารถรับรหัสได้ ระบบจะส่งรหัส 6 หลักให้ กรุณาตรวจกล่องจดหมาย";
export function PasswordFlow({ mode }: { mode: "signup" | "verify" | "recovery" }) {
  const config = useHostedSession();
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState(mode === "verify" ? "verify" : "start");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [attempts, setAttempts] = useState(0);
  const [failed, setFailed] = useState(false);
  const [passwordError, setPasswordError] = useState<"password" | "confirm" | null>(null);
  useEffect(() => { try { setEmail(sessionStorage.getItem("hub-otp-email") || ""); setUntil(Number(sessionStorage.getItem("hub-otp-until") || 0)); } catch { /* The form also works when browser storage is disabled. */ } const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!config?.password) return <AuthLayout title="สมัครและกู้คืนบัญชี" description="ยังไม่เปิดการสมัครและกู้คืนรหัสผ่าน" label={config?.label}><a className="auth-link" href="/login">กลับเข้าสู่ระบบ</a></AuthLayout>;
  const client = hostedBrowser(config);
  const cooldown = Math.max(0, Math.ceil((until - clock) / 1000));
  function remember(key: string, value: string) { try { sessionStorage.setItem(key, value); } catch { /* Keep the current form usable. */ } }
  function cool() { const time = Date.now() + 60000; setUntil(time); remember("hub-otp-until", String(time)); }
  async function sendAgain() {
    if (cooldown || busy) return;
    setBusy(true); setFailed(false); cool();
    try { if (mode === "recovery") await client.auth.resetPasswordForEmail(email); else await client.auth.resend({ type: "signup", email }); setMessage(sent); }
    catch { setMessage(sent); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if ((mode === "signup" || stage === "password") && (password.length < 12 || password !== form.get("confirm"))) { setMessage("รหัสผ่านต้องอย่างน้อย 12 ตัวอักษรและตรงกันทั้งสองช่อง"); setFailed(true); setPasswordError(password.length < 12 ? "password" : "confirm"); return; }
    setBusy(true); setMessage(""); setFailed(false); setPasswordError(null);
    try {
      if (stage === "start") {
        if (cooldown) { setMessage(`กรุณารอ ${cooldown} วินาที`); return; }
        cool(); remember("hub-otp-email", email);
        if (mode === "signup") {
          const { error } = await client.auth.signUp({ email, password });
          if (error) throw error;
          window.location.assign("/signup/verify");
        } else { await client.auth.resetPasswordForEmail(email); setStage("verify"); setMessage(sent); }
      } else if (stage === "verify") {
        if (attempts >= 5) { setMessage("ลองครบ 5 ครั้งแล้ว กรุณารอและขอรหัสใหม่"); return; }
        setAttempts(attempts + 1);
        const { error } = await client.auth.verifyOtp({ email, token: String(form.get("code")), type: mode === "recovery" ? "recovery" : "email" });
        if (error) throw error;
        if (mode === "recovery") setStage("password"); else window.location.assign("/account/request");
      } else {
        const { error } = await client.auth.updateUser({ password }); if (error) throw error;
        const result = await client.auth.signOut({ scope: "global" }); if (result.error) throw result.error;
        setStage("done"); setMessage("เปลี่ยนรหัสผ่านและออกจากระบบทุกเซสชันแล้ว กรุณาเข้าสู่ระบบใหม่");
      }
    } catch { setFailed(!(mode === "recovery" && stage === "start")); setMessage(stage === "verify" ? "รหัสไม่ถูกต้อง หมดอายุ หรือเกินจำนวนครั้ง กรุณาตรวจรหัสหรือขอใหม่" : mode === "recovery" && stage === "start" ? sent : "ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลและลองใหม่"); }
    finally { setBusy(false); }
  }
  const title = stage === "done" ? "เปลี่ยนรหัสผ่านแล้ว" : stage === "password" ? "ตั้งรหัสผ่านใหม่" : mode === "recovery" ? "ลืมรหัสผ่าน" : mode === "verify" ? "ยืนยันอีเมล" : "สมัครด้วยอีเมล";
  const description = stage === "done" ? "กลับเข้าสู่ระบบด้วยรหัสผ่านใหม่ของคุณ" : stage === "password" ? "เลือกรหัสผ่านใหม่เพื่อกลับเข้าสู่พื้นที่ทำงาน" : stage === "verify" ? "กรอกรหัส 6 หลักจากอีเมลเพื่อดำเนินการต่อ" : mode === "signup" ? "สร้างบัญชีของคุณ แล้วส่งคำขอเข้าใช้งานกับทีม SENA" : "ระบุอีเมลที่ใช้กับบัญชี เพื่อรับรหัสสำหรับตั้งรหัสผ่านใหม่";
  return <AuthLayout title={title} description={description} label={config.label} step={mode === "signup" ? 1 : mode === "verify" ? 2 : undefined}>
    {stage === "done" && <div className="auth-success-mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 12 4 4L19 6" /></svg></div>}
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      {stage !== "done" && <div className="form-field auth-field"><label htmlFor="otp-email">อีเมล</label><input id="otp-email" type="email" autoComplete="email" placeholder="name@company.com" maxLength={254} required value={email} disabled={busy} readOnly={stage === "password"} onChange={e => setEmail(e.target.value)} /></div>}
      {(mode === "signup" && stage === "start" || stage === "password") && <>
        <PasswordField id="new-password" name="password" label="รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)" hint="ใช้รหัสผ่านที่ไม่ซ้ำกับบัญชีอื่น และเก็บไว้ในที่ปลอดภัย" minLength={12} required autoComplete="new-password" disabled={busy} aria-invalid={passwordError === "password"} aria-describedby={passwordError === "password" ? "auth-feedback" : undefined} />
        <PasswordField id="confirm-password" name="confirm" label="ยืนยันรหัสผ่าน" minLength={12} required autoComplete="new-password" disabled={busy} aria-invalid={passwordError === "confirm"} aria-describedby={passwordError === "confirm" ? "auth-feedback" : undefined} />
      </>}
      {stage === "verify" && <div className="form-field auth-field"><label htmlFor="otp-code">รหัส 6 หลัก</label><input className="auth-otp" id="otp-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" required disabled={busy} aria-invalid={failed} aria-describedby={failed ? "auth-feedback" : "otp-hint"} /><p className="auth-hint" id="otp-hint">คัดลอกและวางรหัสทั้ง 6 หลักได้ในช่องเดียว</p></div>}
      {message && <p id="auth-feedback" role="status" className="auth-feedback" data-error={failed}>{message}</p>}
      {stage !== "done" && <button className="button primary auth-submit" disabled={busy || stage === "start" && cooldown > 0 || stage === "verify" && attempts >= 5}>{busy ? "กำลังดำเนินการ…" : stage === "verify" ? "ยืนยันรหัส" : stage === "password" ? "บันทึกรหัสผ่านใหม่" : "ส่งรหัสยืนยัน"}{!busy && <AuthArrow />}</button>}
      {(stage === "verify" || stage === "start" && cooldown > 0) && <p className="auth-resend">{cooldown > 0 ? `ส่งรหัสใหม่ได้ใน ${cooldown} วินาที` : <button className="auth-link" type="button" disabled={busy} onClick={() => { setAttempts(0); void sendAgain(); }}>ส่งรหัสใหม่</button>}</p>}
    </form>
    {mode === "signup" && <AuthApprovalNote />}
    {mode === "verify" && <aside className="auth-help"><strong>ยังไม่ได้รับรหัส?</strong><p>ถ้าไม่ได้รับรหัสภายในไม่กี่นาที อีเมลนี้อาจมีบัญชีอยู่แล้ว ลองเข้าสู่ระบบด้วย Google หรือใช้ลืมรหัสผ่าน</p></aside>}
    <p className="auth-back"><a className={stage === "done" ? "button primary auth-submit" : "auth-link"} href="/login"><AuthArrow />กลับเข้าสู่ระบบ</a></p>
  </AuthLayout>;
}
