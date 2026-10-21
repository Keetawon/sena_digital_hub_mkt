"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Brand } from "./brand-admin";
import { request } from "./hub-request";
import { publicationKey } from "./publication-comparison";

export type BrandSnapshot = Pick<Brand, "public_name" | "description" | "slug" | "status" | "assets" | "publication_preview" | "publication_preview_redacted">;
export type BrandVersion = { version_id: string; version_no: number; published_at: string; publisher: string; change_reason: string; payload?: BrandSnapshot };
export type BrandReview = { brand: Brand; versions: BrandVersion[]; error?: string };
export type BrandFilter = "all" | "pending" | "notReady" | "published" | "stopped";
export const brandFilters: { value: BrandFilter; label: string }[] = [
  { value: "all", label: "ทั้งหมด" }, { value: "pending", label: "รอเผยแพร่" },
  { value: "notReady", label: "ยังไม่พร้อม" }, { value: "published", label: "เผยแพร่แล้ว" }, { value: "stopped", label: "หยุดแสดง" },
];
export function brandHasChanges(brand: Brand, versions: BrandVersion[]): boolean | null {
  if (!brand.published_version_id) return versions.length === 0;
  const current = versions.find(version => version.version_id === brand.published_version_id)?.payload;
  return current?.publication_preview && brand.publication_preview ? publicationKey(brand.publication_preview) !== publicationKey(current.publication_preview) : null;
}
export function matchesBrandFilter(row: BrandReview, filter: BrandFilter): boolean {
  const { brand, versions } = row;
  if (filter === "pending") return !row.error && brand.readiness?.percent === 100 && brandHasChanges(brand, versions) === true;
  if (filter === "notReady") return (brand.readiness?.percent ?? 0) < 100;
  if (filter === "published") return brand.publication_available;
  if (filter === "stopped") return !brand.publication_available && versions.length > 0;
  return true;
}
export function brandReviewCounts(rows: BrandReview[]) {
  const counts = Object.fromEntries(brandFilters.map(({ value }) => [value, rows.filter(row => matchesBrandFilter(row, value)).length])) as Record<BrandFilter, number>;
  const incomplete = rows.some(row => row.error || brandHasChanges(row.brand, row.versions) === null);
  return { ...counts, pending: incomplete ? null : counts.pending, stopped: incomplete ? null : counts.stopped };
}
export async function loadBrandReviews(): Promise<BrandReview[]> {
  const brands = await request<Brand[]>("v1/admin/brands");
  return Promise.all(brands.map(async brand => {
    try { return { brand, versions: await request<BrandVersion[]>(`v1/admin/brands/${encodeURIComponent(brand.public_brand_id)}/versions`) }; }
    catch { return { brand, versions: [], error: "โหลดเวอร์ชันสำหรับเปรียบเทียบไม่สำเร็จ" }; }
  }));
}

type ReviewState = { rows: BrandReview[]; loading: boolean; error: string; reload: () => Promise<void>; pendingCount: number | null; enabled: boolean };
const ReviewContext = createContext<ReviewState>({ rows: [], loading: false, error: "", reload: async () => {}, pendingCount: null, enabled: false });
export const useBrandReviews = () => useContext(ReviewContext);
export function BrandReviewProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const generation = useRef(0);
  const [rows, setRows] = useState<BrandReview[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    setLoading(true); setError("");
    try { const result = await loadBrandReviews(); if (current === generation.current) setRows(result); }
    catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : "โหลดรายการตรวจแบรนด์ไม่สำเร็จ"); }
    finally { if (current === generation.current) setLoading(false); }
  }, [enabled]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  const pendingCount = enabled && !loading && !error ? brandReviewCounts(rows).pending : null;
  return <ReviewContext.Provider value={{ rows, loading, error, reload, pendingCount, enabled }}>{children}</ReviewContext.Provider>;
}
