"""Final end-to-end integration check of the website against a RUNNING backend (and optionally the frontend).

Start the servers on a fresh database first, then run from the project root:

    python -m uvicorn api.server:app --port 8000          # fresh data/clockwork.db
    npm --prefix frontend run dev                         # optional, for the --web check
    python experiments/web_integration_check.py --web http://localhost:5173

It talks HTTP only (standard library), exactly like the website, and changes the database (publishes a timetable,
creates accounts, leave, quizzes, holidays...). Use a fresh database: delete data/clockwork.db or set CLOCKWORK_DB.

Checks, in order: frontend served; login/roles; teacher constraints change the optimization; a full optimizer run
with the equal-evaluation greedy baseline; an INDEPENDENT collision/constraint re-check of every Pareto timetable
(written separately from timetable.evaluation); publishing (and refusal of a clashing timetable); accounts;
leave -> cover/substitute; requests/notifications; quiz/extra-class collision checks; online-assessment
cancellation; holidays; syllabus completion; and a sweep of the whole semester calendar for teacher/group/room
double bookings after all those changes. Exit code 0 only if every check passes.
"""
from __future__ import annotations

import argparse
import http.client
import json
import urllib.parse
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

RESULTS: list[dict] = []


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def call(self, path: str, method: str = "GET", body=None, token: str | None = None):
        # http.client (persistent connection, like a browser) rather than urllib: urllib always sends
        # "Connection: close", and on Windows uvicorn can then reset the socket during large responses.
        url = urllib.parse.urlsplit(self.base)
        conn = http.client.HTTPConnection(url.hostname, url.port or 80, timeout=180)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            conn.request(method, url.path.rstrip("/") + "/api" + path, json.dumps(body) if body is not None else None, headers)
            r = conn.getresponse()
            raw = r.read()
        finally:
            conn.close()
        try:
            return r.status, json.loads(raw) if raw else None
        except ValueError:
            return r.status, raw.decode(errors="replace")

    def login(self, username: str, password: str) -> str:
        s, j = self.call("/auth/login", "POST", {"username": username, "password": password})
        if s != 200:
            raise RuntimeError(f"login {username} failed: {s} {j}")
        return j["token"]

    def run(self, body: dict, token: str, timeout: float = 900) -> dict:
        s, j = self.call("/runs", "POST", body, token)
        if s != 200:
            raise RuntimeError(f"start run failed: {s} {j}")
        rid, start = j["runId"], time.time()
        while time.time() - start < timeout:
            time.sleep(0.5)
            s, st = self.call(f"/runs/{rid}", token=token)
            if st["status"] == "done":
                return {"start": j, **st["result"]}
            if st["status"] == "error":
                raise RuntimeError(st["error"])
        raise TimeoutError(f"run {rid} did not finish in {timeout}s")


def check(section: str, name: str, ok: bool, detail: str = "", skip: bool = False) -> bool:
    RESULTS.append({"section": section, "check": name, "status": "SKIP" if skip else "PASS" if ok else "FAIL", "detail": detail})
    mark = "SKIP" if skip else "PASS" if ok else "FAIL"
    print(f"[{mark}] {section}: {name}" + (f"  ({detail})" if detail else ""), flush=True)
    return ok


