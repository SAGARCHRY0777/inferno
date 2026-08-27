"""Command line for the eval harness.

    python -m evals run     --retriever lexical      # score, print, write report
    python -m evals gate    --retriever rag          # score and enforce the policy
    python -m evals baseline --retriever rag         # accept the current scores

``gate`` is what CI calls: exit 0 to merge, exit 1 to block. ``baseline`` is a
deliberate act that produces a reviewable diff -- accepting a quality change is
a decision someone signs off on in a pull request, not something that happens
automatically on a green run.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from evals.gate import BASELINE, Thresholds, check, load_baseline
from evals.retrievers import build_retriever
from evals.runner import DEFAULT_K, RunReport, load_dataset, run


def _run(args: argparse.Namespace) -> RunReport:
    retriever = build_retriever(args.retriever)
    report = run(retriever, load_dataset(), k=args.k)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(report.to_json(), encoding="utf-8")
    return report


def _summary(report: RunReport) -> str:
    low, high = report.interval["primary"]
    lines = [
        f"retriever   {report.retriever}   n={report.n}   k={report.k}",
        f"corpus      {report.corpus_hash}   dataset {report.dataset_hash}",
        "",
        "metrics",
    ]
    lines += [f"  {name:<14} {value:.4f}" for name, value in report.metrics.items()]
    lines += [f"  {'95% CI':<14} {low:.4f} - {high:.4f}   (on primary)", "", "by bucket"]
    for name, bucket in report.by_bucket.items():
        lines.append(f"  {name:<14} {bucket['primary']:.4f}   n={int(bucket['n'])}")
    if report.failures:
        lines += ["", f"failing items ({len(report.failures)})", "  " + ", ".join(report.failures)]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evals", description=__doc__)
    parser.add_argument(
        "command", choices=("run", "gate", "baseline"), help="what to do"
    )
    parser.add_argument(
        "--retriever", default="lexical", choices=("lexical", "rag"),
        help="system under test (default: lexical, the dependency-free baseline)",
    )
    parser.add_argument("--k", type=int, default=DEFAULT_K, help="top-k for retrieval metrics")
    parser.add_argument("--out", help="write the full JSON report here")
    parser.add_argument(
        "--baseline", default=str(BASELINE), help="baseline file to compare against"
    )
    parser.add_argument(
        "--primary-floor", type=float, default=Thresholds().primary_floor
    )
    parser.add_argument(
        "--max-regression", type=float, default=Thresholds().max_regression
    )
    parser.add_argument("--bucket-floor", type=float, default=Thresholds().bucket_floor)
    args = parser.parse_args(argv)

    report = _run(args)
    print(_summary(report))

    if args.command == "run":
        return 0

    if args.command == "baseline":
        path = Path(args.baseline)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(report.to_json(), encoding="utf-8")
        print(f"\nbaseline written to {path}")
        return 0

    thresholds = Thresholds(
        primary_floor=args.primary_floor,
        max_regression=args.max_regression,
        bucket_floor=args.bucket_floor,
    )
    outcome = check(report, load_baseline(Path(args.baseline)), thresholds)
    print("\n" + outcome.render())
    return 0 if outcome.passed else 1


if __name__ == "__main__":
    sys.exit(main())
