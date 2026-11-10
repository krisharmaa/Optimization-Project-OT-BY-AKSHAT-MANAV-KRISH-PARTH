"""Website application layer on top of the final optimizer: accounts, roles, calendar rules, requests,
notifications, publishing checks and optimiser runs. Run: python -m pytest tests/test_web_campus.py"""
import os
import tempfile
import time
import unittest
from datetime import date, timedelta

_tmp = tempfile.mkdtemp()
os.environ["CLOCKWORK_DB"] = os.path.join(_tmp, "test.db")
os.environ["CLOCKWORK_RUNS_DIR"] = os.path.join(_tmp, "runs")

from fastapi.testclient import TestClient  # noqa: E402

from api.server import app  # noqa: E402
from api.bridge import demo_problem, problem_to_web, schedule_to_solution  # noqa: E402
from timetable.greedy import greedy  # noqa: E402

client = TestClient(app)
MONDAY = date(2026, 11, 2)  # a Monday


def login(u, p):
    r = client.post("/api/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


class TestCampus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = login("admin", "admin")
        prob = demo_problem()
        cls.instance = problem_to_web(prob)
        cls.solution = schedule_to_solution(prob, greedy(prob), "S001", True)
        assert cls.solution["violation"] == 0
        r = client.post("/api/timetable/publish", json={"instance": cls.instance, "solution": cls.solution}, headers=cls.admin)
        assert r.status_code == 200, r.text
        client.put("/api/semester", json={"start": MONDAY.isoformat(), "end": (MONDAY + timedelta(weeks=10)).isoformat()}, headers=cls.admin)
        created = client.post("/api/users/bulk", headers=cls.admin).json()["created"]
        cls.pw = {u["username"]: u["password"] for u in created}
        cls.t1 = login("f1", cls.pw["f1"])
        cls.t2 = login("f2", cls.pw["f2"])
        cls.student = login("ga-student", cls.pw["ga-student"])

    def week(self, headers, **filters):
        q = "&".join(f"{k}={v}" for k, v in filters.items())
        r = client.get(f"/api/calendar?start={MONDAY}&end={MONDAY + timedelta(days=4)}&{q}", headers=headers)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["occurrences"]

    def test_login_and_roles(self):
        self.assertEqual(client.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code, 401)
        self.assertEqual(client.get("/api/me").status_code, 401)
        me = client.get("/api/me", headers=self.student).json()["user"]
        self.assertEqual((me["role"], me["groupId"]), ("student", "gA"))
        # students are read-only
        self.assertEqual(client.post("/api/lectures/cancel", json={"eventId": "x", "date": str(MONDAY)}, headers=self.student).status_code, 403)
        self.assertEqual(client.post("/api/runs", json={}, headers=self.student).status_code, 403)
        self.assertEqual(client.get("/api/users", headers=self.t1).status_code, 403)
        self.assertEqual(client.get("/api/timetable", headers=self.student).status_code, 200)
        self.assertTrue(self.week(self.student, group="gA"))

    def test_take_slot_request_flow(self):
        # a lecture of f1 this week that f2 is free to teach
        target = None
        for o in self.week(self.t1, faculty="f1"):
            if o["status"] == "scheduled" and o["originalFacultyId"] == "f1":
                free = client.get(f"/api/free?date={o['date']}&period={o['period']}&length={o['length']}", headers=self.t2).json()
                if any(t["id"] == "f2" for t in free["teachers"]):
                    target = o
                    break
        self.assertIsNotNone(target)
        r = client.post("/api/requests", json={"eventId": target["eventId"], "date": target["date"], "message": "I can cover"}, headers=self.t2)
        self.assertEqual(r.status_code, 200, r.text)
        rid = r.json()["id"]
        # f1 is notified and sees the request
        notes = client.get("/api/notifications", headers=self.t1).json()
        self.assertTrue(any("asks to take your lecture" in n["message"] for n in notes["items"]))
        inc = client.get("/api/requests", headers=self.t1).json()["incoming"]
        self.assertIn(rid, [x["id"] for x in inc])
        # f2 cannot approve its own request; f1 accepts
        self.assertEqual(client.post(f"/api/requests/{rid}/accept", json={}, headers=self.t2).status_code, 403)
        self.assertEqual(client.post(f"/api/requests/{rid}/accept", json={"reply": "thanks"}, headers=self.t1).status_code, 200)
        occ = [o for o in self.week(self.admin) if o["id"] == target["id"]][0]
        self.assertEqual((occ["status"], occ["facultyId"]), ("substituted", "f2"))
        self.assertTrue(any("accepted your request" in n["message"] for n in client.get("/api/notifications", headers=self.t2).json()["items"]))

    def test_busy_teacher_cannot_request(self):
        # a slot where f2 is already teaching something else
        mine = [o for o in self.week(self.t2, faculty="f2") if o["status"] == "scheduled"]
        others = [o for o in self.week(self.admin) if o["originalFacultyId"] not in ("f2",) and o["status"] == "scheduled"]
        clash = next((o for o in others for m in mine if o["date"] == m["date"] and o["period"] == m["period"]), None)
        if clash is None:
            self.skipTest("no overlapping slot in this timetable")
        r = client.post("/api/requests", json={"eventId": clash["eventId"], "date": clash["date"]}, headers=self.t2)
        self.assertEqual(r.status_code, 409)

    def test_cancel_holiday_assessment_syllabus(self):
        day2 = MONDAY + timedelta(days=7)
        occs = client.get(f"/api/calendar?start={day2}&end={day2 + timedelta(days=4)}&faculty=f1", headers=self.t1).json()["occurrences"]
        o = next(x for x in occs if x["status"] == "scheduled" and x["originalFacultyId"] == "f1")
        self.assertEqual(client.post("/api/lectures/cancel", json={"eventId": o["eventId"], "date": o["date"], "reason": "conference"}, headers=self.t1).status_code, 200)
        again = client.get(f"/api/calendar?start={o['date']}&end={o['date']}", headers=self.t1).json()["occurrences"]
        self.assertEqual([x for x in again if x["id"] == o["id"]][0]["status"], "needs_cover")
        self.assertTrue(any("cancelled" in n["message"] for n in client.get("/api/notifications", headers=self.t2).json()["items"]))
        # f2 cannot cancel f1's lecture
        other = next(x for x in occs if x["status"] == "scheduled" and x["id"] != o["id"] and x["originalFacultyId"] == "f1")
        self.assertEqual(client.post("/api/lectures/cancel", json={"eventId": other["eventId"], "date": other["date"]}, headers=self.t2).status_code, 403)

        hol = (MONDAY + timedelta(days=15)).isoformat()  # a Tuesday
        client.post("/api/holidays", json={"date": hol, "name": "Founders day"}, headers=self.admin)
        hol_occ = client.get(f"/api/calendar?start={hol}&end={hol}", headers=self.admin).json()["occurrences"]
        self.assertTrue(hol_occ and all(x["status"] == "cancelled" for x in hol_occ))

        oa_day = (MONDAY + timedelta(days=16)).isoformat()
        r = client.post("/api/assessments", json={"title": "OA-1", "date": oa_day, "startPeriod": 0, "endPeriod": 7, "groupIds": ["gA"]}, headers=self.admin)
        self.assertEqual(r.status_code, 200, r.text)
        oa_occ = client.get(f"/api/calendar?start={oa_day}&end={oa_day}&group=gA", headers=self.admin).json()["occurrences"]
        self.assertTrue(all(x["status"] == "cancelled" and "Online assessment" in x["reason"] for x in oa_occ))

        off = "gB-EVS"  # f6 teaches EVS in the demo (first eligible); find its teacher and close the syllabus
        done_on = (MONDAY + timedelta(days=20)).isoformat()
        self.assertEqual(client.post("/api/syllabus", json={"offeringId": off, "completedOn": done_on}, headers=self.admin).status_code, 200)
        later = client.get(f"/api/calendar?start={MONDAY + timedelta(days=21)}&end={MONDAY + timedelta(days=60)}", headers=self.admin).json()["occurrences"]
        self.assertFalse([x for x in later if x["offeringId"] == off and x["kind"] == "lecture"])

    def test_quiz_collision_checks(self):
        d = (MONDAY + timedelta(days=28)).isoformat()
        occ = client.get(f"/api/calendar?start={d}&end={d}&group=gA", headers=self.admin).json()["occurrences"]
        busy = {p for o in occ if o["status"] in ("scheduled", "substituted") for p in range(o["period"], o["period"] + o["length"])}
        off = next(o for o in self.instance["offerings"] if o["groupIds"] == ["gA"] and self.solution["facultyOf"][o["id"]] == "f1")
        # clash: the group already has a class
        p_busy = min(busy)
        r = client.post("/api/extra-classes", json={"offeringId": off["id"], "date": d, "period": p_busy, "roomId": "r3"}, headers=self.t1)
        self.assertEqual(r.status_code, 409)
        # a period where the group and teacher are free, in a free room that fits
        for p in range(8):
            if p in busy or p == 4:
                continue
            free = client.get(f"/api/free?date={d}&period={p}", headers=self.t1).json()
            if any(t["id"] == "f1" for t in free["teachers"]) and free["rooms"]:
                room = max(free["rooms"], key=lambda r: r["capacity"])
                r = client.post("/api/extra-classes", json={"offeringId": off["id"], "date": d, "period": p, "roomId": room["id"], "title": "Quiz 1"}, headers=self.t1)
                self.assertEqual(r.status_code, 200, r.text)
                break
        else:
            self.skipTest("no free period found")
        # a student of gA is told about it
        self.assertTrue(any("Quiz 1" in n["message"] for n in client.get("/api/notifications", headers=self.student).json()["items"]))
        # f2 does not teach this course
        self.assertEqual(client.post("/api/extra-classes", json={"offeringId": off["id"], "date": d, "period": 0, "roomId": "r3"}, headers=self.t2).status_code, 403)

    def test_leave_and_constraints(self):
        s = MONDAY + timedelta(days=35)
        r = client.post("/api/leaves", json={"start": s.isoformat(), "end": (s + timedelta(days=1)).isoformat(), "reason": "medical"}, headers=self.t2)
        self.assertEqual(r.status_code, 200, r.text)
        occ = client.get(f"/api/calendar?start={s}&end={s + timedelta(days=1)}&faculty=f2", headers=self.admin).json()["occurrences"]
        self.assertTrue(all(o["status"] == "needs_cover" for o in occ if o["kind"] == "lecture"))
        self.assertEqual(client.put("/api/constraints/f2", json={"unavailable": [0, 1], "maxDaily": 3}, headers=self.t2).status_code, 200)
        self.assertEqual(client.put("/api/constraints/f1", json={"unavailable": [0]}, headers=self.t2).status_code, 403)
        self.assertEqual(client.get("/api/constraints", headers=self.admin).json()["f2"]["unavailable"], [0, 1])

    def test_admin_runs_optimiser_with_constraints(self):
        # A teacher's saved availability becomes a hard constraint of the next run of the final optimizer.
        blocked = [0, 1, 2, 3]  # Monday, periods 1-4
        self.assertEqual(client.put("/api/constraints/f5", json={"unavailable": blocked}, headers=self.admin).status_code, 200)
        r = client.post("/api/runs", json={"scenario": "demo", "budget": 120, "population": 12, "searchSeconds": 20}, headers=self.admin)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(any(c.startswith("f5:") for c in r.json()["constraintChanges"]))
        run_id = r.json()["runId"]
        for _ in range(600):
            st = client.get(f"/api/runs/{run_id}", headers=self.admin).json()
            if st["status"] != "running":
                break
            time.sleep(0.1)
        self.assertEqual(st["status"], "done", st.get("error"))
        res = st["result"]
        self.assertIn("memetic", res["stats"]["method"])
        self.assertTrue(res["stats"]["verified"])
        self.assertGreater(res["stats"]["hypervolume"], 0)
        self.assertIsNotNone(res["baseline"])
        self.assertEqual(res["stats"]["baselineEvaluations"], res["stats"]["evaluations"])  # equal-evaluation protocol
        f5 = next(f for f in res["instance"]["faculty"] if f["id"] == "f5")
        self.assertTrue(set(blocked) <= set(f5["unavailable"]))
        P = len(res["instance"]["grid"]["periods"])
        length = {e["id"]: e["length"] for e in res["instance"]["events"]}
        offering = {e["id"]: e["offeringId"] for e in res["instance"]["events"]}
        for sol in [s for s in res["solutions"] if s["onFront"]]:
            for a in sol["assignments"]:
                if sol["facultyOf"][offering[a["eventId"]]] == "f5":
                    slots = {a["day"] * P + a["period"] + k for k in range(length[a["eventId"]])}
                    self.assertFalse(slots & set(blocked))
        # the run is kept server-side and can be published after the independent check
        self.assertEqual(client.get("/api/runs/latest", headers=self.admin).json()["runId"], run_id)
        best = next(s for s in res["solutions"] if s["onFront"])
        tampered = {**best, "assignments": [dict(a, roomId=best["assignments"][0]["roomId"], day=0, period=0) for a in best["assignments"]]}
        bad = client.post("/api/timetable/publish", json={"instance": res["instance"], "solution": tampered}, headers=self.admin)
        self.assertEqual(bad.status_code, 400)
        self.assertIn("hard constraints", bad.json()["detail"])
        client.put("/api/constraints/f5", json={"unavailable": []}, headers=self.admin)

    def test_password_change(self):
        h = login("f3", self.pw["f3"])
        self.assertEqual(client.post("/api/me/password", json={"current": "wrong", "new": "secret1"}, headers=h).status_code, 400)
        self.assertEqual(client.post("/api/me/password", json={"current": self.pw["f3"], "new": "secret1"}, headers=h).status_code, 200)
        login("f3", "secret1")


if __name__ == "__main__":
    unittest.main()