# ---------------------------------------------------------------------------
# independent checks (deliberately NOT using timetable.evaluation)
# ---------------------------------------------------------------------------
def independent_violations(inst: dict, sol: dict) -> list[str]:
    """Re-check a website timetable from first principles: every hard constraint the model states."""
    P = len(inst["grid"]["periods"])
    lunch = set(inst["grid"].get("lunchPeriods") or [inst["grid"]["lunchPeriod"]])
    ev = {e["id"]: e for e in inst["events"]}
    off = {o["id"]: o for o in inst["offerings"]}
    rooms = {r["id"]: r for r in inst["rooms"]}
    fac = {f["id"]: f for f in inst["faculty"]}
    size = {g["id"]: g["strength"] for g in inst["groups"]}
    errors = []
    placed = Counter(a["eventId"] for a in sol["assignments"])
    for eid in ev:
        if placed[eid] != 1:
            errors.append(f"event {eid} placed {placed[eid]} times")
    t_occ, g_occ, r_occ = Counter(), Counter(), Counter()
    daily, weekly, offering_days = Counter(), Counter(), defaultdict(list)
    for o in inst["offerings"]:
        t = sol["facultyOf"].get(o["id"])
        if t not in o["eligibleFaculty"]:
            errors.append(f"{o['id']}: teacher {t} not eligible")
    for a in sol["assignments"]:
        e = ev[a["eventId"]]
        o = off[e["offeringId"]]
        t = sol["facultyOf"][o["id"]]
        r = rooms.get(a["roomId"])
        d, p0, L = a["day"], a["period"], e["length"]
        if r is None:
            errors.append(f"{e['id']}: unknown room")
            continue
        if p0 < 0 or p0 + L > P:
            errors.append(f"{e['id']}: crosses the day boundary")
        kind = o.get("roomKind") or ("lab" if o["type"] == "lab" else "classroom")
        rkind = r.get("kind") or r["type"]
        if (rkind if rkind != "hall" else "classroom") != kind:
            errors.append(f"{e['id']}: room kind {rkind} != {kind}")
        if r["capacity"] < sum(size[g] for g in o["groupIds"]):
            errors.append(f"{e['id']}: room {r['id']} too small")
        offering_days[o["id"]].append(d)
        daily[(t, d)] += L
        weekly[t] += L
        for p in range(p0, p0 + L):
            slot = d * P + p
            if p in lunch:
                errors.append(f"{e['id']}: during lunch")
            if slot in set(fac[t].get("unavailable") or []):
                errors.append(f"{e['id']}: teacher {t} unavailable at slot {slot}")
            if slot in set(r.get("unavailable") or []):
                errors.append(f"{e['id']}: room {r['id']} unavailable at slot {slot}")
            t_occ[(t, slot)] += 1
            r_occ[(r["id"], slot)] += 1
            for g in o["groupIds"]:
                g_occ[(g, slot)] += 1
    errors += [f"teacher clash {k}" for k, v in t_occ.items() if v > 1]
    errors += [f"room clash {k}" for k, v in r_occ.items() if v > 1]
    errors += [f"student group clash {k}" for k, v in g_occ.items() if v > 1]
    errors += [f"{t} over daily limit on day {d}" for (t, d), v in daily.items() if v > fac[t]["maxDaily"]]
    errors += [f"{t} over weekly limit" for t, v in weekly.items() if v > fac[t]["maxWeekly"]]
    for oid, days in offering_days.items():
        if off[oid].get("distinctDays", off[oid]["type"] != "lab") and len(days) != len(set(days)):
            errors.append(f"{oid}: two sessions on one day")
    return errors


def calendar_double_bookings(occs: list[dict]) -> list[str]:
    """Teacher / student-group / room booked twice at the same dated period (active occurrences only)."""
    seen: dict[tuple, str] = {}
    clashes = []
    for o in occs:
        if o["status"] not in ("scheduled", "substituted"):
            continue
        for p in range(o["period"], o["period"] + o["length"]):
            keys = [("teacher", o["facultyId"]), ("room", o["roomId"])] + [("group", g) for g in o["groupIds"]]
            for kind, who in keys:
                k = (o["date"], p, kind, who)
                if k in seen and seen[k] != o["id"]:
                    clashes.append(f"{kind} {who} on {o['date']} P{p + 1}: {seen[k]} and {o['id']}")
                seen[k] = o["id"]
    return clashes


def slots_of(inst: dict, sol: dict, teacher: str) -> dict[int, int]:
    """slot -> count of periods taught by `teacher`; also usable for per-day loads."""
    P = len(inst["grid"]["periods"])
    ev = {e["id"]: e for e in inst["events"]}
    out = Counter()
    for a in sol["assignments"]:
        e = ev[a["eventId"]]
        if sol["facultyOf"][e["offeringId"]] == teacher:
            for p in range(a["period"], a["period"] + e["length"]):
                out[a["day"] * P + p] += 1
    return out


