import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { useStressTest } from "@/hooks/useStressTest";
import { useStore } from "@/store/useStore";
import { THEMES } from "@/theme/themes";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** ⌘K / Ctrl+K quick-action launcher. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const setHistoryOpen = useStore((s) => s.setHistoryOpen);
  const setFeedOpen = useStore((s) => s.setFeedOpen);
  const setFleetOpen = useStore((s) => s.setFleetOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const setThemeId = useStore((s) => s.setThemeId);
  const stress = useStressTest("dummy-echo");
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const commands: Command[] = useMemo(() => {
    const close = () => setOpen(false);
    return [
      { id: "chat", label: "Open Assistant (streaming chat)", hint: "local LLM · RAG", run: () => { setChatOpen(true); close(); } },
      { id: "fleet", label: "Open Fleet Command (AV map)", hint: "path tracing · map", run: () => { setFleetOpen(true); close(); } },
      { id: "recent", label: "Show recent activity", hint: "live job feed", run: () => { setFeedOpen(true); close(); } },
      { id: "history", label: "Open inference history", hint: "view · search · export", run: () => { setHistoryOpen(true); close(); } },
      { id: "stress-100", label: "Stress test · ×100", hint: "watch batching climb", run: () => { stress.run(100); close(); } },
      { id: "stress-500", label: "Stress test · ×500", hint: "heavy load", run: () => { stress.run(500); close(); } },
      ...THEMES.map((t) => ({
        id: `theme-${t.id}`,
        label: `Theme · ${t.name}`,
        hint: t.group,
        run: () => { setThemeId(t.id); close(); },
      })),
    ];
  }, [setOpen, setHistoryOpen, setFeedOpen, setFleetOpen, setChatOpen, setThemeId, stress]);

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            className="glass-raised fixed left-1/2 top-24 z-[96] w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden p-2"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && filtered[0]?.run()}
              placeholder="Type a command… (history, stress, theme)"
              className="focusable w-full rounded-lg bg-transparent px-3 py-3 text-sm outline-none"
            />
            <div className="max-h-[50vh] overflow-y-auto">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={c.run}
                  className="focusable flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink"
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="text-[11px] text-ink-faint">{c.hint}</span>}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-ink-faint">no commands</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
