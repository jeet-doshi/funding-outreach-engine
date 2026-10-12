import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/supabase";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { PipelineRun, RunEvent } from "@/lib/types";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StatusBadge } from "@/components/StatusBadge";

const STAGES = ["run", "ingest", "extract", "dedupe", "research", "score", "draft"];
const STAGE_COLORS: Record<string, string> = {
  run: "bg-stone-800 text-white",
  ingest: "bg-sky-100 text-sky-800",
  extract: "bg-indigo-100 text-indigo-800",
  dedupe: "bg-fuchsia-100 text-fuchsia-800",
  research: "bg-teal-100 text-teal-800",
  score: "bg-amber-100 text-amber-800",
  draft: "bg-emerald-100 text-emerald-800",
};

export default async function RunDetail({ params }: PageProps<"/runs/[id]">) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: run }, { data: events }] = await Promise.all([
    db().from("pipeline_runs").select("*").eq("id", id).maybeSingle(),
    db().from("run_events").select("*").eq("run_id", id).order("id").limit(1000),
  ]);
  if (!run) notFound();
  const r = run as PipelineRun;
  const evs = (events ?? []) as RunEvent[];

  return (
    <div className="space-y-6">
      <AutoRefresh active={r.status === "running"} intervalMs={2500} />
      <Link href="/runs" className="text-sm text-stone-500 hover:text-stone-900">← All runs</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Run {r.id.slice(0, 8)}</h1>
        <StatusBadge status={r.status} />
        <span className="text-sm text-stone-500">
          {formatDateTime(r.started_at)} · {r.trigger} · thesis v{r.thesis_version} · {formatDuration(r.started_at, r.finished_at)}
        </span>
      </div>
      {r.error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{r.error}</div>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(r.stats)
          .sort()
          .map(([k, v]) => (
            <div key={k} className="card px-3 py-2">
              <div className="truncate text-xs text-stone-500">{k.replace(/_/g, " ")}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
      </section>

      <section className="card divide-y divide-stone-100">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">Event log</h2>
          <span className="text-xs text-stone-400">{evs.length} events</span>
        </div>
        {evs.length === 0 && <p className="px-4 py-6 text-sm text-stone-500">No events yet…</p>}
        {evs.map((e) => (
          <div key={e.id} className={`flex gap-3 px-4 py-2 text-sm ${e.level === "error" ? "bg-red-50/60" : e.level === "warn" ? "bg-amber-50/50" : ""}`}>
            <span className="w-16 shrink-0 font-mono text-xs leading-5 text-stone-400">
              {new Date(e.created_at).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })}
            </span>
            <span className={`badge h-5 w-20 shrink-0 justify-center ${STAGE_COLORS[e.stage] ?? "bg-stone-100"}`}>{e.stage}</span>
            <span className={e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-800" : "text-stone-700"}>{e.message}</span>
          </div>
        ))}
      </section>
      <p className="text-xs text-stone-400">Stages: {STAGES.join(" → ")}</p>
    </div>
  );
}
