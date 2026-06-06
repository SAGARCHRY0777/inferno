import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { endpoints } from "@/config";
import { fmtMs, shortId } from "@/lib/format";
import { useStore } from "@/store/useStore";
import type { HistoryRecord } from "@/types";

function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: HistoryRecord[]): string {
  const head = ["timestamp", "job_id", "model", "input_type", "status", "top_label", "top_score", "batch_size", "total_ms", "worker_id"];
  const lines = rows.map((r) =>
    [
      new Date(r.timestamp * 1000).toISOString(),
      r.job_id,
      r.model_name,
      r.input_type,
      r.status,
      r.predictions[0]?.label ?? "",
      r.predictions[0]?.score ?? "",
      r.batch_size,
      r.timings.total_ms.toFixed(2),
      r.worker_id,
    ].join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export function HistoryModal() {
  const open = useStore((s) => s.historyOpen);
  const setOpen = useStore((s) => s.setHistoryOpen);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [q, setQ] = useState("");
  const [model, setModel] = useState("all");
  const [status, setStatus] = useState("all");
  const [label, setLabel] = useState("all"); // item/label filter
  const [from, setFrom] = useState(""); // YYYY-MM-DD
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch(endpoints.history(500))
      .then((r) => r.json())
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const models = useMemo(() => ["all", ...new Set(records.map((r) => r.model_name))], [records]);
  // Distinct detected/predicted items across all records (for item-wise filter).
  const labels = useMemo(
    () => ["all", ...new Set(records.flatMap((r) => r.predictions.map((p) => p.label)))].sort(),
    [records],
  );

  const fromMs = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
  const toMs = to ? new Date(to + "T23:59:59").getTime() : Infinity;

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (model === "all" || r.model_name === model) &&
          (status === "all" || r.status === status) &&
          (label === "all" || r.predictions.some((p) => p.label === label)) &&
          r.timestamp * 1000 >= fromMs &&
          r.timestamp * 1000 <= toMs &&
          (q === "" ||
            r.input_preview.toLowerCase().includes(q.toLowerCase()) ||
            r.job_id.includes(q) ||
            r.predictions.some((p) => p.label.toLowerCase().includes(q.toLowerCase()))),
      ),
    [records, model, status, label, fromMs, toMs, q],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            className="glass-raised fixed inset-4 z-[91] mx-auto flex max-w-5xl flex-col gap-4 p-6 sm:inset-8"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                Inference history <span className="tnum text-ink-faint">· {filtered.length}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => download("inferences.json", JSON.stringify(filtered, null, 2), "application/json")}
                  className="focusable rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-hover"
                >
                  Export JSON
                </button>
                <button
                  onClick={() => download("inferences.csv", toCsv(filtered), "text/csv")}
                  className="focusable rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-hover"
                >
                  Export CSV
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="focusable rounded-lg border border-hairline px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-hover"
                >
                  Esc ✕
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search label, input, or job id…"
                  className="focusable min-w-[180px] flex-1 rounded-lg border border-hairline bg-surface/50 px-3 py-2 text-sm"
                />
                <select value={model} onChange={(e) => setModel(e.target.value)} className="focusable rounded-lg border border-hairline bg-surface/50 px-3 py-2 text-sm">
                  {models.map((m) => (
                    <option key={m} value={m}>{m === "all" ? "all models" : m}</option>
                  ))}
                </select>
                <select value={label} onChange={(e) => setLabel(e.target.value)} className="focusable max-w-[160px] rounded-lg border border-hairline bg-surface/50 px-3 py-2 text-sm">
                  {labels.map((l) => (
                    <option key={l} value={l}>{l === "all" ? "all items" : l}</option>
                  ))}
                </select>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="focusable rounded-lg border border-hairline bg-surface/50 px-3 py-2 text-sm">
                  <option value="all">all status</option>
                  <option value="success">success</option>
                  <option value="error">error</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <span className="label-eyebrow">Date</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="focusable rounded-lg border border-hairline bg-surface/50 px-2.5 py-1.5" />
                <span className="text-ink-faint">→</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="focusable rounded-lg border border-hairline bg-surface/50 px-2.5 py-1.5" />
                {[
                  ["Today", 0],
                  ["7d", 7],
                  ["30d", 30],
                ].map(([txt, days]) => (
                  <button
                    key={txt}
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - (days as number));
                      setFrom(d.toISOString().slice(0, 10));
                      setTo(new Date().toISOString().slice(0, 10));
                    }}
                    className="focusable rounded-md border border-hairline px-2 py-1 hover:bg-surface-hover"
                  >
                    {txt}
                  </button>
                ))}
                <button
                  onClick={() => { setFrom(""); setTo(""); setLabel("all"); setModel("all"); setStatus("all"); setQ(""); }}
                  className="focusable rounded-md border border-hairline px-2 py-1 text-ink-faint hover:bg-surface-hover"
                >
                  clear
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface-raised/90 text-ink-faint backdrop-blur">
                  <tr>
                    {["time", "job", "model", "result", "batch", "latency"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.job_id} className="border-t border-hairline hover:bg-surface-hover/50">
                      <td className="px-3 py-2 tnum text-ink-muted">{new Date(r.timestamp * 1000).toLocaleTimeString()}</td>
                      <td className="px-3 py-2 tnum text-ink-muted">{shortId(r.job_id)}</td>
                      <td className="px-3 py-2 text-ink">{r.model_name}</td>
                      <td className="px-3 py-2">
                        {r.status === "error" ? (
                          <span className="text-danger">error</span>
                        ) : (
                          <span className="text-ink">
                            {r.predictions[0]?.label}{" "}
                            <span className="tnum text-ink-faint">{r.predictions[0] ? `${(r.predictions[0].score * 100).toFixed(0)}%` : ""}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 tnum text-accent">×{r.batch_size}</td>
                      <td className="px-3 py-2 tnum text-ink-muted">{fmtMs(r.timings.total_ms)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-faint">no records</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
