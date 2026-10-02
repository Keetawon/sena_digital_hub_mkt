"use client";

import { useEffect, useState, type ReactNode } from "react";
import { assetFetch, useHostedSession } from "./hosted-session";

type FileAsset = { id: string; public_url: string | null; original_filename?: string };
export function localAssetUrl(asset: FileAsset) { return asset.public_url?.startsWith("/demo-assets/") ? asset.public_url : `/api/hub/v1/admin/assets/${encodeURIComponent(asset.id)}/file`; }
export async function privateAssetBlob(asset: FileAsset) {
  const response = await assetFetch(`v1/admin/assets/${encodeURIComponent(asset.id)}/file`);
  if (!response.ok) throw new Error("ไม่สามารถเปิดไฟล์ส่วนตัวนี้ได้ กรุณาตรวจสอบสิทธิ์หรือเข้าสู่ระบบใหม่");
  return response.blob();
}

export function AssetImage({ asset, alt, width, height, onError }: { asset: FileAsset; alt: string; width: number; height: number; onError?: () => void }) {
  const hosted = Boolean(useHostedSession());
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!hosted) return;
    let active = true; let objectUrl = "";
    setUrl(""); setFailed(false);
    void privateAssetBlob({ id: asset.id, public_url: null }).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [hosted, asset.id]);
  if (hosted && !url) return <span role="status">{failed ? "โหลดภาพไม่ได้" : "กำลังโหลดภาพ…"}</span>;
  return <img src={hosted ? url : localAssetUrl(asset)} alt={alt} width={width} height={height} loading="lazy" onError={onError} />;
}

export function AssetFileLink({ asset, children }: { asset: FileAsset; children: ReactNode }) {
  const hosted = Boolean(useHostedSession());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!hosted) return <a className="asset-file-link" href={localAssetUrl(asset)} target="_blank" rel="noopener noreferrer">{children}</a>;
  return <><button className="button text-button asset-file-link" disabled={pending} onClick={async () => {
    setPending(true); setError("");
    try {
      const blob = await privateAssetBlob(asset); const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = asset.original_filename || "asset"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("ดาวน์โหลดไม่ได้ กรุณาตรวจสอบสิทธิ์หรือเข้าสู่ระบบใหม่"); }
    finally { setPending(false); }
  }}>{pending ? "กำลังดาวน์โหลด…" : "ดาวน์โหลดไฟล์"}<span className="visually-hidden"> {asset.original_filename}</span></button>{error && <p role="alert">{error}</p>}</>;
}
