"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import { contentDate, errorMessage } from "./content-common";
import { workspaceApi, workspaceHref, workspaceName, workspaceText as text, type LocalizedName, type WorkspaceTarget } from "@/lib/unified-workspace";
import "./promotions-workspace.css";
import { benefitText, promotionTiers, type BenefitItem, type PromotionTier } from "./promotion-types";

export type PromotionContext = { kind: "project" | "brand" | "project_group" | "corporate"; owning_project_group_id?: string | null; ref: string; phase?: string | null; project_id: string | null; owning_brand_id: string | null };
export type PromotionSuggestion = { id: string; source: "website" | "km"; source_url: string | null; captured_at: string | null; flags: { likely_expired: boolean; undated: boolean; not_a_promotion: boolean }; text: { title: string; summary: string; conditions_public: string } };
type PromotionRow = {
  can_edit?: boolean;
  promotion_tier?: PromotionTier; applies_via?: PromotionTier; benefit_items?: BenefitItem[]; highlight_badge?: LocalizedName;
  id: string; title: LocalizedName; group: "active" | "in_review" | "draft" | "expired";
  publication_state: "active" | "expired" | "scheduled" | "withdrawn" | "unavailable" | "draft";
  draft_applies: boolean; published_applies: boolean; scope_count: number;
  source: { kind: "brand" | "project" | "shared" | "campaign" | "corporate" | "project_group"; label: LocalizedName | null };
  starts_at: string; ends_at: string; booking_from: string | null; booking_to: string | null; transfer_from: string | null; transfer_to: string | null;
  audience: string; banner: { asset_id: string; rights_status: string; caption: LocalizedName } | null;
  review_lanes?: { type: "DATA" | "LEGAL"; decision: "APPROVED" | "REVOKED" }[];
};
type Listing = { items: PromotionRow[]; total: number; context: PromotionContext; counts: Record<string, number> };
export type PromotionSummary = { ending_soon: number; banner_missing: number; invalid_price_count: number; invalid_prices: { id: string; label: LocalizedName; target: WorkspaceTarget }[] };
const groups = { active: text.promotion_active, in_review: text.promotion_review, draft: text.promotion_draft, expired: text.promotion_expired };
const filters = { all: text.all, ...groups, ending_soon: text.promotion_ending_seven_days, banner_missing: text.promotion_missing_banner_rights };
const audiences: Record<string, string> = { general: text.promotion_audience_general, investor: text.promotion_audience_investor, livnex: text.promotion_audience_livnex };

export function promotionEditorHref(context: PromotionContext, promotion = "new", extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ promotion, context_kind: context.kind, context_ref: context.ref, ...extra });
  if (context.phase) query.set("context_phase", context.phase);
  if (promotion === "new") {
    query.set("tier", context.kind);
    if (context.owning_project_group_id) query.set("owning_project_group_id", context.owning_project_group_id);
    if (context.project_id) query.set("project_id", context.project_id);
    if (context.owning_brand_id) query.set("owning_brand_id", context.owning_brand_id);
  }
  return `/promotions?${query}`;
}

export function PromotionOverview({ summary, level, id, phase }: { summary?: PromotionSummary | null; level: "project" | "brand" | "project_group" | "corporate"; id: string; phase?: string | null }) {
  if (!summary) return null;
  return <section className="workspace-panel"><h2>{text.promotion_tab}</h2><ul className="workspace-items">
    <li><Link prefetch={false} href={workspaceHref({ level, id, phase, tab: "promotions" }, { filter: "ending_soon" })}>{text.promotion_ending_seven_days} <strong>{summary.ending_soon}</strong></Link></li>
    <li><Link prefetch={false} href={workspaceHref({ level, id, phase, tab: "promotions" }, { filter: "banner_missing" })}>{text.promotion_missing_banner_rights} <strong>{summary.banner_missing}</strong></Link></li>
  </ul><details><summary>{text.promotion_invalid_starting_price} <strong>{summary.invalid_price_count}</strong></summary><ul className="workspace-items">{summary.invalid_prices.map(price => <li key={price.id}><Link prefetch={false} href={workspaceHref(price.target)}>{workspaceName(price.label)}</Link></li>)}</ul></details></section>;
}

