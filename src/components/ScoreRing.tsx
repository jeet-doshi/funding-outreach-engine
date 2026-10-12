export function ScoreRing({ score, size = 52 }: { score: number | null; size?: number }) {
  const s = score ?? 0;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = s >= 80 ? "#059669" : s >= 65 ? "#d97706" : "#dc2626";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Fit score ${s}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - s / 100)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{score ?? "–"}</span>
    </div>
  );
}
