import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

import { useStore } from "@/store/useStore";
import { JobFeed } from "./JobFeed";

/** Right slide-over hosting the live Recent Jobs feed (opened from the header). */
export function ActivityDrawer() {
  const open = useStore((s) => s.feedOpen);
  const setOpen = useStore((s) => s.setFeedOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[71] flex h-full w-full max-w-sm flex-col gap-3 p-4 sm:p-5"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Activity</h3>
              <button
                onClick={() => setOpen(false)}
                className="focusable rounded-lg border border-hairline px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover"
              >
                Esc ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <JobFeed />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
