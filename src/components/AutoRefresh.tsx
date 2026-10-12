"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data every few seconds while `active` (e.g. a run is in progress). */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
