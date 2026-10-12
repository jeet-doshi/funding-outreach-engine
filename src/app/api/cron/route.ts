import { NextResponse, type NextRequest } from "next/server";
import { runPipeline, RunInProgressError } from "@/lib/pipeline/run";
import { env } from "@/lib/env";

// Vercel Cron calls this every morning (see vercel.json).
// Vercel sends "Authorization: Bearer $CRON_SECRET" automatically.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = env.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runPipeline("cron");
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof RunInProgressError ? 409 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
