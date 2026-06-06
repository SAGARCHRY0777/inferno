/** Small, pure formatting helpers so telemetry renders consistently everywhere. */

export function fmtMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number): string {
  return `${n.toFixed(0)}%`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

/** Clamp a value into [min, max] (used by gauges). */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
