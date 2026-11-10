# Web application: Clockwork frontend on the final optimizer

The website (`frontend/`, React + Vite + TypeScript) and its application layer (`api/campus/`: accounts, calendar,
leave, substitutes, quizzes, assessments, holidays, syllabus, requests, notifications) come from the Clockwork
project. The optimization side is this repository's final method, unchanged: `src/timetable/` is not modified
by the website, and no other optimizer is used.

## Running it

```bash
python -m pip install -r requirements.txt        # numpy, matplotlib, pytest, fastapi, uvicorn, httpx
npm --prefix frontend ci
python -m uvicorn api.server:app --port 8000     # terminal 1, from the project root
npm --prefix frontend run dev                    # terminal 2
```

Open <http://localhost:5173> and sign in as `admin` / `admin` (change the password at once). Data is kept in
`data/clockwork.db` (delete it to start over). Without the Python server the website shows built-in **offline demo
data**, clearly labelled, which is not optimizer output.

## Data flow

```text
Website (React)                     api/ (FastAPI)                               src/timetable/ (unchanged)
---------------                     --------------                               --------------------------
Overview: Run optimiser  ─ POST /api/runs ─▶  instance: demo | small/medium/large   generation.generate_instance
  budget, population,                         (generator) | published | uploaded
  time cap, seed                              + teachers' saved availability ─────▶ model.Problem (hard constraints)
                                              api/optimizer.py ───────────────────▶ memetic.memetic_nsga2
                                                                                    experiments.greedy_search (baseline,
                                                                                      same evaluations and seed)
                                                                                    experiments.serialize_run (re-check,
                                                                                      hypervolume as in the report)
◀── GET /api/runs/{id} (live progress, then result) ── api/bridge.py: Problem/Schedule -> website JSON
Pareto front, Designer
Designer: ★ Publish ─ POST /api/timetable/publish ─▶ bridge -> evaluation.evaluate; refused if infeasible
Calendar, leave, cover, quiz, OA,     api/campus/*  (all work on the published, verified timetable)
holiday, syllabus, requests
```

* **Instances.** `demo` is Clockwork's two-division department expressed in the optimizer's model; `small`,
  `medium` and `large` are the report's generator presets (instance seed selectable); `published` re-optimises the
  instance of the published timetable; **Upload JSON** accepts either the website format or the CLI format
  (for example `data/benchmark/medium_10.json`).
* **Teacher constraints.** Blocked periods and a maximum per day saved under *My teaching* or *Manage → Availability*
  are merged into the instance before the run (`api/bridge.py: apply_constraints`) and are therefore hard
  constraints of the search, of the independent check and of later substitutions.
* **Optimizer.** `memetic_nsga2` is called with the validation study's defaults (population 24; budget/time per size
  from `experiments/enhancement_validation.json`). Its only hook used is the `evaluator` argument, wrapped to count
  calls for the progress bar; it still calls the shared `evaluate`.
* **Baseline in the website.** The repeated greedy/DSatur baseline gets exactly the number of full evaluations the
  memetic run used and the same seed (equal-evaluation protocol). The Overview shows both hypervolumes; the Pareto
  page overlays the greedy front and tabulates both. A single website run is an illustration; the evidence remains
  the paired multi-seed study in the report.
* **Provenance.** Each run is saved in the CLI's own format under `results/web/<run id>/` (`instance.json`,
  `run.json`, `baseline.json`, `compromise_schedule.json`), so it can be re-validated with
  `python main.py evaluate results/web/<run id>/instance.json results/web/<run id>/compromise_schedule.json`.
  The last ten runs are also kept in the database (`GET /api/runs/latest`).
* **Representatives.** *Fewest gaps*, *Least room wastage*, *Most balanced* and *Best compromise* are the same four
  selections as `export_representatives` (the compromise is the report's `normalized_compromise`).

## Website ↔ optimizer format

`api/bridge.py` converts both ways without loss (checked by `tests/test_web_bridge.py`). A slot index is
`day × len(periods) + period` with lunch counted in `periods`, which is exactly the optimizer's flat time index, so
availability needs no re-indexing. Names (teacher, room, subject, period labels) are kept in the problem's
`metadata.labels`; event ids of website instances are kept too, so calendar records stay valid.

## Tests

```bash
python -m pytest tests/test_web_bridge.py tests/test_web_campus.py
```

End-to-end check against running servers (use a fresh database; it publishes a timetable and creates accounts,
leave, quizzes, holidays...):

```bash
python experiments/web_integration_check.py --api http://127.0.0.1:8000 --web http://localhost:5173
```

Results of the final check are in [final_integration_check.md](final_integration_check.md).

They cover the exact round trip of instances and timetables, the role rules and calendar flows ported from
Clockwork, a real optimizer run started through the API (teacher availability respected, equal-evaluation
baseline, run kept server-side) and the refusal to publish an infeasible timetable.