def compromise(front: list[dict]) -> dict:
    keys = ("f1", "f2", "f3")
    lo = {k: min(s["objectives"][k] for s in front) for k in keys}
    hi = {k: max(s["objectives"][k] for s in front) for k in keys}
    def dist(s):
        return sum(((s["objectives"][k] - lo[k]) / ((hi[k] - lo[k]) or 1)) ** 2 for k in keys)
    return min(front, key=dist)


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--web", help="frontend URL, e.g. http://localhost:5173 (checks it serves the app and proxies /api)")
    ap.add_argument("--admin-password", default="admin")
    ap.add_argument("--scenario", default="medium", help="instance for the main run (demo/small/medium/large)")
    ap.add_argument("--report", default="work/web_integration_check.json")
    args = ap.parse_args()
    api = Api(args.api)
    started = time.time()

    # -- servers ---------------------------------------------------------------
    s, h = api.call("/health")
    check("servers", "backend health", s == 200 and "memetic" in (h or {}).get("optimizer", "").lower(), str(h))
    if args.web:
        try:
            html = urllib.request.urlopen(args.web, timeout=20).read().decode()
            check("servers", "frontend serves the app", "<div id=\"root\"" in html or "Clockwork" in html)
            prox = json.loads(urllib.request.urlopen(args.web.rstrip("/") + "/api/health", timeout=20).read())
            check("servers", "frontend proxies /api to the backend", prox.get("ok") is True)
        except Exception as e:  # noqa: BLE001
            check("servers", "frontend reachable", False, str(e))

    # -- login / roles -----------------------------------------------------------
    check("accounts", "wrong password refused", api.call("/auth/login", "POST", {"username": "admin", "password": "wrong-pw"})[0] == 401)
    check("accounts", "no token refused", api.call("/me")[0] == 401)
    admin = api.login("admin", args.admin_password)
    s, me = api.call("/me", token=admin)
    check("accounts", "admin login", s == 200 and me["user"]["role"] == "admin")

    # -- teacher constraints change the optimization -----------------------------
    sec = "teacher constraints"
    for fid in [k for k in api.call("/constraints", token=admin)[1]]:
        api.call(f"/constraints/{fid}", "PUT", {"unavailable": []}, admin)
    base_cfg = {"scenario": "demo", "seed": 0, "budget": 360, "population": 24, "searchSeconds": None, "compareBaseline": False}
    r0 = api.run(base_cfg, admin)
    s0 = compromise([s for s in r0["solutions"] if s["onFront"]])
    teacher = max((f["id"] for f in r0["instance"]["faculty"]), key=lambda f: sum(slots_of(r0["instance"], s0, f).values()))
    used = sorted(slots_of(r0["instance"], s0, teacher))
    P = len(r0["instance"]["grid"]["periods"])
    api.call(f"/constraints/{teacher}", "PUT", {"unavailable": used, "maxDaily": 2}, admin)
    r1 = api.run(base_cfg, admin)
    check(sec, "saved availability reported as applied", any(c.startswith(teacher + ":") for c in r1["start"]["constraintChanges"]),
          f"{teacher}: blocked {len(used)} periods it used, max 2/day")
    f_inst = next(f for f in r1["instance"]["faculty"] if f["id"] == teacher)
    check(sec, "blocked periods are in the optimised instance", set(used) <= set(f_inst["unavailable"]) and f_inst["maxDaily"] == 2)
    front1 = [s for s in r1["solutions"] if s["onFront"]]
    bad = [s["id"] for s in front1 if set(slots_of(r1["instance"], s, teacher)) & set(used)]
    check(sec, "no Pareto timetable uses a blocked period", not bad, f"{len(front1)} timetables checked")
    over = [s["id"] for s in front1 if any(sum(v for k, v in slots_of(r1["instance"], s, teacher).items() if k // P == d) > 2 for d in range(5))]
    check(sec, "saved daily maximum respected", not over)
    changed = {json.dumps(s["assignments"], sort_keys=True) for s in front1}.isdisjoint({json.dumps(s["assignments"], sort_keys=True) for s in r0["solutions"] if s["onFront"]})
    check(sec, "same seed gives a different result once constraints change", changed,
          f"compromise objectives {s0['objectives']} -> {compromise(front1)['objectives']}")
    api.call(f"/constraints/{teacher}", "PUT", {"unavailable": []}, admin)

    # -- main optimizer run (as the Overview page does) ----------------------------
    sec = "optimizer run"
    s, scen = api.call("/scenarios")
    sc = next(x for x in scen if x["id"] == args.scenario)
    cfg = {"scenario": args.scenario, "instanceSeed": 1, "seed": 0, "budget": sc["budget"], "population": 24,
           "searchSeconds": sc["seconds"], "compareBaseline": True}
    res = api.run(cfg, admin)
    st = res["stats"]
    front = [s for s in res["solutions"] if s["onFront"]]
    check(sec, "final method used", "memetic" in st["method"].lower(), st["method"])
    check(sec, "result checked by the independent evaluator", st["verified"] is True and all(s["violation"] == 0 for s in res["solutions"]))
    check(sec, "Pareto front returned", len(front) == st["frontSize"] > 0, f"{len(front)} timetables, HV {st['hypervolume']:.4f}")
    check(sec, "baseline ran with equal evaluations", st["baselineEvaluations"] == st["evaluations"] and st["baselineFeasible"],
          f"greedy HV {st['baselineHypervolume']:.4f} vs memetic {st['hypervolume']:.4f} at {st['evaluations']} evaluations")
    check(sec, "convergence history for the chart", len(st["convergence"]) > 1)
    s, latest = api.call("/runs/latest", token=admin)
    check(sec, "run kept server-side (/runs/latest)", s == 200 and latest["runId"] == res["runId"])

    # -- no collisions --------------------------------------------------------------
    sec = "collisions"
    problems = {s["id"]: independent_violations(res["instance"], s) for s in res["solutions"]}
    bad = {k: v[:3] for k, v in problems.items() if v}
    check(sec, "every returned timetable passes an independent re-check", not bad,
          f"{len(res['solutions'])} timetables: no teacher/student/room clash, lunch, capacity, kind, availability, limits" if not bad else json.dumps(bad)[:400])

    # -- publish -----------------------------------------------------------------------
    sec = "publish"
    chosen = compromise(front)
    a0 = chosen["assignments"][0]
    clash = {**chosen, "assignments": [dict(a, day=a0["day"], period=a0["period"], roomId=a0["roomId"]) for a in chosen["assignments"]]}
    s, j = api.call("/timetable/publish", "POST", {"instance": res["instance"], "solution": clash}, admin)
    check(sec, "clashing timetable refused", s == 400 and "hard constraints" in str(j), str(j)[:120])
    s, _ = api.call("/timetable/publish", "POST", {"instance": res["instance"], "solution": chosen}, admin)
    s2, pub = api.call("/timetable", token=admin)
    check(sec, "best-compromise timetable published", s == 200 and pub["solution"]["id"] == chosen["id"] and pub["solution"].get("verified"))
    inst, sol = pub["instance"], pub["solution"]

    # semester with a known start (a Monday); the weekly timetable repeats inside it
    monday = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)
    end = monday + timedelta(weeks=12, days=4)
    api.call("/semester", "PUT", {"start": monday.isoformat(), "end": end.isoformat()}, admin)
    D = lambda n: (monday + timedelta(days=n)).isoformat()  # noqa: E731

    # -- accounts -------------------------------------------------------------------------
    sec = "accounts"
    s, j = api.call("/users/bulk", "POST", {}, admin)
    pw = {u["username"]: u["password"] for u in j["created"]}
    check(sec, "one account per teacher and per class", len(pw) == len(inst["faculty"]) + len(inst["groups"]), f"{len(pw)} created")
    tok = {f["id"]: api.login(f["id"].lower(), pw[f["id"].lower()]) for f in inst["faculty"]}
    g0 = inst["groups"][0]["id"]
    student = api.login(f"{g0.lower()}-student", pw[f"{g0.lower()}-student"])
    s, me = api.call("/me", token=student)
    check(sec, "student login sees own class", me["user"]["role"] == "student" and me["user"]["groupId"] == g0)
    t_any = next(iter(tok.values()))
    check(sec, "student cannot run the optimiser / cancel / manage users",
          [api.call("/runs", "POST", {}, student)[0], api.call("/lectures/cancel", "POST", {"eventId": "x", "date": D(0)}, student)[0],
           api.call("/users", token=student)[0]] == [403, 403, 403])
    check(sec, "teacher cannot run the optimiser or manage users", [api.call("/runs", "POST", {}, t_any)[0], api.call("/users", token=t_any)[0]] == [403, 403])
    check(sec, "students and teachers see the published timetable", api.call("/timetable", token=student)[0] == 200 == api.call("/timetable", token=t_any)[0])

    def occ(start: str, stop: str | None = None, token: str = admin, **f) -> list[dict]:
        q = "&".join(f"{k}={v}" for k, v in f.items())
        s, j = api.call(f"/calendar?start={start}&end={stop or start}&{q}", token=token)
        assert s == 200, j
        return j["occurrences"]

    def free(dt: str, period: int, length: int = 1, token: str = t_any) -> dict:
        return api.call(f"/free?date={dt}&period={period}&length={length}", token=token)[1]

    def unread(token: str) -> int:
        return api.call("/notifications", token=token)[1]["unread"]

    # -- leave -> cover / substitute --------------------------------------------------------
    sec = "leave and cover"
    week2 = occ(D(7), D(11))
    by_teacher_day = Counter((o["facultyId"], o["date"]) for o in week2 if o["kind"] == "lecture")
    (A, leave_day), _n = by_teacher_day.most_common(1)[0]
    s, _ = api.call("/leaves", "POST", {"start": leave_day, "end": leave_day, "reason": "medical"}, tok[A])
    mine = [o for o in occ(leave_day, facultyId=A) if o["kind"] == "lecture" and o["originalFacultyId"] == A]
    check(sec, "teacher applies for leave", s == 200, f"{A} on {leave_day}: {len(mine)} lectures")
    check(sec, "their lectures become 'needs cover'", mine and all(o["status"] == "needs_cover" for o in mine))
    others = [f for f in tok if f != A]
    check(sec, "other teachers are notified", any("on leave" in n["message"] for n in api.call("/notifications", token=tok[others[0]])[1]["items"]))
    target = mine[0]
    cands = [t["id"] for t in free(target["date"], target["period"], target["length"])["teachers"] if t["id"] != A]
    B = cands[0]
    before = unread(tok[A])
    s, rq = api.call("/requests", "POST", {"eventId": target["eventId"], "date": target["date"], "message": "I can cover"}, tok[B])
    check(sec, "free teacher requests the lecture", s == 200, f"{B} asks for {target['code']}")
    check(sec, "lecture owner is notified of the request", unread(tok[A]) > before)
    check(sec, "requester cannot approve own request", api.call(f"/requests/{rq['id']}/accept", "POST", {}, tok[B])[0] == 403)
    s, _ = api.call(f"/requests/{rq['id']}/accept", "POST", {"reply": "thanks"}, tok[A])
    o2 = next(o for o in occ(target["date"]) if o["id"] == target["id"])
    check(sec, "accepted request -> covered by the substitute", s == 200 and o2["status"] == "substituted" and o2["facultyId"] == B)
    check(sec, "substitute is notified of the acceptance", any("accepted" in n["message"] for n in api.call("/notifications", token=tok[B])[1]["items"]))
    if len(mine) > 1:
        t2 = mine[1]
        C = next((t["id"] for t in free(t2["date"], t2["period"], t2["length"])["teachers"] if t["id"] != A), None)
        s, _ = api.call("/lectures/assign", "POST", {"eventId": t2["eventId"], "date": t2["date"], "facultyId": C}, admin)
        o3 = next(o for o in occ(t2["date"]) if o["id"] == t2["id"])
        check(sec, "admin assigns a substitute directly", s == 200 and o3["status"] == "substituted" and o3["facultyId"] == C, f"{C}")
        busy_t = next((o["facultyId"] for o in occ(t2["date"]) if o["status"] == "scheduled" and o["facultyId"] != A
                       and not (o["period"] + o["length"] <= t2["period"] or o["period"] >= t2["period"] + t2["length"])), None)
        s, j = api.call("/lectures/assign", "POST", {"eventId": t2["eventId"], "date": t2["date"], "facultyId": busy_t}, admin) if busy_t else (None, None)
        check(sec, "a teacher who is busy then cannot be assigned", s in (400, 409) if busy_t else True, str(j)[:100] if busy_t else "", skip=busy_t is None)
    else:
        check(sec, "admin assigns a substitute directly", True, "only one lecture that day", skip=True)

    # requests: reject flow
    sec = "requests and notifications"
    week3 = occ(D(14), D(18))
    target = next(o for o in week3 if o["kind"] == "lecture" and o["status"] == "scheduled" and o["originalFacultyId"] != B
                  and any(t["id"] == B for t in free(o["date"], o["period"], o["length"])["teachers"]))
    owner = target["originalFacultyId"]
    s, rq = api.call("/requests", "POST", {"eventId": target["eventId"], "date": target["date"], "message": "swap?"}, tok[B])
    check(sec, "request listed for the owner (incoming) and sender (outgoing)",
          any(x["id"] == rq["id"] for x in api.call("/requests", token=tok[owner])[1]["incoming"])
          and any(x["id"] == rq["id"] for x in api.call("/requests", token=tok[B])[1]["outgoing"]))
    before = unread(tok[B])
    s, _ = api.call(f"/requests/{rq['id']}/reject", "POST", {"reply": "no thanks"}, tok[owner])
    still = next(o for o in occ(target["date"]) if o["id"] == target["id"])
    check(sec, "declined request leaves the lecture unchanged", s == 200 and still["status"] == "scheduled" and still["facultyId"] == owner)
    check(sec, "requester is notified of the decline", unread(tok[B]) > before)
    clash_occ = None
    for m in [o for o in week3 if o["facultyId"] == B and o["status"] == "scheduled"]:
        clash_occ = next((o for o in week3 if o["date"] == m["date"] and o["facultyId"] != B and o["status"] == "scheduled"
                          and not (o["period"] + o["length"] <= m["period"] or o["period"] >= m["period"] + m["length"])), None)
        if clash_occ:
            break
    if clash_occ:
        s, j = api.call("/requests", "POST", {"eventId": clash_occ["eventId"], "date": clash_occ["date"]}, tok[B])
        check(sec, "teacher cannot request a lecture while teaching another", s == 409, str(j)[:100])
    else:
        check(sec, "teacher cannot request a lecture while teaching another", True, "no overlapping slot", skip=True)
    api.call("/notifications/read", "POST", {}, tok[B])
    check(sec, "notifications can be marked read", unread(tok[B]) == 0)

    # -- quiz / extra class ------------------------------------------------------------------
    sec = "quiz and extra classes"
    qday = D(21)
    my_off = next(o for o in inst["offerings"] if o["type"] != "lab" and g0 in o["groupIds"])
    T = sol["facultyOf"][my_off["id"]]
    day_occ = occ(qday)
    g_busy = {p for o in day_occ if g0 in o["groupIds"] and o["status"] in ("scheduled", "substituted") for p in range(o["period"], o["period"] + o["length"])}
    t_busy = {p for o in day_occ if o["facultyId"] == T and o["status"] in ("scheduled", "substituted") for p in range(o["period"], o["period"] + o["length"])}
    lunch = inst["grid"]["lunchPeriod"]
    size = sum(g["strength"] for g in inst["groups"] if g["id"] in my_off["groupIds"])
    s, j = api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": qday, "period": min(g_busy), "roomId": inst["rooms"][0]["id"]}, tok[T])
    check(sec, "refused when the students already have a class", s == 409, str(j)[:100])
    # find a (course, date, period) where the class is free but its teacher teaches another class
    found = None
    for k in range(21, 26):
        dk = D(k)
        dk_occ = occ(dk)
        for o in inst["offerings"]:
            if o["type"] == "lab":
                continue
            teacher = sol["facultyOf"][o["id"]]
            gb = {p for x in dk_occ if set(x["groupIds"]) & set(o["groupIds"]) and x["status"] in ("scheduled", "substituted") for p in range(x["period"], x["period"] + x["length"])}
            tb = {p for x in dk_occ if x["facultyId"] == teacher and x["status"] in ("scheduled", "substituted") for p in range(x["period"], x["period"] + x["length"])}
            cand = sorted(tb - gb - {lunch})
            if cand:
                found = (o, teacher, dk, cand[0])
                break
        if found:
            break
    if found:
        o, teacher, dk, p = found
        fr = free(dk, p, token=tok[teacher])["rooms"]
        s, j = api.call("/extra-classes", "POST", {"offeringId": o["id"], "date": dk, "period": p, "roomId": max(fr, key=lambda r: r["capacity"])["id"]}, tok[teacher])
        check(sec, "refused when the teacher is teaching elsewhere", s == 409, str(j)[:100])
    else:
        check(sec, "refused when the teacher is teaching elsewhere", True, "no such slot in the week", skip=True)
    okp = next(p for p in range(len(inst["grid"]["periods"])) if p not in g_busy | t_busy | {lunch})
    fr = free(qday, okp, token=tok[T])
    busy_rooms = [r for r in inst["rooms"] if r["id"] not in {x["id"] for x in fr["rooms"]} and r["capacity"] >= size]
    if busy_rooms:
        s, j = api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": qday, "period": okp, "roomId": busy_rooms[0]["id"]}, tok[T])
        check(sec, "refused when the room is taken", s == 409, str(j)[:100])
    small = [r for r in fr["rooms"] if r["capacity"] < size]
    if small:
        check(sec, "refused when the room is too small", api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": qday, "period": okp, "roomId": small[0]["id"]}, tok[T])[0] == 400)
    room = max(fr["rooms"], key=lambda r: r["capacity"])
    before = unread(student)
    s, j = api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": qday, "period": okp, "roomId": room["id"], "kind": "quiz", "title": "Quiz 1"}, tok[T])
    check(sec, "accepted in a free period / free room", s == 200, f"{my_off['id']} P{okp + 1} in {room['id']}")
    check(sec, "quiz appears in the calendar", any(o["kind"] == "quiz" and o["period"] == okp for o in occ(qday, group=g0)))
    check(sec, "class is notified", unread(student) > before)
    other_t = next(f for f in tok if f != T)
    check(sec, "teacher cannot add a quiz for a course they do not teach",
          api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": qday, "period": okp, "roomId": room["id"]}, tok[other_t])[0] == 403)
    other_off = next((o for o in inst["offerings"] if g0 not in o["groupIds"] and o["type"] != "lab"
                      and okp not in {p for x in day_occ if set(x["groupIds"]) & set(o["groupIds"]) and x["status"] == "scheduled" for p in range(x["period"], x["period"] + x["length"])}
                      and sol["facultyOf"][o["id"]] != T), None)
    if other_off:
        s, j = api.call("/extra-classes", "POST", {"offeringId": other_off["id"], "date": qday, "period": okp, "roomId": room["id"]}, admin)
        check(sec, "second class refused in the room the quiz now uses", s == 409, str(j)[:100])

    # -- online assessment ------------------------------------------------------------------
    sec = "online assessment"
    oa_day = D(23)
    before_oa = [o for o in occ(oa_day, group=g0) if o["kind"] == "lecture"]
    before = unread(student)
    s, _ = api.call("/assessments", "POST", {"title": "OA-1", "date": oa_day, "startPeriod": 0, "endPeriod": 3, "groupIds": [g0]}, admin)
    after = {o["id"]: o for o in occ(oa_day, group=g0)}
    inside = [o for o in before_oa if o["period"] <= 3]
    outside = [o for o in before_oa if o["period"] > 3]
    check(sec, "lectures inside the assessment window are cancelled", s == 200 and inside and all(after[o["id"]]["status"] == "cancelled" and "assessment" in after[o["id"]]["reason"].lower() for o in inside), f"{len(inside)} cancelled")
    check(sec, "lectures outside the window are untouched", all(after[o["id"]]["status"] == o["status"] for o in outside), f"{len(outside)} kept", skip=not outside)
    other_g = inst["groups"][1]["id"] if len(inst["groups"]) > 1 else None
    if other_g:
        check(sec, "other classes are untouched", all(o["status"] == "scheduled" for o in occ(oa_day, group=other_g) if o["kind"] == "lecture"))
    check(sec, "class is notified", unread(student) > before)
    s, j = api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": oa_day, "period": 1, "roomId": room["id"]}, tok[T])
    check(sec, "no quiz can be put inside the assessment", s in (409, 400), str(j)[:80])

    # -- holidays ------------------------------------------------------------------------------
    sec = "holidays"
    hol = D(24)
    s, _ = api.call("/holidays", "POST", {"date": hol, "name": "Founders day"}, admin)
    h_occ = occ(hol)
    check(sec, "every lecture that day is cancelled", s == 200 and h_occ and all(o["status"] == "cancelled" for o in h_occ), f"{len(h_occ)} lectures")
    check(sec, "everyone is notified", any("Holiday" in n["message"] for n in api.call("/notifications", token=student)[1]["items"]))
    check(sec, "no quiz on a holiday", api.call("/extra-classes", "POST", {"offeringId": my_off["id"], "date": hol, "period": okp, "roomId": room["id"]}, tok[T])[0] == 400)
    check(sec, "teachers cannot declare holidays", api.call("/holidays", "POST", {"date": D(25), "name": "x"}, t_any)[0] == 403)

    # -- syllabus -------------------------------------------------------------------------------
    sec = "syllabus completion"
    so = next(o for o in inst["offerings"] if g0 not in o["groupIds"])
    owner = sol["facultyOf"][so["id"]]
    done_on = D(30)
    check(sec, "only the course's teacher (or admin) can mark it", api.call("/syllabus", "POST", {"offeringId": so["id"], "completedOn": done_on}, tok[next(f for f in tok if f != owner)])[0] == 403)
    s, _ = api.call("/syllabus", "POST", {"offeringId": so["id"], "completedOn": done_on}, tok[owner])
    later = [o for o in occ(D(31), D(80)) if o["offeringId"] == so["id"] and o["kind"] == "lecture"]
    earlier = [o for o in occ(D(0), done_on) if o["offeringId"] == so["id"] and o["kind"] == "lecture"]
    check(sec, "no lectures after the completion date", s == 200 and not later and earlier, f"{len(earlier)} before, {len(later)} after")
    check(sec, "no extra class after completion",
          api.call("/extra-classes", "POST", {"offeringId": so["id"], "date": D(35), "period": 0, "roomId": room["id"]}, tok[owner])[0] in (400, 409))

    # -- whole-semester collision sweep after all changes ----------------------------------------
    sec = "collisions"
    all_occ = occ(monday.isoformat(), end.isoformat())
    clashes = calendar_double_bookings(all_occ)
    check(sec, "no teacher/student/room double booking anywhere in the semester calendar", not clashes,
          f"{len(all_occ)} dated classes incl. covers and quizzes" if not clashes else "; ".join(clashes[:5]))

    passed = sum(r["status"] == "PASS" for r in RESULTS)
    failed = sum(r["status"] == "FAIL" for r in RESULTS)
    skipped = sum(r["status"] == "SKIP" for r in RESULTS)
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped in {time.time() - started:.0f}s")
    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"passed": passed, "failed": failed, "skipped": skipped, "api": args.api, "web": args.web,
                               "scenario": args.scenario, "mainRun": {k: st[k] for k in ("method", "evaluations", "hypervolume", "baselineHypervolume", "frontSize", "runtime", "baselineRuntime")},
                               "results": RESULTS}, indent=2) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
