"use client";

import { useState, useTransition } from "react";
import { saveDraft, setDraftStatus } from "@/app/actions";
import type { Draft, DraftStatus, Startup } from "@/lib/types";
import { ScoreRing } from "./ScoreRing";
import { StatusBadge } from "./StatusBadge";

type Props = { draft: Draft & { startup: Startup }; announcedAgo: string; windowHours: number | null };

export function DraftCard({ draft, announcedAgo, windowHours }: Props) {
  const s = draft.startup;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [showWhy, setShowWhy] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const dirty = subject !== draft.subject || body !== draft.body;

  const act = (fn: () => Promise<{ error?: string } | { ok: boolean }>, done: string) =>
    start(async () => {
      const r = await fn();
      setNote("error" in r && r.error ? r.error : done);
      setTimeout(() => setNote(""), 2500);
    });

  const changeStatus = (status: DraftStatus, done: string) =>
    act(async () => {
      if (dirty) await saveDraft(draft.id, subject, body);
      return setDraftStatus(draft.id, status);
    }, done);

  const firstFounder = s.founders?.[0]?.name;
  const su = encodeURIComponent(subject);
  const bo = encodeURIComponent(body);
  // Web compose links work without any desktop mail app configured.
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&su=${su}&body=${bo}`;
  const outlook = `https://outlook.office.com/mail/deeplink/compose?subject=${su}&body=${bo}`;
  const mailto = `mailto:?subject=${su}&body=${bo}`;
  const opened = () => {
    if (draft.status === "draft") changeStatus("approved", "Opened in email — approved");
  };
  const reasons = s.fit_reasons;

  return (
    <article className="card overflow-hidden">
      {/* Header: who, what, how fresh */}
      <div className="flex flex-wrap items-start gap-4 border-b border-stone-100 p-5">
        <ScoreRing score={s.fit_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{s.name}</h3>
            <span className="badge bg-violet-50 text-violet-700">{s.round_type}</span>
            {s.amount_text && <span className="badge bg-stone-100 text-stone-700">{s.amount_text}</span>}
            {draft.status !== "draft" && <StatusBadge status={draft.status} />}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-stone-600" title={s.research?.summary ?? undefined}>{s.description ?? s.research?.summary}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
            {s.sector && <span>🏷 {s.sector}</span>}
            {s.location && <span>📍 {s.location}</span>}
            {s.investors.length > 0 && <span>💰 {s.investors.slice(0, 3).join(", ")}</span>}
            {firstFounder && <span>👤 {s.founders.map((f) => f.name).slice(0, 3).join(", ")}</span>}
            {s.website && (
              <a href={s.website} target="_blank" rel="noreferrer" className="text-stone-700 underline decoration-stone-300 hover:decoration-stone-700">
                {s.domain ?? s.website}
              </a>
            )}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-medium text-stone-800">Announced {announcedAgo}</div>
          {windowHours != null && (
            <div className="mt-0.5 text-emerald-700">Drafted {windowHours < 1 ? "<1" : Math.round(windowHours)}h after announcement</div>
          )}
        </div>
      </div>

      {/* Email editor */}
      <div className="space-y-3 p-5">
        <div>
          <label className="label" htmlFor={`subj-${draft.id}`}>Subject</label>
          <input id={`subj-${draft.id}`} className="input font-medium" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`body-${draft.id}`}>Email</label>
          <textarea
            id={`body-${draft.id}`}
            className="input min-h-80 font-[450] leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {/* Why this startup — transparency for Rohit's approval */}
        <button onClick={() => setShowWhy((v) => !v)} className="text-xs font-medium text-stone-600 hover:text-stone-900">
          {showWhy ? "▾" : "▸"} Why this startup fits{reasons?.criteria?.length ? ` · ${reasons.criteria.length} criteria` : ""}
        </button>
        {showWhy && reasons && (
          <div className="grid gap-4 rounded-lg bg-stone-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <div className="label">Fit criteria</div>
              <ul className="space-y-1.5">
                {reasons.criteria.map((c) => (
                  <li key={c.criterion} className="flex gap-2">
                    <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-stone-500">{c.score}/10</span>
                    <span>
                      <span className="font-medium">{c.criterion}:</span> <span className="text-stone-600">{c.assessment}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3">
              {reasons.concerns.length > 0 && (
                <div>
                  <div className="label">Concerns</div>
                  <ul className="list-disc space-y-1 pl-4 text-stone-600">
                    {reasons.concerns.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              )}
              {draft.personalization?.points?.length ? (
                <div>
                  <div className="label">Personalised with</div>
                  <ul className="list-disc space-y-1 pl-4 text-stone-600">
                    {draft.personalization.points.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              ) : null}
              {s.research?.sources?.length ? (
                <div>
                  <div className="label">Research sources {s.research.grounded ? "(Google Search)" : ""}</div>
                  <ul className="space-y-0.5">
                    {s.research.sources.slice(0, 4).map((src) => (
                      <li key={src.uri} className="truncate">
                        <a href={src.uri} target="_blank" rel="noreferrer" className="text-xs text-stone-600 underline">{src.title || src.uri}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <div className="label">Announcement</div>
                {s.source_urls.slice(0, 2).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block truncate text-xs text-stone-600 underline">{u}</a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 bg-stone-50/60 px-5 py-3">
        {dirty && (
          <button className="btn btn-secondary" disabled={pending} onClick={() => act(() => saveDraft(draft.id, subject, body), "Saved")}>
            Save edits
          </button>
        )}
        {draft.status === "draft" && (
          <button className="btn btn-primary" disabled={pending} onClick={() => changeStatus("approved", "Approved ✓")}>
            ✓ Approve
          </button>
        )}
        {(draft.status === "draft" || draft.status === "approved") && (
          <>
            <a className="btn btn-secondary" href={gmail} target="_blank" rel="noreferrer" onClick={opened} title="Opens a pre-filled Gmail compose window">
              ✉ Open in Gmail
            </a>
            <a className="btn btn-secondary" href={outlook} target="_blank" rel="noreferrer" onClick={opened} title="Opens a pre-filled Outlook web compose window">
              Outlook
            </a>
            <a className="btn btn-ghost" href={mailto} onClick={opened} title="Uses your default desktop mail app, if one is set up">
              Mail app
            </a>
            <button
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
                setNote("Copied");
                setTimeout(() => setNote(""), 2000);
              }}
            >
              Copy
            </button>
            <button className="btn btn-secondary" disabled={pending} onClick={() => changeStatus("sent", "Marked as sent")}>
              Mark sent
            </button>
            <button className="btn btn-ghost ml-auto" disabled={pending} onClick={() => changeStatus("discarded", "Discarded")}>
              Discard
            </button>
          </>
        )}
        {(draft.status === "sent" || draft.status === "discarded") && (
          <button className="btn btn-ghost" disabled={pending} onClick={() => changeStatus("draft", "Moved back to review")}>
            ↺ Move back to review
          </button>
        )}
        {note && <span className="text-xs font-medium text-emerald-700">{note}</span>}
      </div>
    </article>
  );
}
