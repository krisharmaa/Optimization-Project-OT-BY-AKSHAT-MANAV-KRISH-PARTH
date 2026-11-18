"""Saved timetables: create, edit, duplicate and delete timetable data and schedules (admin).

A saved timetable is the department's input data (days, periods, classes, teachers, rooms, courses) in the website
format, plus optionally a schedule (a website solution: assignments + teacher per course). Nothing is hard-coded:
the Demo department is only a template that is offered on a fresh database.

  GET    /api/timetables                 list with sizes and schedule status
  POST   /api/timetables                 create: blank | demo | small | medium | large | published | import | data
  GET    /api/timetables/{id}            data + schedule + check of the schedule
  PUT    /api/timetables/{id}            rename and/or replace the data (validated; events rebuilt with stable ids)
  POST   /api/timetables/{id}/duplicate
  DELETE /api/timetables/{id}
  POST   /api/timetables/{id}/check      check an (unsaved) schedule with the independent evaluator
  PUT    /api/timetables/{id}/schedule   save a schedule; refused if it breaks a hard constraint
  DELETE /api/timetables/{id}/schedule   remove the schedule
  POST   /api/timetables/{id}/publish    publish the saved schedule (same check as the Designer's Publish)

Optimiser runs on a saved timetable use scenario "saved" with ``timetableId`` (api/server.py).
"""
from __future__ import annotations

import json
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from timetable.evaluation import evaluate

from .bridge import demo_problem, period_labels, problem_from_any, problem_to_web, scenario_problem, \
    solution_to_schedule, web_to_problem
from .campus.db import connect, load_published, now

router = APIRouter(prefix="/api")
TEMPLATES = ("blank", "demo", "small", "medium", "large", "published", "import", "data")


def _admin():
    from .campus.routes import ADMIN
    return ADMIN


# ---------------------------------------------------------------------------
# data handling
# ---------------------------------------------------------------------------
def blank_instance(name: str = "New timetable") -> dict:
    return {"name": name, "grid": {"days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "periods": period_labels(8),
                                   "lunchPeriod": 4, "lunchPeriods": [4]},
            "groups": [], "faculty": [], "rooms": [], "offerings": [], "events": []}


def normalize_instance(inst: dict) -> dict:
    """Validate website data and rebuild its events from the courses, keeping existing event ids so a saved
    schedule stays attached to the same classes. Raises ValueError with a readable message."""
    if not isinstance(inst, dict) or "grid" not in inst:
        raise ValueError("timetable data must contain a grid (days and periods)")
    grid = inst["grid"]
    if not grid.get("days"):
        raise ValueError("add at least one day")
    if not grid.get("periods"):
        raise ValueError("add at least one period")
    for key in ("groups", "faculty", "rooms", "offerings"):
        inst.setdefault(key, [])
    old: dict[str, list[str]] = defaultdict(list)
    for e in inst.get("events") or []:
        old[e.get("offeringId")].append(str(e.get("id")))
    used, events = set(), []
    for o in inst["offerings"]:
        for field in ("id", "sessionsPerWeek"):
            if field not in o:
                raise ValueError(f"every course needs '{field}'")
        n = int(o["sessionsPerWeek"])
        if n < 1:
            raise ValueError(f"course {o.get('code') or o['id']}: sessions per week must be at least 1")
        duration = int(o.get("duration") or (2 if o.get("type") == "lab" else 1))
        if duration < 1 or duration > len(grid["periods"]):
            raise ValueError(f"course {o.get('code') or o['id']}: session length must fit in a day")
        o["duration"] = duration
        keep = [i for i in old.get(o["id"], []) if i not in used]
        for k in range(n):
            if k < len(keep):
                eid = keep[k]
            else:
                j, eid = k + 1, f"{o['id']}:{k + 1}"
                while eid in used:
                    j += 1
                    eid = f"{o['id']}:{j}"
            used.add(eid)
            events.append({"id": eid, "offeringId": o["id"], "length": duration, "headcount": 0})
    data = {**inst, "events": events}
    problem = web_to_problem(data)  # schema validation (ids, references, positive numbers)
    return problem_to_web(problem)


