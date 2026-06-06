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

      try {
        const res = await fetch(endpoints.chat, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, use_rag: useRag }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`chat HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            if (!line.startsWith("data: ")) continue;
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "token") {
              acc += evt.token;
              setLast(acc);
            } else if (evt.type === "sources") {
              setSources(evt.sources);
            } else if (evt.type === "error") {
              acc += `\n\n⚠ ${evt.error}`;
              setLast(acc);
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setLast("⚠ Chat service unreachable — start it with scripts\\run-chat.bat");
        }
      } finally {
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
