import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMemo } from "react";

import { useStore } from "@/store/useStore";

/** Distribution of recently-realized batch sizes -- the key "batching works" view. */
export function BatchSizeChart() {
  const snapshot = useStore((s) => s.snapshot);

  const data = useMemo(() => {
    const counts = new Map<number, number>();
    for (const b of snapshot?.recent_batch_sizes ?? []) {
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([size, count]) => ({ size, count }));
  }, [snapshot?.recent_batch_sizes]);

  const max = data.reduce((m, d) => Math.max(m, d.size), 0);

  return (
    <div className="glass flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-eyebrow">Batch-size distribution</span>
        <span className="text-[11px] text-ink-muted tnum">peak {max}</span>
      </div>
      <div className="min-h-[180px] flex-1">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            awaiting traffic…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
              <XAxis
                dataKey="size"
                tick={{ fill: "#5B6573", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fill: "#5B6573", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{
                  background: "#101218",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v: number) => [v, "batches"]}
                labelFormatter={(l) => `size ${l}`}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell
                    key={d.size}
                    fill={`rgba(0,229,255,${0.35 + (max ? (d.size / max) * 0.6 : 0)})`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
