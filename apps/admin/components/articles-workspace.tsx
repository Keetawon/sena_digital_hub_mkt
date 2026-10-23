"use client";

import { useCallback, useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { ArticleEditor, type ArticleReferences } from "./article-editor";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { ErrorSummary, useContentLocation } from "./content-operations-shared";
import { BilingualInput, ExposureInput, TranslationReviewPanel, contentDate, errorMessage, useFieldCatalog, type Exposure, type Locales, type Translation } from "./content-common";
import "./articles.css";

type Link = { kind: "project" | "brand" | "programme"; ref: string };
type Metadata = { slug: string; category: string; cover_asset_id: string | null; author: Locales; tags: Locales[]; ai_exposure: Exposure };
type TextFields = { title: Locales; excerpt: Locales; seo_title: Locales; seo_description: Locales };
type Draft = Metadata & TextFields & { blocks: JSONContent; links: Link[] };
type Version = TextFields & { id: string; version_no: number; state: string; blocks: { th: JSONContent; en: JSONContent }; metadata: Metadata; editors: string[]; created_at: string; links?: Link[] };
type Article = Metadata & { id: string; revision: number; state: string; approved_version_id: string | null; version: Version; links: Link[]; history: Version[]; translations: Translation[]; readiness: { code: string; label: string }[] };
type ArticleList = { items: { id: string; title: Locales; excerpt: Locales; slug: string; state: string; version_no: number; updated_at: string }[]; total: number; offset: number; limit: number };
type Preview = { html: string; state: string; readiness: { code: string; label: string }[] };
const empty: Draft = { slug: "", category: "design", cover_asset_id: null, author: {}, tags: [], ai_exposure: "web_only", title: {}, excerpt: {}, seo_title: {}, seo_description: {}, blocks: { type: "doc", content: [{ type: "paragraph" }] }, links: [] };
const states: Record<string, string> = { DRAFT: "ฉบับร่าง", IN_REVIEW: "รอผู้อนุมัติ", APPROVED: "อนุมัติเนื้อหาแล้ว", RETURNED: "ส่งกลับแก้ไข", WITHDRAWN: "ถอนการอนุมัติ" };
const tabs = { content: "เนื้อหาบทความ", english: "ตรวจภาษาอังกฤษ", preview: "ตัวอย่างบทความ", history: "ประวัติ" };
const textFields = { title: { label: "ชื่อบทความ", max: 300 }, excerpt: { label: "บทนำ", max: 2000 }, seo_title: { label: "ชื่อสำหรับค้นหา", max: 300 }, seo_description: { label: "คำอธิบายสำหรับค้นหา", max: 1000 } };
function plainText(node: JSONContent): string { return node.text ?? (node.content ?? []).map(plainText).filter(Boolean).join(node.type === "paragraph" || node.type === "heading" ? "" : "\n"); }

export function ArticlesWorkspace() {
  const permissions = useHubPermissions(), canEdit = permissions.can("knowledge", "edit"), canApprove = permissions.can("knowledge", "approve");
  const canProjects = permissions.can("projects", "view");
  const { catalog, error: catalogError } = useFieldCatalog();
  const [references, setReferences] = useState<ArticleReferences | null>(null), [list, setList] = useState<ArticleList | null>(null);
  const [current, setCurrent] = useState<Article | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false), [translationDirty, setTranslationDirty] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [search, setSearch] = useState("");
  const [tab, setTab] = useState<keyof typeof tabs>("content"), [locale, setLocale] = useState<"th" | "en">("th"), [preview, setPreview] = useState<Preview | null>(null);
  const [linkKind, setLinkKind] = useState<Link["kind"]>("project"), [linkRef, setLinkRef] = useState("");
  const location = useContentLocation(dirty || translationDirty);
  const selected = location.params.get("article"), query = location.params.get("q") ?? "";
  const offset = Math.min(100000, Math.max(0, Number(location.params.get("offset")) || 0));
  const loadList = useCallback(async () => {
    setList(await request<ArticleList>(`v1/admin/articles?${new URLSearchParams({ q: query, offset: String(offset), limit: "25" })}`));
  }, [query, offset]);
  useEffect(() => { let active = true; request<ArticleReferences>("v1/admin/articles/references").then(value => { if (active) setReferences(value); }).catch(error => { if (active) setError(errorMessage(error)); }); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; loadList().catch(error => { if (active) setError(errorMessage(error)); }); return () => { active = false; }; }, [loadList]);
  useEffect(() => {
    let active = true; setCurrent(null); setDraft(null); setPreview(null); setDirty(false); setTab("content"); setError("");
    if (selected === "new") {
      if (canEdit) setDraft(structuredClone(empty));
      else setError("บัญชีนี้ไม่มีสิทธิ์สร้างบทความ ข้อความที่คุณกรอกเก็บไว้ในรายการกู้คืน");
    } else if (selected) request<Article>(`v1/admin/articles/${selected}`).then(value => { if (active) setCurrent(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [selected, canEdit]);
  useEffect(() => {
    let active = true; setPreview(null);
    if (current && tab === "preview" && !draft) request<Preview>(`v1/admin/articles/${current.id}/preview?locale=${locale}`)
      .then(value => { if (active) setPreview(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [current, tab, locale, draft]);
  const reloadCurrent = useCallback(async () => {
    if (selected && selected !== "new") setCurrent(await request<Article>(`v1/admin/articles/${selected}`));
    await loadList();
  }, [selected, loadList]);
  function change(patch: Partial<Draft>) { if (draft && canEdit) { setDraft({ ...draft, ...patch }); setDirty(true); } }
  function edit() {
    if (!current || !canEdit) return;
    const v = current.version;
    setDraft({ ...v.metadata, title: v.title, excerpt: v.excerpt, seo_title: v.seo_title, seo_description: v.seo_description, blocks: v.blocks.th, links: current.links });
    setDirty(false); setTab("content"); setError(""); setNotice("");
  }
  async function save() {
    if (!draft || !canEdit || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const saved = await request<{ id: string }>(current ? `v1/admin/articles/${current.id}` : "v1/admin/articles", current ? "PUT" : "POST", current ? { expected_revision: current.revision, content: draft } : draft);
      setCurrent(await request<Article>(`v1/admin/articles/${saved.id}`)); setDraft(null); setDirty(false);
      location.navigate({ article: saved.id }, true); await loadList(); setNotice("บันทึกฉบับร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  async function review(decision: "submit" | "approve" | "return" | "withdraw") {
    if (!current || pending || draft || translationDirty || (decision === "submit" ? !canEdit : !canApprove)) return;
    setPending(true); setError(""); setNotice("");
    try {
      await request(`v1/admin/articles/${current.id}/${decision === "submit" ? "submit" : "review"}`, "POST", { expected_revision: current.revision, ...(decision === "submit" ? {} : { decision }) });
      await reloadCurrent(); setNotice(decision === "submit" ? "ส่งตรวจแล้ว ผู้อนุมัติคนอื่นจะตรวจเนื้อหาฉบับนี้" : decision === "approve" ? "อนุมัติเนื้อหาแล้ว ยังไม่เผยแพร่เว็บไซต์" : decision === "return" ? "ส่งกลับให้แก้ไขแล้ว" : "ถอนการอนุมัติแล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  function options(kind: Link["kind"]) { return references?.[kind === "project" ? "projects" : kind === "brand" ? "brands" : "programmes"] ?? []; }
  function linkLabel(link: Link) { return options(link.kind).find(row => row.ref === link.ref)?.label.th || link.ref; }
  const ownEdit = current?.version.editors.includes(permissions.account?.id ?? "");
  const ownApproved = current?.history.find(version => version.id === current.approved_version_id)?.editors.includes(permissions.account?.id ?? "");
  return <div className="content-workspace articles-workspace">
    <header className="content-header"><h1>บทความ</h1><p>เขียนเนื้อหาไทย ตรวจภาษาอังกฤษ และส่งให้ผู้อนุมัติคนอื่นตรวจ</p><p className="content-state">อนุมัติเนื้อหาและเผยแพร่เว็บไซต์เป็นคนละขั้นตอน</p>{!canEdit && !canApprove && <p>สิทธิ์ดูข้อมูลเท่านั้น</p>}</header>
    <ErrorSummary message={error || catalogError} />{notice && <p role="status" className="notice success">{notice}</p>}
    {!selected ? <section className="content-section"><div className="content-toolbar"><h2>รายการบทความ</h2>{canEdit && <button className="button primary" onClick={() => location.navigate({ article: "new" })}>สร้างบทความ</button>}</div>
      <form className="content-actions" onSubmit={event => { event.preventDefault(); location.navigate({ q: search || null, offset: null }); }}><label className="content-input">ค้นหาบทความ<input value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></label><button className="button secondary">ค้นหา</button></form>
      {!list ? <p role="status">กำลังโหลดบทความ…</p> : <><p>ทั้งหมด {list.total} บทความ</p>{list.items.length === 0 && <p>ยังไม่มีบทความในรายการนี้</p>}<div className="content-card-list">{list.items.map(item => <article className="content-card" key={item.id}><h3>{item.title.th || "ยังไม่มีชื่อ"}</h3><p className="content-state">{states[item.state]} · ฉบับ {item.version_no}</p><p>{item.excerpt.th}</p><p>แก้ไข {contentDate(item.updated_at)}</p><button className="button secondary" onClick={() => location.navigate({ article: item.id })}>เปิดบทความ</button></article>)}</div>
        <div className="content-actions"><button className="button secondary" disabled={offset === 0} onClick={() => location.navigate({ offset: String(Math.max(0, offset - 25)) })}>หน้าก่อน</button><button className="button secondary" disabled={offset + list.items.length >= list.total} onClick={() => location.navigate({ offset: String(offset + 25) })}>หน้าถัดไป</button></div></>}
    </section> : <section className="content-section"><div className="content-toolbar"><h2>{selected === "new" ? "บทความใหม่" : current?.version.title.th || "รายละเอียดบทความ"}</h2><button className="button secondary" disabled={pending} onClick={() => location.navigate({ article: null })}>กลับรายการบทความ</button></div>
      {current && <p className="content-state">{states[current.version.state]} · ฉบับ {current.version.version_no}{current.approved_version_id ? " · มีฉบับที่อนุมัติแล้ว" : ""}</p>}
      <nav className="content-tabs" aria-label="ส่วนบทความ">{Object.entries(tabs).map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} disabled={pending || (Boolean(draft) || translationDirty) && tab !== key || !current && key !== "content"} onClick={() => setTab(key as keyof typeof tabs)}>{label}</button>)}</nav>
      {tab === "content" && (draft ? <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={!canEdit || pending} className="content-form">
        <label className="content-input">ชื่อในที่อยู่เว็บ<input required value={draft.slug} maxLength={120} pattern="[a-z0-9][a-z0-9\-]{0,119}" onChange={event => change({ slug: event.target.value })} /><span className="field-help">ใช้ตัวอักษรอังกฤษเล็ก ตัวเลข และขีดกลาง</span></label>
        <label className="content-input">หมวดบทความ<select value={draft.category} onChange={event => change({ category: event.target.value })}>{references?.categories.map(row => <option key={row.code} value={row.code}>{row.label.th || row.code}</option>)}</select></label>
        {Object.entries(textFields).map(([key, field]) => <BilingualInput key={key} id={`article-${key}`} label={field.label} field={catalog?.items.find(item => item.field_key === `article.${key}`)} value={draft[key as keyof TextFields]} maxLength={field.max} rows={key === "excerpt" ? 3 : 2} onChange={value => change({ [key]: value })} />)}
        <ArticleEditor value={draft.blocks} onChange={blocks => change({ blocks })} disabled={!canEdit || pending} references={references} canReadProjects={canProjects} />
        <label className="content-input">ภาพปก<select value={draft.cover_asset_id ?? ""} onChange={event => change({ cover_asset_id: event.target.value || null })}><option value="">ยังไม่เลือกภาพปก</option>{draft.cover_asset_id && !references?.images.some(row => row.id === draft.cover_asset_id) && <option value={draft.cover_asset_id}>ภาพที่เลือกไว้ · ตรวจสิทธิ์อีกครั้งก่อนส่งตรวจ</option>}{references?.images.map(row => <option key={row.id} value={row.id}>{row.alt_text.th || row.caption.th || row.original_filename}</option>)}</select></label>
        <BilingualInput id="article-author" label="ผู้เขียน" value={draft.author} maxLength={200} rows={1} onChange={author => change({ author })} />
        <section aria-label="ป้ายกำกับบทความ"><h3>ป้ายกำกับ</h3>{draft.tags.map((tag, index) => <div className="article-tag" key={index}><BilingualInput id={`article-tag-${index}`} label={`ป้ายกำกับ ${index + 1}`} value={tag} maxLength={100} rows={1} onChange={value => change({ tags: draft.tags.map((item, at) => at === index ? value : item) })} /><button type="button" className="button secondary" onClick={() => change({ tags: draft.tags.filter((_, at) => at !== index) })}>ลบป้ายกำกับ {index + 1}</button></div>)}<button type="button" className="button secondary" disabled={draft.tags.length >= 20} onClick={() => change({ tags: [...draft.tags, {}] })}>เพิ่มป้ายกำกับ</button></section>
        <ExposureInput value={draft.ai_exposure} onChange={ai_exposure => change({ ai_exposure })} />
        <section className="article-links" aria-label="เนื้อหาที่เกี่ยวข้อง"><h3>เชื่อมโยงเนื้อหา</h3><ul>{draft.links.map(link => <li key={`${link.kind}:${link.ref}`}><span>{linkLabel(link)}</span><button type="button" className="button secondary" onClick={() => change({ links: draft.links.filter(item => item !== link) })}>เอาลิงก์ออก</button></li>)}</ul>
          <label className="content-input">ชนิดลิงก์<select value={linkKind} onChange={event => { setLinkKind(event.target.value as Link["kind"]); setLinkRef(""); }}><option value="project">โครงการ</option><option value="brand">แบรนด์</option><option value="programme">โครงการบริการ</option></select></label>
          <label className="content-input">รายการที่เชื่อมโยง<select value={linkRef} onChange={event => setLinkRef(event.target.value)}><option value="">เลือกรายการ</option>{options(linkKind).map(row => <option key={row.ref} value={row.ref}>{row.label.th || row.ref}</option>)}</select></label>
          <button type="button" className="button secondary" disabled={!linkRef || draft.links.length >= 100 || draft.links.some(link => link.kind === linkKind && link.ref === linkRef)} onClick={() => change({ links: [...draft.links, { kind: linkKind, ref: linkRef }] })}>เพิ่มลิงก์ที่เลือก</button>
        </section>
      </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => { if (!dirty || window.confirm("ละทิ้งการแก้ไขที่ยังไม่บันทึกหรือไม่")) { setDraft(null); setDirty(false); if (!current) location.navigate({ article: null }, true); } }}>ยกเลิกการแก้ไข</button><button className="button primary" disabled={!canEdit || pending || !draft.slug || !draft.title.th?.trim()}>{pending ? "กำลังบันทึก…" : "บันทึกบทความ"}</button></div></form> : current ? <>
        <h3>{current.version.title.th}</h3><p className="content-preserve">{current.version.excerpt.th}</p><p className="content-preserve">{plainText(current.version.blocks.th)}</p>
        <div className="content-readiness"><strong>{current.readiness.length ? "ยังมีรายการที่ต้องตรวจ" : current.version.state === "DRAFT" ? "พร้อมส่งตรวจเนื้อหา" : states[current.version.state]}</strong>{current.readiness.length > 0 && <ul>{current.readiness.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.label}</li>)}</ul>}</div>
        {ownEdit && canApprove && <p className="inline-warning">คุณเคยแก้ไขฉบับนี้ ให้ผู้อนุมัติคนอื่นตรวจ</p>}
        <div className="content-actions">{canEdit && <><button className="button secondary" disabled={pending} onClick={edit}>แก้ไขบทความ</button>{current.version.state === "DRAFT" && <button className="button primary" disabled={pending || current.readiness.length > 0} onClick={() => void review("submit")}>ส่งตรวจบทความ</button>}</>}
          {canApprove && current.version.state === "IN_REVIEW" && <><button className="button primary" disabled={pending || ownEdit} onClick={() => void review("approve")}>อนุมัติเนื้อหา</button><button className="button secondary" disabled={pending || ownEdit} onClick={() => void review("return")}>ส่งกลับแก้ไข</button></>}
          {canApprove && current.approved_version_id && <button className="button secondary" disabled={pending || ownApproved} onClick={() => void review("withdraw")}>ถอนการอนุมัติ</button>}
        </div>
      </> : !error && <p role="status">กำลังโหลดบทความ…</p>)}
      {tab === "english" && current && <TranslationReviewPanel items={current.translations} fields={catalog?.items ?? []} canEdit={canEdit && !pending} onChanged={reloadCurrent} onEditingChange={setTranslationDirty} />}
      {tab === "preview" && current && <section aria-label="ตัวอย่างบทความภายใน"><label className="content-input">ภาษาตัวอย่าง<select value={locale} onChange={event => setLocale(event.target.value as "th" | "en")}><option value="th">ไทย</option><option value="en">อังกฤษ</option></select></label><p className="field-help">ตัวอย่างสำหรับตรวจเนื้อหาใน Hub อ้างอิงข้อมูลปัจจุบันที่คุณมีสิทธิ์อ่าน</p>{preview ? <div className="article-preview" dangerouslySetInnerHTML={{ __html: preview.html }} /> : <p role="status">กำลังเตรียมตัวอย่าง…</p>}</section>}
      {tab === "history" && current && <section aria-label="ประวัติบทความ"><h3>ประวัติฉบับที่บันทึก</h3><p className="field-help">แสดง 30 ฉบับล่าสุด</p>{current.history.map(version => <details className="content-card" key={version.id}><summary>ฉบับ {version.version_no} · {states[version.state]} · {contentDate(version.created_at)}</summary><h4>{version.title.th}</h4><p>{version.excerpt.th}</p><p className="content-preserve">{plainText(version.blocks.th)}</p><h4 lang="en">{version.title.en}</h4><p lang="en" className="content-preserve">{plainText(version.blocks.en)}</p><p>ผู้เขียน: {version.metadata.author.th || "ยังไม่ระบุ"}</p><p>ลิงก์ที่บันทึก: {version.links?.map(linkLabel).join(" · ") || "ไม่มี"}</p></details>)}</section>}
    </section>}
  </div>;
}
