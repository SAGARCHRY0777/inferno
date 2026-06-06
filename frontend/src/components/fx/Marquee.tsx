import { useStore } from "@/store/useStore";

/**
 * A seamless, infinitely-scrolling telemetry ticker (landonorris-style kinetic
 * strip), wired to live metrics. The content row is duplicated so the loop is
 * seamless; pauses on hover.
 */
export function Marquee() {
  const snap = useStore((s) => s.snapshot);
  const jobs = useStore((s) => s.jobs.length);
  const models = useStore((s) => s.models.length);

  const items = [
    ["REQ/S", snap ? snap.requests_per_sec.toFixed(1) : "—"],
    ["P50", snap ? `${snap.latency_ms.p50.toFixed(0)} ms` : "—"],
    ["P99", snap ? `${snap.latency_ms.p99.toFixed(0)} ms` : "—"],
    ["QUEUE", snap ? `${snap.queue_depth}` : "—"],
    ["WORKERS", snap ? `${snap.workers_active}` : "—"],
    ["MODELS", `${models}`],
    ["FEED", `${jobs}`],
    ["DYNAMIC BATCHING", "ENABLED"],
    ["BACKPRESSURE", "429 + RETRY-AFTER"],
    ["DELIVERY", "WEBSOCKET"],
  ];

  const Row = () => (
    <div className="flex shrink-0 items-center gap-8 pr-8" aria-hidden>
      {items.map(([k, v], i) => (
        <span key={`${k}-${i}`} className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">{k}</span>
          <span className="tnum text-sm text-accent">{v}</span>
          <span className="text-ink-faint">/</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="group glass relative overflow-hidden py-2.5">
      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
        <Row />
        <Row />
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-surface to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-surface to-transparent" />
    </div>
  );
}
