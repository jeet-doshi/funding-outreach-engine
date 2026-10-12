import "server-only";
import { db } from "../supabase";
import { generateJSON } from "../gemini";
import { formatUsd } from "../normalize";
import type { FitReasons, Startup, Thesis } from "../types";
import type { RunContext } from "./context";
import { mapLimit, recordFailure } from "./context";

// STAGE 4 — FIT SCORING
// The thesis is loaded from Supabase at the start of every run, so editing it
// changes all future scoring with zero code changes. Gemini scores each
// researched startup 0-100 against the thesis with a per-criterion breakdown;
// anything below thesis.fit_threshold is rejected and never shown to Rohit.

const SCHEMA = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER", description: "0-100 overall fit" },
    verdict: { type: "STRING", enum: ["strong_fit", "possible_fit", "not_a_fit"] },
    criteria: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          criterion: { type: "STRING" },
          assessment: { type: "STRING" },
          score: { type: "INTEGER", description: "0-10" },
        },
        required: ["criterion", "assessment", "score"],
      },
    },
    reasons: { type: "ARRAY", items: { type: "STRING" } },
    concerns: { type: "ARRAY", items: { type: "STRING" } },
    personalization_hooks: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Specific, verifiable details an outreach email could reference",
    },
  },
  required: ["score", "verdict", "criteria", "reasons", "concerns", "personalization_hooks"],
};

export function thesisPrompt(t: Thesis): string {
  return `ACCELERATOR: ${t.accelerator_name}
THESIS: ${t.thesis_text}
TARGET STAGES: ${t.target_stages.join(", ")}
TARGET SECTORS: ${t.target_sectors.join(", ") || "any"}
EXCLUDED SECTORS (score these below 20): ${t.excluded_sectors.join(", ") || "none"}
TARGET GEOGRAPHIES: ${t.target_geographies.join(", ") || "anywhere"}
RAISE SIZE: ${t.min_raise_usd != null ? `min ${formatUsd(t.min_raise_usd)}` : "no minimum"}, ${t.max_raise_usd != null ? `max ${formatUsd(t.max_raise_usd)}` : "no maximum"}`;
}

export function startupPrompt(s: Startup): string {
  const r = s.research;
  return `STARTUP: ${s.name}
Round: ${s.round_type} · ${s.amount_text ?? formatUsd(s.amount_usd)} · Investors: ${s.investors.join(", ") || "undisclosed"}
Sector: ${s.sector ?? "unknown"} · Location: ${s.location ?? "unknown"} · Website: ${s.website ?? "unknown"}
Description: ${s.description ?? "n/a"}
Research summary: ${r?.summary ?? "n/a"}
Product: ${r?.product ?? "n/a"}
Customers: ${r?.customers ?? "n/a"}
Traction: ${r?.traction ?? "n/a"}
Founders: ${(s.founders ?? []).map((f) => `${f.name}${f.role ? ` (${f.role})` : ""}${f.background ? ` — ${f.background}` : ""}`).join("; ") || "unknown"}`;
}

const SYSTEM = `You are the selection committee of a startup accelerator. Score how well a startup that just raised money fits the accelerator's thesis.
Score each relevant thesis criterion 0-10 (sector fit, stage fit, geography, team, evidence of demand, timing), then give an overall 0-100 score.
Be calibrated: 80+ = clearly in thesis, 60-79 = plausible fit, below 50 = outside thesis. Missing information is a mild negative, not disqualifying.
Base everything on the facts provided. Do not invent facts.`;

export async function score(ctx: RunContext): Promise<void> {
  const { data, error } = await db().from("startups").select("*").eq("status", "researched").order("discovered_at").limit(20);
  if (error) throw new Error(`Could not load startups: ${error.message}`);
  if (!data?.length) return;
  const t = ctx.thesis;

  await mapLimit(data as Startup[], 3, async (s) => {
    if (ctx.timeLeft() < 30_000) return;
    try {
      const result = await generateJSON<FitReasons & { score: number }>({
        system: SYSTEM,
        prompt: `${thesisPrompt(t)}\n\n---\n\n${startupPrompt(s)}`,
        schema: SCHEMA,
        temperature: 0,
      });
      ctx.bump("gemini_calls");
      const scoreVal = Math.max(0, Math.min(100, Math.round(result.score)));
      const fit = scoreVal >= t.fit_threshold;
      const { score: _omit, ...reasons } = result;
      void _omit;
      await db()
        .from("startups")
        .update({
          status: fit ? "fit" : "rejected",
          fit_score: scoreVal,
          fit_reasons: reasons,
          rejection_reason: fit ? null : `Fit score ${scoreVal} below threshold ${t.fit_threshold}`,
          scored_thesis_version: t.version,
          updated_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      ctx.bump(fit ? "fit" : "rejected_score");
      await ctx.log("score", `${s.name}: ${scoreVal}/100 → ${fit ? "FIT" : "filtered out"}`, "info", { score: scoreVal });
    } catch (e) {
      await recordFailure(ctx, "score", s.id, s.attempts, e);
    }
  });
}
