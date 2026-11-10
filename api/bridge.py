"""Two-way translation between the website's JSON (frontend/src/types.ts) and the optimizer's model.

The optimizer model (``timetable.model``) is the single source of truth: every timetable the website shows,
publishes or edits is converted to a ``Problem``/``Schedule`` and checked with ``timetable.evaluation.evaluate``,
the same independent checker used for the report's experiments.

Website instance (camelCase)::

    {"name", "grid": {"days": [...], "periods": [labels], "lunchPeriod": i, "lunchPeriods": [...]},
     "groups":    [{"id", "name", "strength"}],
     "faculty":   [{"id", "name", "maxWeekly", "maxDaily", "unavailable": [slot]}],
     "rooms":     [{"id", "name", "capacity", "type", "unavailable": [slot]}],
     "offerings": [{"id", "subject", "code", "groupIds", "type", "sessionsPerWeek", "eligibleFaculty",
                    "roomKind"?, "distinctDays"?}],
     "events":    [{"id", "offeringId", "length", "headcount"}]}

A slot is ``day * len(periods) + period`` with lunch included in ``periods``: exactly the optimizer's flat time
index, so availability saved on the website needs no re-indexing.

Website solution::

    {"id", "objectives": {"f1", "f2", "f3"}, "assignments": [{"eventId", "day", "period", "roomId"}],
     "facultyOf": {offeringId: facultyId}, "onFront", "violation", "metrics"}
"""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from timetable.evaluation import Evaluation, evaluate
from timetable.generation import PRESETS, generate_instance
from timetable.model import (Faculty, Group, Offering, Placement, Problem, Room, Schedule,
                             problem_from_dict, validate_problem)

# Evaluation budgets and wall-time caps of the held-out validation study
# (experiments/enhancement_validation.json); the website uses them as defaults.
DEFAULT_RUN = {
    "demo": {"budget": 360, "seconds": 6.0},
    "small": {"budget": 720, "seconds": 2.5},
    "medium": {"budget": 360, "seconds": 6.0},
    "large": {"budget": 240, "seconds": 16.0},
}
SCENARIO_LABELS = {
    "demo": "Demo: SY Computer, 2 divisions",
    "small": "Small synthetic (2 groups, 40 classes)",
    "medium": "Medium synthetic (8 groups, 150 classes)",
    "large": "Large synthetic (20 groups, 400 classes)",
}


# ---------------------------------------------------------------------------
# instances
# ---------------------------------------------------------------------------
def period_labels(count: int, first_hour: int = 9) -> list[str]:
    def clock(h: int) -> str:
        return f"{(h - 1) % 12 + 1}:00"
    return [f"{clock(first_hour + p)} - {clock(first_hour + p + 1)}" for p in range(count)]


