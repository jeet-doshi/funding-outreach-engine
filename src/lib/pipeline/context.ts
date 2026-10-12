import "server-only";
import { db } from "../supabase";
import type { Thesis } from "../types";

// Shared state passed through every stage of a single run.
export type RunContext = {
  runId: string;
  thesis: Thesis;
  deadline: number; // epoch ms — stages stop picking up new work after this
  stats: Record<string, number>;
  log: (stage: string, message: string, level?: "info" | "warn" | "error", data?: unknown) => Promise<void>;
  bump: (key: string, by?: number) => void;
  timeLeft: () => number;
};

export function createContext(runId: string, thesis: Thesis, budgetMs: number): RunContext {
  const stats: Record<string, number> = {};
  const deadline = Date.now() + budgetMs;
  return {
    runId,
    thesis,
    deadline,
    stats,
    bump: (key, by = 1) => {
      stats[key] = (stats[key] ?? 0) + by;
    },
    timeLeft: () => deadline - Date.now(),
    log: async (stage, message, level = "info", data) => {
      const line = `[run ${runId.slice(0, 8)}] [${stage}] ${message}`;
      if (level === "error") console.error(line);
      else console.log(line);
      // Logging must never break the pipeline.
      await db()
        .from("run_events")
        .insert({ run_id: runId, stage, level, message, data: data ?? null })
        .then(({ error }) => error && console.error("run_events insert failed", error.message));
    },
  };
}

/** Run `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Record a failure on a startup; after 3 attempts it is parked in status 'error' (dead-letter). */
export async function recordFailure(ctx: RunContext, stage: string, startupId: string, attempts: number, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const nextAttempts = attempts + 1;
  const giveUp = nextAttempts >= 3;
  await db()
    .from("startups")
    .update({
      attempts: nextAttempts,
      last_error: `${stage}: ${message}`.slice(0, 1000),
      ...(giveUp ? { status: "error" } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", startupId);
  ctx.bump(`${stage}_errors`);
  await ctx.log(stage, `${giveUp ? "Gave up" : "Will retry next run"} — ${message}`, giveUp ? "error" : "warn", {
    startupId,
  });
}
