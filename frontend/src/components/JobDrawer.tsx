import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

import { fmtMs } from "@/lib/format";
import { useStore } from "@/store/useStore";
import { ConfidenceBars } from "./ConfidenceBars";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-2 text-xs">
      <span className="text-ink-faint">{k}</span>
      <span className="tnum truncate text-ink">{v}</span>
    </div>
  );
}

/** Slide-in panel with the full record for a clicked job. */
export function JobDrawer() {
  const id = useStore((s) => s.selectedJobId);
  const close = useStore((s) => s.setSelectedJob);
  const job = useStore((s) => s.jobs.find((j) => j.jobId === id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const t = job?.result?.timings;

  return (
    <AnimatePresence>
      {job && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => close(null)}
          />
          <motion.aside
            className="glass-raised fixed right-0 top-0 z-[81] flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-6"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Inference detail</h3>
              <button
                onClick={() => close(null)}
                className="focusable rounded-lg border border-hairline px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover"
              >
                Esc ✕
              </button>
            </div>

            <div
              className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs ${
                job.result?.status === "error"
                  ? "bg-danger/10 text-danger"
                  : "bg-ok/10 text-ok"
              }`}
            >
              ● {job.result?.status ?? job.phase}
            </div>

            {job.result && job.result.predictions.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="label-eyebrow">Predictions</span>
                <ConfidenceBars predictions={job.result.predictions} />
              </div>
            )}

            {job.result?.error && <p className="text-xs text-danger">{job.result.error}</p>}

            <div className="flex flex-col">
              <Row k="job id" v={job.jobId} />
              <Row k="model" v={job.modelName} />
              <Row k="input type" v={job.inputType} />
              <Row k="input" v={job.preview || "—"} />
              <Row k="batch size" v={job.result ? `×${job.result.batch_size}` : "—"} />
              <Row k="worker" v={job.result?.worker_id ?? "—"} />
            </div>

            {t && (
              <div className="flex flex-col gap-2">
                <span className="label-eyebrow">Timing breakdown</span>
                {(
                  [
                    ["queue", t.queue_ms],
                    ["batch wait", t.batch_wait_ms],
                    ["inference", t.inference_ms],
                    ["total", t.total_ms],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-ink-muted">{label}</span>
                      <span className="tnum text-ink">{fmtMs(v)}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.min(100, (v / (t.total_ms || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
