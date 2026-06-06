import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useChat } from "@/hooks/useChat";
import { useStore } from "@/store/useStore";

export function ChatModal() {
  const open = useStore((s) => s.chatOpen);
  const setOpen = useStore((s) => s.setChatOpen);
  const { messages, streaming, sources, send, stop, reset } = useChat();
  const [input, setInput] = useState("");
  const [useRag, setUseRag] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const submit = () => {
    if (!input.trim()) return;
    send(input, useRag);
    setInput("");
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[92] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            className="glass-raised fixed inset-x-4 top-[6vh] z-[93] mx-auto flex h-[80vh] max-w-2xl flex-col p-5 sm:inset-x-auto sm:w-[640px]"
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Inferno Assistant</h3>
                <p className="text-[11px] text-ink-faint">local LLM · streaming · RAG-grounded</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={reset}
                  className="focusable rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-hover"
                >
                  Clear
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="focusable rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-hover"
                >
                  Esc ✕
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-ink-faint">
                  <span className="text-2xl">▲</span>
                  Ask about the platform — e.g. <em>“How does backpressure work?”</em>
                  <span className="text-[11px]">answers are grounded in the doc corpus with citations</span>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <span className="label-eyebrow">{m.role === "user" ? "you" : "assistant"}</span>
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap rounded-xl border border-hairline px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user" ? "bg-accent/10 text-ink" : "bg-surface/50 text-ink"
                    }`}
                  >
                    {m.content || (streaming && i === messages.length - 1 ? "▍" : "")}
                  </div>
                </div>
              ))}
              {sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-ink-faint">sources:</span>
                  {sources.map((s) => (
                    <span key={s} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                      ⧉ {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                <input type="checkbox" checked={useRag} onChange={(e) => setUseRag(e.target.checked)} className="accent-accent" />
                ground with RAG (retrieve + cite from the corpus)
              </label>
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  placeholder="Ask a question…  (Enter to send, Shift+Enter for newline)"
                  className="focusable min-h-0 flex-1 resize-none rounded-xl border border-hairline bg-surface/40 p-3 text-sm"
                />
                {streaming ? (
                  <button onClick={stop} className="focusable rounded-xl border border-danger/50 bg-danger/10 px-4 py-2.5 text-sm text-danger">
                    Stop
                  </button>
                ) : (
                  <button onClick={submit} className="focusable rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:brightness-110">
                    Send →
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
