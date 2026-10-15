// Deterministic helpers used for deduplication and rule-based filtering.

const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|sas|sa|bv|ag|plc|oy|ab|technologies|technology)\b\.?/g;

/** "Acme AI, Inc." → "acme ai". Two articles about the same company map to the same key. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\.(com|io|ai|co|app|xyz|so|dev)\b/g, " $1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** "https://www.acme.ai/about" → "acme.ai" */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes(".")) return null;
    // Never treat news/social hosts as a company's own domain.
    if (/(linkedin|twitter|x|facebook|crunchbase|techcrunch|google|medium|wikipedia)\.(com|org)$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Strip tracking params so the same story isn't stored twice under different URLs. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()].forEach((k) => {
      if (/^(utm_|fbclid|gclid|ref$|mc_)/.test(k)) u.searchParams.delete(k);
    });
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map the many ways a round is described onto a small, comparable vocabulary. */
export function normalizeStage(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (/pre[\s-]?seed/.test(s)) return "pre-seed";
  if (/seed/.test(s)) return "seed";
  if (/angel/.test(s)) return "angel";
  if (/series[\s-]?a\b/.test(s)) return "series-a";
  if (/series[\s-]?[b-z]\b/.test(s)) return "series-b+";
  if (/grant/.test(s)) return "grant";
  if (/debt|loan|venture debt/.test(s)) return "debt";
  return "unknown";
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null) return "undisclosed";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Cheap keyword gate before spending an LLM call on an article. */
export function looksLikeFundingNews(text: string): boolean {
  return /\b(rais(e|es|ed|ing)|funding|seed|pre-seed|round|secures?|secured|bags|closes|lands|nets|backed|investment)\b/i.test(
    text,
  );
}

// ---------------------------------------------------------------------------
// Fuzzy "same company" matching. News outlets name the same startup
// differently ("Parallel Loop" vs "Parallel Loop AI", "Evos" vs "Evolutionary
// Operating System"), so exact keys alone are not enough.
// ---------------------------------------------------------------------------

const GENERIC_TRAILING = new Set([
  "ai", "tech", "labs", "lab", "hq", "app", "io", "technologies", "technology",
  "systems", "software", "group", "global", "platform", "solutions",
]);

/** "parallel loop ai" → "parallel loop", "nusynth tech" → "nusynth". Never strips the last word. */
export function coreName(normalized: string): string {
  const t = normalized.split(" ").filter(Boolean);
  while (t.length > 1 && GENERIC_TRAILING.has(t[t.length - 1])) t.pop();
  return t.join(" ");
}

export type CompanyFingerprint = {
  normalized_name: string;
  founders?: { name: string }[] | null;
  investors?: string[] | null;
  amount_usd?: number | null;
  round_type?: string | null;
};

const fullNames = (fs: { name: string }[] | null | undefined) =>
  (fs ?? []).map((f) => (f?.name ?? "").toLowerCase().replace(/\s+/g, " ").trim()).filter((n) => n.includes(" "));

/** Returns why two records look like the same company, or null. */
export function sameCompanyReason(a: CompanyFingerprint, b: CompanyFingerprint): string | null {
  if (coreName(a.normalized_name) === coreName(b.normalized_name)) return "same name";
  const fb = new Set(fullNames(b.founders));
  const founder = fullNames(a.founders).find((n) => fb.has(n));
  if (founder) return `same founder (${founder})`;
  if (a.round_type && a.round_type === b.round_type && a.amount_usd && b.amount_usd && Math.abs(a.amount_usd - b.amount_usd) <= 0.02 * b.amount_usd) {
    const ia = new Set((a.investors ?? []).map((x) => x.toLowerCase().trim()));
    if ((b.investors ?? []).some((x) => ia.has(x.toLowerCase().trim()))) return "same round, amount and investor";
  }
  return null;
}
