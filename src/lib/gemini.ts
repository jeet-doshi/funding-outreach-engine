import "server-only";
import { env } from "./env";

// Gemini Flash client, accessed through the OpenRouter gateway
// (OpenAI-compatible /chat/completions). Every request is pinned to Google's own
// infrastructure (google-vertex / google-ai-studio) with fallbacks disabled, so
// only Gemini ever serves our AI calls.
// - Structured JSON output via response_format json_schema (strict).
// - Native Google Search grounding for the research step (web plugin, engine=native).
// - Retries with exponential backoff on 429 / 5xx; stops immediately on 402 (out of credits).
// - A process-wide concurrency cap so a run never bursts past the rate limit.

const API = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 4;
const MAX_CONCURRENT = Number(process.env.GEMINI_CONCURRENCY || 8);
const GOOGLE_ONLY = { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false };

let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

export class GeminiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

type ChatResponse = {
  model?: string;
  error?: { message?: string; code?: number };
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      annotations?: { type: string; url_citation?: { url?: string; title?: string } }[];
    };
  }[];
  usage?: { cost?: number; cost_details?: { upstream_inference_cost?: number } };
};

// Running cost of AI calls in this process (shown in run stats).
let spentUsd = 0;
export const aiCost = { reset: () => (spentUsd = 0), get: () => spentUsd };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(2 ** attempt * 1000 + Math.random() * 500, 20_000);

async function call(body: Record<string, unknown>): Promise<ChatResponse> {
  await acquire();
  try {
    let lastErr: GeminiError | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch(API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.openrouterApiKey()}`,
            "X-Title": "Funding Outreach Engine",
          },
          body: JSON.stringify({ model: env.geminiModel(), ...body }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        lastErr = new GeminiError(`Network error calling Gemini: ${(e as Error).message}`);
        await sleep(backoff(attempt));
        continue;
      }
      const text = await res.text();
      if (res.ok) {
        const json = JSON.parse(text) as ChatResponse;
        // OpenRouter can return 200 with an error object (e.g. upstream failure).
        if (json.error) {
          lastErr = new GeminiError(`Gemini error: ${json.error.message}`, json.error.code);
          if (json.error.code && json.error.code < 500 && json.error.code !== 429) throw lastErr;
          await sleep(backoff(attempt));
          continue;
        }
        spentUsd += json.usage?.cost_details?.upstream_inference_cost ?? json.usage?.cost ?? 0;
        return json;
      }
      lastErr = new GeminiError(`Gemini ${res.status}: ${text.slice(0, 300)}`, res.status);
      if (res.status === 402) throw new GeminiError("Out of AI credits (402) — top up OpenRouter", 402);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : backoff(attempt));
    }
    throw lastErr ?? new GeminiError("Gemini call failed");
  } finally {
    release();
  }
}

function contentOf(r: ChatResponse): string {
  const text = r.choices?.[0]?.message?.content ?? "";
  if (!text) throw new GeminiError(`Empty response (finish_reason=${r.choices?.[0]?.finish_reason})`);
  return text;
}

type LooseSchema = {
  type: string;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  properties?: Record<string, LooseSchema>;
  items?: LooseSchema;
  required?: string[];
};

/**
 * Convert our compact schema notation (OBJECT/STRING…, nullable) into the strict
 * JSON Schema that structured outputs require: every property required,
 * additionalProperties false, nullable → ["type","null"].
 */
export function toStrictSchema(s: LooseSchema): Record<string, unknown> {
  const base = s.type.toLowerCase();
  const out: Record<string, unknown> = { type: s.nullable ? [base, "null"] : base };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (base === "object" && s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toStrictSchema(v)]));
    out.required = Object.keys(s.properties);
    out.additionalProperties = false;
  }
  if (base === "array" && s.items) out.items = toStrictSchema(s.items);
  return out;
}

/** Ask Gemini for JSON that conforms to `schema`. */
export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: object;
  temperature?: number;
}): Promise<T> {
  const res = await call({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    temperature: opts.temperature ?? 0.2,
    reasoning: { effort: "low" },
    response_format: {
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema: toStrictSchema(opts.schema as LooseSchema) },
    },
    provider: { ...GOOGLE_ONLY, require_parameters: true },
  });
  const text = contentOf(res);
  try {
    return JSON.parse(text) as T;
  } catch {
    const salvaged = extractJsonObject<T>(text);
    if (salvaged) return salvaged;
    throw new GeminiError(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

/** Free-text answer grounded in live Google Search results. */
export async function generateGrounded(opts: {
  system: string;
  prompt: string;
}): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
  const res = await call({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    temperature: 0.2,
    plugins: [{ id: "web", engine: "native", max_results: 5 }],
    provider: GOOGLE_ONLY,
  });
  const seen = new Set<string>();
  const sources = (res.choices?.[0]?.message?.annotations ?? [])
    .filter((a) => a.type === "url_citation" && a.url_citation?.url)
    .map((a) => ({ title: a.url_citation!.title ?? "", uri: a.url_citation!.url! }))
    .filter((s) => (seen.has(s.uri) ? false : (seen.add(s.uri), true)))
    .slice(0, 6);
  return { text: contentOf(res), sources };
}

/** Pull the first JSON object out of free text (grounded responses can't use a schema). */
export function extractJsonObject<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
