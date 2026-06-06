import { motion } from "framer-motion";

import type { Prediction } from "@/types";

/** Animated confidence bars for a result's top predictions. */
export function ConfidenceBars({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="flex flex-col gap-2">
      {predictions.map((p, i) => (
        <div key={`${p.label}-${i}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="truncate text-ink">{p.label}</span>
            <span className="tnum text-ink-muted">{(p.score * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(p.score * 100)}%` }}
              transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.05 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
