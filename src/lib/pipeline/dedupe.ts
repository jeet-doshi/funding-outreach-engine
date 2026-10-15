import "server-only";
import { db } from "../supabase";
import { sameCompanyReason, type CompanyFingerprint } from "../normalize";

// Second dedupe layer (the first is exact name/domain + UNIQUE constraints).
// Compares a candidate against every startup seen in the last 120 days using
// fuzzy signals: core name, shared founder, or same round + amount + investor.

export type DuplicateMatch = { id: string; name: string; status: string; reason: string };

export async function findLikelyDuplicate(c: CompanyFingerprint, excludeId?: string): Promise<DuplicateMatch | null> {
  const since = new Date(Date.now() - 120 * 86400_000).toISOString();
  const { data, error } = await db()
    .from("startups")
    .select("id,name,normalized_name,founders,investors,amount_usd,round_type,status")
    .gte("discovered_at", since)
    .order("discovered_at")
    .limit(5000);
  if (error) throw new Error(`Dedupe lookup failed: ${error.message}`);
  // Prefer the record that matters most for "never contact twice".
  const priority: Record<string, number> = { drafted: 0, fit: 1, rejected: 2, researched: 3, new: 4, error: 5 };
  const matches: DuplicateMatch[] = [];
  for (const b of data ?? []) {
    if (b.id === excludeId) continue;
    const reason = sameCompanyReason(c, b);
    if (reason) matches.push({ id: b.id, name: b.name, status: b.status, reason });
  }
  matches.sort((x, y) => (priority[x.status] ?? 9) - (priority[y.status] ?? 9));
  return matches[0] ?? null;
}
