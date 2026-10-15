import "server-only";
import { db } from "../supabase";
import { generateJSON } from "../gemini";
import type { Startup, Thesis } from "../types";
import type { RunContext } from "./context";
import { mapLimit, recordFailure } from "./context";
import { startupPrompt } from "./score";
import { findLikelyDuplicate } from "./dedupe";
import { sameCompanyReason } from "../normalize";

// STAGE 5 — DRAFT
// Write one personalised email per fit startup. drafts.startup_id is UNIQUE,
// so even if two runs overlapped, the database refuses a second draft.

const SCHEMA = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING" },
    body: { type: "STRING" },
    personalization_points: { type: "ARRAY", items: { type: "STRING" }, description: "Which specific facts the email references" },
  },
  required: ["subject", "body", "personalization_points"],
};

function system(t: Thesis): string {
  return `You write outreach emails for ${t.sender_name}, ${t.sender_title} at ${t.accelerator_name}.
Program: ${t.accelerator_pitch}
Tone: ${t.email_tone}. Call to action: ${t.call_to_action}.
Rules:
- 110-160 words, plain text, no markdown. Subject under 9 words, specific to the company.
- Format: greeting line, then 3 short paragraphs (1-3 sentences each), then a sign-off. Separate every paragraph with a blank line and put the signature on its own lines.
- Open with a congratulation that names the round and something concrete (an investor, the product, a customer or milestone).
- One or two sentences on why the program is relevant to THEIR situation right after raising — tie to the fit reasons.
- Address the founder by first name if known, otherwise "Hi <Company> team".
- Only use facts provided. Never invent metrics, customers or mutual connections. No placeholders like [Name].
- Sign off as ${t.sender_name}, ${t.sender_title}, ${t.accelerator_name}.`;
}

/** Safety net: if the model returns one long block, split it into readable paragraphs. */
function formatBody(body: string): string {
  const b = body.replace(/\r/g, "").trim();
  if (b.includes("\n\n")) return b;
  const sentences = b.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) paras.push(sentences.slice(i, i + 2).join(" "));
  return paras.join("\n\n");
}

export async function draft(ctx: RunContext): Promise<void> {
  const { data, error } = await db().from("startups").select("*").eq("status", "fit").order("fit_score", { ascending: false }).limit(30);
  if (error) throw new Error(`Could not load startups: ${error.message}`);
  if (!data?.length) return;

  // Final duplicate guard before anything is written (catches cases the
  // extract-time check could not see, e.g. founders only found by research).
  // Sequential and highest-score-first, so of two duplicates the best one is kept.
  const toDraft: Startup[] = [];
  for (const s of data as Startup[]) {
    const inBatch = toDraft.find((k) => sameCompanyReason(s, k));
    const existing = inBatch ? null : await findLikelyDuplicate(s, s.id);
    const dup = inBatch
      ? { name: inBatch.name, reason: sameCompanyReason(s, inBatch)! }
      : existing && ["drafted", "rejected", "fit"].includes(existing.status)
        ? existing
        : null;
    if (dup) {
      await db()
        .from("startups")
        .update({ status: "rejected", rejection_reason: `Duplicate of ${dup.name} (${dup.reason})`, updated_at: new Date().toISOString() })
        .eq("id", s.id);
      ctx.bump("duplicates_skipped");
      await ctx.log("dedupe", `${s.name} looks like ${dup.name} (${dup.reason}) — not drafted`);
      continue;
    }
    toDraft.push(s);
  }

  await mapLimit(toDraft, 6, async (s) => {
    if (ctx.timeLeft() < 15_000) return;
    try {
      // Defensive: never draft twice even if status got out of sync.
      const { data: existing } = await db().from("drafts").select("id").eq("startup_id", s.id).maybeSingle();
      if (existing) {
        await db().from("startups").update({ status: "drafted" }).eq("id", s.id);
        return;
      }
      const hooks = s.fit_reasons?.personalization_hooks ?? [];
      const reasons = s.fit_reasons?.reasons ?? [];
      const out = await generateJSON<{ subject: string; body: string; personalization_points: string[] }>({
        system: system(ctx.thesis),
        prompt: `${startupPrompt(s)}\n\nWhy they fit: ${reasons.join("; ")}\nPersonalisation hooks: ${hooks.join("; ")}`,
        schema: SCHEMA,
        temperature: 0.6,
      });
      ctx.bump("gemini_calls");
      const { error: insErr } = await db().from("drafts").insert({
        startup_id: s.id,
        subject: out.subject.trim(),
        body: formatBody(out.body),
        personalization: { points: out.personalization_points },
        thesis_version: ctx.thesis.version,
      });
      if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
      await db().from("startups").update({ status: "drafted", updated_at: new Date().toISOString() }).eq("id", s.id);
      ctx.bump("drafts_created");
      await ctx.log("draft", `Draft ready for ${s.name}: "${out.subject}"`);
    } catch (e) {
      await recordFailure(ctx, "draft", s.id, s.attempts, e);
    }
  });
}
