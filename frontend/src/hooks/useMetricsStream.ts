import { useEffect, useRef } from "react";

import { endpoints, ui } from "@/config";
import { useStore } from "@/store/useStore";
import type { MetricsSnapshot, WsEnvelope } from "@/types";

/**
 * Subscribes to the gateway metrics WebSocket and feeds snapshots into the store.
 * Reconnects automatically with a fixed backoff so the dashboard self-heals if
 * the gateway restarts. One hook instance per app (mounted in App).
 */
export function useMetricsStream(): void {
  const pushSnapshot = useStore((s) => s.pushSnapshot);
  const setConnected = useStore((s) => s.setMetricsConnected);
  const timer = useRef<number | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;

    const connect = () => {
      const ws = new WebSocket(endpoints.metricsWs());

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const env = JSON.parse(event.data) as WsEnvelope<MetricsSnapshot>;
        if (env.type === "metrics") pushSnapshot(env.data);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed.current) {
          timer.current = window.setTimeout(connect, ui.reconnectDelayMs);
        }
      };
      ws.onerror = () => ws.close();

      return ws;
    };

    const ws = connect();
    return () => {
      closed.current = true;
      if (timer.current) window.clearTimeout(timer.current);
      ws.close();
    };
  }, [pushSnapshot, setConnected]);
}
