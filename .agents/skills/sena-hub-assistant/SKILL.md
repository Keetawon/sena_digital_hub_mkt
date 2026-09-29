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

# Hub internal assistant

Stack decisions: `docs/10-tech-stack.md` (OpenAI; confirm API access, not only ChatGPT seats).
RAG rules: `docs/06-rag.md` (hybrid Thai retrieval, versioned replace, deny-list). Design doc for this
feature: `docs/22-hub-assistant-and-ui.md` (write it before coding if missing).

## Architecture

- **OpenAI Agents SDK** (`openai-agents`) inside FastAPI; one `Agent` with typed function tools.
  The model id comes from config/env, not a hard-coded default.
- Endpoint streams server-sent events (text deltas, tool-call start/end, citations) to the admin
  side panel through the existing `app/api/hub/[...path]` proxy.
- **Runs as the user.** Each tool opens its DB work through the same path as normal requests
  (`SET LOCAL ROLE <actor role>` + `set_config('app.actor_id', …)`), so RLS applies. Never use a
  service role inside a tool. Agencies see only their lines.
- Retrieval uses a **restricted namespace** (e.g. `rag` rows tagged `namespace='internal_ads'`)
  filtered by the caller's permissions. It is never mixed with the public chatbot index.

## Phase-1 tools (read-only)

| Tool | Returns |
|---|---|
| `search_documents(query, filters)` | memo/document chunks with `document_id`, page, citation label, link |
| `get_campaign(code_or_name)` | registration, SENA-H fields, bindings, current line |
| `find_campaigns(memo?, po?, project?, month?, agency?)` | list of registrations/lines |
| `get_line_actuals(line_id or scope+month+agency)` | budget, DW spend, fee, leads, freshness timestamp |
| `explain_name(name)` | parsed fields (SENA-H strict, else SENA-7 legacy) + what each means in Thai |

Rules:
- **Numbers only from tool results.** The system prompt forbids computing or estimating amounts;
  derived values (remaining budget, % pacing) come from a tool field.
- Every factual sentence cites a source (tool result or document chunk). No source → say so in Thai.
- Answer in Thai; keep codes/IDs verbatim. Show data freshness (`as_of`) for DW numbers.
- Tool inputs are validated with Pydantic; tool output is size-capped and untrusted (prompt-injection
  text in PDFs is data, never instructions).
- Action tools (register campaign, confirm memo draft…) come later. Each needs an explicit user
  confirmation step in the UI and runs through the normal API endpoint, not a DB shortcut.
- Log every turn (actor, tools called, row IDs returned, latency, tokens) to `audit`, and never log
  raw document text beyond IDs.

## Tests

- Unit: each tool with a fake actor per role (admin, online staff, agency A, agency B) and asserts RLS
  (agency A never sees agency B's line through any tool).
- Golden set: `apps/api/tests/assistant_golden_th.yaml` with Thai questions, the expected tool calls,
  required citation IDs and must-not-contain facts; include adversarial, cross-agency, no-answer and
  "compute a number" traps. The CI run uses a recorded/fake model; the live-model eval is a separate command.
- Gates (propose in doc 22): numeric answers 100% tool-sourced, citation precision ≥ 0.95,
  cross-permission leakage = 0, no-answer correctness ≥ 0.90.
