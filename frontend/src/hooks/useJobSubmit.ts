import { useCallback } from "react";

import { authHeaders, endpoints } from "@/config";
import { sound } from "@/lib/sound";

// Slightly longer than the server's JOB_TIMEOUT_S (default 30s) so the server's
// own timeout message wins; this is the backstop if no message ever arrives.
const RESULT_GUARD_MS = 35_000;
// The gateway only validates + enqueues on POST /infer, so acceptance is fast.
// This bounds a silent hang (connection accepted, no response) so the caller's
// promise always settles.
const SUBMIT_TIMEOUT_MS = 15_000;
import { useStore } from "@/store/useStore";
import type { InferenceResult, InputType, TrackedJob, WsEnvelope } from "@/types";

export interface SubmitArgs {
  modelName: string;
  inputType: InputType;
  payload: string; // base64 image OR raw text
  preview: string; // short human-readable preview for the feed
  /**
   * 0-9. Jobs at or above the gateway's `queue.express_priority_min` (default 5)
   * are routed to the model's express lane, which workers drain before the
   * normal lane. Omitted = 0.
   */
  priority?: number;
}

export interface SubmitOutcome {
  ok: boolean;
  jobId?: string;
  error?: string;
  retryAfter?: number;
}

/**
 * Submits a job and tracks it through its lifecycle.
 *
 * The gateway returns only the final result, so we optimistically animate the
 * Queued -> Batched -> Running steps on short timers and finalize on the real
 * result (or timeout). Backpressure (429) surfaces as a typed outcome the UI can
 * present gracefully with the server's Retry-After.
 */
export function useJobSubmit(): (args: SubmitArgs) => Promise<SubmitOutcome> {
  const { addJob, setJobPhase, setJobResult, setJobError, pushToast } = useStore.getState();

  return useCallback(
    async ({ modelName, inputType, payload, preview, priority = 0 }: SubmitArgs): Promise<SubmitOutcome> => {
      let resp: Response;
      // Bound the submit: a gateway that accepts the TCP connection but never
      // replies would otherwise leave this promise pending forever, and the
      // caller's "Submitting…" button disabled until a page reload.
      const submitAbort = new AbortController();
      const submitTimer = window.setTimeout(() => submitAbort.abort(), SUBMIT_TIMEOUT_MS);
      try {
        resp = await fetch(endpoints.infer, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ model_name: modelName, input_type: inputType, payload, priority }),
          signal: submitAbort.signal,
        });
      } catch (e) {
        sound.error();
        const aborted = (e as Error)?.name === "AbortError";
        pushToast(
          "error",
          aborted ? "Gateway timed out accepting the job" : "Gateway unreachable — is the backend running?",
        );
        return {
          ok: false,
          error: aborted ? "submit timed out" : `network error: ${(e as Error).message}`,
        };
      } finally {
        window.clearTimeout(submitTimer);
      }

      if (resp.status === 429) {
        const retryAfter = Number(resp.headers.get("Retry-After") ?? "1");
        pushToast("info", `Backpressure — retry in ${retryAfter}s`);
        return { ok: false, error: "Queue saturated (backpressure)", retryAfter };
      }
      if (resp.status === 401) {
        pushToast("error", "Unauthorized — set an API key in ⚙ settings");
        return { ok: false, error: "unauthorized" };
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        pushToast("error", body.message ?? `Request failed (HTTP ${resp.status})`);
        return { ok: false, error: body.message ?? `HTTP ${resp.status}` };
      }

      sound.submit();
      // A truncated/invalid 202 body must not throw out of submit() — the caller
      // would be left with its busy flag stuck on.
      const accepted = (await resp.json().catch(() => null)) as
        | { job_id: string; result_ws: string }
        | null;
      if (!accepted?.job_id) {
        pushToast("error", "Gateway returned a malformed acceptance");
        return { ok: false, error: "malformed acceptance from gateway" };
      }
      const job: TrackedJob = {
        jobId: accepted.job_id,
        modelName,
        inputType,
        preview,
        phase: "queued",
        submittedAt: Date.now(),
      };
      addJob(job);

      // Optimistic lifecycle animation; cleared when the result lands.
      const t1 = window.setTimeout(() => setJobPhase(job.jobId, "batched"), 130);
      const t2 = window.setTimeout(() => setJobPhase(job.jobId, "running"), 280);

      // The WebSocket constructor throws synchronously on a malformed
      // VITE_WS_BASE; surface it as a failed job instead of an exception that
      // escapes submit() and strands the caller's busy flag.
      let ws: WebSocket;
      try {
        ws = new WebSocket(endpoints.resultWs(job.jobId));
      } catch (e) {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        setJobError(job.jobId, "could not open result stream");
        pushToast("error", "Invalid WebSocket URL — check VITE_WS_BASE");
        return { ok: false, error: `bad result socket: ${(e as Error).message}` };
      }
      // Hard guard so the socket + timers are ALWAYS released even if the server
      // never sends a result and never fires an error (silent hang) -> no leak.
      const guard = window.setTimeout(() => {
        finish();
        setJobError(job.jobId, "timed out");
      }, RESULT_GUARD_MS);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(guard);
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      };

      ws.onmessage = (event) => {
        // Guarded so a malformed frame can't skip finish(): that would leak the
        // socket + timers and then mislabel the job "timed out" via the guard,
        // even though a response did arrive.
        try {
          const env = JSON.parse(event.data) as WsEnvelope<InferenceResult>;
          if (env.type === "result" && env.data) {
            setJobResult(job.jobId, env.data);
            if (env.data.status === "error") sound.error();
            else sound.success();
          } else if (env.type === "timeout") {
            setJobError(job.jobId, "timed out");
            sound.error();
          }
        } catch {
          setJobError(job.jobId, "malformed result frame");
          sound.error();
        } finally {
          finish(); // closes for ALL envelope types
        }
      };
      ws.onerror = () => {
        setJobError(job.jobId, "result stream error");
        finish();
      };
      ws.onclose = finish;

      return { ok: true, jobId: job.jobId };
    },
    [addJob, setJobPhase, setJobResult, setJobError, pushToast],
  );
}
