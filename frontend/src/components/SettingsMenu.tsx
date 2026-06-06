import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { getApiKey, setApiKey } from "@/config";
import { sound } from "@/lib/sound";

/** Small gear popover holding the optional API key (used when auth is enabled). */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(getApiKey());
  const [muted, setMuted] = useState(sound.isMuted());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-cursor="hover"
        aria-label="Settings"
        className="focusable grid h-8 w-8 place-items-center rounded-full border border-hairline bg-surface/60 text-ink-muted transition hover:bg-surface-hover"
      >
        ⚙
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            className="glass-raised absolute right-0 z-50 mt-2 w-72 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="label-eyebrow">Sound</span>
              <button
                onClick={() => {
                  const next = !muted;
                  sound.setMuted(next);
                  setMuted(next);
                }}
                className="focusable rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-hover"
              >
                {muted ? "🔇 muted" : "🔊 on"}
              </button>
            </div>
            <p className="label-eyebrow mb-2">API key</p>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
              Only needed if the gateway has auth enabled. Stored locally and sent as
              the <code>X-API-Key</code> header.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="paste key…"
                className="focusable min-w-0 flex-1 rounded-lg border border-hairline bg-surface/50 px-3 py-2 text-sm"
              />
              <button
                onClick={() => {
                  setApiKey(key.trim());
                  setOpen(false);
                }}
                className="focusable rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-base"
              >
                Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
