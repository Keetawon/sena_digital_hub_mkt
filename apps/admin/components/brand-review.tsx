"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
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
export async function loadBrandReviews(includeVersions = true): Promise<BrandReview[]> {
  const brands = await request<Brand[]>("v1/admin/brands");
  if (!includeVersions) return brands.map(brand => ({ brand, versions: [] }));
  return Promise.all(brands.map(async brand => {
    try { return { brand, versions: await request<BrandVersion[]>(`v1/admin/brands/${encodeURIComponent(brand.public_brand_id)}/versions`) }; }
    catch { return { brand, versions: [], error: "โหลดเวอร์ชันสำหรับเปรียบเทียบไม่สำเร็จ" }; }
  }));
}

const brandReviewCache = new Map<string, { rows: BrandReview[]; expiresAt: number }>();
if (typeof window !== "undefined") {
  const clear = () => brandReviewCache.clear();
  window.addEventListener("hub-accounts-changed", clear);
  window.addEventListener("hub-content-access-invalidated", clear);
}

type ReviewState = { rows: BrandReview[]; loading: boolean; error: string; reload: () => Promise<void>; pendingCount: number | null; enabled: boolean };
const ReviewContext = createContext<ReviewState>({ rows: [], loading: false, error: "", reload: async () => {}, pendingCount: null, enabled: false });
export const useBrandReviews = () => useContext(ReviewContext);
export function BrandReviewProvider({ enabled, defer = false, children }: { enabled: boolean; defer?: boolean; children: ReactNode }) {
  const permissions = useHubPermissions();
  const includeVersions = permissions.can("brands", "approve");
  const authority = `${capabilityKey(permissions.account)}::v=${includeVersions ? 1 : 0}`;
  const generation = useRef(0);
  const cached = enabled ? brandReviewCache.get(authority) : undefined;
  const freshCached = cached && cached.expiresAt > Date.now() ? cached.rows : null;
  const [rows, setRows] = useState<BrandReview[]>(freshCached ?? []);
  const [loading, setLoading] = useState(enabled && !freshCached);
  const [error, setError] = useState("");
  const fetchReviews = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force) {
      const hit = brandReviewCache.get(authority);
      if (hit && hit.expiresAt > Date.now()) {
        setRows(hit.rows);
        setLoading(false);
        setError("");
        return;
      }
    } else {
      brandReviewCache.delete(authority);
    }
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await loadBrandReviews(includeVersions);
      if (current === generation.current) {
        brandReviewCache.set(authority, { rows: result, expiresAt: Date.now() + 30_000 });
        setRows(result);
      }
    }
    catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : "โหลดรายการตรวจแบรนด์ไม่สำเร็จ"); }
    finally { if (current === generation.current) setLoading(false); }
  }, [enabled, authority, includeVersions]);
  const reload = useCallback(() => fetchReviews(true), [fetchReviews]);
  useEffect(() => {
    if (!enabled) { setRows([]); setLoading(false); setError(""); return; }
    const hit = brandReviewCache.get(authority);
    if (hit && hit.expiresAt > Date.now()) {
      setRows(hit.rows); setLoading(false); setError("");
      return;
    }
    if (!defer) {
      void fetchReviews(false);
      return () => { generation.current++; };
    }
    const timer = window.setTimeout(() => { void fetchReviews(false); }, 250);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [enabled, defer, authority, fetchReviews]);
  const pendingCount = enabled && includeVersions && !loading && !error ? brandReviewCounts(rows).pending : null;
  return <ReviewContext.Provider value={{ rows, loading, error, reload, pendingCount, enabled }}>{children}</ReviewContext.Provider>;
}
