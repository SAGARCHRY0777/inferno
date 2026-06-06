import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { AnimatedNumber } from "./AnimatedNumber";
import { Tilt } from "./fx/Tilt";

interface Props {
  label: string;
  value: number;
  digits?: number;
  suffix?: string;
  hint?: ReactNode;
  accent?: "cyan" | "amber" | "danger" | "neutral";
  loading?: boolean;
}

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  cyan: "text-accent",
  amber: "text-warn",
  danger: "text-danger",
  neutral: "text-ink",
};

export function MetricCard({
  label,
  value,
  digits = 0,
  suffix = "",
  hint,
  accent = "neutral",
  loading = false,
}: Props) {
  return (
    <Tilt max={7} className="h-full">
      <motion.div
        layout
        className="glass group relative flex h-full flex-col gap-2 p-4"
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
      <span className="label-eyebrow">{label}</span>
      {loading ? (
        <div className="skeleton h-8 w-24" />
      ) : (
        <div className={`text-3xl font-semibold ${ACCENT[accent]}`}>
          <AnimatedNumber value={value} digits={digits} suffix={suffix} />
        </div>
      )}
        {hint && <span className="text-xs text-ink-muted tnum">{hint}</span>}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      </motion.div>
    </Tilt>
  );
}
