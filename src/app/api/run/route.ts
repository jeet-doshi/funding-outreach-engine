import { NextResponse, after } from "next/server";
import { runPipeline, RunInProgressError } from "@/lib/pipeline/run";
import { db } from "@/lib/supabase";

// Manual "Run now" from the dashboard (protected by the dashboard proxy).
// Responds immediately; the pipeline keeps running in the background via
// after(), and the Runs page polls for progress.
export const maxDuration = 300;

export async function POST() {
  const { data: running } = await db()
    .from("pipeline_runs")
    .select("id,started_at")
    .eq("status", "running")
    .gt("started_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(1);
  if (running?.length) {
    return NextResponse.json({ error: "A run is already in progress", runId: running[0].id }, { status: 409 });
  }
  after(async () => {
    try {
      await runPipeline("manual");
    } catch (e) {
      if (!(e instanceof RunInProgressError)) console.error("Manual run failed", e);
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
