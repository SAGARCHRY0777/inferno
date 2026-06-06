import { motion } from "framer-motion";
import { useEffect } from "react";

import { ActivityDrawer } from "@/components/ActivityDrawer";
import { ChatModal } from "@/components/ChatModal";
import { CommandPalette } from "@/components/CommandPalette";
import { Dashboard } from "@/components/Dashboard";
import { FleetMap } from "@/components/FleetMap";
import { Header } from "@/components/Header";
import { HistoryModal } from "@/components/HistoryModal";
import { JobDrawer } from "@/components/JobDrawer";
import { SubmitPanel } from "@/components/SubmitPanel";
import { Toaster } from "@/components/Toaster";
import { Aurora } from "@/components/fx/Aurora";
import { CustomCursor } from "@/components/fx/CustomCursor";
import { Grain } from "@/components/fx/Grain";
import { Marquee } from "@/components/fx/Marquee";
import { endpoints } from "@/config";
import { useMetricsStream } from "@/hooks/useMetricsStream";
import { useStore } from "@/store/useStore";
import { THEMES } from "@/theme/themes";
import type { HistoryRecord, ModelInfo, TrackedJob } from "@/types";

// Orchestrated staggered entrance for a designed first impression.
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export default function App() {
  const setModels = useStore((s) => s.setModels);
  const loadHistory = useStore((s) => s.loadHistory);
  const pushToast = useStore((s) => s.pushToast);
  useMetricsStream();

  useEffect(() => {
    fetch(endpoints.models)
      .then((r) => r.json())
      .then((m: ModelInfo[]) => setModels(m))
      .catch(() => pushToast("error", "Couldn't load models — is the gateway up?"));

    fetch(endpoints.history(40))
      .then((r) => r.json())
      .then((records: HistoryRecord[]) => {
        const jobs: TrackedJob[] = records.map((rec) => ({
          jobId: rec.job_id,
          modelName: rec.model_name,
          inputType: rec.input_type,
          preview: rec.input_preview,
          phase: rec.status === "success" ? "done" : "error",
          submittedAt: rec.timestamp * 1000,
          result: {
            job_id: rec.job_id,
            model_name: rec.model_name,
            status: rec.status,
            predictions: rec.predictions,
            error: rec.error,
            timings: rec.timings,
            batch_size: rec.batch_size,
            worker_id: rec.worker_id,
          },
        }));
        loadHistory(jobs);
      })
      .catch(() => undefined);
  }, [setModels, loadHistory, pushToast]);

  return (
    <>
      <Aurora />
      <Grain />
      <CustomCursor />
      <JobDrawer />
      <ActivityDrawer />
      <HistoryModal />
      <FleetMap />
      <ChatModal />
      <CommandPalette />
      <Toaster />

      {/* Fixed app-shell on desktop: the page is exactly the viewport height and
          each column scrolls internally, so a result appearing in the submit
          panel NEVER changes the page's dimensions. On mobile it's a normal
          scrolling page. */}
      <div className="mx-auto flex w-full max-w-[1560px] flex-col px-4 py-5 sm:px-6 sm:py-7 max-lg:min-h-screen lg:h-screen lg:overflow-hidden">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex min-h-0 flex-1 flex-col gap-5 sm:gap-6"
        >
          <motion.div variants={item} className="shrink-0">
            <Header />
          </motion.div>

          <motion.div variants={item} className="shrink-0">
            <Marquee />
          </motion.div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* Left rail: scrolls internally; its content never resizes the page. */}
            <motion.aside
              variants={item}
              className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1.5"
            >
              <SubmitPanel />
            </motion.aside>

            {/* Main: the live operations dashboard, scrolls internally. */}
            <motion.main variants={item} className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1.5">
              <Dashboard />
            </motion.main>
          </div>

          <motion.footer
            variants={item}
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4 text-[11px] text-ink-faint"
          >
            <span>
              Inferno · distributed ML inference · dynamic batching · backpressure · WebSocket delivery
            </span>
            <span className="tnum">{THEMES.length} themes · 60fps · responsive</span>
          </motion.footer>
        </motion.div>
      </div>
    </>
  );
}
