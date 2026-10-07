"use client";
import { useEffect, useState, type FormEvent } from "react";
import { hostedBrowser, useHostedSession } from "./hosted-session";

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
  useEffect(() => { setEmail(sessionStorage.getItem("hub-otp-email") || ""); setUntil(Number(sessionStorage.getItem("hub-otp-until") || 0)); const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!config?.password) return <main className="hosted-login"><p>ยังไม่เปิดการสมัครและกู้คืนรหัสผ่าน <a href="/login">กลับเข้าสู่ระบบ</a></p></main>;
  const client = hostedBrowser(config);
  const cooldown = Math.max(0, Math.ceil((until - clock) / 1000));
  function cool() { const time = Date.now() + 60000; setUntil(time); sessionStorage.setItem("hub-otp-until", String(time)); }
  async function sendAgain() {
    if (cooldown || busy) return;
    setBusy(true); cool();
    try { if (mode === "recovery") await client.auth.resetPasswordForEmail(email); else await client.auth.resend({ type: "signup", email }); setMessage(sent); }
    catch { setMessage(sent); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if ((mode === "signup" || stage === "password") && (password.length < 12 || password !== form.get("confirm"))) { setMessage("รหัสผ่านต้องอย่างน้อย 12 ตัวอักษรและตรงกันทั้งสองช่อง"); return; }
    setBusy(true); setMessage("");
    try {
      if (stage === "start") {
        if (cooldown) { setMessage(`กรุณารอ ${cooldown} วินาที`); return; }
        cool(); sessionStorage.setItem("hub-otp-email", email);
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
    } catch { setMessage(stage === "verify" ? "รหัสไม่ถูกต้อง หมดอายุ หรือเกินจำนวนครั้ง กรุณาตรวจรหัสหรือขอใหม่" : mode === "recovery" && stage === "start" ? sent : "ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลและลองใหม่"); }
    finally { setBusy(false); }
  }
  return <main className="hosted-login"><section className="registry-panel"><h1>{mode === "recovery" ? "ลืมรหัสผ่าน" : mode === "verify" ? "ยืนยันอีเมล" : "สมัครด้วยอีเมล"}</h1><form onSubmit={submit}>
    {mode === "verify" && <p>ถ้าไม่ได้รับรหัสภายในไม่กี่นาที อีเมลนี้อาจมีบัญชีอยู่แล้ว ลองเข้าสู่ระบบด้วย Google หรือใช้ลืมรหัสผ่าน</p>}
    {stage !== "done" && <div className="form-field"><label htmlFor="otp-email">อีเมล</label><input id="otp-email" type="email" autoComplete="email" required value={email} readOnly={stage === "password"} onChange={e => setEmail(e.target.value)} /></div>}
    {(mode === "signup" && stage === "start" || stage === "password") && <><div className="form-field"><label htmlFor="new-password">รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)</label><input id="new-password" name="password" type="password" minLength={12} required autoComplete="new-password" /></div><div className="form-field"><label htmlFor="confirm-password">ยืนยันรหัสผ่าน</label><input id="confirm-password" name="confirm" type="password" minLength={12} required autoComplete="new-password" /></div></>}
    {stage === "verify" && <div className="form-field"><label htmlFor="otp-code">รหัส 6 หลัก</label><input id="otp-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required /></div>}
    {message && <p role="status">{message}</p>}
    {stage !== "done" && <button className="button primary" disabled={busy || stage === "start" && cooldown > 0 || stage === "verify" && attempts >= 5}>{busy ? "กำลังดำเนินการ…" : stage === "verify" ? "ยืนยันรหัส" : stage === "password" ? "บันทึกรหัสผ่านใหม่" : "ส่งรหัสยืนยัน"}</button>}
    {(stage === "verify" || stage === "start" && cooldown > 0) && <p>{cooldown > 0 ? `ส่งรหัสใหม่ได้ใน ${cooldown} วินาที` : <button type="button" disabled={busy} onClick={() => { setAttempts(0); void sendAgain(); }}>ส่งรหัสใหม่</button>}</p>}
  </form><p><a href="/login">กลับเข้าสู่ระบบ</a></p></section></main>;
}
