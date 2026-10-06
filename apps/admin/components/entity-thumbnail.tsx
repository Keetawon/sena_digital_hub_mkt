"use client";
import { useState } from "react";
import { AssetImage } from "./private-assets";
import "./entity-thumbnail.css";
export type Thumbnail = { id: string; public_url: string | null };
// Staff access is unchanged; rights approval is not required to inspect a candidate.
export function EntityThumbnail({ name, image, fallback, brandKey = "sena" }: { name: string; image?: Thumbnail | null; fallback?: Thumbnail | null; brandKey?: string | null }) {
  const [failed, setFailed] = useState<string[]>([]);
  const asset = [image, fallback].find(item => item && !failed.includes(item.id));
  const tint = Array.from(brandKey || "sena").reduce((n, c) => n + c.codePointAt(0)!, 0) % 3;
  return asset ? <span className="entity-thumbnail"><AssetImage thumbnail key={asset.id} asset={asset} alt={name} width={48} height={48} onError={() => setFailed(previous => previous.includes(asset.id) ? previous : [...previous, asset.id])} /></span> : <span className={`entity-thumbnail entity-thumbnail-tint-${tint}`} role="img" aria-label={name}>{Array.from(name.trim()).slice(0, 2).join("") || "—"}</span>;
}
