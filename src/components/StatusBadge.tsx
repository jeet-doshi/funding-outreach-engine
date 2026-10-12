const STYLES: Record<string, string> = {
  running: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  partial: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  failed: "bg-red-50 text-red-700 ring-1 ring-red-200",
  draft: "bg-stone-100 text-stone-700",
  approved: "bg-blue-50 text-blue-700",
  sent: "bg-emerald-50 text-emerald-700",
  discarded: "bg-stone-100 text-stone-400 line-through",
  info: "bg-stone-100 text-stone-600",
  warn: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STYLES[status] ?? "bg-stone-100 text-stone-600"}`}>{status}</span>;
}
