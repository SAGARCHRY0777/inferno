/** TypeScript mirror of the backend Pydantic contracts (backend/core/schemas.py). */

export type InputType = "image" | "text" | "audio";
export type TaskType =
  | "classification"
  | "detection"
  | "transcription"
  | "search"
  | "generation"
  | "embedding";
export type ResultStatus = "success" | "error";
export type JobPhase = "queued" | "batched" | "running" | "done" | "error" | "timeout";

export interface Prediction {
  label: string;
  score: number;
  /** Detection box [x1,y1,x2,y2] normalized to 0..1; absent for classifiers. */
  box?: number[] | null;
  /** Citation/source (e.g. the document a RAG passage came from). */
  source?: string | null;
}

export interface Timings {
  queue_ms: number;
  batch_wait_ms: number;
  inference_ms: number;
  total_ms: number;
}

export interface InferenceResult {
  job_id: string;
  model_name: string;
  status: ResultStatus;
  predictions: Prediction[];
  error: string | null;
  timings: Timings;
  batch_size: number;
  worker_id: string;
  cached?: boolean;
}

export interface ModelStats {
  model_name: string;
  requests_per_sec: number;
  p50_ms: number;
  p99_ms: number;
  errors: number;
  avg_batch: number;
}

export interface ModelInfo {
  name: string;
  kind: string;
  input_type: InputType;
  task: TaskType;
  description: string;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p99: number;
}

export interface GpuStats {
  index: number;
  name: string;
  utilization_pct: number;
  vram_used_mb: number;
  vram_total_mb: number;
}

export interface WorkerHeartbeat {
  worker_id: string;
  model_name: string;
  state: string;
  jobs_processed: number;
  last_batch_size: number;
  cpu_pct: number;
  ram_pct: number;
  gpus: GpuStats[];
  updated_at: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  requests_per_sec: number;
  latency_ms: LatencyPercentiles;
  queue_depth: number;
  workers_active: number;
  recent_batch_sizes: number[];
  cpu_pct: number;
  ram_pct: number;
  gpus: GpuStats[];
  workers: WorkerHeartbeat[];
  per_model: ModelStats[];
}

/** A durably-persisted inference, from GET /history. */
export interface HistoryRecord {
  timestamp: number;
  job_id: string;
  model_name: string;
  input_type: InputType;
  input_preview: string;
  status: ResultStatus;
  predictions: Prediction[];
  error: string | null;
  timings: Timings;
  batch_size: number;
  worker_id: string;
}

/** A job tracked locally through its lifecycle in the Submit panel + feed. */
export interface TrackedJob {
  jobId: string;
  modelName: string;
  inputType: InputType;
  preview: string;
  phase: JobPhase;
  submittedAt: number;
  result?: InferenceResult;
  error?: string;
}

/** WebSocket envelope shared by result + metrics streams. */
export interface WsEnvelope<T> {
  type: "result" | "metrics" | "error" | "timeout" | string;
  data: T;
}
