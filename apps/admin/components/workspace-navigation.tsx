"use client";

import { useSearchParams } from "next/navigation";

export function useListQuery() {
  const query = useSearchParams();
  function update(values: Record<string, string | number | null>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value == null || value === "") next.delete(key); else next.set(key, String(value));
    }
    window.history.replaceState(null, "", `/?${next}`);
  }
  return { query, update, href: `/?${query}` };
}

export function listReturnHref(value: string | null, fallback = "/") {
  if (!value?.startsWith("/?") || value.length > 5000) return fallback;
  const url = new URL(value, "http://hub.invalid");
  if (url.origin !== "http://hub.invalid" || url.pathname !== "/") return fallback;
  if (["project", "brand", "version", "draft_at", "source"].some(key => url.searchParams.has(key))) return fallback;
  return `${url.pathname}${url.search}`;
}

export function WorkspaceBack({ fallback = "/", label = "โครงการทั้งหมด" }: { fallback?: string; label?: string }) {
  const query = useSearchParams();
  const href = listReturnHref(query.get("return_to"), fallback);
  return <a className="back-link" href={href}>{href === fallback ? label : "กลับรายการก่อนหน้า"}</a>;
}

export function projectHref(id: string, returnTo: string, field?: string) {
  const query = new URLSearchParams({ project: id });
  if (field) query.set("field", field);
  query.set("return_to", listReturnHref(returnTo));
  return `/?${query}`;
}

export function pageNumber(value: string | null) { return Math.max(1, Math.min(10000, Number(value) || 1)) | 0; }
export function pageSizeNumber(value: string | null) { const size = Number(value); return [10, 25, 50].includes(size) ? size : 10; }

export function WorkspacePagination({ id, page, pages, size, onChange }: {
  id: string; page: number; pages: number; size: number; onChange: (page: number, size: number) => void;
}) {
  return <nav className="brand-pagination" aria-label="หน้ารายการโครงการ">
    <div className="brand-page-size"><label htmlFor={`${id}-size`}>รายการต่อหน้า</label><select id={`${id}-size`} value={size} onChange={event => onChange(1, Number(event.target.value))}>{[10, 25, 50].map(value => <option key={value}>{value}</option>)}</select></div>
    <div className="brand-page-controls"><button className="button secondary" disabled={page <= 1} onClick={() => onChange(page - 1, size)}>หน้าก่อนหน้า</button><div className="brand-page-number"><label htmlFor={`${id}-page`}>หน้า</label><select id={`${id}-page`} value={page} onChange={event => onChange(Number(event.target.value), size)}>{Array.from({ length: pages }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select><span>จาก {pages}</span></div><button className="button secondary" disabled={page >= pages} onClick={() => onChange(page + 1, size)}>หน้าถัดไป</button></div>
  </nav>;
}
