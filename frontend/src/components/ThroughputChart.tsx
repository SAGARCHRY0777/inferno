import {
  Area,
  AreaChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useStore } from "@/store/useStore";

/** Streaming throughput (req/s) with a p99 latency overlay. */
export function ThroughputChart() {
  const data = useStore((s) => s.throughput);

  return (
    <div className="glass flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-eyebrow">Throughput · req/s</span>
        <div className="flex items-center gap-3 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-accent" /> req/s
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-warn" /> p99 ms
          </span>
        </div>
      </div>
      <div className="min-h-[180px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
            <defs>
              <linearGradient id="rps" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00E5FF" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#00E5FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis
              tick={{ fill: "#5B6573", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "#101218",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={() => ""}
              formatter={(v: number, n: string) => [v.toFixed(1), n]}
            />
            <Area
              type="monotone"
              dataKey="rps"
              stroke="#00E5FF"
              strokeWidth={2}
              fill="url(#rps)"
              isAnimationActive={false}
              name="req/s"
            />
            <Line
              type="monotone"
              dataKey="p99"
              stroke="#FFB020"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              name="p99 ms"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
