import "server-only";
import { db } from "../supabase";
import type { Thesis } from "../types";
import { createContext } from "./context";
import { ingest } from "./ingest";
import { extract } from "./extract";
import { research } from "./research";
import { score } from "./score";
import { draft } from "./draft";

// ORCHESTRATOR
// ingest → extract+dedupe → research → score → draft
// Every stage reads its input from the database (not from the previous stage's
// memory), so if a run hits the time budget or crashes, the next run simply
// picks up where it stopped. Items carry their own status.

const STALE_RUN_MS = 10 * 60_000;

export class RunInProgressError extends Error {}

export async function loadActiveThesis(): Promise<Thesis> {
  const { data, error } = await db().from("thesis").select("*").eq("is_active", true).single();
  if (error || !data) throw new Error(`No active thesis found in Supabase (${error?.message ?? "empty"})`);
  return data as Thesis;
}

export async function runPipeline(trigger: "cron" | "manual", budgetMs = 270_000) {
  // Concurrency guard: one run at a time. A run stuck in 'running' for >10 min
  // (e.g. the function was killed) is marked failed so it can't block forever.
  const { data: running } = await db().from("pipeline_runs").select("id,started_at").eq("status", "running");
  for (const r of running ?? []) {
    if (Date.now() - new Date(r.started_at).getTime() > STALE_RUN_MS) {
      await db().from("pipeline_runs").update({ status: "failed", error: "Timed out (stale)", finished_at: new Date().toISOString() }).eq("id", r.id);
    } else {
      throw new RunInProgressError(`Run ${r.id.slice(0, 8)} is already in progress`);
    }
  }

  const thesis = await loadActiveThesis();
  const { data: run, error } = await db()
    .from("pipeline_runs")
    .insert({ trigger, thesis_version: thesis.version })
    .select("id")
    .single();
  // 23505 → the unique "one running run" index rejected us: another run started first.
  if (error?.code === "23505") throw new RunInProgressError("Another run is already in progress");
  if (error || !run) throw new Error(`Could not create run: ${error?.message}`);

  const ctx = createContext(run.id, thesis, budgetMs);
  await ctx.log("run", `Started (${trigger}) with thesis v${thesis.version}, lookback ${thesis.lookback_hours}h, threshold ${thesis.fit_threshold}`);

  const stages = [
    ["ingest", ingest],
    ["extract", extract],
    ["research", research],
    ["score", score],
    ["draft", draft],
  ] as const;

  let status: "completed" | "partial" | "failed" = "completed";
  let failure: string | null = null;
  for (const [name, stage] of stages) {
    try {
      await stage(ctx);
    } catch (e) {
      failure = `${name}: ${(e as Error).message}`;
      await ctx.log(name, failure, "error");
      // Ingest failing shouldn't stop us drafting from items queued earlier.
      status = "partial";
    }
  }

  // Anything still mid-pipeline means we ran out of time — the next run continues it.
  const { count: backlog } = await db()
    .from("startups")
    .select("id", { count: "exact", head: true })
    .in("status", ["new", "researched", "fit"]);
  const { count: articleBacklog } = await db().from("articles").select("id", { count: "exact", head: true }).eq("status", "new");
  ctx.stats.backlog = (backlog ?? 0) + (articleBacklog ?? 0);
  if (status === "completed" && ctx.stats.backlog > 0) status = "partial";
  if (failure && !ctx.stats.drafts_created && !ctx.stats.articles_new && ctx.stats.sources_ok === undefined) status = "failed";

  await db()
    .from("pipeline_runs")
    .update({ status, stats: ctx.stats, error: failure, finished_at: new Date().toISOString() })
    .eq("id", run.id);
  await ctx.log("run", `Finished: ${status} · ${ctx.stats.drafts_created ?? 0} new draft(s) · backlog ${ctx.stats.backlog}`);
  return { runId: run.id, status, stats: ctx.stats };
}
