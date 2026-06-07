/**
 * Pure helpers for the Fleet Arcade games (no React, no I/O). Routing geometry
 * still comes from OSRM via fleet.ts; this module is just geometry + scoring.
 */
import type { LatLng } from "./fleet";

/** Uniformly-random point within `radiusKm` of a center (rough equirectangular). */
export function randomPointNear(center: LatLng, radiusKm: number): LatLng {
  const r = radiusKm / 111; // ~deg per km
  const w = r * Math.sqrt(Math.random());
  const t = 2 * Math.PI * Math.random();
  const dLat = w * Math.cos(t);
  const dLng = (w * Math.sin(t)) / Math.cos((center[0] * Math.PI) / 180);
  return [center[0] + dLat, center[1] + dLng];
}

/** Great-circle distance in metres. */
export function distM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Total straight-line length of an ordered path. */
export function pathDist(points: LatLng[]): number {
  let d = 0;
  for (let i = 0; i < points.length - 1; i++) d += distM(points[i], points[i + 1]);
  return d;
}

/**
 * Shortest visiting order (open path, fixed start = index 0) by brute force.
 * Only used for small N (<= 8) in the Route Rush puzzle, so N! is tiny.
 */
export function tspBest(points: LatLng[]): { order: number[]; dist: number } {
  const rest = Array.from({ length: points.length - 1 }, (_, i) => i + 1);
  let best = { order: [0, ...rest], dist: Infinity };
  const permute = (arr: number[], k: number): void => {
    if (k === arr.length) {
      const order = [0, ...arr];
      const d = pathDist(order.map((i) => points[i]));
      if (d < best.dist) best = { order, dist: d };
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(rest, 0);
  return best;
}