export function ContextualPromotions({ level, id, phase, filter = "all" }: { level: "project" | "brand" | "project_group" | "corporate"; id: string; phase?: string | null; filter?: string }) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const allowed = permissions.can("promotions") && permissions.can("projects") && permissions.can(level === "brand" ? "brands" : level === "corporate" || level === "project_group" ? "knowledge" : "projects");
  const [data, setData] = useState<Listing | null>(null), [suggestions, setSuggestions] = useState<{ items: PromotionSuggestion[]; total: number } | null>(null);
  const [error, setError] = useState(""), [retry, setRetry] = useState(0), [offset, setOffset] = useState(0), [suggestionOffset, setSuggestionOffset] = useState(0);
  const [excluding, setExcluding] = useState<string | null>(null), [notice, setNotice] = useState("");
  const selected = Object.hasOwn(filters, filter) ? filter : "all";
  useEffect(() => { setOffset(0); setSuggestionOffset(0); }, [level, id, phase, selected]);
  useEffect(() => {
    let active = true; setData(null); setSuggestions(null); setError("");
    if (!allowed) return;
    const query = new URLSearchParams({ filter: selected, offset: String(offset) });
    const suggestionQuery = new URLSearchParams({ offset: String(suggestionOffset) });
    if (phase && level === "project") { query.set("phase", phase); suggestionQuery.set("phase", phase); }
    const endpoint = workspaceApi(level, id) + "/promotions";
    Promise.all([request<Listing>(`${endpoint}?${query}`), ["project", "brand"].includes(level) ? request<{ items: PromotionSuggestion[]; total: number }>(`${endpoint}/suggestions?${suggestionQuery}`) : Promise.resolve(null)])
      .then(([rows, legacy]) => { if (active) { setData(rows); setSuggestions(legacy); } })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [level, id, phase, selected, offset, suggestionOffset, authority, allowed, retry]);
  async function exclude(row: PromotionRow) {
    if (!data?.context.project_id || excluding) return;
    setExcluding(row.id); setError("");
    try {
      const current = await request<{ draft_revision: number; excluded_project_ids?: string[] }>(`v1/admin/promotions/${row.id}`);
      await request(`v1/admin/promotions/${row.id}`, "PATCH", { expected_revision: current.draft_revision, excluded_project_ids: [...new Set([...(current.excluded_project_ids ?? []), data.context.project_id])] });
      setNotice("ยกเว้นโครงการในฉบับร่างแล้ว ต้องตรวจขอบเขตใหม่ก่อนเผยแพร่"); setRetry(value => value + 1);
    } catch (e) { setError(errorMessage(e)); } finally { setExcluding(null); }
  }
  if (!allowed) return null;
  const windowText = (start: string | null, end: string | null) => start && end ? `${contentDate(start)} – ${contentDate(end)}` : text.promotion_undated;
  return <div className="contextual-promotions">
    <header className="content-header"><h2>{text.promotion_tab}</h2>{data && permissions.can("promotions", "edit") && <Link prefetch={false} className="button primary" href={promotionEditorHref(data.context)}>{level === "brand" ? text.promotion_create_brand : level === "project" ? text.promotion_create_project : `สร้างโปรโมชันระดับ${promotionTiers[level]}`}</Link>}</header>
    {notice && <p role="status">{notice}</p>}
    <nav className="workspace-promotion-filters" aria-label={text.promotion_tab}>{Object.entries(filters).map(([key, label]) => <Link prefetch={false} key={key} className="button secondary" aria-current={key === selected ? "page" : undefined} href={workspaceHref({ level, id, phase, tab: "promotions" }, { filter: key })}>{label}{data && key !== "all" && <> ({data.counts[key] ?? 0})</>}</Link>)}</nav>
    {error && <p className="notice error" role="alert">{error} <button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>}
    {!data && !error && <p role="status">{text.loading}</p>}
    {data && <>{data.total === 0 && <p>{text.promotion_no_items}</p>}{Object.entries(groups).map(([group, label]) => {
      const order = Object.keys(promotionTiers);
      const rows = data.items.filter(row => row.group === group).sort((a, b) => order.indexOf(a.promotion_tier ?? "project") - order.indexOf(b.promotion_tier ?? "project"));
      return rows.length ? <section key={group}><h3>{label}</h3><ul className="workspace-promotion-list">{rows.map(row => <li key={row.id} className="workspace-panel" data-workspace-item={row.id} tabIndex={-1}>
        <div className="workspace-promotion-heading"><h4><Link prefetch={false} href={promotionEditorHref(data.context, row.id)}>{workspaceName(row.title)}</Link></h4><span className="workspace-promotion-source">{row.source.kind === "brand" ? text.promotion_from_brand.replace("{brand}", workspaceName(row.source.label)) : row.source.kind === "project" ? text.promotion_this_project : text.promotion_shared.replace("{count}", String(row.scope_count))}</span></div>
        {row.promotion_tier && <span className="promo-badge">{promotionTiers[row.applies_via ?? row.promotion_tier]}</span>}{row.highlight_badge?.th && <strong className="promo-highlight">{row.highlight_badge.th}</strong>}{Boolean(row.benefit_items?.length) && <ul className="promo-resolved-pills">{row.benefit_items?.map((item, index) => <li key={index}>{benefitText(item)}</li>)}</ul>}
        {row.banner ? <div className="workspace-promotion-banner"><img src={`/api/hub/v1/admin/assets/${encodeURIComponent(row.banner.asset_id)}/thumbnail`} alt={workspaceName(row.banner.caption)} loading="lazy" width={144} height={96} /><p>{text.promotion_banner_rights}: {row.banner.rights_status === "approved" ? text.promotion_banner_approved : text.promotion_banner_unapproved}</p></div> : <p>{text.promotion_banner_missing}</p>}
        <dl className="workspace-promotion-dates"><div><dt>{text.date}</dt><dd>{windowText(row.starts_at, row.ends_at)}</dd></div><div><dt>{text.promotion_booking_window}</dt><dd>{windowText(row.booking_from, row.booking_to)}</dd></div><div><dt>{text.promotion_transfer_window}</dt><dd>{windowText(row.transfer_from, row.transfer_to)}</dd></div><div><dt>{text.promotion_audience}</dt><dd>{audiences[row.audience] ?? row.audience}</dd></div></dl>
        {["scheduled", "withdrawn", "unavailable"].includes(row.publication_state) && <p>{text[`promotion_${row.publication_state}` as keyof typeof text]}</p>}
        {row.group === "in_review" && <ul>{(["DATA", "LEGAL"] as const).map(lane => { const review = row.review_lanes?.find(item => item.type === lane); return <li key={lane}>{lane === "DATA" ? text.promotion_review_data : text.promotion_review_legal}: {review?.decision === "APPROVED" ? text.promotion_review_approved : review?.decision === "REVOKED" ? text.promotion_review_revoked : text.promotion_review_waiting}</li>; })}</ul>}
        {row.published_applies && !row.draft_applies && <p className="notice">{text.promotion_scope_pending}</p>}
        <div className="content-actions"><Link prefetch={false} className="button secondary" href={promotionEditorHref(data.context, row.id)}>{text.promotion_open_editor}</Link>{level === "project" && data.context.project_id && (row.promotion_tier ? row.promotion_tier !== "project" : row.source.kind !== "project") && permissions.can("promotions", "edit") && row.can_edit !== false && row.draft_applies && <button type="button" className="button secondary" disabled={excluding !== null} onClick={() => void exclude(row)}>{excluding === row.id ? "กำลังยกเว้นโครงการ…" : text.promotion_exclude_project}</button>}</div>
      </li>)}</ul></section> : null;
    })}<div className="content-actions"><button className="button secondary" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{text.previous}</button><button className="button secondary" disabled={offset + data.items.length >= data.total} onClick={() => setOffset(value => value + 50)}>{text.next}</button></div></>}
    {data && suggestions && <section className="workspace-panel"><h3>{text.promotion_suggestion_source} ({suggestions.total})</h3><p>{text.promotion_confirm_numbers}</p>{suggestions.items.map(item => <details key={item.id}><summary>{item.text.title || item.text.summary.slice(0, 140) || text.promotion_suggestion_source}</summary><p>{item.text.summary}</p><p>{item.text.conditions_public}</p><p>{text.promotion_captured_at}: {item.captured_at ? contentDate(item.captured_at) : text.promotion_capture_unknown}</p><p>{item.flags.likely_expired && <span>{text.promotion_likely_expired} · </span>}{item.flags.undated && <span>{text.promotion_undated} · </span>}{item.flags.not_a_promotion && <span>{text.promotion_not_offer}</span>}</p>{item.source_url && <p><a href={item.source_url} target="_blank" rel="noreferrer">{text.promotion_source_page}</a></p>}{permissions.can("promotions", "edit") && <Link prefetch={false} className="button secondary" href={promotionEditorHref(data.context, "new", { suggestion: item.id, suggestion_source: item.source })}>{text.promotion_create_suggestion}</Link>}</details>)}<div className="content-actions"><button className="button secondary" disabled={suggestionOffset === 0} onClick={() => setSuggestionOffset(value => Math.max(0, value - 50))}>{text.previous}</button><button className="button secondary" disabled={suggestionOffset + suggestions.items.length >= suggestions.total} onClick={() => setSuggestionOffset(value => value + 50)}>{text.next}</button></div></section>}
  </div>;
}
