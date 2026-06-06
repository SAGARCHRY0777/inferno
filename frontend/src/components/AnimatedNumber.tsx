import { useEffect } from "react";
import { animate, useMotionValue, useTransform, motion } from "framer-motion";

interface Props {
  value: number;
  digits?: number;
  suffix?: string;
  className?: string;
}

/**
 * Tweens to a new value instead of snapping, so streaming metrics read smoothly.
 * Uses tabular-nums (via the `tnum` class) so the width never jitters.
 */
export function AnimatedNumber({ value, digits = 0, suffix = "", className }: Props) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) =>
    v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  );

  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.5, ease: "easeOut" });
    return controls.stop;
  }, [mv, value]);

  return (
    <span className={`tnum ${className ?? ""}`}>
      <motion.span>{text}</motion.span>
      {suffix}
    </span>
  );
}
