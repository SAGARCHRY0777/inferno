import { useCallback } from "react";

import { authHeaders, endpoints } from "@/config";
import { sound } from "@/lib/sound";

// Slightly longer than the server's JOB_TIMEOUT_S (default 30s) so the server's
// own timeout message wins; this is the backstop if no message ever arrives.
const RESULT_GUARD_MS = 35_000;
import { useStore } from "@/store/useStore";
import type { InferenceResult, InputType, TrackedJob, WsEnvelope } from "@/types";

export interface SubmitArgs {
  modelName: string;
  inputType: InputType;
  payload: string; // base64 image OR raw text
  preview: string; // short human-readable preview for the feed
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
    async ({ modelName, inputType, payload, preview }: SubmitArgs): Promise<SubmitOutcome> => {
      let resp: Response;
      try {
        resp = await fetch(endpoints.infer, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ model_name: modelName, input_type: inputType, payload }),
        });
      } catch (e) {
        sound.error();
        pushToast("error", "Gateway unreachable — is the backend running?");
        return { ok: false, error: `network error: ${(e as Error).message}` };
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
      const accepted = (await resp.json()) as { job_id: string; result_ws: string };
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

      const ws = new WebSocket(endpoints.resultWs(job.jobId));
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
        const env = JSON.parse(event.data) as WsEnvelope<InferenceResult>;
        if (env.type === "result") {
          setJobResult(job.jobId, env.data);
          if (env.data.status === "error") sound.error();
          else sound.success();
        } else if (env.type === "timeout") {
          setJobError(job.jobId, "timed out");
          sound.error();
        }
        finish(); // closes for ALL envelope types
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
