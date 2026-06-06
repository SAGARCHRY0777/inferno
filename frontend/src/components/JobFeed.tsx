import { AnimatePresence, motion } from "framer-motion";

import { fmtMs, shortId } from "@/lib/format";
import { useStore } from "@/store/useStore";
import type { TrackedJob } from "@/types";

function StatusDot({ job }: { job: TrackedJob }) {
  const color =
    job.phase === "done"
      ? "bg-ok"
      : job.phase === "error" || job.phase === "timeout"
        ? "bg-danger"
        : "bg-accent";
  const live = job.phase !== "done" && job.phase !== "error" && job.phase !== "timeout";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {live && <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-60 animate-pulseRing`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

export function JobFeed() {
  const jobs = useStore((s) => s.jobs);
  const setSelectedJob = useStore((s) => s.setSelectedJob);

  return (
    <div className="glass flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-eyebrow">Recent jobs</span>
        <span className="text-[11px] text-ink-faint tnum">{jobs.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {jobs.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            no jobs yet — submit one →
          </div>
        )}
        <AnimatePresence initial={false}>
          {jobs.map((job) => (
            <motion.div
              key={job.jobId}
              layout
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              onClick={() => setSelectedJob(job.jobId)}
              data-cursor="hover"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-hairline bg-surface-raised/50 px-3 py-2 transition hover:border-accent/40 hover:bg-surface-hover"
            >
              <StatusDot job={job} />
              <span className="tnum text-xs text-ink-muted">{shortId(job.jobId)}</span>
              <span className="truncate text-xs text-ink">{job.modelName}</span>
              <div className="ml-auto flex items-center gap-3 text-xs">
                {job.result?.cached ? (
                  <span className="rounded bg-ok/15 px-1.5 py-0.5 text-ok">⚡</span>
                ) : (
                  job.result && (
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 tnum text-accent">
                      ×{job.result.batch_size}
                    </span>
                  )
                )}
                <span className="tnum text-ink-muted">
                  {job.result ? fmtMs(job.result.timings.total_ms) : job.phase}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
