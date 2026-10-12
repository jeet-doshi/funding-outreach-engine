"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { normalizeCompanyName, domainOf } from "@/lib/normalize";
import type { DraftStatus } from "@/lib/types";

// Server Actions — every write from the dashboard goes through here, server-side,
// with the service-role key. The browser never holds database credentials.

export async function saveDraft(id: string, subject: string, body: string) {
  if (!subject.trim() || !body.trim()) return { error: "Subject and body are required" };
  const { error } = await db()
    .from("drafts")
    .update({ subject: subject.trim(), body: body.trim(), updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/");
  return error ? { error: error.message } : { ok: true };
}

export async function setDraftStatus(id: string, status: DraftStatus) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "approved") patch.approved_at = now;
  if (status === "sent") patch.sent_at = now;
  const { error } = await db().from("drafts").update(patch).eq("id", id);
  revalidatePath("/");
  return error ? { error: error.message } : { ok: true };
}

export async function saveThesis(form: FormData) {
  const list = (k: string) =>
    String(form.get(k) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  };

  const row = {
    accelerator_name: String(form.get("accelerator_name") ?? "").trim(),
    accelerator_pitch: String(form.get("accelerator_pitch") ?? "").trim(),
    sender_name: String(form.get("sender_name") ?? "").trim(),
    sender_title: String(form.get("sender_title") ?? "").trim(),
    thesis_text: String(form.get("thesis_text") ?? "").trim(),
    target_stages: list("target_stages").map((s) => s.toLowerCase()),
    target_sectors: list("target_sectors"),
    excluded_sectors: list("excluded_sectors"),
    target_geographies: list("target_geographies"),
    min_raise_usd: num("min_raise_usd"),
    max_raise_usd: num("max_raise_usd"),
    fit_threshold: Number(form.get("fit_threshold") ?? 65),
    email_tone: String(form.get("email_tone") ?? "").trim(),
    call_to_action: String(form.get("call_to_action") ?? "").trim(),
    lookback_hours: Number(form.get("lookback_hours") ?? 24),
  };

  if (!row.accelerator_name || !row.thesis_text || !row.sender_name) return { error: "Name, sender and thesis are required" };
  if (!row.target_stages.length) return { error: "At least one target stage is required" };
  if (!(row.fit_threshold >= 0 && row.fit_threshold <= 100)) return { error: "Threshold must be 0–100" };
  if (!(row.lookback_hours >= 1 && row.lookback_hours <= 168)) return { error: "Lookback must be 1–168 hours" };

  // Versioned: deactivate the current row, insert a new active version.
  const { data: latest } = await db().from("thesis").select("version").order("version", { ascending: false }).limit(1).single();
  const version = (latest?.version ?? 0) + 1;
  const { error: offErr } = await db().from("thesis").update({ is_active: false }).eq("is_active", true);
  if (offErr) return { error: offErr.message };
  const { error } = await db().from("thesis").insert({ ...row, version, is_active: true });
  if (error) {
    // Re-activate the previous version so we are never left without a thesis.
    await db().from("thesis").update({ is_active: true }).eq("version", version - 1);
    return { error: error.message };
  }
  revalidatePath("/thesis");
  return { ok: true, version };
}

export async function activateThesisVersion(version: number) {
  await db().from("thesis").update({ is_active: false }).eq("is_active", true);
  const { error } = await db().from("thesis").update({ is_active: true }).eq("version", version);
  revalidatePath("/thesis");
  return error ? { error: error.message } : { ok: true };
}

export async function toggleSource(id: string, enabled: boolean) {
  await db().from("sources").update({ enabled }).eq("id", id);
  revalidatePath("/sources");
}

export async function addSource(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  if (!name || !/^https?:\/\//.test(url)) return { error: "Name and a valid feed URL are required" };
  const { error } = await db().from("sources").insert({ name, url });
  revalidatePath("/sources");
  return error ? { error: error.message } : { ok: true };
}

export async function deleteSource(id: string) {
  await db().from("sources").delete().eq("id", id);
  revalidatePath("/sources");
}

export async function addDoNotContact(form: FormData) {
  const company = String(form.get("company_name") ?? "").trim();
  if (!company) return { error: "Company name is required" };
  const { error } = await db()
    .from("do_not_contact")
    .upsert(
      {
        company_name: company,
        normalized_name: normalizeCompanyName(company),
        domain: domainOf(String(form.get("domain") ?? "")),
        reason: String(form.get("reason") ?? "").trim() || null,
      },
      { onConflict: "normalized_name" },
    );
  revalidatePath("/sources");
  return error ? { error: error.message } : { ok: true };
}

export async function removeDoNotContact(id: string) {
  await db().from("do_not_contact").delete().eq("id", id);
  revalidatePath("/sources");
}

export async function retryStartup(id: string) {
  // Send a dead-lettered startup back to the start of the pipeline.
  await db().from("startups").update({ status: "new", attempts: 0, last_error: null }).eq("id", id);
  revalidatePath("/runs");
}