def demo_problem() -> Problem:
    """Clockwork's demo department (frontend/src/mock/instance.ts) as an optimizer instance."""
    subjects = [
        ("DSA", "Data Structures", "theory", 3, ("f1", "f2")),
        ("DBMS", "Database Systems", "theory", 3, ("f2", "f3")),
        ("OS", "Operating Systems", "theory", 3, ("f3", "f4")),
        ("MATHS", "Engineering Maths III", "theory", 3, ("f5", "f6")),
        ("COA", "Computer Organisation", "theory", 2, ("f4", "f1")),
        ("EVS", "Environmental Studies", "theory", 1, ("f6", "f5")),
        ("DSA LAB", "Data Structures Lab", "lab", 1, ("f1", "f2")),
        ("DBMS LAB", "Database Lab", "lab", 1, ("f3", "f2")),
    ]
    groups = (Group("gA", 58), Group("gB", 52))
    group_names = {"gA": "SY-Comp Div A", "gB": "SY-Comp Div B"}
    faculty_rows = [("f1", "Prof. Mehta", 12, 4), ("f2", "Dr. Iyer", 12, 4), ("f3", "Prof. Kulkarni", 10, 4),
                    ("f4", "Dr. Fernandes", 10, 3), ("f5", "Prof. Rao", 8, 3), ("f6", "Dr. Shaikh", 8, 3)]
    room_rows = [("r1", "CR-101", 60, "classroom"), ("r2", "CR-102", 72, "classroom"), ("r3", "LH-201", 120, "classroom"),
                 ("r4", "Lab A-301", 64, "lab"), ("r5", "Lab B-302", 70, "lab")]
    offerings, offering_labels = [], {}
    for g in groups:
        for code, name, kind, sessions, eligible in subjects:
            oid = f"{g.id}-{code.replace(' ', '')}"
            lab = kind == "lab"
            offerings.append(Offering(oid, (g.id,), eligible, sessions, 2 if lab else 1, "lab" if lab else "classroom", not lab))
            offering_labels[oid] = {"subject": name, "code": code, "type": kind}
    problem = Problem(
        name="SY Computer Engineering - Semester III",
        days=("Mon", "Tue", "Wed", "Thu", "Fri"), periods_per_day=8, lunch_periods=(4,),
        groups=groups,
        rooms=tuple(Room(i, c, k) for i, _, c, k in room_rows),
        faculty=tuple(Faculty(i, w, d) for i, _, w, d in faculty_rows),
        offerings=tuple(offerings),
        metadata={"synthetic": True, "source": "Clockwork demo department (illustrative, not institutional data)",
                  "labels": {"groups": group_names, "faculty": {i: n for i, n, _, _ in faculty_rows},
                             "rooms": {i: n for i, n, _, _ in room_rows}, "offerings": offering_labels,
                             "periods": period_labels(8)}},
    )
    validate_problem(problem)
    return problem


def scenario_problem(scenario: str, instance_seed: int = 1) -> Problem:
    if scenario == "demo":
        return demo_problem()
    if scenario not in PRESETS:
        raise ValueError(f"Unknown scenario '{scenario}'")
    problem, _certificate = generate_instance(scenario, instance_seed)  # the certificate is never shown to the solver
    return problem


def problem_from_any(data: dict) -> Problem:
    """Accept either the website format (has "grid") or the optimizer's JSON format (has "periods_per_day")."""
    if not isinstance(data, dict):
        raise ValueError("An instance must be a JSON object")
    data = data.get("instance", data) if "grid" not in data and "periods_per_day" not in data else data
    if "grid" in data:
        return web_to_problem(data)
    if "periods_per_day" in data:
        return problem_from_dict(data)
    raise ValueError("Unrecognised instance: expected the website format (grid/offerings) or the optimizer format (periods_per_day)")


def _labels(problem: Problem) -> dict:
    return dict(problem.metadata.get("labels") or {})


def problem_to_web(problem: Problem) -> dict:
    labels = _labels(problem)
    names = {k: labels.get(k) or {} for k in ("groups", "faculty", "rooms", "offerings")}
    periods = labels.get("periods") or period_labels(problem.periods_per_day)
    event_ids = labels.get("event_ids") or [e.id for e in problem.events]
    by_offering = {o.id: o for o in problem.offerings}

    def offering(o: Offering) -> dict:
        lab = o.room_kind == "lab"
        lab_label = names["offerings"].get(o.id, {})
        default_type = "lab" if lab else "theory"
        return {
            "id": o.id,
            "subject": lab_label.get("subject") or f"{'Laboratory' if lab else 'Course'} {o.id}",
            "code": lab_label.get("code") or o.id,
            "groupIds": list(o.groups),
            "type": lab_label.get("type") or default_type,
            "sessionsPerWeek": o.sessions,
            "duration": o.duration,
            "eligibleFaculty": list(o.eligible_faculty),
            "roomKind": o.room_kind,
            "distinctDays": o.distinct_days,
        }

    return {
        "name": problem.name,
        "grid": {"days": list(problem.days), "periods": list(periods),
                 "lunchPeriod": problem.lunch_periods[0] if problem.lunch_periods else -1,
                 "lunchPeriods": list(problem.lunch_periods)},
        "groups": [{"id": g.id, "name": names["groups"].get(g.id, f"Group {g.id}"), "strength": g.size} for g in problem.groups],
        "faculty": [{"id": f.id, "name": names["faculty"].get(f.id, f"Faculty {f.id}"), "maxWeekly": f.max_weekly,
                     "maxDaily": f.max_daily, "unavailable": list(f.unavailable)} for f in problem.faculty],
        "rooms": [{"id": r.id, "name": names["rooms"].get(r.id, f"{'Lab' if r.kind == 'lab' else 'Room'} {r.id}"),
                   "capacity": r.capacity, "type": r.kind if r.kind in ("classroom", "lab", "hall") else "classroom",
                   "kind": r.kind, "unavailable": list(r.unavailable)} for r in problem.rooms],
        "offerings": [offering(o) for o in problem.offerings],
        "events": [{"id": event_ids[i], "offeringId": e.offering_id, "length": e.duration, "headcount": e.size}
                   for i, e in enumerate(problem.events)],
        "metadata": {k: v for k, v in problem.metadata.items() if k in ("synthetic", "source", "seed", "preset", "sampling")}
                    | {"optimizerEventIds": [e.id for e in problem.events], "slotsPerDay": problem.periods_per_day,
                       "durations": {o.id: o.duration for o in by_offering.values()}},
    }


