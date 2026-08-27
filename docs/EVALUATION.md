# Evaluation and failure injection

Two things quality claims usually rest on and rarely prove: *is retrieval any
good?* and *is the at-least-once delivery claim true?* This directory documents
the harness that answers both, and the ways it can still mislead you.

---

## 1. The eval harness

Five parts. Each is load-bearing — remove one and it stops being a harness.

| Part | Where | If it were missing |
|---|---|---|
| **Dataset** | `evals/datasets/golden_rag.jsonl` — 50 frozen items | Today's score would not be comparable to yesterday's |
| **Runner** | `evals/runner.py` | No way to get identical results on a laptop and in CI |
| **Scorers** | `evals/scorers.py` — pure functions | Untestable. These are unit-tested in `backend/tests/test_evals.py` |
| **Baseline** | `evals/baselines/baseline_main.json`, committed | A score with nothing to compare against is a vanity number |
| **Gate** | `evals/gate.py` | Ungated evals get ignored within about three weeks |

```bash
python -m evals run   --retriever lexical    # score and print
python -m evals gate  --retriever lexical    # score and enforce; exit 1 blocks the merge
python -m evals gate  --retriever rag        # the real embedding + reranker stack
python -m evals baseline --retriever rag     # accept the current scores (a reviewed diff)
```

`baseline` is deliberately a separate, manual command. Accepting a quality change
should be a decision someone signs off on in a pull request, not something that
happens silently on a green run.

### The dataset

50 items over the 16-passage corpus, in seven buckets. Every passage is the
target of at least one item — an unreferenced passage is an untested passage,
and that is checked by a test rather than by good intentions.

| Bucket | n | What it is for |
|---|---|---|
| `serving` | 10 | Straightforward questions about inference serving |
| `architecture` | 9 | Straightforward questions about Inferno's design |
| `retrieval` | 9 | Straightforward questions about RAG and vectors |
| `paraphrase` | 8 | Deliberately avoids the corpus's own vocabulary |
| `unanswerable` | 6 | Plausible questions the corpus genuinely cannot answer |
| `observability` | 5 | Metrics, tracing, autoscaling |
| `multi_chunk` | 3 | Needs two or more passages to be answered |

`paraphrase` and `unanswerable` are the two that earn their keep. Paraphrase is
where a keyword matcher should fail and an embedding model should not.
Unanswerable is the guard against a system that scores well by confidently
answering everything — which is the single behaviour that produces fluent
fiction.

### Metrics

| Metric | Meaning |
|---|---|
| `hit@5` | Any relevant passage in the top 5 |
| `recall@5` | Fraction of relevant passages found (differs from hit only for `multi_chunk`) |
| `mrr` | Rank-sensitive: rewards putting the right passage first |
| `groundedness` | The reference answer span appears verbatim in what was retrieved |
| `abstention` | On unanswerable items, the top score fell below the retriever's threshold |
| `abstain_margin` | Diagnostic: mean confidence on answerable minus unanswerable |
| `primary` | The gated number: `hit@5` on answerable items, `abstention` on unanswerable |

**Groundedness is asked one step earlier than usual here.** This system retrieves
but does not generate, so the question is not *did the model stay faithful to its
context* but *does the context contain the answer at all*. If it does not, no
downstream generator could answer without inventing something.

---

## 2. Current numbers

Baseline: `lexical-baseline`, corpus `b962a80f`, dataset `1c640984`.

```
hit@5          0.9091      groundedness   0.8864
recall@5       0.8902      abstention     1.0000   (see the warning below)
mrr            0.8000      abstain_margin 0.0762
primary        0.9200      95% CI         0.8116 - 0.9685
```

| Bucket | primary | n |
|---|---|---|
| serving | 1.0000 | 10 |
| retrieval | 1.0000 | 9 |
| multi_chunk | 1.0000 | 3 |
| unanswerable | 1.0000 | 6 |
| architecture | 0.8889 | 9 |
| observability | 0.8000 | 5 |
| **paraphrase** | **0.7500** | 8 |

Failing: `rag-006`, `rag-030`, `rag-035`, `rag-036`.

Read those numbers with three caveats, in order of how badly they would mislead
you:

**The confidence interval is ±8 points.** On 50 items at p=0.92 the 95% interval
runs 0.81–0.97. A change that moves `primary` from 0.92 to 0.94 is not evidence
of anything. This is why the report also carries per-item outcomes: the right
comparison is paired — same items, count the flips — not two aggregate numbers
from two runs. `mcnemar_counts` does that, and the gate prints `(n fixed, n
broken)` on every run.

**`abstention 1.0000` is close to meaningless for this retriever.** The lexical
baseline's answerable and unanswerable score distributions overlap heavily
(0.13–0.80 against 0.27–0.46), so no threshold separates them well. It scores
1.0 only because its scores rarely cross the threshold at all — at the
cross-encoder's 0.5 it would also have "abstained" on 27 of 44 *answerable*
questions. That is why `abstain_threshold` is a property of each retriever
rather than a constant, and why `abstain_margin` is reported next to it. A
margin near zero means the abstention rate reflects where the threshold sits,
not judgement.

