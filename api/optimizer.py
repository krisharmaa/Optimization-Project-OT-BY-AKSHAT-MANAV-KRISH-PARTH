"""One website optimisation run: the final memetic NSGA-II plus the repeated-greedy baseline.

The optimizer is called exactly as in the CLI (``main.py solve --method memetic``) and in the validation
study. Nothing here changes its operators, constraints or objectives:

* ``timetable.memetic.memetic_nsga2`` searches; the only hook used is its ``evaluator`` argument, wrapped to
  count calls for the progress bar (it still calls the shared ``evaluate``).
* ``timetable.experiments.greedy_search`` is the strong baseline of the report, given the SAME number of
  full evaluations the memetic run actually used and the same seed (the equal-evaluation protocol).
* ``timetable.experiments.serialize_run`` re-checks every archived timetable with the independent evaluator
  and computes hypervolume with the report's a-priori normalisation and reference point (1.1, 1.1, 1.1).

Every run is also saved in the CLI's own format under ``results/web/<run id>/`` (instance.json, run.json,
baseline.json) so it can be re-validated with ``python main.py evaluate``.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Callable

import numpy as np

from timetable.evaluation import evaluate
from timetable.experiments import greedy_search, serialize_run
from timetable.memetic import memetic_nsga2
from timetable.model import Problem, problem_to_dict, schedule_to_dict

from .bridge import problem_to_web, schedule_to_solution

ROOT = Path(__file__).resolve().parents[1]
METHOD = "Feasible memetic NSGA-II (final method)"
BASELINE = "Repeated greedy / DSatur (equal evaluations)"


@dataclass
class RunConfig:
    seed: int = 0
    budget: int = 360
    population: int = 24
    search_seconds: float | None = 6.0
    compare_baseline: bool = True
    label: str = "web"


class NoFeasibleTimetable(RuntimeError):
    pass


def _compromise(values: list[tuple[float, float, float]]) -> int:
    """Index of the report's 'normalized_compromise' (closest to the normalised ideal of the given front)."""
    a = np.asarray(values, dtype=float)
    span = np.ptp(a, axis=0)
    scaled = (a - a.min(axis=0)) / np.where(span > 0, span, 1)
    return int(np.argmin(np.linalg.norm(scaled, axis=1)))


