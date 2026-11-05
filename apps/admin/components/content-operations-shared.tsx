"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import "./ads-registry.css";
import "./content-operations.css";

export type Localized = Record<string, string>;
export const thai = (value: Localized | string | null | undefined): string => typeof value === "string" ? value : value?.th ?? "ยังไม่ระบุ";
export const dateTime = (value: string | null | undefined): string => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "ยังไม่มีข้อมูล";
export const localBangkok = (value: string | undefined): string => value ? new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16) : "";
export const bangkokISO = (value: string): string => `${value}${value.length === 16 ? ":00" : ""}+07:00`;
export type Readiness = { ready: boolean; missing: { field: string; message: string }[] };
export function Ready({ value }: { value?: Readiness }) {
  if (!value) return <p>ยังไม่ได้ตรวจความพร้อม</p>;
  return <div className="content-readiness"><strong>{value.ready ? "พร้อมเผยแพร่ตามการตรวจล่าสุด" : "ยังไม่พร้อมเผยแพร่"}</strong>{value.missing?.length > 0 && <ul>{value.missing.map((row, index) => <li key={`${row.field}-${index}`}>{row.message}</li>)}</ul>}</div>;
}
export function ErrorSummary({ message, fields = [] }: { message: string; fields?: { id: string; label: string }[] }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) node.current?.focus(); }, [message]);
  return message ? <div className="registry-error" role="alert" tabIndex={-1} ref={node}><strong>{message}</strong>{fields.length > 0 && <ul>{fields.map(field => <li key={field.id}><a href={`#${field.id}`} onClick={event => { event.preventDefault(); document.getElementById(field.id)?.focus(); }}>{field.label}</a></li>)}</ul>}</div> : null;
}
export function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return <div className="content-field"><label htmlFor={id}>{label}</label>{children}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function useContentLocation(dirty: boolean, guard = true) {
  const query = useSearchParams();
  const previous = useRef("");
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => {
    previous.current = location.href;
    const pop = () => {
      if (dirtyRef.current && !window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการออกและละทิ้งการแก้ไขหรือไม่")) { history.pushState(null, "", previous.current); return; }
      previous.current = location.href;
    };
    const leave = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    const link = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest("a[href]") as HTMLAnchorElement | null;
      if (anchor && !anchor.hash && dirtyRef.current && !window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการออกและละทิ้งการแก้ไขหรือไม่")) event.preventDefault();
    };
    const checkUnsaved = (event: Event) => {
      if (dirtyRef.current) (event as CustomEvent<{ dirty: boolean }>).detail.dirty = true;
    };
    if (!guard) return;
    addEventListener("hub-check-unsaved", checkUnsaved);
    addEventListener("popstate", pop); addEventListener("beforeunload", leave); document.addEventListener("click", link);
    return () => { removeEventListener("hub-check-unsaved", checkUnsaved); removeEventListener("popstate", pop); removeEventListener("beforeunload", leave); document.removeEventListener("click", link); };
  }, [guard]);
  function navigate(values: Record<string, string | null>, discard = false) {
    if (!discard && dirtyRef.current && !window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการออกและละทิ้งการแก้ไขหรือไม่")) return false;
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(values)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.pushState(null, "", url); previous.current = url.href; return true;
  }
  return { params: new URLSearchParams(query.toString()), navigate };
}
