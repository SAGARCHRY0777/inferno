"""Corpus indexing for the eval harness.

The golden set refers to passages by a stable id rather than by text, so an
edited passage does not silently invalidate every reference to it. Ids are
``<file stem>:<ordinal>`` — readable in a diff, and stable as long as passages
are not reordered within a file.

This module deliberately re-implements nothing: it imports the *same* chunker
the served model uses, so the harness can never measure a different chunking
than production runs. If that chunker changes, the corpus hash changes and the
gate refuses to compare against a stale baseline.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from backend.models.chunking import DEFAULT_CORPUS_DIR, chunk_markdown


@dataclass(frozen=True)
class Chunk:
    """One retrievable passage, with the id the golden set refers to it by."""

    id: str
    text: str
    source: str


def load_chunks(corpus_dir: Path | None = None) -> list[Chunk]:
    """Every passage in the corpus, in the order the model indexes them."""

    root = Path(corpus_dir or DEFAULT_CORPUS_DIR)
    if not root.exists():
        raise FileNotFoundError(f"corpus dir not found: {root}")

    chunks: list[Chunk] = []
    for path in sorted(root.glob("*.md")):
        for ordinal, text in enumerate(chunk_markdown(path.read_text(encoding="utf-8"))):
            chunks.append(Chunk(id=f"{path.stem}:{ordinal}", text=text, source=path.name))
    if not chunks:
        raise ValueError(f"no passages found in corpus: {root}")
    return chunks


def corpus_hash(chunks: list[Chunk]) -> str:
    """Content hash over ids and text.

    Committed alongside every result set. A changed hash means the corpus or the
    chunker moved, so the golden set's references may no longer point at what
    their author intended and scores are not comparable across the change. This
    is the guard against the "silent staleness" failure mode, where reference
    answers rot as documents change and nobody notices the numbers drifting.
    """

    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(chunk.id.encode())
        digest.update(b"\0")
        digest.update(chunk.text.encode())
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def text_to_id(chunks: list[Chunk]) -> dict[str, str]:
    """Map passage text back to its id.

    The served model returns passage *text* and source file, not ids, and is
    left that way on purpose — production has no reason to carry an eval
    concern. Passages are unique within the corpus, so an exact-text lookup
    recovers the id unambiguously.
    """

    mapping = {chunk.text: chunk.id for chunk in chunks}
    if len(mapping) != len(chunks):
        duplicates = len(chunks) - len(mapping)
        raise ValueError(
            f"{duplicates} duplicate passage(s) in the corpus: ids cannot be "
            "recovered from text. Give the retriever explicit ids instead."
        )
    return mapping


def main() -> None:
    """Print the indexed corpus — used when authoring golden items."""

    chunks = load_chunks()
    print(f"# corpus_hash={corpus_hash(chunks)}  chunks={len(chunks)}")
    for chunk in chunks:
        print(json.dumps({"id": chunk.id, "source": chunk.source, "text": chunk.text}))


if __name__ == "__main__":
    main()
