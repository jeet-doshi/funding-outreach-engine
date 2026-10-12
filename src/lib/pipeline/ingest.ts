import "server-only";
import { XMLParser } from "fast-xml-parser";
import { db } from "../supabase";
import { canonicalUrl, looksLikeFundingNews, stripHtml } from "../normalize";
import type { Source } from "../types";
import type { RunContext } from "./context";

// STAGE 1 — INGEST
// Pull every enabled RSS source in parallel, keep items published inside the
// thesis lookback window that look like funding news, and insert them into
// `articles`. The UNIQUE(url) constraint means an article already seen in a
// previous run is silently ignored — no double processing.

type FeedItem = { url: string; title: string; summary: string; source_name: string; published_at: string | null };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

function parseFeed(xml: string, source: Source): FeedItem[] {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items
    .map((it: Record<string, unknown>): FeedItem | null => {
      const link =
        typeof it.link === "string"
          ? it.link
          : asText(it.link) || ((it.link as Record<string, string>)?.["@_href"] ?? "");
      const title = stripHtml(asText(it.title));
      if (!link || !title) return null;
      const date = asText(it.pubDate) || asText(it["dc:date"]) || asText(it.published) || asText(it.updated);
      const parsed = date ? new Date(date) : null;
      // Google News items carry the real publisher in <source>
      const publisher = asText(it.source);
      const summary = stripHtml(asText(it.description) || asText(it["content:encoded"]) || asText(it.summary)).slice(0, 700);
      return {
        url: canonicalUrl(link.trim()),
        title,
        summary: summary === title ? "" : summary,
        source_name: publisher ? `${publisher} (via ${source.name})` : source.name,
        published_at: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      };
    })
    .filter((x): x is FeedItem => x !== null);
}

async function fetchSource(source: Source): Promise<FeedItem[]> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FundingOutreachEngine/1.0)", Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), source);
}

export async function ingest(ctx: RunContext): Promise<void> {
  const { data: sources, error } = await db().from("sources").select("*").eq("enabled", true);
  if (error) throw new Error(`Could not load sources: ${error.message}`);
  if (!sources?.length) {
    await ctx.log("ingest", "No enabled sources configured", "warn");
    return;
  }

  const cutoff = Date.now() - ctx.thesis.lookback_hours * 3600_000;
  const results = await Promise.allSettled((sources as Source[]).map(fetchSource));

  const candidates = new Map<string, FeedItem>();
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i] as Source;
    const r = results[i];
    const now = new Date().toISOString();
    if (r.status === "rejected") {
      ctx.bump("sources_failed");
      await ctx.log("ingest", `Source "${source.name}" failed: ${r.reason?.message ?? r.reason}`, "warn");
      await db().from("sources").update({ last_fetched_at: now, last_status: `error: ${r.reason?.message ?? "unknown"}`, last_item_count: 0 }).eq("id", source.id);
      continue;
    }
    ctx.bump("sources_ok");
    const fresh = r.value.filter((it) => !it.published_at || new Date(it.published_at).getTime() >= cutoff);
    const relevant = fresh.filter((it) => looksLikeFundingNews(`${it.title} ${it.summary}`));
    ctx.bump("items_fetched", r.value.length);
    ctx.bump("items_in_window", fresh.length);
    relevant.forEach((it) => candidates.set(it.url, it));
    await db().from("sources").update({ last_fetched_at: now, last_status: "ok", last_item_count: r.value.length }).eq("id", source.id);
  }

  // Same headline from two feeds (e.g. TechCrunch + Google News) → keep one.
  const byTitle = new Map<string, FeedItem>();
  for (const it of candidates.values()) {
    const key = it.title.toLowerCase().replace(/\s+-\s+[^-]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (!byTitle.has(key)) byTitle.set(key, it);
  }
  const rows = [...byTitle.values()].map((it) => ({ ...it, run_id: ctx.runId, status: "new" }));
  ctx.bump("items_relevant", rows.length);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error: insErr } = await db()
      .from("articles")
      .upsert(rows.slice(i, i + 200), { onConflict: "url", ignoreDuplicates: true })
      .select("id");
    if (insErr) throw new Error(`Article insert failed: ${insErr.message}`);
    inserted += data?.length ?? 0;
  }
  ctx.bump("articles_new", inserted);
  await ctx.log(
    "ingest",
    `${sources.length - (ctx.stats.sources_failed ?? 0)}/${sources.length} sources OK · ${ctx.stats.items_fetched ?? 0} items · ${ctx.stats.items_in_window ?? 0} in last ${ctx.thesis.lookback_hours}h · ${rows.length} look like funding news · ${inserted} new (rest already seen)`,
  );
}
