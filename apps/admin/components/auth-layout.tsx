"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import "./auth-layout.css";

export function AuthLayout({ title, description, label, step, wide = false, children }: {
  title: string; description: string; label?: string; step?: 1 | 2 | 3; wide?: boolean; children: ReactNode;
}) {
  return <main className="auth-page" data-wide={wide}>
    <aside className="auth-story" aria-label="SENA Digital Hub">
      <div className="auth-wordmark"><span>SENA<span className="auth-brand-dot">.</span></span><span>Digital Hub</span></div>
      <div className="auth-story-copy"><p className="auth-kicker">พื้นที่ทำงานของทีม SENA</p><h2>เชื่อมข้อมูล<br />ให้ทุกทีมไปต่อ</h2><p>ข้อมูลโครงการ แบรนด์ และงานการตลาด<br />ในพื้นที่ทำงานเดียวกัน</p></div>
      <svg className="auth-architecture" viewBox="0 0 520 310" fill="none" aria-hidden="true">
        <path className="auth-art-fill" d="M48 273V113L174 48L294 108V273M294 273V155L393 104L475 146V273" />
        <g stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
          <path d="M22 273H500M48 273V113L174 48L294 108V273M48 113L174 176L294 108M174 48V176M174 176V273M294 155L393 104L475 146V273M294 155L393 205L475 160M393 205V273M393 104V205" />
          <path d="M77 145V185L111 202V162ZM128 170V210L151 222V182ZM77 210V250L111 267V227ZM198 185L231 167V205L198 223ZM246 159L272 145V183L246 197ZM198 239L231 221V259L205 273M246 213L272 199V237L246 251M316 186V220L345 235V201ZM358 207V241L377 251V217ZM412 212L453 190V228L412 250Z" />
          <path d="M39 289H345M365 289H482M101 303H415M18 239V192M8 208L18 192L28 208M495 220V175M485 191L495 175L505 191" />
        </g>
        <circle cx="374" cy="44" r="25" className="auth-art-sun" />
      </svg>
      <div className="auth-story-footer"><span>ข้อมูลชัดเจน</span><span>ทำงานร่วมกัน</span><span>เติบโตไปด้วยกัน</span></div>
    </aside>
    <section className="auth-workspace" aria-labelledby="auth-title">
      <div className="auth-environment eyebrow"><span className="auth-environment-dot" aria-hidden="true" />{label || "SENA Digital Hub"}</div>
      <div className="auth-content">
        {step && <ol className="auth-steps" aria-label="ขั้นตอนสมัครใช้งาน">{["สร้างบัญชี", "ยืนยันอีเมล", "ขอสิทธิ์ใช้งาน"].map((text, index) => <li key={text} aria-current={step === index + 1 ? "step" : undefined} data-complete={step > index + 1}><span aria-hidden="true">{step > index + 1 ? "✓" : index + 1}</span>{text}</li>)}</ol>}
        <header className="auth-heading"><h1 id="auth-title">{title}</h1><p>{description}</p></header>
        {children}
      </div>
      <footer className="auth-footer">SENA Digital Hub <span aria-hidden="true">/</span> พื้นที่ทำงานร่วมกัน</footer>
    </section>
  </main>;
}

export function PasswordField({ id, label, hint, hintId, action, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  id: string; label: string; hint?: string; hintId?: string; action?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="form-field auth-field">
    <div className="auth-label-row"><label htmlFor={id}>{label}</label>{action}</div>
    <div className="auth-password"><input {...input} id={id} type={visible ? "text" : "password"} aria-describedby={[input["aria-describedby"], hint ? hintId || `${id}-hint` : undefined].filter(Boolean).join(" ") || undefined} />
      <button type="button" className="auth-password-toggle" disabled={input.disabled} aria-label={`${visible ? "ซ่อน" : "แสดง"}${label}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
      </button>
    </div>{hint && <p className="auth-hint" id={hintId || `${id}-hint`}>{hint}</p>}
  </div>;
}

export function AuthArrow() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

export function AuthApprovalNote() {
  return <div className="auth-approval-note"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></svg><p><strong>เริ่มต้นด้วยบัญชีของคุณ</strong><span>บัญชีใหม่ต้องส่งคำขอและรอผู้ดูแลอนุมัติก่อนใช้งาน</span></p></div>;
}
