import { useEffect, useRef, useState } from "react";

import { toWav16k } from "@/lib/audio";

interface Audio {
  b64: string;
  url: string;
  seconds: number;
}

/** Record from the mic or upload an audio file; emits 16 kHz mono WAV. */
export function AudioInput({
  onAudio,
  audio,
}: {
  onAudio: (a: Audio) => void;
  audio: Audio | null;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Release the microphone if this component unmounts mid-recording. It is
  // rendered conditionally on the selected model being audio, so switching
  // models while recording unmounts it: without this the MediaRecorder keeps
  // running, the browser's recording indicator stays lit, and chunksRef keeps
  // accumulating Blobs for the life of the page.
  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* recorder already torn down */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  async function startRec() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setBusy(true);
        try {
          onAudio(await toWav16k(new Blob(chunksRef.current, { type: rec.mimeType })));
        } catch {
          setError("Could not process audio.");
        }
        setBusy(false);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError("Microphone access denied.");
    }
  }

  function stopRec() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function onFile(f: File) {
    setError(null);
    setBusy(true);
    try {
      onAudio(await toWav16k(f));
    } catch {
      setError("Unsupported audio file.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-hairline bg-surface/40 p-4">
      <div className="flex gap-2">
        {!recording ? (
          <button
            onClick={startRec}
            disabled={busy}
            data-cursor="hover"
            className="focusable flex flex-1 items-center justify-center gap-2 rounded-lg border border-hairline bg-surface/50 py-2 text-xs text-ink transition hover:border-accent/50 disabled:opacity-40"
          >
            ● Record
          </button>
        ) : (
          <button
            onClick={stopRec}
            className="focusable flex flex-1 items-center justify-center gap-2 rounded-lg border border-danger/50 bg-danger/10 py-2 text-xs text-danger"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-danger" /> Stop
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="focusable rounded-lg border border-hairline bg-surface/50 px-3 py-2 text-xs text-ink-muted transition hover:bg-surface-hover disabled:opacity-40"
        >
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </div>
      {busy && <span className="text-[11px] text-ink-muted">processing audio…</span>}
      {error && <span className="text-[11px] text-danger">{error}</span>}
      {audio && !busy && (
        <div className="flex items-center gap-2">
          <audio src={audio.url} controls className="h-8 w-full" />
          <span className="tnum shrink-0 text-[11px] text-ink-faint">{audio.seconds.toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
}
