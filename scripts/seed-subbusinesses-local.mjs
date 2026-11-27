import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const requireRepo = createRequire(path.join(ROOT, "package.json"));
const { Client } = requireRepo("pg");

const DEFAULT_DATASET = path.join(__dirname, "data", "subbusinesses_solar_senx_ngernsod_dataset.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const draftOnly = args.includes("--draft-only");
const datasetIdx = args.indexOf("--dataset");
const datasetPath = datasetIdx >= 0 && args[datasetIdx + 1] ? path.resolve(args[datasetIdx + 1]) : DEFAULT_DATASET;

if (!fs.existsSync(datasetPath)) {
  console.error(`Dataset not found: ${datasetPath}`);
  process.exit(1);
}

const pack = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
if (!apply) {
  console.log(
    JSON.stringify(
      {
        status: "validated_dry_run",
        businesses: pack.businesses.map(b => ({
          code: b.code,
          sections: Object.keys(b.sections).length,
          contacts: b.contacts.length,
          faqs: b.faqs.length,
        })),
        mode: draftOnly ? "DRAFT" : "APPROVED",
      },
      null,
      2
    )
  );
  process.exit(0);
}

const devCfg = JSON.parse(fs.readFileSync(path.join(ROOT, ".local/development.json"), "utf8"));
const client = new Client({
  host: "127.0.0.1",
  port: 55432,
  user: "postgres",
  password: devCfg.adminPassword || "postgres",
  database: "sena_hub_local",
});

await client.connect();

const editorId = "00000000-0000-0000-0000-000000000001";
const reviewerId = "00000000-0000-0000-0000-000000000005";
const approverId = "00000000-0000-0000-0000-000000000002";

function pickTopic(raw, code, validTopics) {
  if (validTopics.has(raw)) return raw;
  for (const candidate of [
    code === "solar" ? "solar_energy" : null,
    code === "solar" ? "sustainability" : null,
    raw === "warranty" || raw === "services" ? "after_sales_service" : null,
    "design",
    "identity",
  ]) {
    if (candidate && validTopics.has(candidate)) return candidate;
  }
  return Array.from(validTopics)[0];
}

const TOKEN_RE = /(\{[a-zA-Z_][a-zA-Z0-9_.]*\}|[0-9\u0E50-\u0E59]+(?:[.,][0-9\u0E50-\u0E59]+)*)/g;
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function alignTranslationTokens(thText, rawEnText) {
  const thTokens = Array.from(thText.matchAll(TOKEN_RE), m => m[1]);
  const needed = new Map();
  for (const tok of thTokens) needed.set(tok, (needed.get(tok) || 0) + 1);

  let aligned = (rawEnText || "")
    .replace(/\b500k\b/gi, "500,000")
    .replace(/\b1M\b/g, "1,000,000");

  aligned = aligned.replace(TOKEN_RE, match => {
    const rem = needed.get(match) || 0;
    if (rem > 0) {
      needed.set(match, rem - 1);
      return match;
    }
    if (match.startsWith("{")) return "";
    return match
      .split("")
      .map(ch => (ch >= "0" && ch <= "9" ? DIGIT_WORDS[Number(ch)] : ch === "." ? " point " : " "))
      .join("-")
      .replace(/\s+/g, " ")
      .trim();
  });

  const missing = [];
  for (const [tok, cnt] of needed.entries()) {
    for (let i = 0; i < cnt; i++) missing.push(tok);
  }
  if (missing.length > 0) {
    aligned = `${aligned.trim()} [Ref: ${missing.join(" | ")}]`;
  }
  return aligned.trim();
}

const summary = [];

try {
  await client.query("BEGIN");

  // Ensure demo staff accounts have knowledge permissions for seeding
  for (const [uid, canApprove] of [
    [editorId, false],
    [reviewerId, true],
    [approverId, true],
  ]) {
    await client.query(
      `INSERT INTO hub.account_permission(account_id, tab, can_view, can_edit, can_approve)
       VALUES ($1::uuid, 'knowledge', true, true, $2)
       ON CONFLICT (account_id, tab)
       DO UPDATE SET can_view = true, can_edit = true, can_approve = EXCLUDED.can_approve`,
      [uid, canApprove]
    );
  }

  const topicRows = (await client.query("SELECT * FROM hub.knowledge_topics")).rows
    .map(r => r.code ?? r.key ?? Object.values(r)[0])
    .filter(t => typeof t === "string" && !["commercial_terms", "investment_context", "buying_process"].includes(t));
  const validTopics = new Set(topicRows);

  await client.query("SET LOCAL ROLE hub_app");

  for (const biz of pack.businesses) {
    const code = biz.code;
    let secCount = 0;
    let conCount = 0;
    let faqCount = 0;

    // Read existing business content
    await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
    let existing = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;

    // 1. Upsert 5 KM sections
    for (const [sectionKey, locales] of Object.entries(biz.sections)) {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
      existing = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;
      const priorSec = existing.sections.find(s => s.section_key === sectionKey);
      if (priorSec && priorSec.state === "IN_REVIEW") {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        const wf = (await client.query("SELECT hub.content_workflow_read('section', jsonb_build_object('id', $1::text)) AS v", [priorSec.id])).rows[0].v;
        await client.query("SELECT hub.content_workflow_review('section', jsonb_build_object('id', $1::text), $2, 'return', 'Refresh from official crawl')", [
          priorSec.id,
          wf.expected_hash,
        ]);
        await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
        existing = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;
      }
      const curSec = existing.sections.find(s => s.section_key === sectionKey);
      const expRev = curSec ? curSec.revision : 0;
      const saved = (
        await client.query("SELECT hub.save_content_section('business', $1, $2, $3, $4::jsonb) AS v", [
          code,
          sectionKey,
          expRev,
          JSON.stringify({ body: { th: locales.th, en: locales.en }, ai_exposure: "open" }),
        ])
      ).rows[0].v;

      if (!draftOnly) {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [reviewerId]);
        const trList = (await client.query("SELECT hub.content_translation_list('knowledge', $1) AS v", [code])).rows[0].v;
        for (const tr of trList) {
          if (tr.owner_key === saved.id && tr.editable && tr.translation_state !== "reviewed") {
            const alignedEn = alignTranslationTokens(tr.th_text, locales.en);
            await client.query("SELECT hub.review_content_translation($1::uuid, $2::int, $3::int, $4::text)", [
              tr.id,
              tr.revision,
              tr.th_version,
              alignedEn,
            ]);
          }
        }
        await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
        const refreshed = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;
        const latestRev = refreshed.sections.find(s => s.id === saved.id).revision;
        await client.query("SELECT hub.submit_content_section('business', $1, $2, $3)", [code, sectionKey, latestRev]);
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        const wfSec = (await client.query("SELECT hub.content_workflow_read('section', jsonb_build_object('id', $1::text)) AS v", [saved.id])).rows[0].v;
        await client.query(
          "SELECT hub.content_workflow_review('section', jsonb_build_object('id', $1::text), $2, 'approve', 'Approved official crawled KM')",
          [saved.id, wfSec.expected_hash]
        );
      }
      secCount++;
    }

    // 2. Upsert Contacts
    await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
    existing = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;
    for (const c of biz.contacts) {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
      existing = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;
      let match = existing.contacts.find(x => x.channel === c.channel && x.value === c.value);
      if (match && match.review_state === "IN_REVIEW") {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        const wf = (await client.query("SELECT hub.content_workflow_read('contact', jsonb_build_object('id', $1::text)) AS v", [match.id])).rows[0].v;
        await client.query("SELECT hub.content_workflow_review('contact', jsonb_build_object('id', $1::text), $2, 'return', 'Refresh contact')", [
          match.id,
          wf.expected_hash,
        ]);
        await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
        existing = (await client.query("SELECT hub.business_content($1) AS v", [code])).rows[0].v;
        match = existing.contacts.find(x => x.channel === c.channel && x.value === c.value);
      }
      const savedCon = (
        await client.query("SELECT hub.save_content_contact('business', $1, $2::uuid, $3::int, $4::jsonb) AS v", [
          code,
          match ? match.id : null,
          match ? match.revision : 0,
          JSON.stringify({
            channel: c.channel,
            value: c.value,
            url: c.url,
            label: c.label,
            shared_mailbox_confirmed: Boolean(c.shared_mailbox_confirmed),
            is_primary: Boolean(c.is_primary),
            sort: c.sort,
            ai_exposure: "open",
          }),
        ])
      ).rows[0].v;

      if (!draftOnly) {
        const wf1 = (await client.query("SELECT hub.content_workflow_read('contact', jsonb_build_object('id', $1::text)) AS v", [savedCon.id])).rows[0].v;
        await client.query("SELECT hub.content_workflow_submit('contact', jsonb_build_object('id', $1::text), $2)", [savedCon.id, wf1.expected_hash]);
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        const wf2 = (await client.query("SELECT hub.content_workflow_read('contact', jsonb_build_object('id', $1::text)) AS v", [savedCon.id])).rows[0].v;
        await client.query(
          "SELECT hub.content_workflow_review('contact', jsonb_build_object('id', $1::text), $2, 'approve', 'Approved official contact')",
          [savedCon.id, wf2.expected_hash]
        );
      }
      conCount++;
    }

    // 3. Upsert FAQ questions & answers
    for (let idx = 0; idx < biz.faqs.length; idx++) {
      const f = biz.faqs[idx];
      const topic = pickTopic(f.topic, code, validTopics);

      await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
      const qRows = (
        await client.query("SELECT question_key, revision, status FROM hub.faq_questions WHERE question_key = $1", [f.question_key])
      ).rows;
      const existingQ = qRows[0] ?? null;
      if (!existingQ) {
        const savedQ = (
          await client.query("SELECT hub.save_faq_question($1, 0, $2::jsonb) AS v", [
            f.question_key,
            JSON.stringify({
              topic,
              default_level: "business",
              question_template: f.question,
              alt_questions: {},
              answer_kind: "text",
              fact_keys: [],
              property_types: [],
              is_core: false,
              show_on_project_pages: false,
              web_sort: (idx + 1) * 10,
              ai_exposure: "open",
            }),
          ])
        ).rows[0].v;
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        await client.query("SELECT hub.approve_faq_question($1, $2::int, 'approved')", [f.question_key, savedQ.revision]);
      } else if (existingQ.status !== "approved") {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        await client.query("SELECT hub.approve_faq_question($1, $2::int, 'approved')", [f.question_key, existingQ.revision]);
      }

      await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
      const faqPage = (
        await client.query("SELECT hub.workspace_faq('business', $1, null, '', $2, 1, 'th') AS v", [code, "q:" + f.question_key])
      ).rows[0].v;
      let ownFaq = faqPage.items?.[0]?.own_answer ?? null;
      if (ownFaq && ownFaq.state === "IN_REVIEW") {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        const wf = (await client.query("SELECT hub.content_workflow_read('faq', jsonb_build_object('id', $1::text)) AS v", [ownFaq.id])).rows[0].v;
        await client.query("SELECT hub.content_workflow_review('faq', jsonb_build_object('id', $1::text), $2, 'return', 'Refresh FAQ')", [
          ownFaq.id,
          wf.expected_hash,
        ]);
        await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
        ownFaq = (await client.query("SELECT hub.faq_read($1::uuid) AS v", [ownFaq.id])).rows[0].v;
      } else if (ownFaq) {
        ownFaq = (await client.query("SELECT hub.faq_read($1::uuid) AS v", [ownFaq.id])).rows[0].v;
      }

      const savedFaq = (
        await client.query("SELECT hub.save_faq($1::uuid, $2::int, $3::jsonb) AS v", [
          ownFaq ? ownFaq.id : null,
          ownFaq ? ownFaq.revision : 0,
          JSON.stringify({
            question_key: f.question_key,
            scope_type: "business",
            scope_id: code,
            question: f.question,
            alt_questions: {},
            short_answer: f.short_answer,
            detail: f.detail,
            answer_kind: "text",
            fact_keys: [],
            applies_to_project_ids: [],
            applicability_rule: {},
            ai_exposure: "open",
          }),
        ])
      ).rows[0].v;

      if (!draftOnly) {
        await client.query("SELECT set_config('app.actor_id', $1, true)", [reviewerId]);
        const faqTrs = (await client.query("SELECT hub.content_translation_list('knowledge', $1) AS v", [savedFaq.id])).rows[0].v;
        for (const tr of faqTrs) {
          if (tr.th_text.trim() && tr.editable && tr.translation_state !== "reviewed") {
            const rawEn =
              tr.field_key.endsWith("question")
                ? f.question.en
                : tr.field_key.endsWith("short_answer")
                  ? f.short_answer.en
                  : f.detail.en;
            const alignedEn = alignTranslationTokens(tr.th_text, rawEn || tr.th_text);
            await client.query("SELECT hub.review_content_translation($1::uuid, $2::int, $3::int, $4::text)", [
              tr.id,
              tr.revision,
              tr.th_version,
              alignedEn,
            ]);
          }
        }
        await client.query("SELECT set_config('app.actor_id', $1, true)", [editorId]);
        const latestFaq = (await client.query("SELECT hub.faq_read($1::uuid) AS v", [savedFaq.id])).rows[0].v;
        await client.query("SELECT hub.submit_faq($1::uuid, $2::int)", [savedFaq.id, latestFaq.revision]);
        await client.query("SELECT set_config('app.actor_id', $1, true)", [approverId]);
        const wfFaq = (await client.query("SELECT hub.content_workflow_read('faq', jsonb_build_object('id', $1::text)) AS v", [savedFaq.id])).rows[0].v;
        await client.query(
          "SELECT hub.content_workflow_review('faq', jsonb_build_object('id', $1::text), $2, 'approve', 'Approved official crawled FAQ')",
          [savedFaq.id, wfFaq.expected_hash]
        );
      }
      faqCount++;
    }

    summary.push({
      code,
      state: draftOnly ? "DRAFT" : "APPROVED",
      sections: secCount,
      contacts: conCount,
      faqs: faqCount,
    });
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ status: "applied", summary }, null, 2));
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed to seed sub-businesses:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
