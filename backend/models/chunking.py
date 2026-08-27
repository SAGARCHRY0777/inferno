"""Corpus chunking, kept free of the ML stack on purpose.

``rag.py`` imports numpy and sentence-transformers at module scope, so anything
importing it drags the whole CPU/GPU model stack in. The eval harness needs the
*exact* chunker the served model uses — measuring a different chunking than
production runs would make the numbers meaningless — but it must also run in the
fast CI lane, which installs core requirements only.

Splitting the chunker out satisfies both: one implementation, importable with
nothing beyond the standard library.
"""

from __future__ import annotations

from pathlib import Path

DEFAULT_CORPUS_DIR = Path(__file__).resolve().parent / "corpus"


def chunk_markdown(text: str) -> list[str]:
    """Split a markdown doc into passages: non-heading paragraphs, trimmed."""

    chunks: list[str] = []
    for block in text.split("\n\n"):
        block = " ".join(block.split())  # collapse whitespace
        if not block or block.startswith("#"):
            continue
        chunks.append(block)
    return chunks
