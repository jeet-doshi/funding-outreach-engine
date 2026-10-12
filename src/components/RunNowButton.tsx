"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunNowButton({ className = "btn btn-primary" }: { className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function start() {
    setState("starting");
    setMsg("");
    const res = await fetch("/api/run", { method: "POST" });
    if (res.status === 202 || res.status === 409) {
      if (res.status === 409) setMsg("A run is already in progress");
      // Give the run a moment to register before showing the runs page.
      setTimeout(() => {
        router.push("/runs");
        router.refresh();
        setState("idle");
      }, 1500);
    } else {
      setState("error");
      setMsg((await res.json().catch(() => ({}))).error ?? "Could not start run");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={start} disabled={state === "starting"} className={className}>
        {state === "starting" ? "Starting…" : "▶ Run pipeline now"}
      </button>
      {msg && <span className={`text-xs ${state === "error" ? "text-red-600" : "text-stone-500"}`}>{msg}</span>}
    </div>
  );
}
