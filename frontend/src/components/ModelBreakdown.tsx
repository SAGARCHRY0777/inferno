import { AnimatePresence, motion } from "framer-motion";

import { useStore } from "@/store/useStore";

/** Per-model live breakdown: req/s, p50/p99, errors, avg batch. */
export function ModelBreakdown() {
  // Note: the `?? []` MUST be outside the selector — returning a fresh array
  // from the selector makes zustand re-render every tick (React error #185).
  const rows = useStore((s) => s.snapshot?.per_model) ?? [];

  return (
    <div className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-eyebrow">Per-model breakdown</span>
        <span className="text-[11px] text-ink-faint tnum">{rows.length} active</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink-faint">awaiting traffic…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-faint">
              <tr>
                {["model", "req/s", "p50", "p99", "avg batch", "err"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((m) => (
                  <motion.tr
                    key={m.model_name}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-t border-hairline"
                  >
                    <td className="px-2 py-1.5 text-ink">{m.model_name}</td>
                    <td className="px-2 py-1.5 tnum text-accent">{m.requests_per_sec.toFixed(1)}</td>
                    <td className="px-2 py-1.5 tnum text-ink-muted">{m.p50_ms.toFixed(0)} ms</td>
                    <td className="px-2 py-1.5 tnum text-warn">{m.p99_ms.toFixed(0)} ms</td>
                    <td className="px-2 py-1.5 tnum text-ink-muted">{m.avg_batch.toFixed(1)}</td>
                    <td className={`px-2 py-1.5 tnum ${m.errors > 0 ? "text-danger" : "text-ink-faint"}`}>
                      {m.errors}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
