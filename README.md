# Timed Funding Outreach Engine

Every morning, this system turns **yesterday's seed and pre-seed funding announcements** into **researched, fit-scored, personalised outreach drafts** for an accelerator's recruitment lead (Rohit). Startups that don't fit the accelerator's thesis are filtered out before he sees them. No startup is ever drafted twice.

**Live:** https://funding-outreach-engine-chi.vercel.app · **Components Map:** [COMPONENTS_MAP.md](COMPONENTS_MAP.md)

**Stack:** Next.js 16 (App Router, Server Actions) on Vercel · Vercel Cron · Supabase Postgres · Gemini Flash `google/gemini-3.7-flash` via OpenRouter, pinned to Google infrastructure (structured JSON output + native Google Search grounding) · live RSS / Google News feeds.

---

## What happens in a run

| # | Stage | What it does | Code |
|---|-------|--------------|------|
| 0 | Trigger | Vercel Cron calls `/api/cron` daily at 01:00 UTC (6:30 AM IST). It is authenticated with `CRON_SECRET`. The **Run pipeline now** button calls `/api/run`. | `vercel.json`, `src/app/api/*` |
| 1 | Ingest | Fetches every enabled RSS source in parallel with a 15-second timeout per feed. Keeps items inside the thesis lookback window (default 24h) that pass a cheap funding-keyword check. Stores them in `articles`. `UNIQUE(url)` means an article is never processed twice. | `pipeline/ingest.ts` |
| 2 | Extract | Gemini reads articles in batches of 10 and returns typed JSON (`responseSchema`) with company, round, amount in USD, investors, sector, founders and website. Fund closes, roundups and rumours are rejected. | `pipeline/extract.ts` |
| 3 | Dedupe + rules | Matches the normalised company name or domain against every startup ever seen and against the do-not-contact list. Then applies the thesis's hard rules deterministically: target stages and min/max raise. | `pipeline/extract.ts`, `lib/normalize.ts` |
| 4 | Research | Gemini with **Google Search grounding** writes a brief covering product, customers, traction, founders and website, with source links. If grounding fails, it falls back to the announcement text only. | `pipeline/research.ts` |
| 5 | Score | Loads the **active thesis from Supabase** and scores the startup 0–100 with a per-criterion breakdown, concerns and personalisation hooks. Startups below `fit_threshold` are marked rejected and hidden. | `pipeline/score.ts` |
| 6 | Draft | Writes a 110–160 word email that references the round, the investors and the product, in the thesis's tone and call to action. | `pipeline/draft.ts` |
| 7 | Review | In the dashboard Rohit can edit, approve, open the email in his mail client, copy it, mark it sent or discard it. | `src/app/page.tsx` |

## Reliability design

- **Duplicate outreach is impossible at the database level.** The schema has `UNIQUE(startups.normalized_name)`, `UNIQUE(startups.domain)` and `UNIQUE(drafts.startup_id)`, plus a manual `do_not_contact` table. A startup that was rejected, drafted or sent is remembered permanently.
- **Runs are resumable.** Every stage reads its work from the database by status (`new → researched → fit → drafted`) instead of from memory. If a run hits its time budget it is marked `partial`, and the next run continues from where it stopped.
- **Only one run at a time.** A partial unique index (`pipeline_runs WHERE status='running'`) acts as an atomic lock. A run stuck as running for more than 10 minutes is marked failed so it can't block future runs.
- **Failures are isolated.** One broken feed doesn't stop the run. A failed Gemini batch leaves its articles as `new` so they're retried. A startup that fails 3 times is parked as `error` (a dead-letter state) and can be retried from the Runs page.
- **The Gemini client handles rate limits.** It retries 429 and 5xx errors with exponential backoff and respects the server's `retryDelay`. It caps concurrency and times out each call after 60 seconds.
- **Everything is observable.** Every run stores funnel stats and a full event log, shown under *Pipeline runs*.
- **The database is locked down.** RLS is enabled with no policies, so the public anon key can't read anything. Only server code holding the service-role key can access data. A password gate for the dashboard is optional (`DASHBOARD_PASSWORD`).

## The thesis is configurable without code changes

The `thesis` table holds the free-text thesis, target and excluded sectors, stages, geographies, raise bounds, fit threshold, email tone, call to action and lookback window. It is **re-read at the start of every run**. You can edit it on the dashboard's *Thesis* page or directly in Supabase. Each save from the dashboard creates a new version, and every score records the `scored_thesis_version` that produced it.

## Setup

1. **Supabase:** create a project. In the SQL Editor, paste and run `supabase/schema.sql`. It is idempotent, and it seeds a sample thesis and 8 sources.
2. **Environment:** copy `.env.example` to `.env.local` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` and `CRON_SECRET`.
3. **Run locally:** `npm install && npm run dev`, open http://localhost:3000 and click **Run pipeline now**.
4. **Tests:** `npm test` runs the unit tests for normalisation and dedupe logic.
5. **Deploy:** import the repo into Vercel and add the same env vars. The cron job in `vercel.json` registers automatically.

## Trade-offs and limitations

- **Free RSS and Google News instead of paid APIs such as Crunchbase or PitchBook.** The data is live and costs nothing, but it covers less and the text is messier. LLM extraction compensates for the messiness.
- **Drafts, not auto-send.** Rohit stays in control of every email. Founders' email addresses are not guessed, because fabricating contact details is worse than leaving them blank. The *Open in email* button pre-fills the subject and body.
- **Hard rules are deterministic, and fit is judged by the LLM.** Stage and raise size are filtered in code, which is cheap and predictable. The nuanced judgement comes from Gemini, which shows its per-criterion reasoning so it can be audited.
- **Vercel Hobby limits.** Hobby allows only one cron job per day and caps function duration. Each run therefore has a time budget and limits per stage, and the resumable design picks up any overflow on the next run.
