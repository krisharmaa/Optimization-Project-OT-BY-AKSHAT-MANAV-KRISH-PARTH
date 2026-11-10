"""Website <-> optimizer translation: nothing is lost or changed on the way."""
import pytest

from api.bridge import (apply_constraints, demo_problem, problem_from_any, problem_to_web, scenario_problem,
                        schedule_to_solution, solution_to_schedule, web_to_problem)
from timetable.evaluation import evaluate
from timetable.greedy import greedy
from timetable.model import problem_to_dict


def _shape(p):
    return (p.days, p.periods_per_day, p.lunch_periods, p.groups, p.rooms, p.faculty,
            tuple((o.id, o.groups, o.eligible_faculty, o.sessions, o.duration, o.room_kind, o.distinct_days)
                  for o in p.offerings))


@pytest.mark.parametrize("scenario", ["demo", "small", "medium"])
def test_problem_round_trip_is_exact(scenario):
    problem = scenario_problem(scenario, 1)
    assert _shape(web_to_problem(problem_to_web(problem))) == _shape(problem)


@pytest.mark.parametrize("scenario", ["demo", "small"])
def test_schedule_round_trip_keeps_objectives(scenario):
    problem = scenario_problem(scenario, 1)
    schedule = greedy(problem)
    sol = schedule_to_solution(problem, schedule, "S", True)
    web = problem_to_web(problem)
    back = web_to_problem(web)
    assert solution_to_schedule(back, sol) == schedule
    assert evaluate(back, solution_to_schedule(back, sol)).objectives == evaluate(problem, schedule).objectives
    assert sol["violation"] == 0 and len(sol["assignments"]) == len(problem.events)


def test_optimizer_json_accepted():
    problem = scenario_problem("small", 3)
    assert _shape(problem_from_any(problem_to_dict(problem))) == _shape(problem)
    assert _shape(problem_from_any(problem_to_web(problem))) == _shape(problem)
    with pytest.raises(ValueError):
        problem_from_any({"nothing": 1})


def test_saved_teacher_constraints_merge():
    problem = demo_problem()
    merged, changes = apply_constraints(problem, {"f1": {"unavailable": [0, 1, 999], "max_daily": 2}, "nobody": {}})
    f1 = next(f for f in merged.faculty if f.id == "f1")
    assert set(f1.unavailable) == {0, 1} and f1.max_daily == 2  # out-of-range slot dropped
    assert changes and changes[0].startswith("f1:")
    assert apply_constraints(problem, None) == (problem, [])
