"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { companyLabels, companyLabel, label as roleLabelText, methodLabel, phonePattern, useHubPermissions } from "./accounts";
import { hostedBrowser, useHostedSession } from "./hosted-session";
import { roleLabels, type LocalRole } from "@/lib/roles";
import "./account-menu.css";

type ThemeChoice = "system" | "light" | "dark";
type DialogKind = "profile" | "permissions" | "security" | null;

const THEME_STORAGE_KEY = "hub-theme";
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function applyThemeChoice(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  if (choice === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = choice;
  }
}

function AvatarThumb({
  hasAvatar,
  avatarUpdatedAt,
  initial,
  classNameImg,
  classNameFallback,
}: {
  hasAvatar: boolean;
  avatarUpdatedAt?: string | null;
  initial: string;
  classNameImg: string;
  classNameFallback: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [hasAvatar, avatarUpdatedAt]);

  if (hasAvatar && !failed) {
    const version = avatarUpdatedAt ? `?v=${encodeURIComponent(avatarUpdatedAt.slice(0, 32).replace(/[^A-Za-z0-9._:-]/g, "_"))}` : "";
    return (
      <img
        className={classNameImg}
        src={`/api/hub/v1/me/avatar${version}`}
        alt="รูปโปรไฟล์"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className={classNameFallback} aria-hidden="true">{initial}</span>;
}

export function AccountMenu({ roleLabel }: { roleLabel: string }) {
  const hostedConfig = useHostedSession();
  const permissions = useHubPermissions();
  const account = permissions.account;
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  // Profile / avatar dialog state
  const [displayNameTh, setDisplayNameTh] = useState("");
  const [phone, setPhone] = useState("");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("");
  const [companyType, setCompanyType] = useState("SENA");
  const [companyName, setCompanyName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        setTheme(saved);
        applyThemeChoice(saved);
      }
    } catch {
      /* Default system theme works without storage. */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialog) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (dialog) return;
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, dialog]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (dialog) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [dialog]);

  const effectiveRole = account?.hub_role ?? account?.role ?? null;
  const agencyCode = account?.agency_code || account?.agency || null;
  const resolvedRoleLabel =
    effectiveRole === "agency" && agencyCode
      ? `เอเจนซี ${agencyCode}`
      : roleLabels[effectiveRole as LocalRole] || roleLabelText(effectiveRole) || roleLabel;
  const displayName = account?.display_name_th?.trim() || "";
  const triggerPrimary = displayName || resolvedRoleLabel;
  const triggerSecondary = displayName ? resolvedRoleLabel : roleLabel;
  const initialChar = (triggerPrimary || roleLabel).charAt(0);
  const agencyLocked =
    account?.hub_role === "agency" ||
    account?.role === "agency" ||
    account?.company_type === "AGENCY";
  const pendingCount = permissions.pending ?? 0;
  const canOpenSettings = permissions.can("projects") || permissions.can("knowledge");

  function openDialog(kind: Exclude<DialogKind, null>) {
    setOpen(false);
    if (kind === "profile") {
      setDisplayNameTh(account?.display_name_th ?? "");
      setPhone(account?.phone ?? "");
      setTeam(account?.team ?? "");
      setPosition(account?.position ?? "");
      const ct = agencyLocked ? "AGENCY" : account?.company_type || "SENA";
      setCompanyType(ct);
      setCompanyName(
        agencyLocked
          ? account?.company_name || account?.agency_code || account?.agency || ""
          : account?.company_name ?? ""
      );
      setProfileFeedback(null);
      setAvatarMessage(null);
      setFieldErrors({});
    } else if (kind === "security") {
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFeedback(null);
    }
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    triggerRef.current?.focus();
  }

  function selectTheme(next: ThemeChoice) {
    setTheme(next);
    applyThemeChoice(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Ignore storage refusal. */
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileFeedback(null);
    setFieldErrors({});
    const payload = {
      display_name_th: displayNameTh.trim(),
      phone: phone.trim(),
      team: team.trim(),
      position: position.trim(),
      company_type: agencyLocked ? "AGENCY" : companyType,
      company_name:
        (agencyLocked ? "AGENCY" : companyType) === "SENA"
          ? null
          : (agencyLocked ? account?.company_name || account?.agency_code || companyName : companyName).trim(),
    };
    try {
      const response = await fetch("/api/hub/v1/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        const nextErrors = Object.fromEntries(
          ((body.error?.details as { field: string; message: string }[] | undefined) ?? []).map((d) => [
            d.field.split(".")[0],
            d.message,
          ])
        );
        setFieldErrors(nextErrors);
        setProfileFeedback({ kind: "error", text: body.error?.message || "บันทึกข้อมูลส่วนตัวไม่สำเร็จ" });
        return;
      }
      setProfileFeedback({ kind: "success", text: "บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว" });
      permissions.refreshAccount();
    } catch {
      setProfileFeedback({ kind: "error", text: "ไม่สามารถเชื่อมต่อบริการข้อมูลได้ กรุณาลองใหม่" });
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || avatarBusy) return;
    if (!AVATAR_ALLOWED_TYPES.has(file.type)) {
      setAvatarMessage({ kind: "error", text: "รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP เท่านั้น" });
      return;
    }
    if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
      setAvatarMessage({ kind: "error", text: "ไฟล์รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MiB" });
      return;
    }
    setAvatarBusy(true);
    setAvatarMessage(null);
    try {
      const bytes = await file.arrayBuffer();
      const response = await fetch("/api/hub/v1/me/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: bytes,
      });
      const body = await response.json();
      if (!response.ok) {
        setAvatarMessage({ kind: "error", text: body.error?.message || "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ" });
        return;
      }
      setAvatarMessage({ kind: "success", text: "อัปเดตรูปโปรไฟล์เรียบร้อยแล้ว" });
      permissions.refreshAccount();
    } catch {
      setAvatarMessage({ kind: "error", text: "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setAvatarMessage(null);
    try {
      const response = await fetch("/api/hub/v1/me/avatar/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) {
        setAvatarMessage({ kind: "error", text: body.error?.message || "ลบรูปโปรไฟล์ไม่สำเร็จ" });
        return;
      }
      setAvatarMessage({ kind: "success", text: "ลบรูปโปรไฟล์เรียบร้อยแล้ว" });
      permissions.refreshAccount();
    } catch {
      setAvatarMessage({ kind: "error", text: "ลบรูปโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hostedConfig || passwordBusy) return;
    setPasswordFeedback(null);
    if (newPassword.length < 8) {
      setPasswordFeedback({ kind: "error", text: "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ kind: "error", text: "รหัสผ่านใหม่และการยืนยันไม่ตรงกัน" });
      return;
    }
    setPasswordBusy(true);
    try {
      const { error } = await hostedBrowser(hostedConfig).auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordFeedback({ kind: "error", text: "เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาตรวจสอบความซับซ้อนหรือลองเข้าสู่ระบบใหม่" });
        return;
      }
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFeedback({ kind: "success", text: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" });
    } catch {
      setPasswordFeedback({ kind: "error", text: "ไม่สามารถเปลี่ยนรหัสผ่านได้ในขณะนี้" });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleSignOut() {
    if (!hostedConfig || signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    const result = await hostedBrowser(hostedConfig).auth.signOut();
    if (result.error) {
      setSignOutError("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
      setSigningOut(false);
    } else {
      window.location.assign("/login");
    }
  }

  const permittedTabs = (permissions.capabilities.catalog ?? []).filter((item) => permissions.can(item.tab));
  const scopeSummary = account?.content_scope?.expires_at
    ? `ขอบเขตจำกัดถึง ${new Date(account.content_scope.expires_at).toLocaleDateString("th-TH")}`
    : permissions.can("projects") || permissions.can("brands")
      ? "เข้าถึงข้อมูลตามสิทธิ์ที่กำหนด"
      : "ไม่มีสิทธิ์ข้อมูลโครงการ";

  return (
    <div className="account-menu-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`เมนูบัญชีผู้ใช้ ${triggerPrimary}`}
        onClick={() => setOpen((current) => !current)}
      >
        <AvatarThumb
          hasAvatar={Boolean(account?.has_avatar)}
          avatarUpdatedAt={account?.avatar_updated_at}
          initial={initialChar}
          classNameImg="account-avatar-img"
          classNameFallback="avatar"
        />
        <span className="account-trigger-meta">
          <span className="account-trigger-name">{triggerPrimary}</span>
          <span className="account-trigger-role">{triggerSecondary}</span>
        </span>
        <svg className="account-trigger-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="account-popover" role="menu" aria-label="เมนูบัญชีผู้ใช้">
          <div className="account-popover-header">
            <AvatarThumb
              hasAvatar={Boolean(account?.has_avatar)}
              avatarUpdatedAt={account?.avatar_updated_at}
              initial={initialChar}
              classNameImg="account-avatar-lg-img"
              classNameFallback="avatar account-avatar-lg"
            />
            <div className="account-identity-lines">
              <span className="account-identity-name">{triggerPrimary}</span>
              {account?.email && <span className="account-identity-email">{account.email}</span>}
              <span className="account-identity-sub">
                {[
                  resolvedRoleLabel,
                  companyLabel({ company_type: account?.company_type ?? null, company_name: account?.company_name ?? account?.agency_code ?? null }),
                  account?.team,
                ]
                  .filter((item) => item && item !== "ยังไม่ระบุ")
                  .join(" · ")}
              </span>
              <span className="account-scope-pill">{scopeSummary}</span>
            </div>
          </div>

          <div className="account-popover-sep" />

          <button type="button" role="menuitem" className="account-menu-item" onClick={() => openDialog("profile")}>
            <span className="account-menu-item-main">ข้อมูลส่วนตัวและรูปโปรไฟล์</span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" role="menuitem" className="account-menu-item" onClick={() => openDialog("permissions")}>
            <span className="account-menu-item-main">สิทธิ์และขอบเขตการใช้งานของฉัน</span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" role="menuitem" className="account-menu-item" onClick={() => openDialog("security")}>
            <span className="account-menu-item-main">ความปลอดภัยและรหัสผ่าน</span>
            <span aria-hidden="true">›</span>
          </button>

          <div className="account-popover-sep" />

          <div className="account-theme-row">
            <span className="account-theme-label">ธีมหน้าจอ</span>
            <div className="account-theme-segment" role="group" aria-label="เลือกธีมหน้าจอ">
              {(
                [
                  ["system", "ตามระบบ"],
                  ["light", "สว่าง"],
                  ["dark", "มืด"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  className="account-theme-btn"
                  aria-pressed={theme === value}
                  onClick={() => selectTheme(value)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          {(permissions.admin || canOpenSettings) && (
            <>
              <div className="account-popover-sep" />
              {permissions.admin && (
                <Link prefetch={false} role="menuitem" className="account-menu-item" href="/admin/accounts" onClick={() => setOpen(false)}>
                  <span className="account-menu-item-main">จัดการผู้ใช้และสิทธิ์</span>
                  {pendingCount > 0 && <span className="account-menu-badge">{pendingCount}</span>}
                </Link>
              )}
              {canOpenSettings && (
                <Link prefetch={false} role="menuitem" className="account-menu-item" href="/settings" onClick={() => setOpen(false)}>
                  <span className="account-menu-item-main">ตั้งค่าระบบและคลังข้อมูล</span>
                  <span aria-hidden="true">›</span>
                </Link>
              )}
            </>
          )}

          <div className="account-popover-sep" />

          <div className="account-popover-footer">
            <span className="account-env-line">{hostedConfig ? hostedConfig.label : "SENA Digital Hub · โหมดภายในเครื่อง"}</span>
            {hostedConfig ? (
              <button
                type="button"
                role="menuitem"
                className="account-menu-item account-menu-signout"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
              >
                <span className="account-menu-item-main">{signingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}</span>
              </button>
            ) : (
              <Link prefetch={false} role="menuitem" className="account-menu-item" href="/account/request" onClick={() => setOpen(false)}>
                <span className="account-menu-item-main">สถานะคำขอ / บัญชีทดสอบ</span>
              </Link>
            )}
            {signOutError && (
              <p className="account-feedback" data-kind="error" role="alert">
                {signOutError}
              </p>
            )}
          </div>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="account-dialog"
        aria-label={
          dialog === "profile"
            ? "ข้อมูลส่วนตัวและรูปโปรไฟล์"
            : dialog === "permissions"
              ? "สิทธิ์และขอบเขตการใช้งานของฉัน"
              : "ความปลอดภัยและรหัสผ่าน"
        }
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        {dialog === "profile" && (
          <div className="account-dialog-inner">
            <div className="account-dialog-header">
              <h2>ข้อมูลส่วนตัวและรูปโปรไฟล์</h2>
              <button type="button" className="account-dialog-close" aria-label="ปิดหน้าต่าง" onClick={closeDialog}>
                ×
              </button>
            </div>

            <div className="account-avatar-editor">
              <AvatarThumb
                hasAvatar={Boolean(account?.has_avatar)}
                avatarUpdatedAt={account?.avatar_updated_at}
                initial={initialChar}
                classNameImg="account-avatar-preview-img"
                classNameFallback="account-avatar-preview-fallback"
              />
              <div className="account-avatar-controls">
                <div className="account-avatar-buttons">
                  <label className="account-file-label">
                    {avatarBusy ? "กำลังอัปโหลด…" : "แก้ไขรูปโปรไฟล์"}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="account-file-input"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={avatarBusy}
                      onChange={(e) => void handleAvatarFile(e)}
                    />
                  </label>
                  {account?.has_avatar && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={avatarBusy}
                      onClick={() => void removeAvatar()}
                    >
                      ลบรูปโปรไฟล์
                    </button>
                  )}
                </div>
                <p className="account-field-note">รองรับไฟล์ JPEG, PNG หรือ WebP ขนาดไม่เกิน 2 MiB</p>
              </div>
            </div>
            {avatarMessage && (
              <p className="account-feedback" data-kind={avatarMessage.kind} role={avatarMessage.kind === "error" ? "alert" : "status"}>
                {avatarMessage.text}
              </p>
            )}

            <form className="account-form-grid" onSubmit={(e) => void saveProfile(e)} noValidate>
              {profileFeedback && (
                <p className="account-feedback" data-kind={profileFeedback.kind} role={profileFeedback.kind === "error" ? "alert" : "status"}>
                  {profileFeedback.text}
                </p>
              )}
              <div className="form-field">
                <label htmlFor="self-display-name">ชื่อและนามสกุลภาษาไทย</label>
                <input
                  id="self-display-name"
                  required
                  maxLength={200}
                  value={displayNameTh}
                  onChange={(e) => setDisplayNameTh(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.display_name_th)}
                />
                {fieldErrors.display_name_th && <p className="field-error">{fieldErrors.display_name_th}</p>}
              </div>
              <div className="form-field">
                <label htmlFor="self-phone">เบอร์โทรศัพท์ที่ทำงาน</label>
                <input
                  id="self-phone"
                  type="tel"
                  required
                  pattern={phonePattern}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.phone)}
                />
                {fieldErrors.phone && <p className="field-error">{fieldErrors.phone}</p>}
              </div>
              <div className="form-field">
                <label htmlFor="self-team">ทีม / ฝ่าย</label>
                <input
                  id="self-team"
                  required
                  maxLength={200}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.team)}
                />
                {fieldErrors.team && <p className="field-error">{fieldErrors.team}</p>}
              </div>
              <div className="form-field">
                <label htmlFor="self-position">ตำแหน่ง</label>
                <input
                  id="self-position"
                  required
                  maxLength={100}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.position)}
                />
                {fieldErrors.position && <p className="field-error">{fieldErrors.position}</p>}
              </div>
              <div className="form-field">
                <label htmlFor="self-company-type">ประเภทบริษัท</label>
                <select
                  id="self-company-type"
                  value={companyType}
                  disabled={agencyLocked}
                  onChange={(e) => setCompanyType(e.target.value)}
                >
                  {Object.entries(companyLabels).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
                {agencyLocked && <p className="account-field-note">บัญชีเอเจนซีไม่สามารถเปลี่ยนประเภทหรือชื่อบริษัทด้วยตนเองได้</p>}
              </div>
              {companyType !== "SENA" && (
                <div className="form-field">
                  <label htmlFor="self-company-name">ชื่อบริษัท</label>
                  <input
                    id="self-company-name"
                    maxLength={200}
                    readOnly={agencyLocked}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.company_name)}
                  />
                  {fieldErrors.company_name && <p className="field-error">{fieldErrors.company_name}</p>}
                </div>
              )}

              <div className="account-dialog-actions">
                <button type="button" className="button secondary" onClick={closeDialog}>
                  ปิด
                </button>
                <button type="submit" className="button primary" disabled={profileBusy || account?.status !== "ACTIVE"}>
                  {profileBusy ? "กำลังบันทึก…" : "บันทึกข้อมูลส่วนตัว"}
                </button>
              </div>
            </form>
          </div>
        )}

        {dialog === "permissions" && (
          <div className="account-dialog-inner">
            <div className="account-dialog-header">
              <h2>สิทธิ์และขอบเขตการใช้งานของฉัน</h2>
              <button type="button" className="account-dialog-close" aria-label="ปิดหน้าต่าง" onClick={closeDialog}>
                ×
              </button>
            </div>
            <p className="account-field-note">
              บทบาทหลัก: <strong>{resolvedRoleLabel}</strong> · {scopeSummary}
              {permissions.admin ? " · สามารถจัดการผู้ใช้และสิทธิ์" : ""}
            </p>
            {permittedTabs.length === 0 ? (
              <p>ยังไม่มีสิทธิ์เข้าถึงเมนูย่อยในระบบ</p>
            ) : (
              <ul className="account-perm-list">
                {permittedTabs.map((item) => (
                  <li className="account-perm-row" key={item.tab}>
                    <span>{item.label_th}</span>
                    <span className="account-perm-levels">
                      {permissions.can(item.tab, "view") && <span className="account-perm-tag">ดู</span>}
                      {permissions.can(item.tab, "edit") && <span className="account-perm-tag">แก้ไข</span>}
                      {permissions.can(item.tab, "approve") && <span className="account-perm-tag">อนุมัติ</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="account-dialog-actions">
              <button type="button" className="button primary" onClick={closeDialog}>
                ปิด
              </button>
            </div>
          </div>
        )}

        {dialog === "security" && (
          <div className="account-dialog-inner">
            <div className="account-dialog-header">
              <h2>ความปลอดภัยและรหัสผ่าน</h2>
              <button type="button" className="account-dialog-close" aria-label="ปิดหน้าต่าง" onClick={closeDialog}>
                ×
              </button>
            </div>
            <p className="account-field-note">
              อีเมลบัญชี: <strong>{account?.email || "บัญชีสาธิตภายในเครื่อง"}</strong>
              <br />
              วิธีเข้าสู่ระบบ: <strong>{methodLabel(account?.sign_in_method || (hostedConfig?.google ? "google" : "email"))}</strong>
            </p>
            {!hostedConfig ? (
              <p className="account-feedback" data-kind="success">
                คุณกำลังใช้งานในโหมดทดสอบภายในเครื่อง (ไม่ใช้รหัสผ่านจริง)
              </p>
            ) : account?.sign_in_method === "google" ? (
              <p className="account-feedback" data-kind="success">
                บัญชีนี้เชื่อมต่อผ่าน Google คุณสามารถจัดการรหัสผ่านและการยืนยันตัวตน 2 ชั้นได้ที่บัญชี Google ของคุณ
              </p>
            ) : (
              <form className="account-form-grid" onSubmit={(e) => void submitPasswordChange(e)} noValidate>
                {passwordFeedback && (
                  <p className="account-feedback" data-kind={passwordFeedback.kind} role={passwordFeedback.kind === "error" ? "alert" : "status"}>
                    {passwordFeedback.text}
                  </p>
                )}
                <div className="form-field">
                  <label htmlFor="self-new-password">รหัสผ่านใหม่</label>
                  <input
                    id="self-new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="self-confirm-password">ยืนยันรหัสผ่านใหม่</label>
                  <input
                    id="self-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <div className="account-dialog-actions">
                  <button type="button" className="button secondary" onClick={closeDialog}>
                    ปิด
                  </button>
                  <button type="submit" className="button primary" disabled={passwordBusy}>
                    {passwordBusy ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
                  </button>
                </div>
              </form>
            )}
            {(!hostedConfig || account?.sign_in_method === "google") && (
              <div className="account-dialog-actions">
                <button type="button" className="button primary" onClick={closeDialog}>
                  ปิด
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}
