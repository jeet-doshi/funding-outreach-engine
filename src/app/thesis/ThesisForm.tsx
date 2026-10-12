"use client";

import { useState, useTransition } from "react";
import { saveThesis } from "../actions";
import type { Thesis } from "@/lib/types";

export function ThesisForm({ thesis: t }: { thesis: Thesis }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="card space-y-6 p-6"
      action={(fd) =>
        start(async () => {
          const r = await saveThesis(fd);
          setMsg("error" in r && r.error ? { ok: false, text: r.error } : { ok: true, text: `Saved as v${"version" in r ? r.version : "?"} — the next run will use it.` });
        })
      }
    >
      <Section title="What makes a great fit">
        <Field label="Thesis (free text — the scorer reads this verbatim)" full>
          <textarea name="thesis_text" defaultValue={t.thesis_text} className="input min-h-32" required />
        </Field>
        <Field label="Target stages (comma-separated)" hint="pre-seed, seed, angel, series-a">
          <input name="target_stages" defaultValue={t.target_stages.join(", ")} className="input" required />
        </Field>
        <Field label="Fit threshold (0–100)" hint="Startups scoring below this are never shown">
          <input name="fit_threshold" type="number" min={0} max={100} defaultValue={t.fit_threshold} className="input" required />
        </Field>
        <Field label="Target sectors">
          <input name="target_sectors" defaultValue={t.target_sectors.join(", ")} className="input" />
        </Field>
        <Field label="Excluded sectors">
          <input name="excluded_sectors" defaultValue={t.excluded_sectors.join(", ")} className="input" />
        </Field>
        <Field label="Target geographies" hint="Leave empty for anywhere">
          <input name="target_geographies" defaultValue={t.target_geographies.join(", ")} className="input" />
        </Field>
        <Field label="Lookback window (hours)" hint="How far back each run looks for announcements">
          <input name="lookback_hours" type="number" min={1} max={168} defaultValue={t.lookback_hours} className="input" />
        </Field>
        <Field label="Min raise (USD)" hint="Empty = no minimum">
          <input name="min_raise_usd" type="number" min={0} defaultValue={t.min_raise_usd ?? ""} className="input" />
        </Field>
        <Field label="Max raise (USD)" hint="Empty = no maximum">
          <input name="max_raise_usd" type="number" min={0} defaultValue={t.max_raise_usd ?? ""} className="input" />
        </Field>
      </Section>

      <Section title="Outreach voice">
        <Field label="Accelerator name">
          <input name="accelerator_name" defaultValue={t.accelerator_name} className="input" required />
        </Field>
        <Field label="Email tone">
          <input name="email_tone" defaultValue={t.email_tone} className="input" />
        </Field>
        <Field label="Sender name">
          <input name="sender_name" defaultValue={t.sender_name} className="input" required />
        </Field>
        <Field label="Sender title">
          <input name="sender_title" defaultValue={t.sender_title} className="input" />
        </Field>
        <Field label="What the program offers" full>
          <textarea name="accelerator_pitch" defaultValue={t.accelerator_pitch} className="input min-h-20" />
        </Field>
        <Field label="Call to action" full>
          <input name="call_to_action" defaultValue={t.call_to_action} className="input" />
        </Field>
      </Section>

      <div className="flex items-center gap-3 border-t border-stone-100 pt-4">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : `Save as v${t.version + 1}`}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({ label, hint, full, children }: { label: string; hint?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={full ? "sm:col-span-2" : ""}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}
