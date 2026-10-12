export type Thesis = {
  id: string;
  version: number;
  is_active: boolean;
  accelerator_name: string;
  accelerator_pitch: string;
  sender_name: string;
  sender_title: string;
  thesis_text: string;
  target_stages: string[];
  target_sectors: string[];
  excluded_sectors: string[];
  target_geographies: string[];
  min_raise_usd: number | null;
  max_raise_usd: number | null;
  fit_threshold: number;
  email_tone: string;
  call_to_action: string;
  lookback_hours: number;
  created_at: string;
};

export type Founder = { name: string; role?: string | null; background?: string | null };

export type Research = {
  summary: string;
  product?: string | null;
  customers?: string | null;
  traction?: string | null;
  founders?: Founder[];
  website?: string | null;
  headquarters?: string | null;
  grounded: boolean;
  sources: { title: string; uri: string }[];
};

export type FitReasons = {
  verdict: "strong_fit" | "possible_fit" | "not_a_fit";
  criteria: { criterion: string; assessment: string; score: number }[];
  reasons: string[];
  concerns: string[];
  personalization_hooks: string[];
};

export type StartupStatus = "new" | "researched" | "rejected" | "fit" | "drafted" | "error";

export type Startup = {
  id: string;
  name: string;
  normalized_name: string;
  domain: string | null;
  website: string | null;
  description: string | null;
  sector: string | null;
  location: string | null;
  round_type: string | null;
  amount_usd: number | null;
  amount_text: string | null;
  investors: string[];
  founders: Founder[];
  announced_at: string | null;
  discovered_at: string;
  source_urls: string[];
  research: Research | null;
  status: StartupStatus;
  fit_score: number | null;
  fit_reasons: FitReasons | null;
  rejection_reason: string | null;
  scored_thesis_version: number | null;
  attempts: number;
  last_error: string | null;
  updated_at: string;
};

export type DraftStatus = "draft" | "approved" | "sent" | "discarded";

export type Draft = {
  id: string;
  startup_id: string;
  subject: string;
  body: string;
  personalization: { points: string[] } | null;
  status: DraftStatus;
  thesis_version: number | null;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  updated_at: string;
};

export type PipelineRun = {
  id: string;
  trigger: "cron" | "manual";
  status: "running" | "completed" | "partial" | "failed";
  thesis_version: number | null;
  stats: Record<string, number>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type RunEvent = {
  id: number;
  run_id: string;
  stage: string;
  level: "info" | "warn" | "error";
  message: string;
  data: unknown;
  created_at: string;
};

export type Source = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  last_fetched_at: string | null;
  last_status: string | null;
  last_item_count: number | null;
};
