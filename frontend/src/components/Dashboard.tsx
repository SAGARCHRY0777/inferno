import { useStore } from "@/store/useStore";
import { BatchSizeChart } from "./BatchSizeChart";
import { MetricCard } from "./MetricCard";
import { ModelBreakdown } from "./ModelBreakdown";
import { ResourceGauges } from "./ResourceGauges";
import { StressTest } from "./StressTest";
import { ThroughputChart } from "./ThroughputChart";

export function Dashboard() {
  const snapshot = useStore((s) => s.snapshot);
  const loading = snapshot === null;
  const lat = snapshot?.latency_ms;

  return (
    <div className="flex flex-col gap-4">
      <StressTest />

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Req / sec" value={snapshot?.requests_per_sec ?? 0} digits={1} accent="cyan" loading={loading} />
        <MetricCard label="p50 latency" value={lat?.p50 ?? 0} suffix=" ms" accent="neutral" loading={loading} />
        <MetricCard label="p90 latency" value={lat?.p90 ?? 0} suffix=" ms" accent="neutral" loading={loading} />
        <MetricCard label="p99 latency" value={lat?.p99 ?? 0} suffix=" ms" accent="amber" loading={loading} />
        <MetricCard label="Queue depth" value={snapshot?.queue_depth ?? 0} accent={(snapshot?.queue_depth ?? 0) > 100 ? "amber" : "neutral"} loading={loading} />
        <MetricCard label="Workers" value={snapshot?.workers_active ?? 0} accent="cyan" loading={loading} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ThroughputChart />
        <BatchSizeChart />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.1fr]">
        <ResourceGauges />
        <ModelBreakdown />
      </div>
    </div>
  );
}
