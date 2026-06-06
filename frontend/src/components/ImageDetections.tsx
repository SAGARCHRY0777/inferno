import { motion } from "framer-motion";

import type { Prediction } from "@/types";

/**
 * Renders an image with detection bounding boxes overlaid. Box coordinates are
 * normalized 0..1, so they scale to whatever size the image is displayed at.
 */
export function ImageDetections({
  url,
  predictions,
}: {
  url: string;
  predictions: Prediction[];
}) {
  const dets = predictions.filter((p) => p.box && p.box.length === 4);

  return (
    <div className="flex flex-col gap-2">
      <span className="label-eyebrow">{dets.length} object(s) detected</span>
      <div className="relative mx-auto inline-block max-h-[220px] max-w-full overflow-hidden rounded-xl border border-hairline">
        <img src={url} alt="detections" className="block max-h-[220px] w-auto object-contain" />
        {dets.map((p, i) => {
          const [x1, y1, x2, y2] = p.box as number[];
          return (
            <motion.div
              key={i}
              className="absolute rounded-sm border-2 border-accent shadow-[0_0_12px_var(--c-accent-glow)]"
              style={{
                left: `${x1 * 100}%`,
                top: `${y1 * 100}%`,
                width: `${(x2 - x1) * 100}%`,
                height: `${(y2 - y1) * 100}%`,
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.06, type: "spring", stiffness: 300, damping: 22 }}
            >
              <span className="absolute -top-[18px] left-0 whitespace-nowrap rounded bg-accent px-1 text-[10px] font-semibold text-base">
                {p.label} {(p.score * 100).toFixed(0)}%
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