def run_optimizer(problem: Problem, cfg: RunConfig, progress: Callable[[dict], None] | None = None,
                  save: bool = True, run_id: str | None = None) -> dict:
    report = progress or (lambda _p: None)
    started = perf_counter()
    calls = {"n": 0, "feasible": 0, "last": 0.0}

    def counted_evaluate(prob, schedule):
        ev = evaluate(prob, schedule)
        calls["n"] += 1
        calls["feasible"] += ev.feasible
        now = perf_counter()
        if now - calls["last"] > 0.2:
            calls["last"] = now
            report({"phase": "memetic", "evaluations": calls["n"], "budget": cfg.budget,
                    "feasibleEvaluations": calls["feasible"], "seconds": now - started,
                    "secondsLimit": cfg.search_seconds})
        return ev

    report({"phase": "memetic", "evaluations": 0, "budget": cfg.budget, "seconds": 0.0, "secondsLimit": cfg.search_seconds})
    result = memetic_nsga2(problem, seed=cfg.seed, population_size=cfg.population, max_evaluations=cfg.budget,
                           time_limit=cfg.search_seconds, evaluator=counted_evaluate)
    if not result.archive:
        best = evaluate(problem, result.best_schedule) if result.best_schedule is not None else None
        detail = f" Smallest violation found: {best.violation} ({dict(best.violations)})." if best else ""
        raise NoFeasibleTimetable(
            "No feasible timetable was found within this budget. This is a search failure, not a proof that the "
            "constraints are impossible: try a larger budget/time, or relax teacher availability." + detail)
    run = serialize_run(problem, result, "memetic", cfg.seed)  # asserts every archived timetable is feasible

    baseline_run = baseline_result = None
    if cfg.compare_baseline:
        report({"phase": "baseline", "evaluations": result.evaluations, "budget": result.evaluations,
                "seconds": perf_counter() - started})
        baseline_result = greedy_search(problem, cfg.seed, result.evaluations)
        baseline_run = serialize_run(problem, baseline_result, "greedy", cfg.seed)

    report({"phase": "export", "evaluations": result.evaluations, "budget": cfg.budget, "seconds": perf_counter() - started})
    # Pareto archive (onFront) plus distinct feasible members of the final population (shown as grey dots).
    solutions = []
    archive_keys = set(result.archive)
    for i, schedule in enumerate(result.archive):
        solutions.append(schedule_to_solution(problem, schedule, f"S{i + 1:03d}", True))
    extra = 0
    for schedule in dict.fromkeys(result.population):
        if schedule in archive_keys:
            continue
        ev = evaluate(problem, schedule)
        if ev.feasible:
            extra += 1
            solutions.append(schedule_to_solution(problem, schedule, f"S{len(result.archive) + extra:03d}", False, ev))

    baseline = None
    baseline_front = []
    if baseline_result is not None and baseline_result.archive:
        values = [tuple(v) for v in baseline_run["objectives"]]
        pick = baseline_result.archive[_compromise(values)]
        baseline = schedule_to_solution(problem, pick, "GREEDY", False)
        baseline_front = [{"f1": v[0], "f2": v[1], "f3": v[2]} for v in values]

    meta = result.metadata
    stats = {
        "method": METHOD,
        "baselineMethod": BASELINE if cfg.compare_baseline else None,
        "runtime": run["runtime"],
        "evaluations": run["evaluations"],
        "budget": cfg.budget,
        "population": cfg.population,
        "searchSeconds": cfg.search_seconds,
        "stopReason": meta.get("stop_reason"),
        "generations": meta.get("generations_completed", 0),
        "frontSize": run["archive_size"],
        "hypervolume": run["hypervolume"],
        "spacing": run["spacing"] or 0.0,
        "baselineHypervolume": baseline_run["hypervolume"] if baseline_run else 0.0,
        "baselineFeasible": bool(baseline_run and baseline_run["feasible_run"]),
        "baselineRuntime": baseline_run["runtime"] if baseline_run else None,
        "baselineEvaluations": baseline_run["evaluations"] if baseline_run else None,
        "baselineFrontSize": baseline_run["archive_size"] if baseline_run else 0,
        "baselineFront": baseline_front,
        "normalization": run["normalization"],
        "reference": run["reference"],
        "convergence": [
            {"generation": h["generation"], "evaluations": h["evaluations"], "hypervolume": h["hypervolume"],
             "archiveSize": len(result.history[i].get("front", [])), "feasibleFraction": h.get("feasible_fraction", 0.0)}
            for i, h in enumerate(run["history"])
        ],
        "verified": True,  # serialize_run re-evaluated every archived timetable with the independent checker
    }

    run_id = run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
    saved_to = None
    if save:
        out = Path(os.environ.get("CLOCKWORK_RUNS_DIR", ROOT / "results" / "web")) / run_id
        out.mkdir(parents=True, exist_ok=True)
        (out / "instance.json").write_text(json.dumps(problem_to_dict(problem), indent=2) + "\n")
        (out / "run.json").write_text(json.dumps(run, indent=2, allow_nan=False) + "\n")
        if baseline_run:
            (out / "baseline.json").write_text(json.dumps(baseline_run, indent=2, allow_nan=False) + "\n")
        if solutions:
            (out / "compromise_schedule.json").write_text(json.dumps(
                schedule_to_dict(result.archive[_compromise([tuple(v) for v in run["objectives"]])]), indent=2) + "\n")
        saved_to = str(out.relative_to(ROOT) if out.is_relative_to(ROOT) else out).replace("\\", "/")
    stats["savedTo"] = saved_to
    return {
        "runId": run_id,
        "params": {"seed": cfg.seed, "budget": cfg.budget, "population": cfg.population,
                   "searchSeconds": cfg.search_seconds, "compareBaseline": cfg.compare_baseline, "label": cfg.label},
        "instance": problem_to_web(problem),
        "solutions": solutions,
        "baseline": baseline,
        "stats": stats,
    }
