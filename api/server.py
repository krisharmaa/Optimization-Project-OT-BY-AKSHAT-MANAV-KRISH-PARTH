"""Web API for the Clockwork website, backed by the final memetic NSGA-II optimizer.

Run from the project root:

    python -m uvicorn api.server:app --port 8000

Optimisation runs take seconds to minutes, so they run as background jobs:
  GET  /api/scenarios      built-in instances with their default budgets
  POST /api/runs           start a run (admin), returns {"runId": ...}
  GET  /api/runs/latest    the most recent finished run, kept in the database
  GET  /api/runs/{id}      status + live progress; includes the result when done
Everything else (accounts, published timetable, calendar, leave, substitutes, quizzes, assessments, holidays,
syllabus, requests, notifications, teacher constraints) is in api/campus/routes.py.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src") not in sys.path:  # allow running without `pip install -e .`
    sys.path.insert(0, str(ROOT / "src"))

from fastapi import Depends, FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from api.bridge import (DEFAULT_RUN, SCENARIO_LABELS, apply_constraints, problem_from_any,  # noqa: E402
                        scenario_problem, web_to_problem)
from api.campus.db import connect, init_db, load_published, now  # noqa: E402
from api.campus.routes import ADMIN, constraint_overrides  # noqa: E402
from api.campus.routes import router as campus_router  # noqa: E402
from api.optimizer import METHOD, NoFeasibleTimetable, RunConfig, run_optimizer  # noqa: E402

app = FastAPI(title="Clockwork timetable optimiser", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()  # creates data/clockwork.db and the admin/admin superuser on first start
app.include_router(campus_router)

_executor = ThreadPoolExecutor(max_workers=2)
_jobs: dict[str, dict] = {}
_lock = threading.Lock()
MAX_JOBS_KEPT = 20
MAX_RUNS_STORED = 10


class RunRequest(BaseModel):
    scenario: str = Field("demo", description="demo | small | medium | large | published | custom")
    instanceSeed: int = 1
    seed: int = 0
    budget: int = Field(360, ge=10, le=100_000, description="full evaluations (the validation study's budget unit)")
    population: int = Field(24, ge=2, le=300)
    searchSeconds: float | None = Field(6.0, gt=0, le=1800, description="wall-time cap; null = evaluations only")
    compareBaseline: bool = True
    instance: dict | None = Field(None, description="custom instance (website or optimizer JSON format)")


@app.get("/api/health")
def health():
    return {"ok": True, "optimizer": METHOD}


@app.get("/api/scenarios")
def scenarios():
    out = []
    for sid, label in SCENARIO_LABELS.items():
        p = scenario_problem(sid, 1)
        out.append({"id": sid, "label": label, "events": len(p.events), "groups": len(p.groups), "rooms": len(p.rooms),
                    "faculty": len(p.faculty), **DEFAULT_RUN[sid]})
    return out


def _work(job_id: str, problem, cfg: RunConfig, user: str, scenario: str, changes: list[str]):
    job = _jobs[job_id]

    def progress(entry: dict):
        job["progress"] = entry

    try:
        result = run_optimizer(problem, cfg, progress, run_id=job_id)
        result["params"].update(scenario=scenario, constraintChanges=changes)
        job["result"] = result
        job["status"] = "done"
        _store_run(job_id, user, scenario, result)
    except NoFeasibleTimetable as e:
        job["status"] = "error"
        job["error"] = str(e)
    except Exception as e:  # report to the client instead of failing silently
        job["status"] = "error"
        job["error"] = f"{type(e).__name__}: {e}"
        traceback.print_exc()
    job["finished"] = time.time()


def _store_run(run_id: str, user: str, scenario: str, result: dict) -> None:
    s = result["stats"]
    summary = {"runId": run_id, "scenario": scenario, "instance": result["instance"]["name"], "frontSize": s["frontSize"],
               "hypervolume": s["hypervolume"], "baselineHypervolume": s["baselineHypervolume"],
               "evaluations": s["evaluations"], "runtime": s["runtime"], "savedTo": s.get("savedTo")}
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO optimizer_runs (id, created_at, created_by, summary_json, result_json) VALUES (?, ?, ?, ?, ?)",
                    (run_id, now(), user, json.dumps(summary), json.dumps(result)))
        con.execute("DELETE FROM optimizer_runs WHERE id NOT IN (SELECT id FROM optimizer_runs ORDER BY created_at DESC, rowid DESC LIMIT ?)",
                    (MAX_RUNS_STORED,))


def _problem_for(req: RunRequest):
    if req.scenario in DEFAULT_RUN:
        return scenario_problem(req.scenario, req.instanceSeed)
    if req.scenario == "published":
        with connect() as con:
            pub = load_published(con)
        if not pub:
            raise HTTPException(409, "Nothing is published yet.")
        return web_to_problem(pub["instance"])
    if req.scenario == "custom":
        if not req.instance:
            raise HTTPException(400, "Upload an instance JSON for a custom run.")
        return problem_from_any(req.instance)
    raise HTTPException(400, f"Unknown scenario '{req.scenario}'")


@app.post("/api/runs")
def start_run(req: RunRequest, user=Depends(ADMIN)):
    try:
        problem = _problem_for(req)
        # Teachers' saved weekly availability / daily maximum become hard constraints of this run.
        problem, changes = apply_constraints(problem, constraint_overrides())
    except HTTPException:
        raise
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"Invalid instance: {e}") from e
    cfg = RunConfig(seed=req.seed, budget=req.budget, population=req.population,
                    search_seconds=req.searchSeconds, compare_baseline=req.compareBaseline, label=req.scenario)
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    with _lock:
        if len(_jobs) >= MAX_JOBS_KEPT:  # forget the oldest finished jobs
            done = sorted((k for k, j in _jobs.items() if j["status"] != "running"), key=lambda k: _jobs[k]["started"])
            for k in done[: len(_jobs) - MAX_JOBS_KEPT + 1]:
                del _jobs[k]
        _jobs[job_id] = {"status": "running", "started": time.time(),
                         "progress": {"phase": "queued", "evaluations": 0, "budget": req.budget}}
    _executor.submit(_work, job_id, problem, cfg, user["username"], req.scenario, changes)
    return {"runId": job_id, "events": len(problem.events), "constraintChanges": changes}


@app.get("/api/runs/latest")
def latest_run(user=Depends(ADMIN)):
    with connect() as con:
        row = con.execute("SELECT result_json FROM optimizer_runs ORDER BY created_at DESC, rowid DESC LIMIT 1").fetchone()
    if not row:
        raise HTTPException(404, "No optimiser run has finished yet.")
    return json.loads(row["result_json"])


@app.get("/api/runs/history")
def run_history(user=Depends(ADMIN)):
    with connect() as con:
        rows = con.execute("SELECT summary_json, created_at, created_by FROM optimizer_runs ORDER BY created_at DESC, rowid DESC").fetchall()
    return [json.loads(r["summary_json"]) | {"createdAt": r["created_at"], "createdBy": r["created_by"]} for r in rows]


@app.get("/api/runs/{job_id}")
def get_run(job_id: str, user=Depends(ADMIN)):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Run not found")
    out = {"status": job["status"], "progress": job.get("progress")}
    if job["status"] == "done":
        out["result"] = job["result"]
    if job["status"] == "error":
        out["error"] = job["error"]
    return out
