import { create } from "zustand";

import { ui } from "@/config";
import { applyTheme, getStoredThemeId, storeThemeId, themeById } from "@/theme/themes";
import type {
  InferenceResult,
  MetricsSnapshot,
  ModelInfo,
  TrackedJob,
} from "@/types";

/** A single throughput sample kept for the streaming line chart. */
export interface ThroughputPoint {
  t: number;
  rps: number;
  p50: number;
  p99: number;
}

export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
let _toastId = 0;

interface AppState {
  models: ModelInfo[];
  metricsConnected: boolean;
  snapshot: MetricsSnapshot | null;
  throughput: ThroughputPoint[];
  jobs: TrackedJob[]; // most-recent-first, capped
  themeId: string;
  selectedJobId: string | null;
  paletteOpen: boolean;
  historyOpen: boolean;
  feedOpen: boolean;
  fleetOpen: boolean;
  chatOpen: boolean;
  toasts: Toast[];
  /**
   * YOLO vehicle labels waiting to be spawned onto the Fleet map.
   *
   * This is the hand-off that connects the inference platform to Fleet Command:
   * detect vehicles in a real photo, then watch those exact vehicles drive. The
   * queue lives in the store because the detection happens in SubmitPanel while
   * the spawning happens inside FleetMap's Leaflet context.
   */
  fleetSpawnQueue: string[];

  setChatOpen: (open: boolean) => void;
  /** Queue detected vehicle labels (e.g. ["car","car","bus"]) for the Fleet map. */
  queueFleetSpawns: (labels: string[]) => void;
  /** Drain the queue — returns what was pending and clears it. */
  takeFleetSpawns: () => string[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
  setSelectedJob: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
  setFeedOpen: (open: boolean) => void;
  setFleetOpen: (open: boolean) => void;
  setThemeId: (id: string) => void;
  setModels: (m: ModelInfo[]) => void;
  loadHistory: (jobs: TrackedJob[]) => void;
  setMetricsConnected: (c: boolean) => void;
  pushSnapshot: (s: MetricsSnapshot) => void;
  addJob: (j: TrackedJob) => void;
  setJobPhase: (jobId: string, phase: TrackedJob["phase"]) => void;
  setJobResult: (jobId: string, result: InferenceResult) => void;
  setJobError: (jobId: string, error: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  models: [],
  metricsConnected: false,
  snapshot: null,
  throughput: [],
  jobs: [],
  themeId: getStoredThemeId(),
  selectedJobId: null,
  paletteOpen: false,
  historyOpen: false,
  feedOpen: false,
  fleetOpen: false,
  chatOpen: false,
  toasts: [],
  fleetSpawnQueue: [],

  setChatOpen: (chatOpen) => set({ chatOpen }),
  queueFleetSpawns: (labels) =>
    // Capped: a busy photo can contain dozens of vehicles, and each becomes a
    // live marker. 60 is plenty to look convincing without flooding the map.
    set((state) => ({ fleetSpawnQueue: [...state.fleetSpawnQueue, ...labels].slice(-60) })),
  takeFleetSpawns: () => {
    const pending = get().fleetSpawnQueue;
    if (pending.length) set({ fleetSpawnQueue: [] });
    return pending;
  },
  pushToast: (kind, message) =>
    set((state) => ({ toasts: [...state.toasts, { id: ++_toastId, kind, message }].slice(-4) })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  setSelectedJob: (selectedJobId) => set({ selectedJobId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  setFeedOpen: (feedOpen) => set({ feedOpen }),
  setFleetOpen: (fleetOpen) => set({ fleetOpen }),

  setThemeId: (id) => {
    applyTheme(themeById(id));
    storeThemeId(id);
    set({ themeId: id });
  },
  setModels: (models) => set({ models }),

  // Prefill the feed with persisted history, without clobbering live jobs.
  loadHistory: (historyJobs) =>
    set((state) => {
      const seen = new Set(state.jobs.map((j) => j.jobId));
      const merged = [...state.jobs, ...historyJobs.filter((j) => !seen.has(j.jobId))];
      return { jobs: merged.slice(0, ui.maxFeedItems) };
    }),

  setMetricsConnected: (metricsConnected) => set({ metricsConnected }),

  pushSnapshot: (snapshot) =>
    set((state) => {
      const point: ThroughputPoint = {
        t: snapshot.timestamp * 1000,
        rps: snapshot.requests_per_sec,
        p50: snapshot.latency_ms.p50,
        p99: snapshot.latency_ms.p99,
      };
      const throughput = [...state.throughput, point].slice(-ui.throughputWindow);
      return { snapshot, throughput };
    }),

  addJob: (job) =>
    set((state) => ({ jobs: [job, ...state.jobs].slice(0, ui.maxFeedItems) })),

  setJobPhase: (jobId, phase) =>
    set((state) => ({
      jobs: state.jobs.map((j) =>
        // Never regress a finished job back to an interim phase.
        j.jobId === jobId && j.phase !== "done" && j.phase !== "error"
          ? { ...j, phase }
          : j,
      ),
    })),

  setJobResult: (jobId, result) =>
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.jobId === jobId
          ? { ...j, phase: result.status === "success" ? "done" : "error", result }
          : j,
      ),
    })),

  setJobError: (jobId, error) =>
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.jobId === jobId ? { ...j, phase: "error", error } : j,
      ),
    })),
}));

// Dev-only debug handle: lets you inspect and drive the store from the browser
// console (and lets UI tests exercise store actions without a live backend).
// `import.meta.env.DEV` is statically false in a production build, so bundlers
// tree-shake this away entirely — it never ships.
if (import.meta.env.DEV) {
  (window as unknown as { __inferno_store?: typeof useStore }).__inferno_store = useStore;
}
