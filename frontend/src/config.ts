/**
 * The single source of truth for backend endpoints.
 *
 * In dev, Vite proxies `/api` and `/metrics` to the gateway, so the browser
 * uses same-origin relative paths (no CORS). Override `VITE_API_BASE` /
 * `VITE_WS_BASE` to point a production build at a remote gateway. Nothing else
 * in the app hardcodes a URL.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

function wsUrl(path: string): string {
  // If the API base is absolute (http/https), `path` is already a full URL —
  // just switch the scheme to ws/wss. This keeps a single source of truth and
  // avoids double-prefixing when VITE_API_BASE points at a remote gateway.
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path.replace(/^http/, "ws");
  }
  const base = import.meta.env.VITE_WS_BASE;
  if (base) return `${base}${path}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

// The streaming chat LLM runs as its own service (default :8100).
const CHAT_BASE = import.meta.env.VITE_CHAT_URL ?? "http://127.0.0.1:8100";

export const endpoints = {
  infer: `${API_BASE}/infer`,
  models: `${API_BASE}/models`,
  health: `${API_BASE}/health`,
  history: (limit = 40) => `${API_BASE}/history?limit=${limit}`,
  chat: `${CHAT_BASE}/chat`,
  metricsWs: () => wsUrl(`${API_BASE}/ws/metrics`),
  resultWs: (jobId: string) => wsUrl(`${API_BASE}/ws/${jobId}`),
} as const;

// --- Optional API key (only needed when the gateway has auth enabled) ------ //
const API_KEY_STORAGE = "inferno.apikey";

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

/** Headers to attach to requests (adds X-API-Key when one is set). */
export function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-API-Key": key } : {};
}

/** UI-wide tunables kept in one place rather than scattered as magic numbers. */
export const ui = {
  maxFeedItems: 40,
  throughputWindow: 60, // points kept on the throughput chart
  reconnectDelayMs: 1500,
} as const;
