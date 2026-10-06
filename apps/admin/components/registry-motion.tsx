"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function HubMotion({ children }: { children: ReactNode }) {
  return <>{children}</>;
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
    {open && <div className="registry-options" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? event.key === "ArrowDown" ? 0 : buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>{options.length > 10 && <input aria-label={`ค้นหา${label}`} className="registry-input" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />}<div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>{shown.map(option => <button type="button" key={option.value} role="option" aria-selected={value === option.value} disabled={option.disabled} onPointerEnter={() => setHighlighted(option.value)} onFocus={() => setHighlighted(option.value)} onClick={() => { onChange(option.value); close(); }}>{highlighted === option.value && !option.disabled && <span className="registry-picker-highlight" />}<span className="relative">{option.label}</span></button>)}</div>{!shown.length && <p role="status" className="p-3">ไม่พบข้อมูลที่ตรงกัน</p>}</div>}
  </div>;
}

// Decorative placeholder rows; the paired live region announces loading.
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return <div className="hub-skeleton-list" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div key={index} className="hub-skeleton-row"><span className="hub-skeleton tall" /><span className="hub-skeleton" /><span className="hub-skeleton short" /><span className="hub-skeleton short" /></div>)}</div>;
}

// Keep the live region mounted; announce status without decorative motion.
export function StatusText({ message }: { message: string }) {
  return message ? <span key={message} className="hub-status-msg">{message}</span> : null;
}

export function RegistryRowSummary({ id, children }: { id: string; children: ReactNode }) {
  return <div data-row-id={id} className="registry-row-summary">{children}</div>;
}

// Native modal focus containment; opening and closing never depend on animation.
export function DetailDialog({ dialogId, title, onClose, children }: { dialogId: string; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    return () => { element?.close(); (opener?.isConnected ? opener : document.getElementById("registry-title"))?.focus(); };
  }, []);
  return <dialog ref={dialog} data-dialog-id={dialogId} className="registry-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close.current(); }}>
    <div className="registry-backdrop" onClick={onClose} />
    <section className="registry-card">
      <header className="flex flex-wrap items-center justify-between gap-4"><h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2><button type="button" className="registry-button" onClick={onClose}>ปิด</button></header>
      {children}
    </section>
  </dialog>;
}
