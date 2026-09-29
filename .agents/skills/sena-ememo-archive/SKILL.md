---
name: sena-ememo-archive
description: >
  E-memo PDF archive and search for SENA marketing budget memos: private
  Cloudflare R2 storage with content-hash keys and kept versions, text
  extraction plus Thai OCR, LLM field extraction into DRAFT memo rows that the
  Online team confirms, and embedding into a RESTRICTED RAG namespace (never
  the public chatbot index). Covers PDPA, access, retention and the place in
  BF-2. Use when designing or building memo upload, ingest jobs, OCR,
  extraction, ads.memo_document tables, memo search UI or restricted RAG.
---

# E-memo archive and search

Design doc: `docs/21-ememo-archive-and-search.md` (write it before coding if missing). Business flow:
BF-2 in `docs/20-marketing-operations-flows.md`. RAG rules: `docs/06-rag.md`.

## Source preference

1. E-memo API/webhook, 2. read-only view/export, 3. **PDF upload** (this pipeline, the current fallback).
When IT provides 1 or 2, it becomes the source of structured fields; PDFs remain as evidence.
The Hub mirrors approvals and never approves a memo itself. Open question: E-memo access (ask IT).

## Storage (R2)

- Private bucket; no public URLs. Downloads via short-lived presigned GET issued by the API after a permission check.
- Object key = `memo/sha256/<hex>.pdf` (content hash). Identical re-uploads dedupe; a new version is a
  new object linked to the same memo with `version_no`. Never delete old versions (retention policy decides).
- Record in DB: sha256, size, mime, original filename, uploaded_by, uploaded_at, R2 key, page count.
- Validate on upload: PDF magic bytes, size cap, page cap, no encrypted/JS-bearing PDFs (reuse the
  upload hardening in `apps/api/sena_hub_api/assets.py`).
- R2/Supabase region: a region outside Thailand is a cross-border transfer under PDPA, so record the
  decision (open question) before real memos are uploaded.

## Ingest pipeline (job on the Hostinger worker, idempotent per sha256)

1. Text layer via `pypdf` (already a dependency).
2. Pages with no/garbled text → Thai OCR (candidate: Tesseract `tha+eng`; compare with a cloud OCR
   on 10 real memos before choosing). Store per-page text + method + confidence.
3. Field extraction (OpenAI structured output) → **DRAFT** `ads.memo` fields: memo no.
   (`MO<YYMM><NNN>` / `M.COM<NNN>_<BE yy>`), subject, BUD, amounts (gross/media/fee/VAT), period,
   approvers and dates, each with source page and confidence. Validate formats with regex; never
   auto-promote.
4. Online staff confirm or correct each field in the UI → status CONFIRMED (who/when kept).
5. Chunk (per section/page, Thai word-segmented lexical + vector) → `rag` rows with
   `namespace='internal_memo'`, `document_id`, version, page. Versioned replace in one transaction; a
   daily reconcile removes orphans.

## Access and PDPA

- Memos can hold names, signatures and internal budgets: restricted to marketing-ops roles; agencies
  get no memo access unless a line-level rule explicitly grants it.
- Restricted namespace is filtered by the caller's permissions at query time and is never exported to
  `public_api` or the customer chatbot. Add a DB-level check so `internal_*` namespaces cannot be
  flagged public.
- Retention: propose it in doc 21 (e.g., as long as finance records), with a legal-hold flag; log every
  view/download to `audit`.

## Search UX

Thai query box → hybrid results grouped by memo, showing memo no., BUD, amount (only if the role may
see it), period and a highlighted page snippet → open the PDF at that page. Filters: memo series, BUD,
month, status (draft/confirmed). Facets come from confirmed fields only.
