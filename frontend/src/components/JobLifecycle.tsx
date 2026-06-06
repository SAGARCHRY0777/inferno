import { motion } from "framer-motion";

import type { JobPhase } from "@/types";

const STEPS: { key: JobPhase; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "batched", label: "Batched" },
  { key: "running", label: "Running" },
  { key: "done", label: "Done" },
];

const ORDER: JobPhase[] = ["queued", "batched", "running", "done"];

function indexOfPhase(phase: JobPhase): number {
  if (phase === "error" || phase === "timeout") return 3;
  return ORDER.indexOf(phase);
}

/** A horizontal stepper that fills as a job advances, with a spring on success. */
export function JobLifecycle({ phase }: { phase: JobPhase }) {
  const active = indexOfPhase(phase);
  const failed = phase === "error" || phase === "timeout";

  return (
    <div className="flex items-center gap-2" role="status" aria-label={`Job ${phase}`}>
      {STEPS.map((step, i) => {
        const reached = i <= active;
        const isDoneStep = i === 3;
        const color = failed && isDoneStep ? "bg-danger" : reached ? "bg-accent" : "bg-surface-hover";
        return (
          <div key={step.key} className="flex flex-1 items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <motion.span
                className={`h-2.5 w-2.5 rounded-full ${color}`}
                initial={false}
                animate={
                  isDoneStep && reached && !failed
                    ? { scale: [1, 1.6, 1] }
                    : { scale: reached ? 1 : 0.8 }
                }
                transition={{ type: "spring", stiffness: 360, damping: 18 }}
              />
              <span
                className={`text-[10px] uppercase tracking-wider ${
                  reached ? "text-ink" : "text-ink-faint"
                }`}
              >
                {failed && isDoneStep ? (phase === "timeout" ? "Timeout" : "Error") : step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="relative -mt-4 h-px flex-1 bg-surface-hover">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-accent"
                  initial={{ width: "0%" }}
                  animate={{ width: i < active ? "100%" : "0%" }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
