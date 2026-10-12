import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/supabase";
import { hoursBetween, isoHoursAgo, median, timeAgo } from "@/lib/format";
import type { Draft, PipelineRun, Startup } from "@/lib/types";
import { DraftCard } from "@/components/DraftCard";
import { RunNowButton } from "@/components/RunNowButton";
import { StatusBadge } from "@/components/StatusBadge";

const TABS = [
  { key: "draft", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" },
  { key: "discarded", label: "Discarded" },
] as const;

type Row = Draft & { startup: Startup };

export default async function DraftsPage({ searchParams }: PageProps<"/">) {
  await connection();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "draft";
  const since24h = isoHoursAgo(24);

  const [{ data: drafts }, { data: all }, { data: lastRun }, { count: screened }] = await Promise.all([
    db().from("drafts").select("*, startup:startups(*)").eq("status", tab).order("created_at", { ascending: false }).limit(100),
    db().from("drafts").select("status, created_at, startup:startups(announced_at, discovered_at)"),
    db().from("pipeline_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("startups").select("id", { count: "exact", head: true }).eq("status", "rejected").gte("updated_at", since24h),
  ]);

  const rows = (drafts ?? []) as Row[];
  type Lite = { status: string; created_at: string; startup: { announced_at: string | null; discovered_at: string } | null };
  const lite = (all ?? []) as unknown as Lite[];
  const counts = Object.fromEntries(TABS.map((t) => [t.key, lite.filter((d) => d.status === t.key).length]));
  const latencies = lite
    .map((d) => hoursBetween(d.startup?.announced_at ?? d.startup?.discovered_at, d.created_at))
    .filter((h): h is number => h != null);
  const medianHours = median(latencies);
  const newToday = lite.filter((d) => d.created_at >= since24h).length;
  const run = lastRun as PipelineRun | null;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-stone-500">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Good morning, Rohit</h1>
          <p className="mt-1 text-stone-600">
            {counts.draft
              ? `${counts.draft} researched outreach draft${counts.draft === 1 ? "" : "s"} waiting for your review.`
              : "No drafts waiting — the pipeline runs every morning and only surfaces startups that fit your thesis."}
          </p>
        </div>
        <RunNowButton />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Awaiting review" value={counts.draft ?? 0} />
        <Stat label="New drafts (24h)" value={newToday} />
        <Stat
          label="Announcement → draft"
          value={medianHours == null ? "—" : `${medianHours < 1 ? "<1" : Math.round(medianHours)}h`}
          hint="median outreach window"
        />
        <Stat label="Screened out (24h)" value={screened ?? 0} hint="didn't fit thesis — hidden" />
      </section>

      {run && (
        <Link href={`/runs/${run.id}`} className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:border-stone-300">
          <span className="text-stone-500">Last pipeline run</span>
          <StatusBadge status={run.status} />
          <span className="text-stone-700">{timeAgo(run.started_at)} · {run.trigger}</span>
          <span className="text-stone-500">
            {run.stats.articles_new ?? 0} new articles · {run.stats.funding_announcements ?? 0} funding announcements ·{" "}
            {run.stats.drafts_created ?? 0} drafts
          </span>
          <span className="ml-auto text-stone-400">View log →</span>
        </Link>
      )}

      <section>
        <div className="mb-4 flex gap-1 border-b border-stone-200">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "draft" ? "/" : `/?tab=${t.key}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.key ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              {t.label} <span className="ml-1 text-xs tabular-nums text-stone-400">{counts[t.key] ?? 0}</span>
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="card grid place-items-center px-6 py-16 text-center">
            <div className="text-3xl">📭</div>
            <p className="mt-3 font-medium">Nothing here yet</p>
            <p className="mt-1 max-w-md text-sm text-stone-500">
              {tab === "draft"
                ? "When a startup announces a seed or pre-seed round that matches your thesis, a personalised draft will appear here."
                : `No ${tab} drafts.`}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {rows.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                announcedAgo={timeAgo(d.startup.announced_at ?? d.startup.discovered_at)}
                windowHours={hoursBetween(d.startup.announced_at ?? d.startup.discovered_at, d.created_at)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="text-xs text-stone-400">{hint}</div>}
    </div>
  );
}