def warnings_for(inst: dict) -> list[str]:
    """Things that make a timetable impossible or unlikely, explained for the admin (not schema errors)."""
    out = []
    grid = inst["grid"]
    lunch = set(grid.get("lunchPeriods") or [grid.get("lunchPeriod")])
    teaching = len(grid["days"]) * (len(grid["periods"]) - len([p for p in lunch if p is not None and 0 <= p < len(grid["periods"])]))
    size = {g["id"]: g["strength"] for g in inst["groups"]}
    rooms = inst["rooms"]
    need = defaultdict(int)
    for o in inst["offerings"]:
        label = o.get("code") or o["id"]
        if not o.get("eligibleFaculty"):
            out.append(f"{label}: no teacher can teach it")
        if not o.get("groupIds"):
            out.append(f"{label}: no class takes it")
        kind = o.get("roomKind") or ("lab" if o.get("type") == "lab" else "classroom")
        headcount = sum(size.get(g, 0) for g in o.get("groupIds", []))
        if not any((r.get("kind") or r["type"]) in (kind, "hall" if kind == "classroom" else kind) and r["capacity"] >= headcount for r in rooms):
            out.append(f"{label}: no {kind} holds {headcount} students")
        for g in o.get("groupIds", []):
            need[g] += o["sessionsPerWeek"] * o["duration"]
    names = {g["id"]: g["name"] for g in inst["groups"]}
    for g, n in need.items():
        if n > teaching:
            out.append(f"{names.get(g, g)}: {n} periods of classes but only {teaching} teaching periods a week")
    demand = sum(o["sessionsPerWeek"] * o["duration"] for o in inst["offerings"])
    capacity = sum(f["maxWeekly"] for f in inst["faculty"])
    if inst["offerings"] and demand > capacity:
        out.append(f"teachers can give {capacity} periods a week in total but the courses need {demand}")
    return out


def clean_solution(inst: dict, solution: dict | None) -> dict | None:
    """Keep only assignments/teachers that still refer to existing classes and courses."""
    if not solution:
        return None
    events = {e["id"] for e in inst["events"]}
    offerings = {o["id"] for o in inst["offerings"]}
    return {"id": solution.get("id"), "assignments": [a for a in solution.get("assignments", []) if a.get("eventId") in events],
            "facultyOf": {k: v for k, v in (solution.get("facultyOf") or {}).items() if k in offerings}}


def check(inst: dict, solution: dict | None) -> dict:
    """Independent check of a (possibly incomplete) schedule with the optimizer's evaluator."""
    if not solution:
        return {"exists": False}
    sol = clean_solution(inst, solution)
    placed = {a["eventId"] for a in sol["assignments"]}
    unplaced = [e["id"] for e in inst["events"] if e["id"] not in placed]
    problem = web_to_problem(inst)
    try:
        ev = evaluate(problem, solution_to_schedule(problem, sol))
    except (ValueError, KeyError, TypeError) as e:
        return {"exists": True, "feasible": False, "violations": {"invalid": 1}, "error": str(e), "unplaced": unplaced}
    return {"exists": True, "feasible": ev.feasible, "violations": {k: v for k, v in ev.violations.items() if v},
            "objectives": dict(zip(("f1", "f2", "f3"), map(float, ev.objectives))),
            "metrics": {k: float(v) for k, v in ev.metrics.items() if isinstance(v, (int, float)) and not isinstance(v, bool)},
            "unplaced": unplaced}


