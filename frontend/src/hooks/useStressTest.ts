import { useCallback, useEffect, useRef, useState } from "react";

import { authHeaders, endpoints } from "@/config";

const SAMPLES = [
  "Inferno batches requests beautifully under load.",
  "This is a stress test of the dynamic batching window.",
  "Throughput climbs as concurrent requests coalesce.",
  "Backpressure protects the queue when it saturates.",
];

/**
 * Fires N concurrent inference requests (fire-and-forget) so the dashboard's
 * batch sizes climb and p99 is exercised in real time. Submits in waves to stay
 * within the browser's per-host connection limits.
 */
export function useStressTest(modelName = "dummy-echo") {
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const cancel = useRef(false);

  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (count: number, wave = 40) => {
      if (running) return;
      setRunning(true);
      setTotal(count);
      setSent(0);
      cancel.current = false;
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let done = 0;
      for (let i = 0; i < count && !cancel.current; i += wave) {
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
            }).catch(() => undefined),
          ),
        );
        done += batch;
        setSent(done);
      }
      abortRef.current = null;
      setRunning(false);
    },
    [modelName, running],
  );

  const stop = useCallback(() => {
    cancel.current = true;
    abortRef.current?.abort(); // abort in-flight requests, don't just stop new waves
  }, []);

  // Abort any in-flight load if the component using this hook unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { running, sent, total, run, stop };
}
