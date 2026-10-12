-- Timed Funding Outreach Engine — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run. It is idempotent (safe to re-run).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. THESIS — the accelerator's investment thesis. Edited by Rohit, read by
--    every pipeline run. Exactly one row is active; each save is a new version
--    so every score can be traced to the thesis that produced it.
-- ---------------------------------------------------------------------------
create table if not exists thesis (
  id                  uuid primary key default gen_random_uuid(),
  version             int not null,
  is_active           boolean not null default false,
  accelerator_name    text not null,
  accelerator_pitch   text not null,           -- what the program offers
  sender_name         text not null,
  sender_title        text not null,
  thesis_text         text not null,           -- free-text: what a great fit looks like
  target_stages       text[] not null default '{pre-seed,seed}',
  target_sectors      text[] not null default '{}',
  excluded_sectors    text[] not null default '{}',
  target_geographies  text[] not null default '{}', -- empty = anywhere
  min_raise_usd       numeric,                 -- null = no lower bound
  max_raise_usd       numeric,                 -- null = no upper bound
  fit_threshold       int not null default 65 check (fit_threshold between 0 and 100),
  email_tone          text not null default 'warm, concise, founder-to-founder',
  call_to_action      text not null default 'a 20-minute call next week',
  lookback_hours      int not null default 24 check (lookback_hours between 1 and 168),
  created_at          timestamptz not null default now()
);
create unique index if not exists thesis_one_active on thesis (is_active) where is_active;
create unique index if not exists thesis_version_uq on thesis (version);

