import { motion } from "framer-motion";

/**
 * Slow-drifting aurora gradient blobs behind the content. Themed (uses the
 * accent CSS variable), GPU-friendly (transform/opacity only), and sits below
 * everything with pointer-events disabled.
 */
export function Aurora() {
  const blob = "absolute rounded-full blur-3xl mix-blend-screen";
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        className={blob}
        style={{ background: "rgb(var(--c-accent) / 0.16)", width: 560, height: 560, top: "-12%", right: "-6%" }}
        animate={{ x: [0, 40, -20, 0], y: [0, 30, 10, 0], scale: [1, 1.1, 0.95, 1] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={blob}
        style={{ background: "rgb(var(--c-accent-dim) / 0.14)", width: 520, height: 520, bottom: "-14%", left: "-8%" }}
        animate={{ x: [0, -30, 20, 0], y: [0, -20, 20, 0], scale: [1, 1.08, 0.9, 1] }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={blob}
        style={{ background: "rgb(var(--c-ok) / 0.10)", width: 420, height: 420, top: "40%", left: "55%" }}
        animate={{ x: [0, 24, -24, 0], y: [0, -28, 16, 0], scale: [1, 1.12, 0.92, 1] }}
        transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