def _int_list(values, upper: int) -> tuple[int, ...]:
    out = sorted({int(v) for v in values or [] if isinstance(v, (int, float)) and 0 <= int(v) < upper})
    return tuple(out)


def web_to_problem(inst: dict) -> Problem:
    """Website instance -> optimizer Problem. Names are kept in metadata so a round trip loses nothing."""
    grid = inst["grid"]
    days = tuple(str(d) for d in grid["days"])
    periods = list(grid["periods"])
    P = len(periods)
    lunch = grid.get("lunchPeriods")
    if lunch is None:
        lp = grid.get("lunchPeriod")
        lunch = [lp] if isinstance(lp, int) and 0 <= lp < P else []
    total = len(days) * P
    groups = tuple(Group(str(g["id"]), int(g["strength"])) for g in inst["groups"])
    faculty = tuple(Faculty(str(f["id"]), int(f["maxWeekly"]), int(f["maxDaily"]), _int_list(f.get("unavailable"), total))
                    for f in inst["faculty"])

    def room_kind(r: dict) -> str:
        kind = r.get("kind") or r.get("type") or "classroom"
        return "classroom" if kind == "hall" else kind  # a hall is a large classroom for placement purposes

    rooms = tuple(Room(str(r["id"]), int(r["capacity"]), room_kind(r), _int_list(r.get("unavailable"), total))
                  for r in inst["rooms"])
    events_by_offering: dict[str, list[dict]] = {}
    for e in inst.get("events") or []:
        events_by_offering.setdefault(e["offeringId"], []).append(e)
    offerings, event_ids, offering_labels = [], [], {}
    for o in inst["offerings"]:
        oid = str(o["id"])
        kind = o.get("type", "theory")
        evs = events_by_offering.get(oid, [])
        if evs:
            lengths = {int(e.get("length", 1)) for e in evs}
            if len(lengths) != 1:
                raise ValueError(f"Offering {oid}: all sessions must have the same length")
            duration, sessions = lengths.pop(), len(evs)
        else:
            duration = int(o.get("duration") or (2 if kind == "lab" else 1))
            sessions = int(o["sessionsPerWeek"])
        room = o.get("roomKind") or ("lab" if kind == "lab" else "classroom")
        distinct = o.get("distinctDays")
        distinct = (kind != "lab") if distinct is None else bool(distinct)
        offerings.append(Offering(oid, tuple(o["groupIds"]), tuple(o["eligibleFaculty"]), sessions, duration, room, distinct))
        event_ids += [str(e["id"]) for e in evs] or [f"{oid}:{i + 1}" for i in range(sessions)]
        offering_labels[oid] = {"subject": o.get("subject", oid), "code": o.get("code", oid), "type": kind}
    problem = Problem(
        name=str(inst.get("name") or "Website instance"), days=days, periods_per_day=P, lunch_periods=tuple(lunch),
        groups=groups, rooms=rooms, faculty=faculty, offerings=tuple(offerings),
        metadata={**{k: v for k, v in (inst.get("metadata") or {}).items() if k in ("synthetic", "source", "seed", "preset")},
                  "labels": {"groups": {g["id"]: g.get("name", g["id"]) for g in inst["groups"]},
                             "faculty": {f["id"]: f.get("name", f["id"]) for f in inst["faculty"]},
                             "rooms": {r["id"]: r.get("name", r["id"]) for r in inst["rooms"]},
                             "offerings": offering_labels, "periods": periods, "event_ids": event_ids}},
    )
    validate_problem(problem)
    return problem