-- ---------------------------------------------------------------------------
-- 2. SOURCES — live news feeds to monitor (add/disable without code changes)
-- ---------------------------------------------------------------------------
create table if not exists sources (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  url              text not null,
  enabled          boolean not null default true,
  last_fetched_at  timestamptz,
  last_status      text,
  last_item_count  int,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. PIPELINE RUNS + EVENTS — observability for every run
-- ---------------------------------------------------------------------------
create table if not exists pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  trigger         text not null check (trigger in ('cron','manual')),
  status          text not null default 'running' check (status in ('running','completed','partial','failed')),
  thesis_version  int,
  stats           jsonb not null default '{}'::jsonb,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
-- Atomic lock: the database itself allows only ONE run in 'running' state.
create unique index if not exists pipeline_runs_one_running on pipeline_runs ((true)) where status = 'running';

create table if not exists run_events (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references pipeline_runs(id) on delete cascade,
  stage       text not null,
  level       text not null default 'info' check (level in ('info','warn','error')),
  message     text not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists run_events_run_idx on run_events (run_id, id);

-- ---------------------------------------------------------------------------
-- 4. ARTICLES — every news item seen. URL is unique, so an article is only
--    ever processed once, even across runs.
-- ---------------------------------------------------------------------------
create table if not exists articles (
  id            uuid primary key default gen_random_uuid(),
  url           text not null unique,
  title         text not null,
  summary       text,
  source_name   text not null,
  published_at  timestamptz,
  run_id        uuid references pipeline_runs(id) on delete set null,
  status        text not null default 'new'
                check (status in ('new','not_funding','out_of_scope','linked','duplicate','error')),
  extraction    jsonb,
  startup_id    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists articles_status_idx on articles (status);

-- ---------------------------------------------------------------------------
-- 5. STARTUPS — one row per company (normalized name is unique = dedupe key).
--    status is a small state machine so an interrupted run resumes cleanly:
--    new → researched → (rejected | fit) → drafted
-- ---------------------------------------------------------------------------
create table if not exists startups (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  normalized_name        text not null unique,
  domain                 text,
  website                text,
  description            text,
  sector                 text,
  location               text,
  round_type             text,
  amount_usd             numeric,
  amount_text            text,
  investors              text[] not null default '{}',
  founders               jsonb not null default '[]'::jsonb,
  announced_at           timestamptz,
  discovered_at          timestamptz not null default now(),
  source_urls            text[] not null default '{}',
  research               jsonb,
  status                 text not null default 'new'
                         check (status in ('new','researched','rejected','fit','drafted','error')),
  fit_score              int,
  fit_reasons            jsonb,
  rejection_reason       text,
  scored_thesis_version  int,
  attempts               int not null default 0,
  last_error             text,
  updated_at             timestamptz not null default now()
);
create index if not exists startups_status_idx on startups (status);
create unique index if not exists startups_domain_uq on startups (domain) where domain is not null;

alter table articles drop constraint if exists articles_startup_fk;
alter table articles add constraint articles_startup_fk
  foreign key (startup_id) references startups(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6. DRAFTS — the outreach emails. UNIQUE(startup_id) is the database-level
--    guarantee that a startup can never get two outreach emails.
-- ---------------------------------------------------------------------------
create table if not exists drafts (
  id               uuid primary key default gen_random_uuid(),
  startup_id       uuid not null unique references startups(id) on delete cascade,
  subject          text not null,
  body             text not null,
  personalization  jsonb,
  status           text not null default 'draft'
                   check (status in ('draft','approved','sent','discarded')),
  thesis_version   int,
  created_at       timestamptz not null default now(),
  approved_at      timestamptz,
  sent_at          timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists drafts_status_idx on drafts (status);

-- ---------------------------------------------------------------------------
-- 7. DO-NOT-CONTACT — companies Rohit already reached outside this system
-- ---------------------------------------------------------------------------
create table if not exists do_not_contact (
  id               uuid primary key default gen_random_uuid(),
  company_name     text not null,
  normalized_name  text not null unique,
  domain           text,
  reason           text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security: the browser never talks to Supabase directly; all
-- access goes through server routes using the service-role key. Enabling RLS
-- with no policies blocks the public anon key entirely.
-- ---------------------------------------------------------------------------
alter table thesis          enable row level security;
alter table sources         enable row level security;
alter table pipeline_runs   enable row level security;
alter table run_events      enable row level security;
alter table articles        enable row level security;
alter table startups        enable row level security;
alter table drafts          enable row level security;
alter table do_not_contact  enable row level security;

-- ---------------------------------------------------------------------------
-- SEED DATA
-- ---------------------------------------------------------------------------
insert into thesis (version, is_active, accelerator_name, accelerator_pitch, sender_name, sender_title,
                    thesis_text, target_stages, target_sectors, excluded_sectors, target_geographies,
                    min_raise_usd, max_raise_usd, fit_threshold)
select 1, true,
  'Launchpad Ventures Accelerator',
  '12-week program for post-seed founders: $150K uncapped SAFE, 1:1 mentoring from operators who scaled B2B companies past $10M ARR, GTM sprints, and a demo day with 200+ Series A investors.',
  'Rohit', 'Head of Program Recruitment',
  'We back technical founding teams building B2B software, AI infrastructure, developer tools, fintech and climate tech. We like companies that have a clear wedge, early evidence of demand (pilots, design partners, revenue) and that just raised a pre-seed or seed round so they have runway to make the most of 12 weeks. We avoid pure consumer social apps, crypto tokens, gambling and companies that have already raised a Series A.',
  '{pre-seed,seed}',
  '{B2B SaaS,AI/ML,Developer Tools,Fintech,Climate Tech,Healthtech}',
  '{Crypto/Web3 tokens,Gambling,Adult content}',
  '{}',
  null, 15000000, 65
where not exists (select 1 from thesis);

insert into sources (name, url) values
  ('TechCrunch Venture',       'https://techcrunch.com/category/venture/feed/'),
  ('Crunchbase News',          'https://news.crunchbase.com/feed/'),
  ('Tech Funding News',        'https://techfundingnews.com/feed/'),
  ('Inc42',                    'https://inc42.com/feed/'),
  ('YourStory',                'https://yourstory.com/feed'),
  ('Google News: seed rounds', 'https://news.google.com/rss/search?q=%22seed+round%22+OR+%22seed+funding%22+when:1d&hl=en-US&gl=US&ceid=US:en'),
  ('Google News: pre-seed',    'https://news.google.com/rss/search?q=%22pre-seed%22+raises+when:1d&hl=en-US&gl=US&ceid=US:en'),
  ('Google News: startup raises seed', 'https://news.google.com/rss/search?q=startup+raises+seed+when:1d&hl=en-US&gl=US&ceid=US:en')
on conflict (name) do nothing;
