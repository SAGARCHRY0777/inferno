import { useCallback, useEffect, useRef, useState } from "react";

import { endpoints } from "@/config";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Streaming chat client. POSTs the history to the chat service and reads the
 * SSE token stream off the response body (fetch + ReadableStream), appending
 * tokens to the last assistant message as they arrive.
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, useRag: boolean) => {
      if (!text.trim() || streaming) return;
      const history: ChatMsg[] = [...messages, { role: "user", content: text }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setStreaming(true);
      setSources([]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const setLast = (content: string) =>
        setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, content } : msg)));

      // Declared outside the try so the catch can keep the tokens streamed so far
      // and the finally can release the response body.
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let acc = "";

      try {
        const res = await fetch(endpoints.chat, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, use_rag: useRag }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`chat HTTP ${res.status}`);

        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            if (!line.startsWith("data: ")) continue;
            // One malformed SSE line must not abort the whole stream and discard
            // everything received so far — skip it and keep reading.
            let evt: { type?: string; token?: string; sources?: unknown; error?: string };
            try {
              evt = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (evt.type === "token") {
              acc += evt.token ?? "";
              setLast(acc);
            } else if (evt.type === "sources") {
              setSources(evt.sources as never);
            } else if (evt.type === "error") {
              acc += `\n\n⚠ ${evt.error}`;
              setLast(acc);
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          // Append rather than replace. Overwriting threw away every token
          // already streamed and rendered, and claimed the service was
          // unreachable even when it had answered and then failed mid-stream.
          acc += acc
            ? "\n\n⚠ Connection lost mid-response."
            : "⚠ Chat service unreachable — start it with scripts\\run-chat.bat";
          setLast(acc);
        }
      } finally {
        // Release the response body: an abandoned reader holds its connection
        // open until GC.
        try {
          await reader?.cancel();
        } catch {
          /* already released */
        }
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSources([]);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, streaming, sources, send, stop, reset };
}
