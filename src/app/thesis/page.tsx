import { connection } from "next/server";
import { db } from "@/lib/supabase";
import { formatDateTime } from "@/lib/format";
import type { Thesis } from "@/lib/types";
import { ThesisForm } from "./ThesisForm";
import { activateThesisVersion } from "../actions";

export default async function ThesisPage() {
  await connection();
  const { data } = await db().from("thesis").select("*").order("version", { ascending: false }).limit(20);
  const versions = (data ?? []) as Thesis[];
  const active = versions.find((v) => v.is_active) ?? versions[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accelerator thesis</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          This is what every startup is scored against. It lives in the Supabase <code className="rounded bg-stone-100 px-1">thesis</code> table and
          is re-read at the start of every pipeline run — edit it here or directly in Supabase, and all future scoring and emails reflect
          the change with no code changes or redeploy. Each save creates a new version, so every score is traceable to the thesis that produced it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {active ? <ThesisForm thesis={active} /> : <div className="card p-6 text-sm text-red-600">No thesis found — run supabase/schema.sql.</div>}

        <aside className="card h-fit p-4">
          <h2 className="text-sm font-semibold">Version history</h2>
          <ul className="mt-3 space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium">
                    v{v.version} {v.is_active && <span className="badge ml-1 bg-emerald-50 text-emerald-700">active</span>}
                  </div>
                  <div className="text-xs text-stone-500">{formatDateTime(v.created_at)} · threshold {v.fit_threshold}</div>
                </div>
                {!v.is_active && (
                  <form action={async () => { "use server"; await activateThesisVersion(v.version); }}>
                    <button className="btn btn-ghost text-xs">Restore</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
