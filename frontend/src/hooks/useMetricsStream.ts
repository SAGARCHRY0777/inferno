import { useEffect } from "react";

import { endpoints, ui } from "@/config";
import { useStore } from "@/store/useStore";
import type { MetricsSnapshot, WsEnvelope } from "@/types";

/**
 * Subscribes to the gateway metrics WebSocket and feeds snapshots into the store.
 * Reconnects automatically with a fixed backoff so the dashboard self-heals if
 * the gateway restarts. One hook instance per app (mounted in App).
 *
 * Two things here are deliberate and easy to regress:
 *
 * 1. `current` tracks the *live* socket, reassigned on every reconnect. Closing
 *    only the socket returned by the first `connect()` would leave every
 *    reconnected socket open forever, each still pushing snapshots into the store.
 * 2. `closed` and `timer` are effect-local (`let`), not refs. Refs are shared
 *    across effect runs, and under `<React.StrictMode>` the mount/cleanup/mount
 *    cycle would let the first socket's async `close` event observe the *second*
 *    run's `closed === false` and schedule another connect — yielding two live
 *    sockets and double-rate metrics in dev.
 */
export function useMetricsStream(): void {
  const pushSnapshot = useStore((s) => s.pushSnapshot);
  const setConnected = useStore((s) => s.setMetricsConnected);

  useEffect(() => {
    let closed = false;
    let timer: number | null = null;
    let current: WebSocket | null = null;

    const connect = () => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(endpoints.metricsWs());
      } catch {
        // A malformed VITE_WS_BASE makes the constructor throw synchronously.
        // Retry on the same backoff rather than leaving the dashboard dead.
        setConnected(false);
        if (!closed) timer = window.setTimeout(connect, ui.reconnectDelayMs);
        return;
      }
      current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        // A malformed frame must not throw out of the handler: that error is
        // uncatchable by ErrorBoundary (it isn't a render error) and would kill
        // this tick for no reason.
        try {
          const env = JSON.parse(event.data) as WsEnvelope<MetricsSnapshot>;
          if (env.type === "metrics" && env.data) pushSnapshot(env.data);
        } catch {
          /* ignore a malformed frame and wait for the next one */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = window.setTimeout(connect, ui.reconnectDelayMs);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      current?.close();
    };
  }, [pushSnapshot, setConnected]);
}
