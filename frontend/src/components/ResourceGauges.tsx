import { motion } from "framer-motion";

import { clamp, fmtMb } from "@/lib/format";
import { useStore } from "@/store/useStore";

function Gauge({ label, value, sub, danger = 70 }: { label: string; value: number; sub?: string; danger?: number }) {
  const pct = clamp(value, 0, 100);
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = pct >= 90 ? "#FF4D6D" : pct >= danger ? "#FFB020" : "#00E5FF";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[76px] w-[76px]">
        <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
          <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <motion.circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            animate={{ strokeDashoffset: c - (pct / 100) * c }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tnum text-sm font-semibold" style={{ color }}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <span className="label-eyebrow">{label}</span>
      {sub && <span className="text-[10px] text-ink-faint tnum">{sub}</span>}
    </div>
  );
}

/** CPU/RAM always; GPU gauges only when a device is actually present (guarded). */
export function ResourceGauges() {
  const snapshot = useStore((s) => s.snapshot);
  const gpus = snapshot?.gpus ?? [];

  return (
    <div className="glass flex h-full flex-col p-4">
      <span className="label-eyebrow mb-3">Compute</span>
      <div className="flex flex-wrap items-center justify-around gap-4">
        <Gauge label="CPU" value={snapshot?.cpu_pct ?? 0} />
        <Gauge label="RAM" value={snapshot?.ram_pct ?? 0} />
        {gpus.length === 0 ? (
          <div className="flex flex-col items-center gap-1 opacity-60">
            <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-dashed border-hairline text-[10px] text-ink-faint">
              CPU-only
            </div>
            <span className="label-eyebrow">GPU</span>
          </div>
        ) : (
          gpus.map((g) => (
            <Gauge
              key={g.index}
              label={`GPU ${g.index}`}
              value={g.utilization_pct}
              sub={`${fmtMb(g.vram_used_mb)} / ${fmtMb(g.vram_total_mb)}`}
            />
          ))
        )}
      </div>
      {gpus[0] && (
        <p className="mt-3 truncate text-center text-[11px] text-ink-muted">{gpus[0].name}</p>
      )}
    </div>
  );
}