def _row(con, tid: int):
    r = con.execute("SELECT * FROM timetables WHERE id = ?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404, "No such timetable.")
    return r


def _summary(r) -> dict:
    inst = json.loads(r["instance_json"])
    sol = json.loads(r["solution_json"]) if r["solution_json"] else None
    status = check(inst, sol) if sol else {"exists": False}
    return {"id": r["id"], "name": r["name"], "source": r["source"], "updatedAt": r["updated_at"], "createdBy": r["created_by"],
            "classes": len(inst["events"]), "groups": len(inst["groups"]), "teachers": len(inst["faculty"]),
            "rooms": len(inst["rooms"]), "courses": len(inst["offerings"]),
            "schedule": "none" if not status.get("exists") else
                        "ok" if status["feasible"] and not status["unplaced"] else "needs attention"}


def _insert(con, name: str, inst: dict, sol: dict | None, source: str, by: str) -> int:
    cur = con.execute("INSERT INTO timetables (name, instance_json, solution_json, source, created_by, created_at, updated_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (name, json.dumps(inst), json.dumps(sol) if sol else None, source, by, now(), now()))
    return cur.lastrowid


def ensure_default(con) -> None:
    """A fresh database starts with the Demo department as an editable template (cold start)."""
    if con.execute("SELECT COUNT(*) FROM timetables").fetchone()[0] == 0:
        inst = problem_to_web(demo_problem())
        inst["name"] = "Demo department"  # the timetable's name is also its title everywhere in the website
        _insert(con, "Demo department", inst, None, "demo", "system")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
class CreateBody(BaseModel):
    name: str = Field("", max_length=120)
    template: str = "blank"
    instanceSeed: int = 1
    instance: dict | None = None
    solution: dict | None = None


class UpdateBody(BaseModel):
    name: str | None = Field(None, max_length=120)
    instance: dict | None = None


class ScheduleBody(BaseModel):
    solution: dict


@router.get("/timetables")
def list_timetables(user=Depends(_admin())):
    with connect() as con:
        ensure_default(con)
        rows = con.execute("SELECT * FROM timetables ORDER BY updated_at DESC, id DESC").fetchall()
        return [_summary(r) for r in rows]


@router.post("/timetables")
def create_timetable(b: CreateBody, user=Depends(_admin())):
    if b.template not in TEMPLATES:
        raise HTTPException(400, f"template must be one of {TEMPLATES}")
    sol = None
    try:
        if b.template == "blank":
            inst = blank_instance(b.name or "New timetable")
        elif b.template in ("demo", "small", "medium", "large"):
            inst = problem_to_web(scenario_problem(b.template, b.instanceSeed))
        elif b.template == "published":
            with connect() as con:
                pub = load_published(con)
            if not pub:
                raise HTTPException(409, "Nothing is published yet.")
            inst, sol = pub["instance"], pub["solution"]
        else:  # import (website or CLI JSON) / data (e.g. the Final timetable of a run)
            if not b.instance:
                raise HTTPException(400, "Provide the timetable data.")
            inst = problem_to_web(problem_from_any(b.instance)) if "periods_per_day" in b.instance else b.instance
            sol = b.solution
        inst = normalize_instance(inst)
    except ValueError as e:
        raise HTTPException(400, f"Invalid timetable data: {e}") from e
    name = b.name or inst.get("name") or "New timetable"
    inst["name"] = name
    sol = clean_solution(inst, sol)  # an imperfect schedule is kept; the editor shows what is wrong
    with connect() as con:
        tid = _insert(con, name, inst, sol, b.template, user["username"])
    return {"id": tid}


@router.get("/timetables/{tid}")
def get_timetable(tid: int, user=Depends(_admin())):
    with connect() as con:
        r = _row(con, tid)
    inst = json.loads(r["instance_json"])
    sol = json.loads(r["solution_json"]) if r["solution_json"] else None
    return {**_summary(r), "instance": inst, "solution": sol, "check": check(inst, sol), "warnings": warnings_for(inst)}


@router.put("/timetables/{tid}")
def update_timetable(tid: int, b: UpdateBody, user=Depends(_admin())):
    with connect() as con:
        r = _row(con, tid)
        inst = json.loads(r["instance_json"])
        sol = json.loads(r["solution_json"]) if r["solution_json"] else None
        name = (b.name or "").strip() or r["name"]
        if b.instance is not None:
            try:
                inst = normalize_instance(b.instance)
            except (ValueError, KeyError, TypeError) as e:
                raise HTTPException(400, f"Not saved: {e}") from e
            sol = clean_solution(inst, sol)
        inst["name"] = name
        con.execute("UPDATE timetables SET name = ?, instance_json = ?, solution_json = ?, updated_at = ? WHERE id = ?",
                    (name, json.dumps(inst), json.dumps(sol) if sol else None, now(), tid))
    return {"ok": True, "warnings": warnings_for(inst), "check": check(inst, sol), "instance": inst}


@router.post("/timetables/{tid}/duplicate")
def duplicate_timetable(tid: int, user=Depends(_admin())):
    with connect() as con:
        r = _row(con, tid)
        inst = json.loads(r["instance_json"])
        name = f"{r['name']} (copy)"
        inst["name"] = name
        new = _insert(con, name, inst, json.loads(r["solution_json"]) if r["solution_json"] else None, "copy", user["username"])
    return {"id": new}


@router.delete("/timetables/{tid}")
def delete_timetable(tid: int, user=Depends(_admin())):
    with connect() as con:
        _row(con, tid)
        con.execute("DELETE FROM timetables WHERE id = ?", (tid,))
    return {"ok": True}


@router.post("/timetables/{tid}/check")
def check_schedule(tid: int, b: ScheduleBody, user=Depends(_admin())):
    with connect() as con:
        inst = json.loads(_row(con, tid)["instance_json"])
    return check(inst, b.solution)


@router.put("/timetables/{tid}/schedule")
def save_schedule(tid: int, b: ScheduleBody, user=Depends(_admin())):
    with connect() as con:
        inst = json.loads(_row(con, tid)["instance_json"])
        result = check(inst, b.solution)
        if result.get("unplaced"):
            raise HTTPException(400, f"Not saved: {len(result['unplaced'])} class(es) are not placed yet.")
        if not result.get("feasible"):
            broken = ", ".join(f"{k} x{v}" for k, v in result.get("violations", {}).items())
            raise HTTPException(400, f"Not saved: the schedule breaks hard constraints ({broken}).")
        sol = {**clean_solution(inst, b.solution), "objectives": result["objectives"]}
        con.execute("UPDATE timetables SET solution_json = ?, updated_at = ? WHERE id = ?", (json.dumps(sol), now(), tid))
    return {"ok": True, "check": result}


@router.delete("/timetables/{tid}/schedule")
def clear_schedule(tid: int, user=Depends(_admin())):
    with connect() as con:
        _row(con, tid)
        con.execute("UPDATE timetables SET solution_json = NULL, updated_at = ? WHERE id = ?", (now(), tid))
    return {"ok": True}


@router.post("/timetables/{tid}/publish")
def publish_saved(tid: int, user=Depends(_admin())):
    from .campus.routes import publish_timetable
    with connect() as con:
        r = _row(con, tid)
        pub = load_published(con)
    inst = json.loads(r["instance_json"])
    sol = json.loads(r["solution_json"]) if r["solution_json"] else None
    if not sol:
        raise HTTPException(409, "This timetable has no schedule yet. Run the optimiser on it or place the classes first.")
    publish_timetable(inst, sol, pub.get("design") if pub else None, user, message=f"Timetable '{r['name']}' has been published.")
    return {"ok": True}


def load_saved_instance(tid: int) -> dict:
    """Used by optimiser runs on a saved timetable."""
    with connect() as con:
        r = _row(con, tid)
    inst = json.loads(r["instance_json"])
    if not inst["offerings"]:
        raise HTTPException(400, "This timetable has no courses yet. Add classes, teachers, rooms and courses first.")
    return inst


@router.get("/starter")
def starter(user=Depends(_admin())):
    """The timetable shown before any optimiser run: the published one, otherwise the most recently edited saved
    timetable with courses, scheduled by one quick greedy construction (clearly NOT optimised)."""
    from timetable.greedy import SchedulingFailure, greedy

    from .bridge import schedule_to_solution
    with connect() as con:
        pub = load_published(con)
        if pub:
            return {"kind": "published", "name": pub["instance"].get("name", "Published timetable"), "timetableId": None,
                    "instance": pub["instance"], "solution": pub["solution"], "check": check(pub["instance"], pub["solution"])}
        ensure_default(con)
        rows = con.execute("SELECT * FROM timetables ORDER BY updated_at DESC, id DESC").fetchall()
    row = next((r for r in rows if json.loads(r["instance_json"])["offerings"]), None)
    if row is None:
        return {"kind": "empty", "name": None, "timetableId": None, "instance": None, "solution": None, "check": {"exists": False}}
    inst = json.loads(row["instance_json"])
    sol = json.loads(row["solution_json"]) if row["solution_json"] else None
    kind = "saved"
    if sol is None:
        kind = "starting"
        problem = web_to_problem(inst)
        try:
            sol = schedule_to_solution(problem, greedy(problem, seed=0, restarts=1), "START", False)
        except SchedulingFailure:
            sol = None
    return {"kind": kind, "name": row["name"], "timetableId": row["id"], "instance": inst, "solution": sol, "check": check(inst, sol)}
