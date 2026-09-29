"use client";

import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
    <AnimatePresence>{open && <motion.div className="registry-options" initial={{ opacity: 0, scale: reduce ? 1 : .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : .14 }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? event.key === "ArrowDown" ? 0 : buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>{options.length > 10 && <input aria-label={`ค้นหา${label}`} className="registry-input" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />}<div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>{shown.map(option => <button type="button" key={option.value} role="option" aria-selected={value === option.value} disabled={option.disabled} onPointerEnter={() => setHighlighted(option.value)} onFocus={() => setHighlighted(option.value)} onClick={() => { onChange(option.value); close(); }}>{highlighted === option.value && !option.disabled && <motion.span className="registry-picker-highlight" layoutId={reduce ? undefined : `${id}-highlight`} transition={{ duration: reduce ? 0 : .14 }} />}<span className="relative">{option.label}</span></button>)}</div>{!shown.length && <p role="status" className="p-3">ไม่พบข้อมูลที่ตรงกัน</p>}</motion.div>}</AnimatePresence>
  </div>;
}

export function RegistryRowSummary({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return <motion.div layoutId={reduce ? undefined : id} className="registry-row-summary">{children}</motion.div>;
}

// The parent owns the URL and restores the selection on popstate; native dialog
// supplies modal focus containment and inert background without another library.
export function RowToCard({ layoutId, morph = true, title, onClose, children }: { layoutId: string; morph?: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const reduce = useReducedMotion();
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    return () => { element?.close(); (opener?.isConnected ? opener : document.getElementById("registry-title"))?.focus(); };
  }, []);
  return <dialog ref={dialog} className="registry-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close.current(); }}>
    <motion.div className="registry-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? .08 : .18 }} onClick={onClose} />
    <motion.section layout={!reduce} layoutId={reduce || !morph ? undefined : layoutId} className="registry-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 35 }}>
      <header className="flex flex-wrap items-center justify-between gap-4"><h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2><button type="button" className="registry-button" onClick={onClose}>ปิด</button></header>
      {children}
    </motion.section>
  </dialog>;
}
