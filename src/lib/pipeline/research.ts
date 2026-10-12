import "server-only";
import { db } from "../supabase";
import { extractJsonObject, generateGrounded, generateJSON } from "../gemini";
import { domainOf } from "../normalize";
import type { Research, Startup } from "../types";
import type { RunContext } from "./context";
import { mapLimit, recordFailure } from "./context";

// STAGE 3 — RESEARCH
// For each new startup, Gemini runs a live Google Search (grounding) to build
// a short research brief: product, customers, traction, founders, website.
// If grounding is unavailable (quota / error) we fall back to an ungrounded
// summary of the announcement itself and mark the brief grounded=false, so
// the run still produces a draft instead of stalling.

export const MAX_PER_RUN = 12;

const SYSTEM = `You are a startup analyst at an accelerator. Research the company using Google Search and report only facts you can find.
Respond with ONLY a JSON object (no prose) with keys:
summary (2-3 sentences), product, customers, traction, founders (array of {name, role, background}), website, headquarters.
Use null for anything you cannot verify. Never invent founders, customers or numbers.`;

const FALLBACK_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    product: { type: "STRING", nullable: true },
    customers: { type: "STRING", nullable: true },
    traction: { type: "STRING", nullable: true },
  },
  required: ["summary"],
};

function describe(s: Startup, headlines: string[]): string {
  return `Company: ${s.name}
Round: ${s.round_type} ${s.amount_text ?? ""} ${s.investors.length ? `led/joined by ${s.investors.join(", ")}` : ""}
Sector: ${s.sector ?? "unknown"} · Location: ${s.location ?? "unknown"}
What we know: ${s.description ?? "n/a"}
Founders mentioned: ${s.founders.map((f) => f.name).join(", ") || "none"}
Website (if known): ${s.website ?? "unknown"}
Announcement headlines:
${headlines.map((h) => `- ${h}`).join("\n")}`;
}

async function researchOne(ctx: RunContext, s: Startup): Promise<void> {
  const { data: arts } = await db().from("articles").select("title,summary").eq("startup_id", s.id).limit(3);
  const headlines = (arts ?? []).map((a) => `${a.title}${a.summary ? ` — ${a.summary.slice(0, 200)}` : ""}`);
  const context = describe(s, headlines);

  let research: Research;
  try {
    const g = await generateGrounded({ system: SYSTEM, prompt: `Research this startup that just announced funding:\n\n${context}` });
    ctx.bump("gemini_calls");
    const parsed = extractJsonObject<Omit<Research, "grounded" | "sources">>(g.text);
    research = {
      summary: parsed?.summary ?? g.text.slice(0, 600),
      product: parsed?.product ?? null,
      customers: parsed?.customers ?? null,
      traction: parsed?.traction ?? null,
      founders: Array.isArray(parsed?.founders) ? parsed!.founders : [],
      website: parsed?.website ?? null,
      headquarters: parsed?.headquarters ?? null,
      grounded: true,
      sources: g.sources,
    };
  } catch (e) {
    await ctx.log("research", `Search grounding unavailable for ${s.name} (${(e as Error).message.slice(0, 120)}); using announcement only`, "warn");
    const f = await generateJSON<{ summary: string; product: string | null; customers: string | null; traction: string | null }>({
      system: "Summarise what this startup does using ONLY the information given. Do not add facts.",
      prompt: context,
      schema: FALLBACK_SCHEMA,
    });
    ctx.bump("gemini_calls");
    research = { ...f, founders: [], website: null, headquarters: null, grounded: false, sources: [] };
  }

  // Merge newly found facts without overwriting what the announcement told us.
  const update: Record<string, unknown> = { research, status: "researched", updated_at: new Date().toISOString() };
  const foundDomain = domainOf(research.website);
  if (!s.domain && foundDomain) {
    const { data: clash } = await db().from("startups").select("id,name").eq("domain", foundDomain).neq("id", s.id).limit(1);
    if (clash?.length) {
      // Same website as a company we already know → it's a duplicate under a different name.
      await db().from("startups").update({ status: "rejected", rejection_reason: `Duplicate of ${clash[0].name} (same domain)`, research }).eq("id", s.id);
      ctx.bump("duplicates_skipped");
      await ctx.log("dedupe", `${s.name} shares ${foundDomain} with ${clash[0].name} — treated as duplicate`);
      return;
    }
    update.domain = foundDomain;
    update.website = `https://${foundDomain}`;
  }
  if (!s.founders.length && research.founders?.length) update.founders = research.founders;
  if (!s.location && research.headquarters) update.location = research.headquarters;

  const { error } = await db().from("startups").update(update).eq("id", s.id);
  if (error) throw new Error(error.message);
  ctx.bump("researched");
}

export async function research(ctx: RunContext): Promise<void> {
  const { data, error } = await db().from("startups").select("*").eq("status", "new").order("discovered_at").limit(MAX_PER_RUN);
  if (error) throw new Error(`Could not load startups: ${error.message}`);
  if (!data?.length) return;
  await mapLimit(data as Startup[], 3, async (s) => {
    if (ctx.timeLeft() < 45_000) return;
    try {
      await researchOne(ctx, s);
    } catch (e) {
      await recordFailure(ctx, "research", s.id, s.attempts, e);
    }
  });
  await ctx.log("research", `Researched ${ctx.stats.researched ?? 0} startup(s)`);
}
