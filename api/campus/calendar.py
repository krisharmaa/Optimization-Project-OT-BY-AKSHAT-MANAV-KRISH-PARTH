"""Turns the published weekly timetable into dated lectures ("occurrences") for the semester.

Order of rules for a lecture of offering O, taught by teacher A, on date d:
  1. outside the semester, or a weekend day the grid has no column for      -> not shown
  2. syllabus of O marked complete before d                               -> not shown (no more classes)
  3. d is a holiday                                                       -> cancelled (closed)
  4. an online assessment for O's group overlaps the lecture's periods    -> cancelled (closed)
  5. a substitution exists for (lecture, d)                               -> substituted (taught by B)
  6. A cancelled it, or A is on leave on d                                -> needs cover (open: others may request it)
  7. otherwise                                                            -> scheduled
Quiz / extra classes are added as their own occurrences.

`busy()` answers "who and what is occupied at (d, periods)", which every change is checked against so
the calendar never gets a collision (teacher, group or room double-booked).
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from .db import get_setting, load_published

ACTIVE = ("scheduled", "substituted")


def parse_day(s: str) -> date:
    return date.fromisoformat(s)


def daterange(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


class Calendar:
    """Everything needed to build occurrences, loaded once per request."""

    def __init__(self, con):
        self.con = con
        self.pub = load_published(con)
        self.sem_start = parse_day(get_setting(con, "semester_start"))
        self.sem_end = parse_day(get_setting(con, "semester_end"))
        self.holidays = {r["day"]: r["name"] for r in con.execute("SELECT * FROM holidays")}
        self.syllabus = {r["offering_id"]: r["completed_on"] for r in con.execute("SELECT * FROM syllabus")}
        self.cancel = {(r["event_id"], r["day"]): dict(r) for r in con.execute("SELECT * FROM cancellations")}
        self.subs = {(r["event_id"], r["day"]): dict(r) for r in con.execute("SELECT * FROM substitutions")}
        self.leaves = [dict(r) for r in con.execute("SELECT * FROM leaves")]
        self.assess = [dict(r, group_ids=json.loads(r["group_ids"])) for r in con.execute("SELECT * FROM assessments")]
        self.extras = [dict(r) for r in con.execute("SELECT * FROM extra_classes")]
        self.constraints = {r["faculty_id"]: {"unavailable": json.loads(r["unavailable"]), "max_daily": r["max_daily"]}
                            for r in con.execute("SELECT * FROM teacher_constraints")}
        if self.pub:
            inst = self.pub["instance"]
            self.inst = inst
            self.days = inst["grid"]["days"]
            self.P = len(inst["grid"]["periods"])
            self.events = {e["id"]: e for e in inst["events"]}
            self.offerings = {o["id"]: o for o in inst["offerings"]}
            self.faculty = {f["id"]: f for f in inst["faculty"]}
            self.rooms = {r["id"]: r for r in inst["rooms"]}
            self.groups = {g["id"]: g for g in inst["groups"]}
            self.faculty_of = self.pub["solution"]["facultyOf"]
            self.by_day: dict[int, list] = {}
            for a in self.pub["solution"]["assignments"]:
                self.by_day.setdefault(a["day"], []).append(a)

    # ---- helpers ----
    def on_leave(self, faculty_id: str, d: str) -> dict | None:
        for lv in self.leaves:
            if lv["faculty_id"] == faculty_id and lv["start_date"] <= d <= lv["end_date"]:
                return lv
        return None

    def day_index(self, d: date) -> int | None:
        i = d.weekday()  # Monday = 0, matching the grid's first column
        return i if i < len(self.days) else None

    def in_semester(self, d: date) -> bool:
        return self.sem_start <= d <= self.sem_end

    def _assessment(self, groups, d: str, p0: int, p1: int):
        for a in self.assess:
            if a["day"] == d and set(groups) & set(a["group_ids"]) and not (p1 < a["start_period"] or p0 > a["end_period"]):
                return a
        return None

    # ---- occurrences ----
    def occurrences(self, start: date, end: date, faculty_id=None, group_id=None, room_id=None) -> list[dict]:
        if not self.pub:
            return []
        out = []
        for d in daterange(max(start, self.sem_start), min(end, self.sem_end)):
            di = self.day_index(d)
            if di is None:
                continue
            ds = d.isoformat()
            for a in self.by_day.get(di, []):
                ev = self.events.get(a["eventId"])
                if not ev:
                    continue
                off = self.offerings[ev["offeringId"]]
                done = self.syllabus.get(off["id"])
                if done and ds > done:
                    continue  # syllabus complete: no more classes
                original = self.faculty_of.get(off["id"])
                occ = {
                    "id": f"{ev['id']}@{ds}", "kind": "lecture", "eventId": ev["id"], "offeringId": off["id"],
                    "code": off["code"], "subject": off["subject"], "date": ds, "day": di, "period": a["period"],
                    "length": ev["length"], "roomId": a["roomId"], "groupIds": off["groupIds"],
                    "facultyId": original, "originalFacultyId": original, "status": "scheduled", "reason": "", "coverOpen": False,
                }
                p0, p1 = a["period"], a["period"] + ev["length"] - 1
                oa = self._assessment(off["groupIds"], ds, p0, p1)
                if ds in self.holidays:
                    occ.update(status="cancelled", reason=f"Holiday: {self.holidays[ds]}")
                elif oa:
                    occ.update(status="cancelled", reason=f"Online assessment: {oa['title']}")
                elif (ev["id"], ds) in self.subs:
                    s = self.subs[(ev["id"], ds)]
                    occ.update(status="substituted", facultyId=s["faculty_id"], reason=f"Covered by {self.faculty_name(s['faculty_id'])}")
                elif (ev["id"], ds) in self.cancel:
                    c = self.cancel[(ev["id"], ds)]
                    occ.update(status="needs_cover", coverOpen=True, reason=c["reason"] or "Cancelled by the teacher")
                elif self.on_leave(original, ds):
                    occ.update(status="needs_cover", coverOpen=True, reason="Teacher on leave")
                out.append(occ)
            for x in self.extras:
                if x["day"] != ds:
                    continue
                off = self.offerings.get(x["offering_id"], {"code": x["offering_id"], "subject": "", "groupIds": []})
                out.append({
                    "id": f"extra-{x['id']}", "kind": x["kind"], "extraId": x["id"], "eventId": None, "offeringId": x["offering_id"],
                    "code": off["code"], "subject": x["title"] or off["subject"], "date": ds, "day": di, "period": x["period"],
                    "length": 1, "roomId": x["room_id"], "groupIds": off["groupIds"], "facultyId": x["faculty_id"],
                    "originalFacultyId": x["faculty_id"], "status": "scheduled", "reason": x["title"], "coverOpen": False,
                })
        if faculty_id:
            out = [o for o in out if faculty_id in (o["facultyId"], o["originalFacultyId"])]
        if group_id:
            out = [o for o in out if group_id in o["groupIds"]]
        if room_id:
            out = [o for o in out if o["roomId"] == room_id]
        return out

    def faculty_name(self, fid: str) -> str:
        return self.faculty.get(fid, {}).get("name", fid) if self.pub else fid

    def find(self, event_id: str, ds: str) -> dict | None:
        d = parse_day(ds)
        for o in self.occurrences(d, d):
            if o["eventId"] == event_id:
                return o
        return None

    # ---- collisions ----
    def busy(self, ds: str, p0: int, length: int, ignore_id: str | None = None) -> dict:
        """Teachers, groups and rooms that are occupied at any period of [p0, p0+length) on date ds."""
        d = parse_day(ds)
        p1 = p0 + length - 1
        teachers, groups, rooms = {}, {}, {}
        for o in self.occurrences(d, d):
            if o["id"] == ignore_id or o["status"] not in ACTIVE:
                continue
            q0, q1 = o["period"], o["period"] + o["length"] - 1
            if q1 < p0 or q0 > p1:
                continue
            label = f"{o['code']} ({'P' + str(o['period'] + 1)})"
            teachers[o["facultyId"]] = label
            for g in o["groupIds"]:
                groups[g] = label
            rooms[o["roomId"]] = label
        return {"teachers": teachers, "groups": groups, "rooms": rooms}

    def teacher_conflict(self, faculty_id: str, ds: str, p0: int, length: int, ignore_id: str | None = None) -> str | None:
        """Why this teacher cannot teach at (ds, p0..): clash, leave or a weekly unavailable slot; None if free."""
        b = self.busy(ds, p0, length, ignore_id)
        if faculty_id in b["teachers"]:
            return f"{self.faculty_name(faculty_id)} already teaches {b['teachers'][faculty_id]} then."
        if self.on_leave(faculty_id, ds):
            return f"{self.faculty_name(faculty_id)} is on leave that day."
        di = self.day_index(parse_day(ds))
        blocked = set(self.constraints.get(faculty_id, {}).get("unavailable", [])) | set(self.faculty.get(faculty_id, {}).get("unavailable", []))
        for p in range(p0, p0 + length):
            if di is not None and di * self.P + p in blocked:
                return f"{self.faculty_name(faculty_id)} is marked unavailable at that time."
        return None
