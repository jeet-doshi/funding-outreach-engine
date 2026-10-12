import "server-only";
import { env } from "./env";

// Thin client over the Gemini REST API (generateContent).
// - Structured JSON output via responseSchema (no fragile regex parsing).
// - Google Search grounding for the research step.
// - Retries with exponential backoff on 429 / 5xx, honouring the server's retryDelay.
// - A process-wide concurrency cap so a run never bursts past the rate limit.

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ATTEMPTS = 4;
const MAX_CONCURRENT = Number(process.env.GEMINI_CONCURRENCY || 3);

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

type Part = { text?: string };
type GeminiResponse = {
  candidates?: {
    content?: { parts?: Part[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { totalTokenCount?: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(body: string, attempt: number): number {
  // Gemini 429 bodies include RetryInfo: { retryDelay: "17s" }
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  const server = m ? Number(m[1]) * 1000 : 0;
  const backoff = 2 ** attempt * 1000 + Math.random() * 500;
  return Math.min(Math.max(server, backoff), 30_000);
}

async function call(body: object): Promise<GeminiResponse> {
  const url = `${API}/${env.geminiModel()}:generateContent`;
  await acquire();
  try {
    let lastErr: GeminiError | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey() },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        lastErr = new GeminiError(`Network error calling Gemini: ${(e as Error).message}`);
        await sleep(retryDelayMs("", attempt));
        continue;
      }
      if (res.ok) return (await res.json()) as GeminiResponse;

      const text = await res.text();
      lastErr = new GeminiError(`Gemini ${res.status}: ${text.slice(0, 300)}`, res.status);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw lastErr;
      await sleep(retryDelayMs(text, attempt));
    }
    throw lastErr ?? new GeminiError("Gemini call failed");
  } finally {
    release();
  }
}

function textOf(r: GeminiResponse): string {
  if (r.promptFeedback?.blockReason) throw new GeminiError(`Blocked: ${r.promptFeedback.blockReason}`);
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  if (!text) throw new GeminiError(`Empty response (finishReason=${r.candidates?.[0]?.finishReason})`);
  return text;
}

/** Ask Gemini for JSON that conforms to `schema` (OpenAPI-subset schema). */
export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: object;
  temperature?: number;
}): Promise<T> {
  const res = await call({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
    },
  });
  const text = textOf(res);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

/** Free-text answer grounded in live Google Search results. */
export async function generateGrounded(opts: {
  system: string;
  prompt: string;
}): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
  const res = await call({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  });
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c) => ({ title: c.web?.title ?? "", uri: c.web?.uri ?? "" }))
    .filter((s) => s.uri)
    .slice(0, 6);
  return { text: textOf(res), sources };
}

/** Pull the first JSON object out of free text (grounded responses can't use responseSchema). */
export function extractJsonObject<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
