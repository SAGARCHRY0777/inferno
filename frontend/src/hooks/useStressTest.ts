import { useCallback, useSyncExternalStore } from "react";

import { authHeaders, endpoints } from "@/config";

const SAMPLES = [
  "Inferno batches requests beautifully under load.",
  "This is a stress test of the dynamic batching window.",
  "Throughput climbs as concurrent requests coalesce.",
  "Backpressure protects the queue when it saturates.",
];

/**
 * Module-level singleton state.
 *
 * There are two entry points to the stress test — the dashboard panel
 * (`StressTest.tsx`) and the ⌘K palette (`CommandPalette.tsx`) — and each used to
 * call `useStressTest()`, giving each its own `running`/`sent` state. Launching
 * from the palette therefore showed no progress anywhere, left the panel's
 * buttons enabled so a second run could start concurrently, and left neither
 * `stop` able to cancel the other's run. One shared store fixes all three.
 */
interface StressState {
  running: boolean;
  sent: number;
  total: number;
}

let state: StressState = { running: false, sent: 0, total: 0 };
const listeners = new Set<() => void>();

function setState(next: Partial<StressState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let cancelled = false;
let abort: AbortController | null = null;

async function runStress(modelName: string, count: number, wave = 40) {
  if (state.running) return; // guards both entry points, not just one
  setState({ running: true, total: count, sent: 0 });
  cancelled = false;
  const ctrl = new AbortController();
  abort = ctrl;

  try {
    let done = 0;
    for (let i = 0; i < count && !cancelled; i += wave) {
      const batch = Math.min(wave, count - i);
      await Promise.all(
        Array.from({ length: batch }, () =>
          fetch(endpoints.infer, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              model_name: modelName,
              input_type: "text",
              payload: SAMPLES[Math.floor(Math.random() * SAMPLES.length)],
            }),
            signal: ctrl.signal,
          })
            // Drain the body. An unread Response keeps its connection checked out
            // of the browser's per-host pool until GC; at the ×500 preset that's
            // 500 idle bodies competing with the real result sockets.
            .then((r) => r.body?.cancel().catch(() => undefined))
            .catch(() => undefined),
        ),
      );
      done += batch;
      setState({ sent: done });
    }
  } finally {
    // finally, so an unexpected throw can't strand `running: true` and
    // permanently disable every stress-test button until a reload.
    abort = null;
    setState({ running: false });
  }
}

function stopStress() {
  cancelled = true;
  abort?.abort(); // abort in-flight requests, don't just stop new waves
}

/**
 * Fires N concurrent inference requests (fire-and-forget) so the dashboard's
 * batch sizes climb and p99 is exercised in real time. Submits in waves to stay
 * within the browser's per-host connection limits.
 *
 * Every caller shares one run: progress is visible wherever it was started from,
 * and `stop` cancels it from anywhere.
 */
export function useStressTest(modelName = "dummy-echo") {
  const snapshot = useSyncExternalStore(subscribe, () => state);

  const run = useCallback(
    (count: number, wave = 40) => runStress(modelName, count, wave),
    [modelName],
  );

  return { ...snapshot, run, stop: stopStress };
}
