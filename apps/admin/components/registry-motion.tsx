"use client";

import { animate, AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function HubMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export type PickerOption = { value: string; label: string; disabled?: boolean };
export function DropdownPop({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: PickerOption[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(value);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const shown = options.filter(option => option.label.toLocaleLowerCase("th").includes(query.toLocaleLowerCase("th")));
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    (container.current?.querySelector<HTMLElement>('input') ?? container.current?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') ?? container.current?.querySelector<HTMLElement>('[role="option"]:not(:disabled)'))?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={container} className="registry-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span id={`${id}-label`} className="block font-medium">{label}</span>
    <button ref={trigger} type="button" className="registry-input text-left" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} disabled={disabled} onClick={() => { setQuery(""); setOpen(!open); }} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setQuery(""); setOpen(true); } }}><span id={`${id}-value`}>{options.find(option => option.value === value)?.label || "เลือกข้อมูล"}</span><span aria-hidden="true"> ▾</span></button>
    <AnimatePresence>{open && <motion.div className="registry-options" initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .95, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: .98, y: -4, transition: { duration: .12 } }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34, mass: .8 }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? event.key === "ArrowDown" ? 0 : buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>{options.length > 10 && <input aria-label={`ค้นหา${label}`} className="registry-input" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />}<div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>{shown.map(option => <button type="button" key={option.value} role="option" aria-selected={value === option.value} disabled={option.disabled} onPointerEnter={() => setHighlighted(option.value)} onFocus={() => setHighlighted(option.value)} onClick={() => { onChange(option.value); close(); }}>{highlighted === option.value && !option.disabled && <motion.span className="registry-picker-highlight" layoutId={reduce ? undefined : `${id}-highlight`} transition={{ duration: reduce ? 0 : .14 }} />}<span className="relative">{option.label}</span></button>)}</div>{!shown.length && <p role="status" className="p-3">ไม่พบข้อมูลที่ตรงกัน</p>}</motion.div>}</AnimatePresence>
  </div>;
}

// Decorative placeholder rows; the paired live region announces loading.
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return <div className="hub-skeleton-list" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div key={index} className="hub-skeleton-row"><span className="hub-skeleton tall" /><span className="hub-skeleton" /><span className="hub-skeleton short" /><span className="hub-skeleton short" /></div>)}</div>;
}

// Keep the live region mounted; remount only the message so each change pops in.
export function StatusText({ message }: { message: string }) {
  return message ? <span key={message} className="hub-status-msg">{message}</span> : null;
}

export function RegistryRowSummary({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return <motion.div layoutId={reduce ? undefined : id} data-morph-id={id} className="registry-row-summary">{children}</motion.div>;
}

// The parent owns the URL and restores the selection on popstate; native dialog
// supplies modal focus containment and inert background without another library.
// The card grows out of its source row with a uniform spring scale, so text is
// never stretched; a direct link without a visible row rises into place instead.
export function RowToCard({ layoutId, morph = true, title, onClose, children }: { layoutId: string; morph?: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const reduce = useReducedMotion();
  const titleId = useId();
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    const surface = card.current;
    let entrance: { stop: () => void } | undefined;
    if (surface && !reduce) {
      const source = morph ? document.querySelector<HTMLElement>(`[data-morph-id="${CSS.escape(layoutId)}"]`) : null;
      const from = source?.getBoundingClientRect();
      const to = surface.getBoundingClientRect();
      const start = from?.width && to.width
        ? { x: from.left + from.width / 2 - (to.left + to.width / 2), y: from.top + from.height / 2 - (to.top + to.height / 2), scale: Math.min(.9, Math.max(.55, from.width / to.width)) }
        : { x: 0, y: 18, scale: .96 };
      surface.style.opacity = "0";
      entrance = animate(surface, { opacity: [0, 1], x: [start.x, 0], y: [start.y, 0], scale: [start.scale, 1] }, { type: "spring", stiffness: 360, damping: 32, mass: .9, opacity: { duration: .2, ease: [.22, 1, .36, 1] } });
    }
    return () => { entrance?.stop(); element?.close(); (opener?.isConnected ? opener : document.getElementById("registry-title"))?.focus(); };
  }, []);
  return <dialog ref={dialog} className="registry-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close.current(); }}>
    <motion.div className="registry-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? .08 : .22 }} onClick={onClose} />
    <motion.section ref={card} className="registry-card" exit={reduce ? { opacity: 0, transition: { duration: .08 } } : { opacity: 0, scale: .96, y: 10, transition: { duration: .18, ease: [.55, 0, .75, .2] } }}>
      <header className="flex flex-wrap items-center justify-between gap-4"><h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2><button type="button" className="registry-button" onClick={onClose}>ปิด</button></header>
      {children}
    </motion.section>
  </dialog>;
}
