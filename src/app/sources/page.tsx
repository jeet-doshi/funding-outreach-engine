import { connection } from "next/server";
import { db } from "@/lib/supabase";
import { timeAgo } from "@/lib/format";
import type { Source } from "@/lib/types";
import { addDoNotContact, addSource, deleteSource, removeDoNotContact, toggleSource } from "../actions";

type Dnc = { id: string; company_name: string; domain: string | null; reason: string | null };

export default async function SourcesPage() {
  await connection();
  const [{ data: sources }, { data: dnc }] = await Promise.all([
    db().from("sources").select("*").order("created_at"),
    db().from("do_not_contact").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sources &amp; suppression</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Live news feeds the pipeline monitors (TechCrunch, Crunchbase News, Inc42, YourStory, Google News searches…). Add any RSS feed — no code changes.
        </p>
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Last fetch</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {((sources ?? []) as Source[]).map((s) => (
              <tr key={s.id} className={s.enabled ? "" : "opacity-50"}>
                <td className="max-w-md px-4 py-3">
                  <div className="font-medium">{s.name}</div>
                  <div className="truncate text-xs text-stone-400">{s.url}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full ${s.last_status === "ok" ? "bg-emerald-500" : s.last_status ? "bg-red-500" : "bg-stone-300"}`} />
                  <span className="text-stone-600">{s.last_fetched_at ? timeAgo(s.last_fetched_at) : "never"}</span>
                  {s.last_status && s.last_status !== "ok" && <div className="text-xs text-red-600">{s.last_status}</div>}
                </td>
                <td className="px-4 py-3 tabular-nums">{s.last_item_count ?? "—"}</td>
                <td className="space-x-1 whitespace-nowrap px-4 py-3 text-right">
                  <form action={toggleSource.bind(null, s.id, !s.enabled)} className="inline">
                    <button className="btn btn-secondary text-xs">{s.enabled ? "Disable" : "Enable"}</button>
                  </form>
                  <form action={deleteSource.bind(null, s.id)} className="inline">
                    <button className="btn btn-ghost text-xs">Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={async (fd) => { "use server"; await addSource(fd); }} className="flex flex-wrap gap-2 border-t border-stone-100 p-4">
          <input name="name" placeholder="Source name" className="input max-w-48" required />
          <input name="url" placeholder="https://example.com/feed/" className="input flex-1" required type="url" />
          <button className="btn btn-primary">Add feed</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Do-not-contact list</h2>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Companies you&apos;ve already contacted outside this system. The pipeline also never drafts twice for any startup it has seen — this list
          covers contacts made elsewhere.
        </p>
        <div className="card mt-4">
          <form action={async (fd) => { "use server"; await addDoNotContact(fd); }} className="flex flex-wrap gap-2 border-b border-stone-100 p-4">
            <input name="company_name" placeholder="Company name" className="input max-w-56" required />
            <input name="domain" placeholder="domain.com (optional)" className="input max-w-48" />
            <input name="reason" placeholder="Reason (optional)" className="input flex-1" />
            <button className="btn btn-primary">Add</button>
          </form>
          {(dnc as Dnc[] | null)?.length ? (
            <ul className="divide-y divide-stone-100">
              {(dnc as Dnc[]).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="font-medium">{d.company_name}</span>
                  {d.domain && <span className="text-xs text-stone-500">{d.domain}</span>}
                  <span className="flex-1 text-xs text-stone-500">{d.reason}</span>
                  <form action={removeDoNotContact.bind(null, d.id)}>
                    <button className="btn btn-ghost text-xs">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-stone-500">Empty.</p>
          )}
        </div>
      </section>
    </div>
  );
}
