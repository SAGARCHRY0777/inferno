import { motion } from "framer-motion";

import { useStressTest } from "@/hooks/useStressTest";

const PRESETS = [25, 100, 500];

/** Compact horizontal load generator — sits atop the dashboard it drives. */
export function StressTest() {
  const { running, sent, total, run, stop } = useStressTest("dummy-echo");
  const pct = total ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <span className="label-eyebrow shrink-0">Stress test</span>
      <div className="flex items-center gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            disabled={running}
            onClick={() => run(n)}
            data-cursor="hover"
            className="focusable rounded-lg border border-hairline bg-surface/50 px-3 py-1 text-xs font-medium text-ink transition hover:border-accent/50 hover:bg-surface-hover disabled:opacity-40"
          >
            ×{n}
          </button>
        ))}
        {running && (
          <button
            onClick={stop}
            className="focusable rounded-lg border border-danger/50 bg-danger/10 px-3 py-1 text-xs text-danger"
          >
            stop
          </button>
        )}
      </div>
      {running ? (
        <div className="flex min-w-[160px] flex-1 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${pct}%` }}
              transition={{ ease: "linear" }}
            />
          </div>
          <span className="tnum shrink-0 text-[11px] text-ink-muted">
            {sent}/{total}
          </span>
        </div>
      ) : (
        <span className="ml-auto text-[11px] text-ink-faint">watch batches climb →</span>
      )}
    </div>
  );
}
