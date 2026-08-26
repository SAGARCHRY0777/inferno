import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import { useJobSubmit } from "@/hooks/useJobSubmit";
import { vehicleLabels } from "@/lib/fleet";
import { fmtMs } from "@/lib/format";
import { useStore } from "@/store/useStore";
import type { ModelInfo } from "@/types";
import { AudioInput } from "./AudioInput";
import { ConfidenceBars } from "./ConfidenceBars";
import { ImageDetections } from "./ImageDetections";
import { JobLifecycle } from "./JobLifecycle";
import { Magnetic } from "./fx/Magnetic";

const SAMPLE_TEXT = "Inferno batches requests beautifully and the latency is incredible.";

export function SubmitPanel() {
  const models = useStore((s) => s.models);
  const jobs = useStore((s) => s.jobs);
  const queueFleetSpawns = useStore((s) => s.queueFleetSpawns);
  const setFleetOpen = useStore((s) => s.setFleetOpen);
  const submit = useJobSubmit();

  const [modelName, setModelName] = useState<string>("");
  const [text, setText] = useState(SAMPLE_TEXT);
  const [image, setImage] = useState<{ b64: string; name: string; url: string } | null>(null);
  const [audio, setAudio] = useState<{ b64: string; url: string; seconds: number } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Express = priority 9, which the gateway routes to the model's express lane
  // (workers drain it before the normal lane). Visible under load: queue a burst
  // with the stress test, then submit one express job and watch it jump ahead.
  const [express, setExpress] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const model: ModelInfo | undefined = useMemo(
    () => models.find((m) => m.name === modelName) ?? models[0],
    [models, modelName],
  );
  const activeJob = jobs.find((j) => j.jobId === activeJobId);

  // Track object URLs so we can revoke them (blob-URL leak prevention). The
  // result overlay reuses the image URL, so we never revoke the one still shown.
  const resultImageRef = useRef<string | null>(null);
  resultImageRef.current = resultImage;
  // Mirror the live blob URLs into refs so the unmount cleanup can revoke the
  // *current* ones. The previous version read `image`/`audio` directly from an
  // effect with `[]` deps, which captured their first-render values (both null),
  // making every guard permanently false — the cleanup revoked nothing at all.
  const imageUrlRef = useRef<string | null>(null);
  imageUrlRef.current = image?.url ?? null;
  const audioUrlRef = useRef<string | null>(null);
  audioUrlRef.current = audio?.url ?? null;
  useEffect(() => {
    return () => {
      const img = imageUrlRef.current;
      const aud = audioUrlRef.current;
      const shown = resultImageRef.current;
      if (img) URL.revokeObjectURL(img);
      if (aud) URL.revokeObjectURL(aud);
      if (shown && shown !== img) URL.revokeObjectURL(shown);
    };
  }, []);

  function onFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file.");
      return;
    }
    // FileReader handles files of any size; spreading bytes into
    // String.fromCharCode overflows the call stack on real images.
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:image/...;base64,XXXX"
      const b64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      setNotice(null);
      setImage((prev) => {
        // Revoke the previous preview unless it's the one shown in the result.
        if (prev && prev.url !== resultImageRef.current) URL.revokeObjectURL(prev.url);
        return { b64, name: file.name, url: URL.createObjectURL(file) };
      });
    };
    reader.onerror = () => setNotice("Could not read that file.");
    reader.readAsDataURL(file);
  }

  function onAudio(a: { b64: string; url: string; seconds: number }) {
    setAudio((prev) => {
      if (prev) URL.revokeObjectURL(prev.url); // release the old recording
      return a;
    });
  }

  async function onSubmit() {
    if (!model) return;
    setNotice(null);
    const kind = model.input_type;
    if (kind === "image" && !image) return setNotice("Drop an image first.");
    if (kind === "audio" && !audio) return setNotice("Record or upload audio first.");

    let payload: string;
    let preview: string;
    if (kind === "image") {
      payload = image!.b64;
      preview = image!.name;
    } else if (kind === "audio") {
      payload = audio!.b64;
      preview = `audio · ${audio!.seconds.toFixed(1)}s`;
    } else {
      payload = text;
      preview = text.slice(0, 40);
    }

    setBusy(true);
    try {
      const outcome = await submit({
        modelName: model.name,
        inputType: kind,
        payload,
        preview,
        priority: express ? 9 : 0,
      });
      if (outcome.ok && outcome.jobId) {
        setActiveJobId(outcome.jobId);
        setResultImage(kind === "image" && image ? image.url : null); // keep image for box overlay
      } else {
        setNotice(outcome.retryAfter ? `${outcome.error} — retry in ${outcome.retryAfter}s` : outcome.error ?? "failed");
      }
    } catch (e: unknown) {
      // Without this the button stays disabled on "Submitting…" until a page
      // reload: submit() can throw (bad VITE_WS_BASE makes the WebSocket
      // constructor throw synchronously, a truncated 202 body breaks .json()).
      setNotice((e as Error)?.message ?? "submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-raised flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Submit inference</h2>
        <span className="label-eyebrow">{model?.input_type ?? "—"}</span>
      </div>

      {/* Model selector */}
      <div className="flex flex-wrap gap-2">
        {models.map((m) => (
          <button
            key={m.name}
            onClick={() => setModelName(m.name)}
            className={`focusable rounded-lg border px-3 py-1.5 text-xs transition ${
              model?.name === m.name
                ? "border-accent/60 bg-accent/10 text-accent shadow-glow"
                : "border-hairline text-ink-muted hover:bg-surface-hover"
            }`}
          >
            {m.name}
          </button>
        ))}
        {models.length === 0 && <div className="skeleton h-7 w-40" />}
      </div>

      {/* Input — chosen by the model's input_type */}
      {model?.input_type === "image" ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void onFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className="focusable flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline bg-surface/40 p-3 text-center transition hover:border-accent/50"
          tabIndex={0}
          role="button"
          aria-label="Drop an image"
        >
          {image ? (
            <img src={image.url} alt={image.name} className="max-h-20 rounded-lg object-contain" />
          ) : (
            <>
              <span className="text-2xl">⬇</span>
              <span className="text-sm text-ink-muted">Drop an image, or click to browse</span>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
      ) : model?.input_type === "audio" ? (
        <AudioInput onAudio={onAudio} audio={audio} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="focusable w-full resize-none rounded-xl border border-hairline bg-surface/40 p-3 text-sm text-ink placeholder:text-ink-faint"
          placeholder="Type or paste text to classify…"
        />
      )}

      {/* Priority lane toggle. Redis Streams are FIFO, so this routes the job to
          a separate express stream that workers drain first — not a sort key. */}
      <button
        onClick={() => setExpress((e) => !e)}
        aria-pressed={express}
        className={`focusable flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
          express
            ? "border-warn/60 bg-warn/10 text-ink"
            : "border-hairline bg-surface/40 text-ink-muted hover:bg-surface-hover"
        }`}
      >
        <span>{express ? "⚡ Express lane" : "Normal lane"}</span>
        <span className="ml-2 shrink-0 text-ink-faint">
          {express ? "priority 9 · served first" : "priority 0 · FIFO"}
        </span>
      </button>

      <Magnetic strength={0.25}>
        <button
          onClick={onSubmit}
          disabled={busy || !model}
          data-cursor="hover"
          className="focusable group relative w-full overflow-hidden rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-base transition hover:brightness-110 disabled:opacity-50"
        >
          <span className="relative z-10">{busy ? "Submitting…" : "Run inference →"}</span>
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        </button>
      </Magnetic>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live result */}
      <AnimatePresence>
        {activeJob && (
          <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex max-h-[44vh] flex-col gap-3 overflow-y-auto rounded-xl border border-hairline bg-surface/40 p-4"
          >
            <JobLifecycle phase={activeJob.phase} />
            {activeJob.result?.status === "success" && (
              <>
                {(() => {
                  const task = models.find((m) => m.name === activeJob.modelName)?.task;
                  const preds = activeJob.result.predictions;
                  if (task === "transcription") {
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="label-eyebrow">Transcript</span>
                        <p className="rounded-lg border border-hairline bg-surface/40 p-3 text-sm leading-relaxed text-ink">
                          “{preds[0]?.label || "(no speech detected)"}”
                        </p>
                      </div>
                    );
                  }
                  if (task === "detection" && preds.some((p) => p.box) && resultImage) {
                    return <ImageDetections url={resultImage} predictions={preds} />;
                  }
                  if (task === "search") {
                    return (
                      <div className="flex flex-col gap-2">
                        <span className="label-eyebrow">Top matches</span>
                        {preds.map((p, i) => (
                          <div key={i} className="rounded-lg border border-hairline bg-surface/40 p-2.5">
                            <p className="text-xs leading-relaxed text-ink">{p.label}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              {p.source && (
                                <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                                  ⧉ {p.source}
                                </span>
                              )}
                              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-hover">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p.score * 100)}%` }} />
                              </div>
                              <span className="tnum text-[10px] text-ink-muted">{(p.score * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return <ConfidenceBars predictions={preds} />;
                })()}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted tnum">
                  {activeJob.result.cached ? (
                    <span className="rounded bg-ok/15 px-1.5 text-ok">⚡ cached</span>
                  ) : (
                    <span className="text-accent">
                      processed in a batch of {activeJob.result.batch_size}
                    </span>
                  )}
                  <span>queue {fmtMs(activeJob.result.timings.queue_ms)}</span>
                  <span>wait {fmtMs(activeJob.result.timings.batch_wait_ms)}</span>
                  <span>infer {fmtMs(activeJob.result.timings.inference_ms)}</span>
                  <span>total {fmtMs(activeJob.result.timings.total_ms)}</span>
                </div>
                {/* Detection -> Fleet: the vehicles the model just found in this
                    photo become live traffic on the Fleet Command map. */}
                {(() => {
                  const found = vehicleLabels(activeJob.result.predictions ?? []);
                  if (!found.length) return null;
                  const counts = found.reduce<Record<string, number>>((acc, l) => {
                    acc[l] = (acc[l] ?? 0) + 1;
                    return acc;
                  }, {});
                  const summary = Object.entries(counts)
                    .map(([l, n]) => `${n} ${l}${n === 1 ? "" : "s"}`)
                    .join(" · ");
                  return (
                    <button
                      onClick={() => {
                        queueFleetSpawns(found);
                        setFleetOpen(true);
                      }}
                      className="focusable flex w-full items-center justify-between rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] text-ink transition hover:bg-accent/20"
                    >
                      <span>🚗 Send {found.length} detected to Fleet map</span>
                      <span className="ml-2 shrink-0 text-ink-muted">{summary}</span>
                    </button>
                  );
                })()}
              </>
            )}
            {activeJob.result?.status === "error" && (
              <p className="text-xs text-danger">{activeJob.result.error}</p>
            )}
            {activeJob.error && <p className="text-xs text-danger">{activeJob.error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
