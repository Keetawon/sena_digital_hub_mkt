import { uploadText } from "./upload-text";

export type UploadContext =
  | { v: 1; kind: "intake" }
  | { v: 1; kind: "project"; ref: string; category: string | null; purpose: string }
  | { v: 1; kind: "brand"; ref: string; purpose: string }
  | { v: 1; kind: "model" | "commercial_type"; project_ref: string; ref: string; category: string | null; purpose: string }
  | { v: 1; kind: "media_target"; project_ref: string; target_type: string; target_key: string; category: string | null; usage: string }
  | { v: 1; kind: "disclosure"; project_ref: string; ref: string | null }
  | { v: 1; kind: "knowledge"; candidate_id: string };
const fields: Record<UploadContext["kind"], readonly string[]> = {
  intake: [], project: ["ref", "category", "purpose"], brand: ["ref", "purpose"],
  model: ["project_ref", "ref", "category", "purpose"], commercial_type: ["project_ref", "ref", "category", "purpose"],
  media_target: ["project_ref", "target_type", "target_key", "category", "usage"],
  disclosure: ["project_ref", "ref"], knowledge: ["candidate_id"],
};
const purposes: Record<string, readonly string[]> = {
  project: ["media", "hero", "thumbnail", "master_plan", "floor_plan", "brochure"],
  brand: ["logo_primary", "logo_white", "logo_mono", "favicon"],
  model: ["model_image", "floor_plan", "structural_plan"],
  commercial_type: ["media", "floor_plan", "unit_plan", "structural_plan"],
};
export const uploadCategories = ["exterior", "interior", "facility", "lifestyle", "aerial", "surrounding", "master_plan", "floor_plan", "unit_plan", "map", "progress", "promotion_ad", "brochure", "legal_document"] as const;
export const uploadMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/pdf"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseUploadContext(header: string | null): UploadContext {
  if (!header || header.length > 2048 || /[^\x20-\x7e]/.test(header)) throw new Error(uploadText.context_invalid);
  // Finite flat JSON grammar detects duplicate (including escaped) keys before JSON.parse can discard them.
  const value: Record<string, unknown> = Object.create(null), input = header.trim();
  if (!input.startsWith("{")) throw new Error(uploadText.context_invalid);
  const pair = /\s*"((?:[^"\\]|\\.)*)"\s*:\s*("(?:[^"\\]|\\.)*"|null|1)\s*(,|})/gy;
  let position = 1, closed = false;
  try {
    while (!closed) {
      pair.lastIndex = position;
      const match = pair.exec(input);
      if (!match) throw new Error();
      const key: string = JSON.parse('"' + match[1] + '"');
      if (Object.hasOwn(value, key)) throw new Error();
      value[key] = JSON.parse(match[2]); position = pair.lastIndex; closed = match[3] === "}";
    }
  } catch { throw new Error(uploadText.context_invalid); }
  const kind = value.kind as UploadContext["kind"];
  if (position !== input.length || value.v !== 1 || !Object.hasOwn(fields, kind)) throw new Error(uploadText.context_invalid);
  const keys = ["v", "kind", ...fields[kind]];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error(uploadText.context_invalid);
  for (const key of fields[kind]) {
    const item = value[key];
    if (item === null && (key === "category" || kind === "disclosure" && key === "ref")) continue;
    if (typeof item !== "string" || !/^[\x20-\x7e]{1,200}$/.test(item)) throw new Error(uploadText.context_invalid);
  }
  if (value.category !== undefined && value.category !== null && !uploadCategories.includes(value.category as typeof uploadCategories[number])) throw new Error(uploadText.context_invalid);
  if (purposes[kind] && !purposes[kind].includes(String(value.purpose))) throw new Error(uploadText.context_invalid);
  if (kind === "media_target" && (!["project", "commercial_type", "facility", "feature", "place", "promotion", "article", "building_floor", "selling_point", "disclosure"].includes(String(value.target_type))
    || !["hero", "thumbnail", "gallery", "card", "banner", "evidence"].includes(String(value.usage)))) throw new Error(uploadText.context_invalid);
  if (kind === "knowledge" && !uuid.test(String(value.candidate_id)) || kind === "disclosure" && value.ref !== null && !uuid.test(String(value.ref))) throw new Error(uploadText.context_invalid);
  return value as UploadContext;
}
export function uploadContextHeader(context: UploadContext): string {
  const header = JSON.stringify(context); parseUploadContext(header); return header;
}
export function uploadFileLimit(context: UploadContext, mime: string): number {
  if (!uploadMimeTypes.includes(mime as typeof uploadMimeTypes[number])) return 0;
  if ("purpose" in context && (context.kind === "brand" && mime === "application/pdf" || context.purpose === "brochure" && mime !== "application/pdf" || ["hero", "thumbnail"].includes(context.purpose) && mime === "application/pdf")) return 0;
  const privateFile = context.kind === "intake" || context.kind === "disclosure"
    || "category" in context && (context.category === null || context.category === "legal_document")
    || "purpose" in context && context.purpose === "structural_plan"
    || context.kind === "media_target" && context.target_type === "disclosure";
  if (privateFile) return mime === "image/svg+xml" ? 0 : 10 * 1024 * 1024;
  if (mime === "image/svg+xml") return 2 * 1024 * 1024;
  // Knowledge classification is server-owned; the API applies its resolved private/marketing ceiling before reading bytes.
  return (mime === "application/pdf" ? 50 : 30) * 1024 * 1024;
}
export function uploadFileError(file: Pick<File, "size" | "type">, context: UploadContext): string | null {
  uploadContextHeader(context);
  const limit = uploadFileLimit(context, file.type);
  if (!limit) return uploadText.unsupported;
  if (!file.size || file.size > limit) return limit === 10 * 1024 * 1024 ? uploadText.legal_limit
    : file.type === "application/pdf" ? uploadText.pdf_limit : file.type === "image/svg+xml" ? uploadText.svg_limit : uploadText.image_limit;
  return null;
}
export type UploadEvidence = {
  source_id: string; evidence_id: string;
  original: { size: number; mime_type: string; width: number | null; height: number | null };
  stored: { size: number; mime_type: string; width: number | null; height: number | null };
  pipeline_version: string; extraction_version: string;
  processing: { metadata_stripped: boolean; kept_unchanged_legal?: boolean; kept_original_because_no_gain?: boolean; [key: string]: unknown };
  suggestions: { source: "file_metadata"; confirmed: false; values: {
    taken_at?: { value: string; offset_known: boolean }; credit?: string; credit_evidence?: { field: string; text: string }[];
    stock?: "present"; stock_evidence?: string[]; image_kind?: "photo" | "render"; caption?: string;
    tags?: string[]; unmapped_keywords?: string[]; proximity?: "near" | "far" | "unknown";
  } };
};
