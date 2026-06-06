import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useStore } from "@/store/useStore";
import { THEMES, type Theme, type ThemeGroup, themeById } from "@/theme/themes";

const GROUPS: ThemeGroup[] = ["Dark", "Vibrant", "Glass", "Light"];

function Swatch({ theme }: { theme: Theme }) {
  const dot = (t: string) => ({ backgroundColor: `rgb(${t})` });
  return (
    <div className="flex items-center gap-1">
      <span className="h-3 w-3 rounded-full ring-1 ring-black/20" style={dot(theme.c.accent)} />
      <span className="h-3 w-3 rounded-full ring-1 ring-black/20" style={dot(theme.c.surfaceRaised)} />
      <span className="h-3 w-3 rounded-full ring-1 ring-black/20" style={dot(theme.c.warn)} />
    </div>
  );
}

/** A palette popover for switching between the 20 themes. */
export function ThemeSwitcher() {
  const themeId = useStore((s) => s.themeId);
  const setThemeId = useStore((s) => s.setThemeId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = themeById(themeId);

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
        className="focusable flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-hover"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Swatch theme={current} />
        <span className="hidden sm:inline">{current.name}</span>
        <span className="text-ink-faint">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="glass-raised absolute right-0 z-50 mt-2 max-h-[70vh] w-72 overflow-y-auto p-3"
          >
            <p className="label-eyebrow mb-2 px-1">Theme · {THEMES.length} modes</p>
            {GROUPS.map((group) => (
              <div key={group} className="mb-2">
                <p className="px-1 py-1 text-[10px] uppercase tracking-wider text-ink-faint">
                  {group}
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {THEMES.filter((t) => t.group === group).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setThemeId(t.id);
                        setOpen(false);
                      }}
                      className={`focusable flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition ${
                        t.id === themeId
                          ? "border-accent/50 bg-accent/10 text-ink"
                          : "border-transparent text-ink-muted hover:bg-surface-hover"
                      }`}
                    >
                      <span>{t.name}</span>
                      <Swatch theme={t} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
