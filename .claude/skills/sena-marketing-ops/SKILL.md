---
name: sena-marketing-ops
description: >
  SENA marketing-operations domain for the Hub ads module: the media line
  (scope × calendar month × agency = one INVOICE Ads ledger row), memo register
  (BUD MO<YYMM><NNN>, corporate M.COM<NNN>_<BE yy>), ledger import, agency-fee
  QT/PO, media bills, payment package, line actuals from the DW, controls
  C1–C9, correction crosswalk, business flows BF-0…BF-12 and the Hub↔DW repo
  boundary. Use when designing or building ads.* tables other than the name
  generator, ledger/memo imports, line actuals, exception queues, or
  anything that touches spend, budgets, memos or POs.
---

# sena-marketing-ops (pointer)

The canonical skill lives in `.agents/skills/sena-marketing-ops/` (shared with Codex).
Read and follow `.agents/skills/sena-marketing-ops/SKILL.md` now. Resolve every relative path it
mentions (scripts, data, references) against `.agents/skills/sena-marketing-ops/`, not this folder.
