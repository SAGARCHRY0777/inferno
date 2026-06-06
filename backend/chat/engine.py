"""Local LLM chat engine with async token streaming.

Loads a small instruct model lazily (first request), then streams generated
tokens one at a time. Generation runs in a worker thread (transformers'
``model.generate`` is blocking) while the async caller pulls tokens off a
``TextIteratorStreamer`` without blocking the event loop.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator

from backend.core.config import get_settings
from backend.core.logging import get_logger

_log = get_logger("chat.engine")
_DONE = object()


class ChatEngine:
    """Lazy-loaded local instruct model that streams tokens."""

    def __init__(self) -> None:
        self._model = None
        self._tok = None
        self._device = "cpu"
        self._lock = threading.Lock()

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            from transformers import AutoModelForCausalLM, AutoTokenizer

            from backend.models.runtime import resolve_torch_device

            s = get_settings().chat
            self._device = resolve_torch_device()
            _log.info("chat_model_loading", model_id=s.model_id, device=self._device)
            self._tok = AutoTokenizer.from_pretrained(s.model_id)
            self._model = (
                AutoModelForCausalLM.from_pretrained(s.model_id).eval().to(self._device)
            )
            _log.info("chat_model_loaded", model_id=s.model_id, device=self._device)

    async def stream(
        self, messages: list[dict], context: str = ""
    ) -> AsyncIterator[str]:
        """Stream the assistant's reply token-by-token.

        Args:
            messages: chat history as ``[{"role": "user"|"assistant", "content": ...}]``.
            context: optional retrieved passages to ground the answer (RAG).
        """

        await asyncio.get_event_loop().run_in_executor(None, self._ensure_loaded)
        from transformers import TextIteratorStreamer

        s = get_settings().chat
        system = (
            "You are Inferno's assistant — concise, accurate, and helpful. "
            "Answer the user's question."
        )
        if context:
            system += (
                " Use ONLY the following retrieved context to answer, and cite the "
                "source file in brackets. If the context doesn't contain the answer, "
                f"say so.\n\nContext:\n{context}"
            )
        chat = [{"role": "system", "content": system}, *messages]

        input_ids = self._tok.apply_chat_template(
            chat, add_generation_prompt=True, return_tensors="pt"
        ).to(self._device)

        streamer = TextIteratorStreamer(self._tok, skip_prompt=True, skip_special_tokens=True)
        kwargs = {
            "input_ids": input_ids,
            "max_new_tokens": s.max_new_tokens,
            "do_sample": s.temperature > 0,
            "temperature": max(s.temperature, 0.01),
            "streamer": streamer,
            "pad_token_id": self._tok.eos_token_id,
        }
        thread = threading.Thread(target=self._model.generate, kwargs=kwargs, daemon=True)
        thread.start()

        loop = asyncio.get_event_loop()
        while True:
            token = await loop.run_in_executor(None, lambda: next(streamer, _DONE))
            if token is _DONE:
                break
            if token:
                yield token


engine = ChatEngine()