def apply_constraints(problem: Problem, overrides: dict | None) -> tuple[Problem, list[str]]:
    """Merge teacher constraints saved on the website ({faculty_id: {"unavailable": [...], "max_daily": n}}).

    Blocked periods are added to the instance's own unavailability; a saved daily maximum replaces the instance's.
    Returns the new problem and a human-readable list of what changed.
    """
    if not overrides:
        return problem, []
    changes, faculty = [], []
    for f in problem.faculty:
        o = overrides.get(f.id) or {}
        blocked = set(f.unavailable) | set(_int_list(o.get("unavailable"), problem.total_periods))
        max_daily = int(o["max_daily"]) if o.get("max_daily") else f.max_daily
        if blocked != set(f.unavailable) or max_daily != f.max_daily:
            changes.append(f"{f.id}: {len(blocked) - len(f.unavailable)} more blocked period(s), max {max_daily}/day")
        faculty.append(replace(f, unavailable=tuple(sorted(blocked)), max_daily=max_daily))
    problem = replace(problem, faculty=tuple(faculty))
    validate_problem(problem)
    return problem, changes


# ---------------------------------------------------------------------------
# schedules
# ---------------------------------------------------------------------------
def _event_ids(problem: Problem) -> list[str]:
    return _labels(problem).get("event_ids") or [e.id for e in problem.events]


def _scalar_metrics(metrics: dict) -> dict[str, float]:
    return {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}


def schedule_to_solution(problem: Problem, schedule: Schedule, sid: str, on_front: bool,
                         evaluation: Evaluation | None = None) -> dict:
    ev = evaluation or evaluate(problem, schedule)
    ids = _event_ids(problem)
    P = problem.periods_per_day
    assignments = []
    for i, placement in enumerate(schedule.placements):
        if placement is None:
            continue
        day, period = divmod(placement.start, P)
        assignments.append({"eventId": ids[i], "day": day, "period": period, "roomId": placement.room})
    f1, f2, f3 = ev.objectives
    return {
        "id": sid,
        "objectives": {"f1": float(f1), "f2": float(f2), "f3": float(f3)},
        "assignments": assignments,
        "facultyOf": {o.id: schedule.teachers[k] for k, o in enumerate(problem.offerings)},
        "onFront": on_front,
        "violation": int(ev.violation),
        "metrics": _scalar_metrics(ev.metrics),
    }


def solution_to_schedule(problem: Problem, solution: dict) -> Schedule:
    index = {eid: i for i, eid in enumerate(_event_ids(problem))}
    P = problem.periods_per_day
    placements: list[Placement | None] = [None] * len(problem.events)
    for a in solution.get("assignments", []):
        i = index.get(a.get("eventId"))
        if i is None:
            raise ValueError(f"Unknown event {a.get('eventId')!r} in the timetable")
        placements[i] = Placement(int(a["day"]) * P + int(a["period"]), str(a["roomId"]))
    faculty_of = solution.get("facultyOf", {})
    teachers = tuple(str(faculty_of.get(o.id, "")) for o in problem.offerings)
    return Schedule(tuple(placements), teachers)


def check_web_timetable(instance: dict, solution: dict) -> Evaluation:
    """Independent hard-constraint check of a website timetable (used before publishing)."""
    problem = web_to_problem(instance)
    return evaluate(problem, solution_to_schedule(problem, solution))
