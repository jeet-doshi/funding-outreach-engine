import "server-only";
import { db } from "../supabase";
import { generateJSON } from "../gemini";
import { domainOf, formatUsd, normalizeCompanyName, normalizeStage } from "../normalize";
import type { RunContext } from "./context";
import { mapLimit } from "./context";

// STAGE 2 — EXTRACT + DEDUPE
// Gemini reads articles in batches and returns structured funding facts.
// Then deterministic rules decide what happens to each one:
//   not a startup funding announcement     → article.status = not_funding
//   stage outside thesis.target_stages     → article.status = out_of_scope
//   company already known / do-not-contact → article.status = duplicate (never re-contacted)
//   raise outside thesis min/max           → startup stored as rejected (so dedupe remembers it)
//   otherwise                              → new startup row, status = new

const BATCH = 10;
const MAX_ARTICLES_PER_RUN = 120;

type Extraction = {
  index: number;
  is_startup_funding_announcement: boolean;
  company_name: string | null;
  round_type: string | null;
  amount_text: string | null;
  amount_usd: number | null;
  investors: string[];
  sector: string | null;
  location: string | null;
  one_liner: string | null;
  website: string | null;
  founders: string[];
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          is_startup_funding_announcement: { type: "BOOLEAN" },
          company_name: { type: "STRING", nullable: true },
          round_type: { type: "STRING", nullable: true, description: "e.g. pre-seed, seed, angel, Series A, grant, debt, unknown" },
          amount_text: { type: "STRING", nullable: true, description: "As written, e.g. '€2M' or '₹15 crore'" },
          amount_usd: { type: "NUMBER", nullable: true, description: "Best USD estimate as a plain number, null if undisclosed" },
          investors: { type: "ARRAY", items: { type: "STRING" } },
          sector: { type: "STRING", nullable: true },
          location: { type: "STRING", nullable: true, description: "City/country of the startup" },
          one_liner: { type: "STRING", nullable: true, description: "What the startup does, one sentence" },
          website: { type: "STRING", nullable: true, description: "Only if explicitly present in the text" },
          founders: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["index", "is_startup_funding_announcement", "investors", "founders"],
      },
    },
  },
  required: ["results"],
};

const SYSTEM = `You extract structured facts from startup news headlines and snippets for an accelerator's deal-sourcing pipeline.
Rules:
- is_startup_funding_announcement = true ONLY if the item announces that ONE specific operating startup raised a specific round.
- false for: VC firms closing a fund, funding roundups/lists, acquisitions, IPOs, layoffs, opinion pieces, government programs, or rumours.
- Never invent facts. If a field is not stated, return null (or [] for lists). Do not guess websites.
- amount_usd: convert to USD using approximate rates (1 EUR≈1.08, 1 GBP≈1.27, 1 INR crore≈120000 USD, 1 INR lakh≈1200 USD).
- Return one result per input item, using its index.`;

type ArticleRow = { id: string; url: string; title: string; summary: string | null; source_name: string; published_at: string | null };

export async function extract(ctx: RunContext): Promise<void> {
  const { data: articles, error } = await db()
    .from("articles")
    .select("id,url,title,summary,source_name,published_at")
    .eq("status", "new")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_ARTICLES_PER_RUN);
  if (error) throw new Error(`Could not load articles: ${error.message}`);
  if (!articles?.length) {
    await ctx.log("extract", "No new articles to analyse");
    return;
  }

  const batches: ArticleRow[][] = [];
  for (let i = 0; i < articles.length; i += BATCH) batches.push(articles.slice(i, i + BATCH) as ArticleRow[]);

  await mapLimit(batches, 3, async (batch) => {
    if (ctx.timeLeft() < 60_000) return; // leave time for later stages; unprocessed articles stay 'new'
    const prompt = batch
      .map((a, i) => `[${i}] ${a.title}\nSource: ${a.source_name}\nSnippet: ${a.summary || "(none)"}`)
      .join("\n\n");
    let results: Extraction[];
    try {
      results = (await generateJSON<{ results: Extraction[] }>({ system: SYSTEM, prompt, schema: SCHEMA, temperature: 0 })).results;
      ctx.bump("gemini_calls");
    } catch (e) {
      ctx.bump("extract_errors");
      await ctx.log("extract", `Batch of ${batch.length} failed, will retry next run: ${(e as Error).message}`, "warn");
      return;
    }
    for (let i = 0; i < batch.length; i++) {
      const r = results.find((x) => x.index === i);
      if (!r) continue; // stays 'new' and is retried next run
      await handleExtraction(ctx, batch[i], r);
    }
  });
}

