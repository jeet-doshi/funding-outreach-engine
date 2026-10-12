// Components Map — how every piece of the system fits together.

const FLOW = [
  { n: "01", title: "Trigger", tech: "Vercel Cron · 6:30 AM IST", body: "Calls /api/cron with a secret bearer token. A manual “Run now” button does the same from the dashboard." },
  { n: "02", title: "Ingest", tech: "RSS · 8 live feeds", body: "Fetches TechCrunch, Crunchbase News, Inc42, YourStory, Tech Funding News and Google News queries in parallel. Keeps items inside the lookback window that look like funding news." },
  { n: "03", title: "Extract", tech: "Gemini Flash · JSON schema", body: "Reads articles in batches of 10 and returns structured facts: company, round, amount (USD), investors, sector, founders. Filters out fund closes, roundups and rumours." },
  { n: "04", title: "Dedupe + rules", tech: "Postgres constraints", body: "Normalised company name + domain match against every startup ever seen and the do-not-contact list. Stage and raise-size rules from the thesis are applied deterministically." },
  { n: "05", title: "Research", tech: "Gemini Flash + native Google Search", body: "Live web research: product, customers, traction, founders, website. Falls back to the announcement text if grounding is unavailable." },
  { n: "06", title: "Score", tech: "Gemini Flash · thesis from Supabase", body: "Scores 0–100 against the active thesis with a per-criterion breakdown. Below the threshold → rejected and hidden from Rohit." },
  { n: "07", title: "Draft", tech: "Gemini Flash", body: "Writes a personalised 110–160 word email referencing the round, investors and product, in the thesis's tone and call to action." },
  { n: "08", title: "Review", tech: "Next.js dashboard", body: "Rohit edits, approves, opens in his mail client, and marks sent. Every action is persisted." },
];

const COMPONENTS: [string, string, string, string][] = [
  ["Scheduler", "Vercel Cron (vercel.json)", "Starts the daily run", "Bearer CRON_SECRET; manual trigger fallback"],
  ["Orchestrator", "src/lib/pipeline/run.ts", "Runs stages in order, records run + stats", "DB unique index = one run at a time; stale-run recovery; time budget → partial run, next run resumes"],
  ["Ingest", "src/lib/pipeline/ingest.ts", "RSS → articles table", "Per-source timeout; one failing feed never stops the run; URL unique → never reprocessed"],
  ["Extractor", "src/lib/pipeline/extract.ts", "Article → structured funding facts", "Strict JSON-schema output (typed); failed batch stays 'new' and retries next run"],
  ["Deduper", "extract.ts + DB constraints", "Guarantees one outreach per startup", "UNIQUE(normalized_name), UNIQUE(domain), UNIQUE(drafts.startup_id), do-not-contact list"],
  ["Researcher", "src/lib/pipeline/research.ts", "Live web research brief", "Grounded search → ungrounded fallback; domain clash = duplicate"],
  ["Scorer", "src/lib/pipeline/score.ts", "Fit score vs thesis", "Thesis loaded from Supabase per run; version stored on every score"],
  ["Drafter", "src/lib/pipeline/draft.ts", "Personalised email", "Only uses provided facts; no placeholders; DB refuses a 2nd draft"],
  ["Gemini client", "src/lib/gemini.ts", "All LLM calls — google/gemini-3.7-flash", "OpenRouter pinned to Google (no fallback); retries 429/5xx with backoff; stops on 402; concurrency cap; AI cost tracked per run"],
  ["Database", "Supabase Postgres (supabase/schema.sql)", "thesis, sources, articles, startups, drafts, runs, events, do_not_contact", "RLS on, no public policies — only the server (service role) can read/write"],
  ["Dashboard", "Next.js App Router + Server Actions", "Drafts inbox, runs log, thesis editor, sources", "Optional password gate (proxy.ts)"],
];

const STATES = ["new", "researched", "fit", "drafted"];

