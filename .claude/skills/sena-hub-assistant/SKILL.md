---
name: sena-hub-assistant
description: >
  Internal Thai AI assistant inside the SENA Hub: OpenAI Agents SDK running in
  the FastAPI app (apps/api/sena_hub_api), streaming to an admin side panel,
  with read-only tools (search_documents, get_campaign, find_campaigns,
  get_line_actuals, explain_name), numbers only from tools, citations, the
  caller's own RLS permissions, and a Thai golden-question test set. Use when
  building, testing or reviewing the assistant, its tools, prompts,
  streaming endpoint, side panel or evals. Not the public customer chatbot
  (separate repo sena_ai_chatbot_mkt).
---

# sena-hub-assistant (pointer)

The canonical skill lives in `.agents/skills/sena-hub-assistant/` (shared with Codex).
Read and follow `.agents/skills/sena-hub-assistant/SKILL.md` now. Resolve every relative path it
mentions (scripts, data, references) against `.agents/skills/sena-hub-assistant/`, not this folder.