async function handleExtraction(ctx: RunContext, a: ArticleRow, r: Extraction) {
  const setArticle = (status: string, extra: Record<string, unknown> = {}) =>
    db().from("articles").update({ status, extraction: r, ...extra }).eq("id", a.id);

  if (!r.is_startup_funding_announcement || !r.company_name) {
    ctx.bump("not_funding");
    await setArticle("not_funding");
    return;
  }
  ctx.bump("funding_announcements");

  const stage = normalizeStage(r.round_type);
  if (!ctx.thesis.target_stages.includes(stage)) {
    ctx.bump("out_of_scope_stage");
    await setArticle("out_of_scope");
    return;
  }

  const normalized = normalizeCompanyName(r.company_name);
  const domain = domainOf(r.website);
  if (!normalized) {
    await setArticle("not_funding");
    return;
  }

  // Dedupe 1: Rohit's manual do-not-contact list
  // Values are quoted so PostgREST treats spaces/dots literally.
  const matchFilter = domain ? `normalized_name.eq."${normalized}",domain.eq."${domain}"` : `normalized_name.eq."${normalized}"`;
  const { data: dnc } = await db().from("do_not_contact").select("id").or(matchFilter).limit(1);
  if (dnc?.length) {
    ctx.bump("duplicates_skipped");
    await setArticle("duplicate");
    await ctx.log("dedupe", `${r.company_name} is on the do-not-contact list — skipped`);
    return;
  }

  // Dedupe 2: a startup we've already seen (any status — drafted, sent, rejected…)
  const { data: existing } = await db().from("startups").select("id,name,status,source_urls").or(matchFilter).limit(1);
  if (existing?.length) {
    const s = existing[0];
    ctx.bump("duplicates_skipped");
    await setArticle("duplicate", { startup_id: s.id });
    if (!s.source_urls.includes(a.url)) {
      await db().from("startups").update({ source_urls: [...s.source_urls, a.url] }).eq("id", s.id);
    }
    await ctx.log("dedupe", `${r.company_name} already in pipeline (status: ${s.status}) — no duplicate outreach`);
    return;
  }

  // Hard rule: raise size bounds from the thesis
  const { min_raise_usd: min, max_raise_usd: max } = ctx.thesis;
  let rejection: string | null = null;
  if (r.amount_usd != null && max != null && r.amount_usd > max) rejection = `Raise ${formatUsd(r.amount_usd)} is above the thesis maximum ${formatUsd(max)}`;
  if (r.amount_usd != null && min != null && r.amount_usd < min) rejection = `Raise ${formatUsd(r.amount_usd)} is below the thesis minimum ${formatUsd(min)}`;

  const { data: created, error } = await db()
    .from("startups")
    .insert({
      name: r.company_name.trim(),
      normalized_name: normalized,
      domain,
      website: domain ? `https://${domain}` : null,
      description: r.one_liner,
      sector: r.sector,
      location: r.location,
      round_type: stage,
      amount_usd: r.amount_usd,
      amount_text: r.amount_text,
      investors: r.investors ?? [],
      founders: (r.founders ?? []).map((name) => ({ name })),
      announced_at: a.published_at,
      source_urls: [a.url],
      status: rejection ? "rejected" : "new",
      rejection_reason: rejection,
      scored_thesis_version: rejection ? ctx.thesis.version : null,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique violation: a concurrent batch in this run created it first.
    if (error.code === "23505") {
      ctx.bump("duplicates_skipped");
      await setArticle("duplicate");
      return;
    }
    await setArticle("error");
    await ctx.log("extract", `Could not save ${r.company_name}: ${error.message}`, "error");
    return;
  }

  await setArticle("linked", { startup_id: created.id });
  if (rejection) {
    ctx.bump("rejected_rules");
    await ctx.log("extract", `${r.company_name}: ${rejection}`);
  } else {
    ctx.bump("startups_new");
    await ctx.log("extract", `New startup: ${r.company_name} — ${stage}, ${r.amount_text ?? "amount undisclosed"}`);
  }
}