export default function HowItWorks() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How it works — Components Map</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          From a funding announcement going public to a personalised draft in Rohit&apos;s inbox, with no manual step in between. Startups that
          don&apos;t fit are filtered out before he ever sees them, and no startup is ever drafted twice.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW.map((f, i) => (
          <div key={f.n} className="card relative p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-stone-400">{f.n}</span>
              {i < FLOW.length - 1 && <span className="text-stone-300">→</span>}
            </div>
            <h3 className="mt-1 font-semibold">{f.title}</h3>
            <div className="mt-0.5 text-xs font-medium text-violet-700">{f.tech}</div>
            <p className="mt-2 text-sm text-stone-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Architecture</h2>
        <svg viewBox="0 0 900 300" className="mt-4 w-full" role="img" aria-label="Architecture diagram">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#78716c" />
            </marker>
          </defs>
          {[
            { x: 10, y: 30, w: 150, h: 70, t: "Live news", s: "8 RSS feeds", c: "#e0f2fe" },
            { x: 10, y: 190, w: 150, h: 70, t: "Vercel Cron", s: "daily 6:30 IST", c: "#f5f5f4" },
            { x: 230, y: 100, w: 200, h: 100, t: "Pipeline (Vercel fn)", s: "ingest → extract → dedupe → research → score → draft", c: "#ede9fe" },
            { x: 500, y: 20, w: 170, h: 70, t: "Gemini Flash", s: "JSON + Search grounding", c: "#fef3c7" },
            { x: 500, y: 210, w: 170, h: 70, t: "Supabase", s: "Postgres + constraints", c: "#d1fae5" },
            { x: 740, y: 110, w: 150, h: 80, t: "Dashboard", s: "Rohit reviews & sends", c: "#fce7f3" },
          ].map((b) => (
            <g key={b.t}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="12" fill={b.c} stroke="#d6d3d1" />
              <text x={b.x + b.w / 2} y={b.y + b.h / 2 - 4} textAnchor="middle" fontSize="15" fontWeight="600" fill="#1c1917">{b.t}</text>
              <foreignObject x={b.x + 6} y={b.y + b.h / 2 + 2} width={b.w - 12} height={b.h / 2}>
                <div style={{ fontSize: 11, color: "#57534e", textAlign: "center", lineHeight: 1.25 }}>{b.s}</div>
              </foreignObject>
            </g>
          ))}
          <g stroke="#78716c" strokeWidth="1.5" fill="none" markerEnd="url(#arr)">
            <path d="M160 65 C200 65 200 130 228 130" />
            <path d="M160 225 C200 225 200 170 228 170" />
            <path d="M430 125 C470 125 470 55 498 55" />
            <path d="M498 70 C470 70 465 140 432 140" strokeDasharray="4 3" />
            <path d="M430 175 C470 175 470 245 498 245" />
            <path d="M670 245 C710 245 710 170 738 170" />
            <path d="M738 135 C710 135 705 230 672 230" strokeDasharray="4 3" />
          </g>
          <text x="385" y="70" fontSize="11" fill="#78716c">prompts → JSON</text>
          <text x="300" y="250" fontSize="11" fill="#78716c">read thesis · write state</text>
          <text x="745" y="255" fontSize="11" fill="#78716c">edits</text>
        </svg>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">Component</th>
              <th className="px-4 py-3 font-medium">Where</th>
              <th className="px-4 py-3 font-medium">Responsibility</th>
              <th className="px-4 py-3 font-medium">Reliability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {COMPONENTS.map(([c, w, r, rel]) => (
              <tr key={c}>
                <td className="px-4 py-3 font-medium">{c}</td>
                <td className="px-4 py-3 font-mono text-xs text-stone-600">{w}</td>
                <td className="px-4 py-3 text-stone-700">{r}</td>
                <td className="px-4 py-3 text-stone-600">{rel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-sm font-semibold">Startup state machine</h2>
          <p className="mt-1 text-xs text-stone-500">Each stage reads work from the database by status, so an interrupted run resumes exactly where it stopped.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {STATES.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-md bg-stone-100 px-2 py-1 font-mono text-xs">{s}</span>
                {i < STATES.length - 1 && <span className="text-stone-400">→</span>}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
            <span className="rounded-md bg-red-50 px-2 py-1 font-mono text-red-700">rejected</span> below threshold / rule failed ·
            <span className="rounded-md bg-red-50 px-2 py-1 font-mono text-red-700">error</span> failed 3× (retryable from Runs)
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold">Key trade-offs</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-stone-600">
            <li>RSS + Google News over paid APIs (Crunchbase): free and live, at the cost of messier text — solved with LLM extraction.</li>
            <li>Cheap keyword gate before Gemini: cuts LLM calls on irrelevant news.</li>
            <li>Hard rules (stage, raise size) are deterministic; nuanced fit is LLM-scored with a breakdown for auditability.</li>
            <li>Drafts, not auto-send: Rohit stays in control of what goes out.</li>
            <li>Dedupe enforced by database constraints, not just app logic, so overlapping runs can&apos;t double-draft.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
