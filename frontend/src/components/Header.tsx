import { motion } from "framer-motion";

import { useStore } from "@/store/useStore";
import { SettingsMenu } from "./SettingsMenu";
import { ThemeSwitcher } from "./ThemeSwitcher";

/** Brand + a live activity pulse that reacts to real throughput. */
export function Header() {
  const connected = useStore((s) => s.metricsConnected);
  const rps = useStore((s) => s.snapshot?.requests_per_sec ?? 0);
  const jobCount = useStore((s) => s.jobs.length);
  const active = connected && rps > 0;

  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-accent/10 ring-1 ring-accent/30">
          <span className="text-accent">▲</span>
          {active && (
            <span className="absolute inset-0 rounded-xl ring-1 ring-accent/40 animate-pulseRing" />
          )}
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Inferno</h1>
          <p className="text-[11px] text-ink-faint">Distributed inference · operations console</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => useStore.getState().setFeedOpen(true)}
          data-cursor="hover"
          className="focusable relative flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-hover"
        >
          <span className="relative flex h-2 w-2">
            {jobCount > 0 && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-pulseRing" />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="hidden sm:inline">Recent</span>
          {jobCount > 0 && <span className="tnum text-accent">{jobCount}</span>}
        </button>
        <button
          onClick={() => useStore.getState().setChatOpen(true)}
          data-cursor="hover"
          className="focusable rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/20"
        >
          Chat
        </button>
        <button
          onClick={() => useStore.getState().setFleetOpen(true)}
          data-cursor="hover"
          className="focusable hidden rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-hover sm:block"
        >
          Fleet
        </button>
        <button
          onClick={() => useStore.getState().setHistoryOpen(true)}
          data-cursor="hover"
          className="focusable hidden rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-hover sm:block"
        >
          History
        </button>
        <button
          onClick={() => useStore.getState().setPaletteOpen(true)}
          data-cursor="hover"
          className="focusable hidden items-center gap-1.5 rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-hover sm:flex"
        >
          <span>Commands</span>
          <kbd className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] tnum">⌘K</kbd>
        </button>
        <ThemeSwitcher />
        <SettingsMenu />
        <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-3 py-1.5">
          <motion.span
            className={`h-2 w-2 rounded-full ${connected ? "bg-ok" : "bg-danger"}`}
            animate={{ opacity: connected ? [1, 0.4, 1] : 1 }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          <span className="text-xs text-ink-muted">{connected ? "live" : "reconnecting…"}</span>
        </div>
      </div>
    </header>
  );
}
