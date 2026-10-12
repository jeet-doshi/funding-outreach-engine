import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/supabase";
import { formatDateTime, formatDuration, timeAgo } from "@/lib/format";
import type { PipelineRun, Startup } from "@/lib/types";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RunNowButton } from "@/components/RunNowButton";
import { StatusBadge } from "@/components/StatusBadge";
import { retryStartup } from "../actions";

const FUNNEL: { key: string; label: string }[] = [
  { key: "items_fetched", label: "Items fetched" },
  { key: "items_relevant", label: "Funding-like" },
  { key: "articles_new", label: "New articles" },
  { key: "funding_announcements", label: "Funding rounds" },
  { key: "startups_new", label: "New startups" },
  { key: "fit", label: "Fit thesis" },
  { key: "drafts_created", label: "Drafts" },
];

export default async function RunsPage() {
  await connection();
  const [{ data: runs }, { data: stuck }, { data: statusRows }] = await Promise.all([
    db().from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(30),
    db().from("startups").select("id,name,last_error,attempts").eq("status", "error").limit(20),
    db().from("startups").select("status"),
  ]);
  const list = (runs ?? []) as PipelineRun[];
  const running = list.some((r) => r.status === "running");
  const byStatus = (statusRows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <AutoRefresh active={running} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline runs</h1>
          <p className="mt-1 text-sm text-stone-600">
            Runs automatically every morning at 6:30 AM IST (Vercel Cron). Each run picks up any work a previous run didn&apos;t finish.
          </p>
        </div>
        <RunNowButton />
      </div>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">Startup pipeline state</h2>
        <p className="mb-4 text-xs text-stone-500">Every startup moves through: new → researched → fit / rejected → drafted</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {["new", "researched", "fit", "drafted", "rejected", "error"].map((s) => (
            <div key={s} className="rounded-lg bg-stone-50 px-3 py-2">
              <div className="text-xs capitalize text-stone-500">{s}</div>
              <div className="text-xl font-semibold tabular-nums">{byStatus[s] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      {stuck && stuck.length > 0 && (
        <section className="card border-red-200 p-5">
          <h2 className="text-sm font-semibold text-red-700">Needs attention — failed 3 times</h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {(stuck as Pick<Startup, "id" | "name" | "last_error" | "attempts">[]).map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="flex-1 truncate text-xs text-stone-500">{s.last_error}</span>
                <form action={retryStartup.bind(null, s.id)}>
                  <button className="btn btn-secondary">Retry</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Funnel</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-stone-500">No runs yet — click “Run pipeline now”.</td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-3">
                  <div className="font-medium">{formatDateTime(r.started_at)}</div>
                  <div className="text-xs text-stone-500">{timeAgo(r.started_at)} · {r.trigger} · thesis v{r.thesis_version}</div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {FUNNEL.map((f) => (
                      <span key={f.key} className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600" title={f.label}>
                        {f.label}: <b className="tabular-nums text-stone-900">{r.stats[f.key] ?? 0}</b>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums text-stone-600">{formatDuration(r.started_at, r.finished_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/runs/${r.id}`} className="text-stone-600 hover:text-stone-900">Log →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