**The baseline is a keyword matcher, and it scores 0.92.** The corpus is 16
passages and most questions share vocabulary with their answer, so this is an
easy set for lexical matching. The number to watch when comparing retrievers is
the `paraphrase` bucket (0.75), which is the one place the baseline is
structurally weak. A headline improvement that does not move `paraphrase` has
probably not bought anything.

### The gate

Three independent checks, because each catches what the others cannot:

- **absolute floor** (`primary >= 0.70`) — quality cannot drift down one
  acceptable step at a time;
- **max regression** (`-0.06` against the committed baseline) — one change
  cannot give back more than an agreed amount even while still above the floor;
- **per-bucket floor** (`>= 0.50`) — aggregates are blind. A six-item bucket
  going 1.00 → 0.00 moves a 50-item headline by 12 points, comfortably inside
  the noise band.

`max_regression` is 0.06 and not something tighter on purpose: with a ±8 point
interval, a tighter gate fails on noise and gets switched off within a month.

The gate **refuses to compare** across a changed corpus or dataset hash. Editing
a passage is legitimate, but it makes today's score incomparable with
yesterday's, and reporting that as a "regression" would be a lie. This is the
guard against silent staleness — reference answers rotting as documents change.

---

## 3. Failure injection

`backend/tests/failure/test_worker_crash_reclaim.py`

The platform claims at-least-once delivery with reclaim of abandoned work. The
test attacks the one window where that claim can fail: after `XREADGROUP` has
delivered an entry — it is now pending against that consumer — and before
anything has been published or acked.

```
gateway          redis stream          worker-A            worker-B
   |-- XADD ---------->|                  |
   |                   |<-- XREADGROUP ---|      entry PENDING, owner = A
   |                   |          ### os._exit(137) ###          <-- crash point
   |                   |                  X
   |                   |  still PENDING, idle climbing
   |                   |<---- XCLAIM ------------------------|
   |                   |<---- publish result ----------------|
   |                   |<---- XACK --------------------------|
```

Four assertions:

1. after the kill, exactly one entry is pending, owned by the dead consumer;
2. no result was written before the crash;
3. a healthy worker reclaims and publishes it;
4. the pending list drains, and exactly one observable result exists.

**Measured recovery: 0.56 s**, with `reclaim_min_idle_ms` at 400 ms under test.
Production uses 90 s, deliberately: "idle" means time since *delivery*, not time
since the owner died, so the threshold must exceed the slowest realistic batch or
a healthy worker's in-flight work gets stolen and executed twice. It is a
recovery-time budget, not a constant.

### Why `os._exit` and not `sys.exit`

`sys.exit` raises `SystemExit`, which the worker's `try/finally` would catch on
the way out — running the drain heartbeat and potentially an ack. The test would
then pass for the wrong reason. `os._exit` skips `finally` blocks, `atexit`
handlers and buffer flushes, which is what an OOM kill or a lost node actually
looks like.

The crash point lives in `Worker._maybe_crash`, behind `INFERNO_CRASH_AFTER_READ`,
and there is a test asserting it stays inert when that variable is unset.

### The test was verified to have power

A failure test nobody has watched fail is decoration. Acking on read instead of
after publishing — the classic form of this bug — makes it fail:

```
AssertionError: expected exactly one orphaned entry, got []
assert 0 == 1
```

The ack removes the entry from the pending list while no result exists anywhere,
so the job is lost outright and there is nothing left to reclaim. That red run
was observed before the test was committed.

### At-least-once means duplicates

The guarantee is *never lost*, not *never repeated*. After a reclaim the work is
genuinely done twice. What the test asserts is that exactly one **observable**
result exists, which idempotent writes keyed on job id provide. A test asserting
"delivered exactly once" would be asserting something the system does not claim.

---

## 4. CI

`.github/workflows/evals.yml`, tiered so that the parts which gate are the parts
that are cheap and deterministic.

| Job | Runs on | Cost |
|---|---|---|
| `eval-gate` | every PR | ~1 min, no model downloads |
| `failure-injection` | every PR | ~1 min, Redis service container |
| `eval-real-model` | nightly + manual | slow; installs the CPU ML stack, caches weights |

The real model is not on the PR lane because a job that downloads a model stack
on every push gets switched off, and a chaos suite that blocks merges gets
deleted. Both still run — just where they will survive.

---

## 5. What this does not measure

Worth saying out loud, because an interviewer will ask and the honest list is
short and specific:

- **No generation, so no faithfulness or answer quality.** There is no LLM in
  this pipeline; `groundedness` checks retrieval sufficiency, not output.
- **No LLM judge, so no judge-agreement number.** Adding one would mean
  validating it against human labels first; an unvalidated judge is an
  unmeasured ruler.
- **The dataset is written, not sampled from traffic.** It reflects what its
  author imagined users would ask. The correct fix is the ratchet: every
  confirmed real-world failure becomes a golden item, and the set only grows.
- **n=50 is small.** Every rate here carries roughly ±8 points. The set is sized
  for a corpus of 16 passages, not for detecting small effects.
- **The corpus is tiny.** Numbers on 16 passages say little about behaviour at
  100k, where approximate nearest-neighbour recall becomes the dominant term.
