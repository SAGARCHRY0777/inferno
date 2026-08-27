"""The gate: turn a run report into a merge decision.

An ungated eval gets ignored within three weeks, so this is the part that makes
the harness engineering rather than reporting. Three independent checks, because
each catches something the others cannot:

* an **absolute floor**, so quality cannot drift down one acceptable step at a
  time until it is bad;
* a **max regression** against the committed baseline, so a single change cannot
  give back more than an agreed amount even while still above the floor;
* a **per-bucket floor**, because an aggregate is blind. A six-item bucket going
  from 1.00 to 0.00 moves a 50-item headline by 12 points and can easily sit
  inside the noise band.

The report also carries the hashes of the corpus and dataset. If either moved,
the comparison is between two different measurements and the gate says so rather
than quietly reporting a regression.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from evals.runner import RunReport
from evals.scorers import mcnemar_counts

BASELINE = Path(__file__).resolve().parent / "baselines" / "baseline_main.json"


@dataclass(frozen=True)
class Thresholds:
    """The gate's policy. Deliberately small and deliberately committed.

    ``max_regression`` is set at 0.06 rather than something tighter because the
    95% interval on 50 items is roughly +/-11 points: a tighter gate would fail
    on noise and be switched off within a month. It is a guard against a real
    drop, not a precision instrument -- that is what the paired McNemar counts
    in the report are for.
    """

    primary_floor: float = 0.70
    max_regression: float = 0.06
    bucket_floor: float = 0.50


@dataclass
class GateResult:
    passed: bool
    reasons: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def render(self) -> str:
        lines = ["GATE: PASS" if self.passed else "GATE: FAIL"]
        lines += [f"  x {reason}" for reason in self.reasons]
        lines += [f"  - {note}" for note in self.notes]
        return "\n".join(lines)


def load_baseline(path: Path = BASELINE) -> dict | None:
    """The last accepted run, or None when no baseline is committed yet."""

    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def check(
    report: RunReport,
    baseline: dict | None,
    thresholds: Thresholds = Thresholds(),
) -> GateResult:
    """Apply the policy. Pure: no I/O, no exit codes, so it is testable."""

    result = GateResult(passed=True)
    primary = report.metrics["primary"]
    low, high = report.interval["primary"]
    result.notes.append(
        f"primary {primary:.4f} (95% CI {low:.2f}-{high:.2f}, n={report.n})"
    )

    if primary < thresholds.primary_floor:
        result.passed = False
        result.reasons.append(
            f"primary {primary:.4f} below floor {thresholds.primary_floor:.2f}"
        )

    for name, bucket in report.by_bucket.items():
        if bucket["primary"] < thresholds.bucket_floor:
            result.passed = False
            result.reasons.append(
                f"bucket '{name}' {bucket['primary']:.4f} below "
                f"bucket floor {thresholds.bucket_floor:.2f} (n={int(bucket['n'])})"
            )

    if baseline is None:
        result.notes.append("no committed baseline: floors enforced, regression skipped")
        return result

    if baseline.get("retriever") != report.retriever:
        result.notes.append(
            f"baseline is for retriever '{baseline.get('retriever')}', "
            f"this run is '{report.retriever}': regression check skipped"
        )
        return result

    # A changed corpus or dataset means the two runs measured different things.
    # Reporting a "regression" across that boundary would be misleading, so the
    # gate refuses the comparison and says why.
    for label, key in (("corpus", "corpus_hash"), ("dataset", "dataset_hash")):
        if baseline.get(key) and baseline[key] != getattr(report, key):
            result.notes.append(
                f"{label} changed ({baseline[key]} -> {getattr(report, key)}): "
                "regression check skipped, re-baseline deliberately"
            )
            return result

    previous = baseline["metrics"]["primary"]
    delta = primary - previous
    fixed, broken = mcnemar_counts(baseline.get("per_item", {}), report.per_item)
    result.notes.append(
        f"vs baseline {previous:.4f}: delta {delta:+.4f} "
        f"({fixed} fixed, {broken} broken)"
    )

    if delta < -thresholds.max_regression:
        result.passed = False
        result.reasons.append(
            f"primary regressed {delta:+.4f}, more than the allowed "
            f"-{thresholds.max_regression:.2f}"
        )

    newly_broken = sorted(
        item
        for item, score in report.per_item.items()
        if score < baseline.get("per_item", {}).get(item, 0.0)
    )
    if newly_broken:
        # Not a failure on its own -- a couple of flips on 50 items is noise --
        # but it is the only part of the output a reviewer reliably reads.
        result.notes.append(f"newly failing: {', '.join(newly_broken)}")

    return result
