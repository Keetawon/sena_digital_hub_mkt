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

# sena-ememo-archive (pointer)

The canonical skill lives in `.agents/skills/sena-ememo-archive/` (shared with Codex).
Read and follow `.agents/skills/sena-ememo-archive/SKILL.md` now. Resolve every relative path it
mentions (scripts, data, references) against `.agents/skills/sena-ememo-archive/`, not this folder.
