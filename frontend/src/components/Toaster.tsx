import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

import { type Toast, useStore } from "@/store/useStore";

const ACCENT: Record<Toast["kind"], string> = {
  info: "border-accent/40 text-accent",
  success: "border-ok/40 text-ok",
  error: "border-danger/40 text-danger",
};
const ICON: Record<Toast["kind"], string> = { info: "ⓘ", success: "✓", error: "⚠" };

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const id = window.setTimeout(() => dismiss(toast.id), 4200);
    return () => window.clearTimeout(id);
  }, [toast.id, dismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      onClick={() => dismiss(toast.id)}
      className={`glass-raised pointer-events-auto flex w-72 cursor-pointer items-start gap-3 border-l-2 p-3 text-sm ${ACCENT[toast.kind]}`}
    >
      <span className="mt-0.5 shrink-0">{ICON[toast.kind]}</span>
      <span className="text-ink">{toast.message}</span>
    </motion.div>
  );
}

/** Bottom-right toast stack for non-blocking notifications. */
export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[110] flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
