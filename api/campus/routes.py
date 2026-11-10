"""Accounts, the published timetable and the semester calendar.

Roles
    admin    everything (the superuser admin/admin is created on an empty database)
    teacher  sees everything; cancels own lectures, takes leave, requests another teacher's slot,
             approves / rejects requests for own slots, adds quiz classes and marks syllabus complete for
             own courses, edits own availability
    student  read-only: the published timetable and calendar (download / CSV are done in the browser)

Every change that puts someone in a room at a time is checked by Calendar.busy / teacher_conflict, so
the calendar never gets a teacher, group or room collision.
"""
from __future__ import annotations

import json
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .calendar import Calendar, parse_day
from .db import (
    admin_ids,
    connect,
    get_setting,
    hash_password,
    hash_token,
    load_published,
    notify,
    now,
    set_setting,
    users_for_faculty,
    verify_password,
)

router = APIRouter(prefix="/api")
SESSION_DAYS = 7


# ---------------------------------------------------------------------------
# auth helpers
# ---------------------------------------------------------------------------
def public_user(r) -> dict:
    return {"id": r["id"], "username": r["username"], "role": r["role"], "displayName": r["display_name"],
            "facultyId": r["faculty_id"], "groupId": r["group_id"], "defaultPassword": bool(r["default_password"])}


def current_user(authorization: str | None = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Please log in.")
    token = authorization.split(" ", 1)[1].strip()
    with connect() as con:
        row = con.execute(
            "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", (hash_token(token),)
        ).fetchone()
        if not row or row["expires_at"] < now():
            raise HTTPException(401, "Your session has expired. Please log in again.")
        return public_user(row)


def require(*roles):
    def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "You do not have permission to do that.")
        return user

    return dep


ADMIN = require("admin")
STAFF = require("admin", "teacher")


def need_published(cal: Calendar):
    if not cal.pub:
        raise HTTPException(409, "No timetable has been published yet.")


def check_date(cal: Calendar, ds: str) -> date:
    try:
        d = parse_day(ds)
    except ValueError:
        raise HTTPException(400, f"'{ds}' is not a date (use YYYY-MM-DD).") from None
    if not cal.in_semester(d):
        raise HTTPException(400, f"{ds} is outside the semester ({cal.sem_start} to {cal.sem_end}).")
    if cal.day_index(d) is None:
        raise HTTPException(400, f"{ds} is not a teaching day.")
    return d


def students_of(con, group_ids) -> list[int]:
    if not group_ids:
        return []
    q = ",".join("?" * len(group_ids))
    return [r["id"] for r in con.execute(f"SELECT id FROM users WHERE role = 'student' AND group_id IN ({q})", list(group_ids))]


def other_teachers(con, exclude_faculty: str | None) -> list[int]:
    return [r["id"] for r in con.execute("SELECT id FROM users WHERE role = 'teacher' AND (faculty_id IS NULL OR faculty_id != ?)", (exclude_faculty or "",))]


def teaches(cal: Calendar, user: dict, offering_id: str) -> bool:
    return user["role"] == "admin" or (user["facultyId"] is not None and cal.faculty_of.get(offering_id) == user["facultyId"])


def when(cal: Calendar, occ: dict) -> str:
    return f"{occ['code']} on {occ['date']} ({cal.days[occ['day']]}, {cal.inst['grid']['periods'][occ['period']]})"


# ---------------------------------------------------------------------------
# login / me
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(body: LoginBody):
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE username = ?", (body.username.strip(),)).fetchone()
        if not row or not verify_password(body.password, row["password_hash"], row["salt"]):
            raise HTTPException(401, "Wrong username or password.")
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
        con.execute("INSERT INTO sessions VALUES (?, ?, ?)", (hash_token(token), row["id"], expires))
        unread = con.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0", (row["id"],)).fetchone()[0]
        return {"token": token, "user": public_user(row), "unread": unread}


@router.post("/auth/logout")
def logout(authorization: str | None = Header(None)):
    if authorization and authorization.lower().startswith("bearer "):
        with connect() as con:
            con.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(authorization.split(" ", 1)[1].strip()),))
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    with connect() as con:
        unread = con.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0", (user["id"],)).fetchone()[0]
    return {"user": user, "unread": unread}


class PasswordBody(BaseModel):
    current: str
    new: str = Field(min_length=4)


@router.post("/me/password")
def change_password(body: PasswordBody, user=Depends(current_user)):
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not verify_password(body.current, row["password_hash"], row["salt"]):
            raise HTTPException(400, "The current password is wrong.")
        h, s = hash_password(body.new)
        con.execute("UPDATE users SET password_hash = ?, salt = ?, default_password = 0 WHERE id = ?", (h, s, user["id"]))
    return {"ok": True}


# ---------------------------------------------------------------------------
# accounts (admin)
# ---------------------------------------------------------------------------
class UserBody(BaseModel):
    username: str = Field(min_length=2)
    password: str = Field(min_length=4)
    role: str
    displayName: str = ""
    facultyId: str | None = None
    groupId: str | None = None


class UserPatch(BaseModel):
    displayName: str | None = None
    facultyId: str | None = None
    groupId: str | None = None
    password: str | None = Field(None, min_length=4)


@router.get("/users")
def list_users(user=Depends(ADMIN)):
    with connect() as con:
        return [public_user(r) for r in con.execute("SELECT * FROM users ORDER BY role, username")]


def _insert_user(con, b: UserBody) -> dict:
    if b.role not in ("admin", "teacher", "student"):
        raise HTTPException(400, "Role must be admin, teacher or student.")
    if b.role == "teacher" and not b.facultyId:
        raise HTTPException(400, "A teacher account needs the teacher it belongs to.")
    if b.role == "student" and not b.groupId:
        raise HTTPException(400, "A student account needs a student group.")
    if con.execute("SELECT 1 FROM users WHERE username = ?", (b.username,)).fetchone():
        raise HTTPException(400, f"The username '{b.username}' is taken.")
    h, s = hash_password(b.password)
    cur = con.execute(
        "INSERT INTO users (username, password_hash, salt, role, display_name, faculty_id, group_id, default_password, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
        (b.username.strip(), h, s, b.role, b.displayName or b.username, b.facultyId if b.role == "teacher" else None,
         b.groupId if b.role == "student" else None, now()),
    )
    return public_user(con.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())


@router.post("/users")
def create_user(b: UserBody, user=Depends(ADMIN)):
    with connect() as con:
        return _insert_user(con, b)


@router.post("/users/bulk")
def bulk_users(user=Depends(ADMIN)):
    """One account per teacher and one per student group of the published timetable that has none yet.
    Generated passwords are returned once so the admin can hand them out."""
    with connect() as con:
        pub = load_published(con)
        if not pub:
            raise HTTPException(409, "Publish a timetable first, so the teachers and groups are known.")
        created = []
        for f in pub["instance"]["faculty"]:
            if not con.execute("SELECT 1 FROM users WHERE role = 'teacher' AND faculty_id = ?", (f["id"],)).fetchone():
                pw = secrets.token_urlsafe(6)
                uname = f["id"].lower()
                if con.execute("SELECT 1 FROM users WHERE username = ?", (uname,)).fetchone():
                    uname = f"teacher-{uname}"
                created.append({**_insert_user(con, UserBody(username=uname, password=pw, role="teacher", displayName=f.get("name", f["id"]), facultyId=f["id"])), "password": pw})
        for g in pub["instance"]["groups"]:
            if not con.execute("SELECT 1 FROM users WHERE role = 'student' AND group_id = ?", (g["id"],)).fetchone():
                pw = secrets.token_urlsafe(6)
                uname = f"{g['id'].lower()}-student"
                created.append({**_insert_user(con, UserBody(username=uname, password=pw, role="student", displayName=g.get("name", g["id"]), groupId=g["id"])), "password": pw})
        return {"created": created}


@router.patch("/users/{uid}")
def update_user(uid: int, b: UserPatch, user=Depends(ADMIN)):
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not row:
            raise HTTPException(404, "No such user.")
        if b.displayName is not None:
            con.execute("UPDATE users SET display_name = ? WHERE id = ?", (b.displayName, uid))
        if b.facultyId is not None and row["role"] == "teacher":
            con.execute("UPDATE users SET faculty_id = ? WHERE id = ?", (b.facultyId, uid))
        if b.groupId is not None and row["role"] == "student":
            con.execute("UPDATE users SET group_id = ? WHERE id = ?", (b.groupId, uid))
        if b.password:
            h, s = hash_password(b.password)
            con.execute("UPDATE users SET password_hash = ?, salt = ?, default_password = 1 WHERE id = ?", (h, s, uid))
            con.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        return public_user(con.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())


@router.delete("/users/{uid}")
def delete_user(uid: int, user=Depends(ADMIN)):
    if uid == user["id"]:
        raise HTTPException(400, "You cannot delete your own account.")
    with connect() as con:
        con.execute("DELETE FROM users WHERE id = ?", (uid,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# published timetable and semester
# ---------------------------------------------------------------------------
class PublishBody(BaseModel):
    instance: dict
    solution: dict
    design: dict | None = None


@router.get("/timetable")
def get_timetable(user=Depends(current_user)):
    with connect() as con:
        pub = load_published(con)
    if not pub:
        raise HTTPException(404, "No timetable has been published yet.")
    return pub


@router.post("/timetable/publish")
def publish(b: PublishBody, user=Depends(ADMIN)):
    events = {e["id"] for e in b.instance.get("events", [])}
    assigned = {a.get("eventId") for a in b.solution.get("assignments", [])}
    if not events or events != assigned:
        raise HTTPException(400, "The timetable must place every class of the instance exactly once.")
    # Independent hard-constraint check with the optimizer's own evaluator (same checker as the report).
    from api.bridge import check_web_timetable
    try:
        ev = check_web_timetable(b.instance, b.solution)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"The timetable could not be checked: {e}") from e
    if not ev.feasible:
        broken = ", ".join(f"{k} x{v}" for k, v in ev.violations.items() if v)
        raise HTTPException(400, f"Not published: the timetable breaks hard constraints ({broken}).")
    with connect() as con:
        con.execute(
            "INSERT INTO published (id, instance_json, solution_json, design_json, published_at, published_by) VALUES (1, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET instance_json = excluded.instance_json, solution_json = excluded.solution_json, "
            "design_json = excluded.design_json, published_at = excluded.published_at, published_by = excluded.published_by",
            (json.dumps(b.instance), json.dumps({"assignments": b.solution["assignments"], "facultyOf": b.solution["facultyOf"],
                                                 "id": b.solution.get("id"),
                                                 "objectives": dict(zip(("f1", "f2", "f3"), map(float, ev.objectives))),
                                                 "verified": True}),
             json.dumps(b.design) if b.design else None, now(), user["username"]),
        )
        others = [r["id"] for r in con.execute("SELECT id FROM users WHERE id != ?", (user["id"],))]
        notify(con, others, "A new timetable has been published.", "timetable", "/calendar")
    return {"ok": True}


class SemesterBody(BaseModel):
    start: str
    end: str


@router.get("/semester")
def get_semester(user=Depends(current_user)):
    with connect() as con:
        return {"start": get_setting(con, "semester_start"), "end": get_setting(con, "semester_end")}


@router.put("/semester")
def set_semester(b: SemesterBody, user=Depends(ADMIN)):
    try:
        s, e = parse_day(b.start), parse_day(b.end)
    except ValueError:
        raise HTTPException(400, "Use YYYY-MM-DD dates.") from None
    if e < s:
        raise HTTPException(400, "The semester must end after it starts.")
    with connect() as con:
        set_setting(con, "semester_start", s.isoformat())
        set_setting(con, "semester_end", e.isoformat())
    return {"start": s.isoformat(), "end": e.isoformat()}


# ---------------------------------------------------------------------------
# calendar
# ---------------------------------------------------------------------------
@router.get("/calendar")
def calendar(start: str, end: str, faculty: str | None = None, group: str | None = None, room: str | None = None, user=Depends(current_user)):
    try:
        s, e = parse_day(start), parse_day(end)
    except ValueError:
        raise HTTPException(400, "Use YYYY-MM-DD dates.") from None
    if (e - s).days > 120:
        raise HTTPException(400, "Ask for at most 120 days at a time.")
    with connect() as con:
        cal = Calendar(con)
        occ = cal.occurrences(s, e, faculty, group, room)
        hol = {d: n for d, n in cal.holidays.items() if start <= d <= end}
        oas = [a for a in cal.assess if start <= a["day"] <= end]
        return {"published": cal.pub is not None, "semester": {"start": cal.sem_start.isoformat(), "end": cal.sem_end.isoformat()},
                "occurrences": occ, "holidays": hol, "assessments": oas,
                "days": cal.days if cal.pub else [], "periods": cal.inst["grid"]["periods"] if cal.pub else [],
                "lunchPeriod": cal.inst["grid"].get("lunchPeriod") if cal.pub else None}


@router.get("/free")
def free_resources(date: str, period: int, length: int = 1, user=Depends(STAFF)):
    """Teachers and rooms that are free at a date/period (helps pick a quiz room or a substitute)."""
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        check_date(cal, date)
        b = cal.busy(date, period, length)
        rooms = [{"id": r["id"], "name": r.get("name", r["id"]), "capacity": r["capacity"]} for r in cal.inst["rooms"] if r["id"] not in b["rooms"]]
        teachers = [{"id": f["id"], "name": f.get("name", f["id"])} for f in cal.inst["faculty"] if not cal.teacher_conflict(f["id"], date, period, length)]
        return {"rooms": rooms, "teachers": teachers, "busyGroups": list(b["groups"])}


# ---------------------------------------------------------------------------
# cancellation and direct assignment
# ---------------------------------------------------------------------------
class LectureRef(BaseModel):
    eventId: str
    date: str
    reason: str = ""


@router.post("/lectures/cancel")
def cancel_lecture(b: LectureRef, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        check_date(cal, b.date)
        occ = cal.find(b.eventId, b.date)
        if not occ:
            raise HTTPException(404, "There is no such lecture on that day.")
        if user["role"] != "admin" and user["facultyId"] != occ["originalFacultyId"]:
            raise HTTPException(403, "You can only cancel your own lectures.")
        if occ["status"] != "scheduled":
            raise HTTPException(400, f"This lecture is already {occ['status'].replace('_', ' ')}.")
        con.execute("INSERT INTO cancellations (event_id, day, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
                    (b.eventId, b.date, b.reason, user["username"], now()))
        who = cal.faculty_name(occ["originalFacultyId"])
        notify(con, other_teachers(con, occ["originalFacultyId"]), f"{who} cancelled {when(cal, occ)}. You can request to take this slot.", "cover", "/calendar")
        notify(con, students_of(con, occ["groupIds"]), f"{when(cal, occ)} is cancelled.", "change", "/timetable")
        return {"ok": True}


@router.post("/lectures/restore")
def restore_lecture(b: LectureRef, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        occ = cal.find(b.eventId, b.date)
        row = con.execute("SELECT * FROM cancellations WHERE event_id = ? AND day = ?", (b.eventId, b.date)).fetchone()
        if not occ or not row:
            raise HTTPException(404, "That lecture is not cancelled.")
        if user["role"] != "admin" and user["facultyId"] != occ["originalFacultyId"]:
            raise HTTPException(403, "You can only restore your own lectures.")
        if (b.eventId, b.date) in cal.subs:
            raise HTTPException(400, "Another teacher has already taken this slot.")
        con.execute("DELETE FROM cancellations WHERE id = ?", (row["id"],))
        con.execute("UPDATE requests SET status = 'withdrawn', decided_at = ? WHERE event_id = ? AND day = ? AND status = 'pending'", (now(), b.eventId, b.date))
        notify(con, students_of(con, occ["groupIds"]), f"{when(cal, occ)} is back on.", "change", "/timetable")
        return {"ok": True}


class AssignBody(BaseModel):
    eventId: str
    date: str
    facultyId: str


@router.post("/lectures/assign")
def assign_substitute(b: AssignBody, user=Depends(ADMIN)):
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        check_date(cal, b.date)
        occ = cal.find(b.eventId, b.date)
        if not occ or occ["status"] in ("cancelled",):
            raise HTTPException(400, "That lecture is not running on that day.")
        if b.facultyId not in cal.faculty:
            raise HTTPException(400, "Unknown teacher.")
        why = cal.teacher_conflict(b.facultyId, b.date, occ["period"], occ["length"], ignore_id=occ["id"])
        if why:
            raise HTTPException(409, why)
        _substitute(con, cal, occ, b.facultyId, user["username"])
        return {"ok": True}


@router.post("/lectures/unassign")
def remove_substitute(b: LectureRef, user=Depends(ADMIN)):
    with connect() as con:
        con.execute("DELETE FROM substitutions WHERE event_id = ? AND day = ?", (b.eventId, b.date))
    return {"ok": True}


def _substitute(con, cal: Calendar, occ: dict, faculty_id: str, by: str):
    con.execute("INSERT INTO substitutions (event_id, day, faculty_id, original_faculty_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(event_id, day) DO UPDATE SET faculty_id = excluded.faculty_id, created_by = excluded.created_by",
                (occ["eventId"], occ["date"], faculty_id, occ["originalFacultyId"], by, now()))
    notify(con, users_for_faculty(con, faculty_id), f"You will teach {when(cal, occ)}.", "cover", "/calendar")
    notify(con, students_of(con, occ["groupIds"]), f"{when(cal, occ)} will be taught by {cal.faculty_name(faculty_id)}.", "change", "/timetable")


# ---------------------------------------------------------------------------
# take-slot requests (the teacher who owns the slot approves)
# ---------------------------------------------------------------------------
class RequestBody(BaseModel):
    eventId: str
    date: str
    message: str = ""


class Decision(BaseModel):
    reply: str = ""


def _request_row(con, r, cal: Calendar | None = None) -> dict:
    cal = cal or Calendar(con)
    occ = cal.find(r["event_id"], r["day"]) if cal.pub else None
    sender = con.execute("SELECT * FROM users WHERE id = ?", (r["from_user"],)).fetchone()
    return {"id": r["id"], "eventId": r["event_id"], "date": r["day"], "status": r["status"], "message": r["message"], "reply": r["reply"],
            "createdAt": r["created_at"], "decidedAt": r["decided_at"], "toFacultyId": r["to_faculty"],
            "toName": cal.faculty_name(r["to_faculty"]) if cal.pub else r["to_faculty"],
            "from": public_user(sender) if sender else None, "lecture": occ}


@router.post("/requests")
def create_request(b: RequestBody, user=Depends(require("teacher"))):
    if not user["facultyId"]:
        raise HTTPException(400, "Your account is not linked to a teacher; ask the admin.")
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        check_date(cal, b.date)
        occ = cal.find(b.eventId, b.date)
        if not occ:
            raise HTTPException(404, "There is no such lecture on that day.")
        if occ["status"] == "cancelled":
            raise HTTPException(400, f"That lecture does not run ({occ['reason']}).")
        if occ["status"] == "substituted":
            raise HTTPException(400, "Another teacher has already taken this slot.")
        if occ["originalFacultyId"] == user["facultyId"]:
            raise HTTPException(400, "This is already your lecture.")
        why = cal.teacher_conflict(user["facultyId"], b.date, occ["period"], occ["length"], ignore_id=occ["id"])
        if why:
            raise HTTPException(409, why)
        if con.execute("SELECT 1 FROM requests WHERE event_id = ? AND day = ? AND from_user = ? AND status = 'pending'", (b.eventId, b.date, user["id"])).fetchone():
            raise HTTPException(400, "You already asked for this slot.")
        cur = con.execute("INSERT INTO requests (event_id, day, from_user, to_faculty, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                          (b.eventId, b.date, user["id"], occ["originalFacultyId"], b.message, now()))
        owners = users_for_faculty(con, occ["originalFacultyId"]) or admin_ids(con)  # no account -> the admin decides
        note = f' "{b.message}"' if b.message else ""
        notify(con, owners, f"{user['displayName']} asks to take your lecture {when(cal, occ)}.{note}", "request", "/requests")
        return _request_row(con, con.execute("SELECT * FROM requests WHERE id = ?", (cur.lastrowid,)).fetchone())


@router.get("/requests")
def list_requests(user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)  # built once for the whole list
        if user["role"] == "admin":
            rows = con.execute("SELECT * FROM requests ORDER BY id DESC LIMIT 200").fetchall()
            return {"incoming": [_request_row(con, r, cal) for r in rows], "outgoing": []}
        inc = con.execute("SELECT * FROM requests WHERE to_faculty = ? ORDER BY id DESC LIMIT 100", (user["facultyId"] or "",)).fetchall()
        out = con.execute("SELECT * FROM requests WHERE from_user = ? ORDER BY id DESC LIMIT 100", (user["id"],)).fetchall()
        return {"incoming": [_request_row(con, r, cal) for r in inc], "outgoing": [_request_row(con, r, cal) for r in out]}


def _decidable(con, rid: int, user: dict):
    r = con.execute("SELECT * FROM requests WHERE id = ?", (rid,)).fetchone()
    if not r:
        raise HTTPException(404, "No such request.")
    if r["status"] != "pending":
        raise HTTPException(400, f"This request is already {r['status']}.")
    if user["role"] != "admin" and user["facultyId"] != r["to_faculty"]:
        raise HTTPException(403, "Only the teacher whose lecture it is can decide.")
    return r


@router.post("/requests/{rid}/accept")
def accept_request(rid: int, b: Decision, user=Depends(STAFF)):
    with connect() as con:
        r = _decidable(con, rid, user)
        cal = Calendar(con)
        occ = cal.find(r["event_id"], r["day"])
        sender = con.execute("SELECT * FROM users WHERE id = ?", (r["from_user"],)).fetchone()
        if not occ or occ["status"] in ("cancelled", "substituted"):
            raise HTTPException(400, "This lecture can no longer be taken over.")
        why = cal.teacher_conflict(sender["faculty_id"], r["day"], occ["period"], occ["length"], ignore_id=occ["id"])
        if why:
            raise HTTPException(409, why)
        _substitute(con, cal, occ, sender["faculty_id"], user["username"])
        con.execute("UPDATE requests SET status = 'accepted', reply = ?, decided_at = ?, decided_by = ? WHERE id = ?", (b.reply, now(), user["username"], rid))
        notify(con, [sender["id"]], f"{user['displayName']} accepted your request: you will teach {when(cal, occ)}.", "request", "/calendar")
        for o in con.execute("SELECT * FROM requests WHERE event_id = ? AND day = ? AND status = 'pending' AND id != ?", (r["event_id"], r["day"], rid)).fetchall():
            con.execute("UPDATE requests SET status = 'rejected', reply = 'Someone else is taking this lecture.', decided_at = ? WHERE id = ?", (now(), o["id"]))
            notify(con, [o["from_user"]], f"Your request for {when(cal, occ)} was declined: someone else is taking it.", "request", "/requests")
        return {"ok": True}


@router.post("/requests/{rid}/reject")
def reject_request(rid: int, b: Decision, user=Depends(STAFF)):
    with connect() as con:
        r = _decidable(con, rid, user)
        cal = Calendar(con)
        occ = cal.find(r["event_id"], r["day"])
        con.execute("UPDATE requests SET status = 'rejected', reply = ?, decided_at = ?, decided_by = ? WHERE id = ?", (b.reply, now(), user["username"], rid))
        what = when(cal, occ) if occ else f"{r['event_id']} on {r['day']}"
        notify(con, [r["from_user"]], f"{user['displayName']} declined your request for {what}." + (f' "{b.reply}"' if b.reply else ""), "request", "/requests")
        return {"ok": True}


@router.post("/requests/{rid}/withdraw")
def withdraw_request(rid: int, user=Depends(STAFF)):
    with connect() as con:
        r = con.execute("SELECT * FROM requests WHERE id = ?", (rid,)).fetchone()
        if not r or (r["from_user"] != user["id"] and user["role"] != "admin"):
            raise HTTPException(404, "No such request of yours.")
        if r["status"] != "pending":
            raise HTTPException(400, f"This request is already {r['status']}.")
        con.execute("UPDATE requests SET status = 'withdrawn', decided_at = ? WHERE id = ?", (now(), rid))
        return {"ok": True}


# ---------------------------------------------------------------------------
# leave
# ---------------------------------------------------------------------------
class LeaveBody(BaseModel):
    start: str
    end: str
    reason: str = ""
    facultyId: str | None = None


@router.get("/leaves")
def list_leaves(user=Depends(STAFF)):
    with connect() as con:
        if user["role"] == "admin":
            rows = con.execute("SELECT * FROM leaves ORDER BY start_date").fetchall()
        else:
            rows = con.execute("SELECT * FROM leaves WHERE faculty_id = ? ORDER BY start_date", (user["facultyId"] or "",)).fetchall()
        return [dict(r) for r in rows]


@router.post("/leaves")
def add_leave(b: LeaveBody, user=Depends(STAFF)):
    fid = b.facultyId if user["role"] == "admin" and b.facultyId else user["facultyId"]
    if not fid:
        raise HTTPException(400, "Choose the teacher who is on leave.")
    try:
        s, e = parse_day(b.start), parse_day(b.end)
    except ValueError:
        raise HTTPException(400, "Use YYYY-MM-DD dates.") from None
    if e < s:
        raise HTTPException(400, "Leave must end on or after its first day.")
    with connect() as con:
        con.execute("INSERT INTO leaves (faculty_id, start_date, end_date, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (fid, s.isoformat(), e.isoformat(), b.reason, user["username"], now()))
        cal = Calendar(con)
        open_lectures = [o for o in cal.occurrences(s, e, faculty_id=fid) if o["status"] == "needs_cover"]
        who = cal.faculty_name(fid)
        if open_lectures:
            notify(con, other_teachers(con, fid), f"{who} is on leave {s} to {e}: {len(open_lectures)} lecture(s) need cover. You can request them in the calendar.", "cover", "/calendar")
            notify(con, admin_ids(con), f"{who} is on leave {s} to {e}; {len(open_lectures)} lecture(s) need cover.", "cover", "/calendar")
        groups = {g for o in open_lectures for g in o["groupIds"]}
        notify(con, students_of(con, groups), f"{who} is on leave {s} to {e}; some lectures may move or be covered.", "change", "/timetable")
        return {"ok": True, "lecturesNeedingCover": len(open_lectures)}


@router.delete("/leaves/{lid}")
def delete_leave(lid: int, user=Depends(STAFF)):
    with connect() as con:
        r = con.execute("SELECT * FROM leaves WHERE id = ?", (lid,)).fetchone()
        if not r or (user["role"] != "admin" and r["faculty_id"] != user["facultyId"]):
            raise HTTPException(404, "No such leave of yours.")
        con.execute("DELETE FROM leaves WHERE id = ?", (lid,))
        return {"ok": True}


# ---------------------------------------------------------------------------
# quiz / extra classes
# ---------------------------------------------------------------------------
class ExtraBody(BaseModel):
    offeringId: str
    date: str
    period: int
    roomId: str
    kind: str = "quiz"
    title: str = ""


@router.post("/extra-classes")
def add_extra(b: ExtraBody, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        check_date(cal, b.date)
        off = cal.offerings.get(b.offeringId)
        if not off:
            raise HTTPException(400, "Unknown course.")
        if not teaches(cal, user, b.offeringId):
            raise HTTPException(403, "You can only add classes for courses you teach.")
        if b.kind not in ("quiz", "extra"):
            raise HTTPException(400, "Kind must be quiz or extra.")
        if not (0 <= b.period < cal.P) or b.period == cal.inst["grid"].get("lunchPeriod"):
            raise HTTPException(400, "Pick a teaching period (not lunch).")
        if b.date in cal.holidays:
            raise HTTPException(400, f"{b.date} is a holiday ({cal.holidays[b.date]}).")
        done = cal.syllabus.get(b.offeringId)
        if done and b.date > done:
            raise HTTPException(400, f"The syllabus of {off['code']} was completed on {done}.")
        room = cal.rooms.get(b.roomId)
        if not room:
            raise HTTPException(400, "Unknown room.")
        size = max((cal.groups[g]["strength"] for g in off["groupIds"] if g in cal.groups), default=0)
        if room["capacity"] < size:
            raise HTTPException(400, f"{room.get('name', b.roomId)} holds {room['capacity']}, the class has {size} students.")
        busy = cal.busy(b.date, b.period, 1)
        clash_group = [g for g in off["groupIds"] if g in busy["groups"]]
        if clash_group:
            raise HTTPException(409, f"The students already have {busy['groups'][clash_group[0]]} then.")
        if b.roomId in busy["rooms"]:
            raise HTTPException(409, f"{room.get('name', b.roomId)} is taken by {busy['rooms'][b.roomId]}.")
        if cal._assessment(off["groupIds"], b.date, b.period, b.period):
            raise HTTPException(409, "The students have an online assessment then.")
        fid = cal.faculty_of.get(b.offeringId)
        why = cal.teacher_conflict(fid, b.date, b.period, 1)
        if why:
            raise HTTPException(409, why)
        title = b.title or ("Quiz" if b.kind == "quiz" else "Extra class")
        con.execute("INSERT INTO extra_classes (offering_id, day, period, room_id, faculty_id, kind, title, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (b.offeringId, b.date, b.period, b.roomId, fid, b.kind, title, user["username"], now()))
        notify(con, students_of(con, off["groupIds"]), f"{title} for {off['code']} on {b.date} ({cal.inst['grid']['periods'][b.period]}) in {room.get('name', b.roomId)}.", "change", "/timetable")
        return {"ok": True}


@router.delete("/extra-classes/{xid}")
def delete_extra(xid: int, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        r = con.execute("SELECT * FROM extra_classes WHERE id = ?", (xid,)).fetchone()
        if not r or (cal.pub and not teaches(cal, user, r["offering_id"])):
            raise HTTPException(404, "No such class of yours.")
        con.execute("DELETE FROM extra_classes WHERE id = ?", (xid,))
        return {"ok": True}


# ---------------------------------------------------------------------------
# online assessments, syllabus completion, holidays
# ---------------------------------------------------------------------------
class AssessmentBody(BaseModel):
    title: str = Field(min_length=1)
    date: str
    startPeriod: int
    endPeriod: int
    groupIds: list[str] = Field(min_length=1)


@router.post("/assessments")
def add_assessment(b: AssessmentBody, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        d = check_date(cal, b.date)
        if b.endPeriod < b.startPeriod:
            raise HTTPException(400, "The assessment must end after it starts.")
        unknown = [g for g in b.groupIds if g not in cal.groups]
        if unknown:
            raise HTTPException(400, f"Unknown groups: {unknown}")
        con.execute("INSERT INTO assessments (title, day, start_period, end_period, group_ids, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (b.title, b.date, b.startPeriod, b.endPeriod, json.dumps(b.groupIds), user["username"], now()))
        cal = Calendar(con)
        hit = [o for o in cal.occurrences(d, d) if o["reason"] == f"Online assessment: {b.title}"]
        notify(con, students_of(con, b.groupIds), f"Online assessment '{b.title}' on {b.date}; {len(hit)} lecture(s) in that time are cancelled.", "change", "/timetable")
        for fid in {o["originalFacultyId"] for o in hit}:
            notify(con, users_for_faculty(con, fid), f"Your lecture(s) on {b.date} are cancelled for the online assessment '{b.title}'.", "change", "/calendar")
        return {"ok": True, "cancelledLectures": len(hit)}


@router.delete("/assessments/{aid}")
def delete_assessment(aid: int, user=Depends(STAFF)):
    with connect() as con:
        con.execute("DELETE FROM assessments WHERE id = ?", (aid,))
    return {"ok": True}


@router.get("/assessments")
def list_assessments(user=Depends(current_user)):
    with connect() as con:
        return [dict(r, group_ids=json.loads(r["group_ids"])) for r in con.execute("SELECT * FROM assessments ORDER BY day")]


class SyllabusBody(BaseModel):
    offeringId: str
    completedOn: str


@router.get("/syllabus")
def list_syllabus(user=Depends(current_user)):
    with connect() as con:
        return [dict(r) for r in con.execute("SELECT * FROM syllabus ORDER BY completed_on")]


@router.post("/syllabus")
def complete_syllabus(b: SyllabusBody, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        need_published(cal)
        try:
            parse_day(b.completedOn)
        except ValueError:
            raise HTTPException(400, "Use a YYYY-MM-DD date.") from None
        off = cal.offerings.get(b.offeringId)
        if not off:
            raise HTTPException(400, "Unknown course.")
        if not teaches(cal, user, b.offeringId):
            raise HTTPException(403, "You can only close courses you teach.")
        con.execute("INSERT INTO syllabus VALUES (?, ?, ?, ?) ON CONFLICT(offering_id) DO UPDATE SET completed_on = excluded.completed_on",
                    (b.offeringId, b.completedOn, user["username"], now()))
        notify(con, students_of(con, off["groupIds"]), f"{off['code']} ({off['subject']}) syllabus is complete: no more classes after {b.completedOn}.", "change", "/timetable")
        return {"ok": True}


@router.delete("/syllabus/{offering_id}")
def reopen_syllabus(offering_id: str, user=Depends(STAFF)):
    with connect() as con:
        cal = Calendar(con)
        if cal.pub and not teaches(cal, user, offering_id):
            raise HTTPException(403, "You can only reopen courses you teach.")
        con.execute("DELETE FROM syllabus WHERE offering_id = ?", (offering_id,))
        return {"ok": True}


class HolidayBody(BaseModel):
    date: str
    name: str = Field(min_length=1)


@router.get("/holidays")
def list_holidays(user=Depends(current_user)):
    with connect() as con:
        return [{"date": r["day"], "name": r["name"]} for r in con.execute("SELECT * FROM holidays ORDER BY day")]


@router.post("/holidays")
def add_holiday(b: HolidayBody, user=Depends(ADMIN)):
    try:
        parse_day(b.date)
    except ValueError:
        raise HTTPException(400, "Use a YYYY-MM-DD date.") from None
    with connect() as con:
        con.execute("INSERT INTO holidays VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET name = excluded.name", (b.date, b.name))
        everyone = [r["id"] for r in con.execute("SELECT id FROM users WHERE id != ?", (user["id"],))]
        notify(con, everyone, f"Holiday on {b.date}: {b.name}. No classes that day.", "change", "/calendar")
    return {"ok": True}


@router.delete("/holidays/{day}")
def delete_holiday(day: str, user=Depends(ADMIN)):
    with connect() as con:
        con.execute("DELETE FROM holidays WHERE day = ?", (day,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# teacher constraints (used by the optimiser and by collision checks)
# ---------------------------------------------------------------------------
class ConstraintBody(BaseModel):
    unavailable: list[int] = []
    maxDaily: int | None = Field(None, ge=1, le=12)
    note: str = ""


@router.get("/constraints")
def list_constraints(user=Depends(STAFF)):
    with connect() as con:
        rows = con.execute("SELECT * FROM teacher_constraints").fetchall()
        out = {r["faculty_id"]: {"unavailable": json.loads(r["unavailable"]), "maxDaily": r["max_daily"], "note": r["note"], "updatedAt": r["updated_at"]} for r in rows}
        if user["role"] != "admin":
            out = {k: v for k, v in out.items() if k == user["facultyId"]}
        return out


@router.put("/constraints/{faculty_id}")
def set_constraints(faculty_id: str, b: ConstraintBody, user=Depends(STAFF)):
    if user["role"] != "admin" and user["facultyId"] != faculty_id:
        raise HTTPException(403, "You can only edit your own availability.")
    with connect() as con:
        con.execute(
            "INSERT INTO teacher_constraints (faculty_id, unavailable, max_daily, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(faculty_id) DO UPDATE SET unavailable = excluded.unavailable, max_daily = excluded.max_daily, note = excluded.note, "
            "updated_by = excluded.updated_by, updated_at = excluded.updated_at",
            (faculty_id, json.dumps(sorted(set(b.unavailable))), b.maxDaily, b.note, user["username"], now()),
        )
        if user["role"] != "admin":
            notify(con, admin_ids(con), f"{user['displayName']} updated their availability; re-run the optimiser to use it.", "info", "/manage")
    return {"ok": True}


def constraint_overrides() -> dict:
    """{faculty_id: {"unavailable": [...], "max_daily": n}} for the optimiser."""
    with connect() as con:
        return {r["faculty_id"]: {"unavailable": json.loads(r["unavailable"]), "max_daily": r["max_daily"]} for r in con.execute("SELECT * FROM teacher_constraints")}


# ---------------------------------------------------------------------------
# notifications
# ---------------------------------------------------------------------------
@router.get("/notifications")
def list_notifications(user=Depends(current_user)):
    with connect() as con:
        rows = con.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100", (user["id"],)).fetchall()
        unread = sum(1 for r in rows if not r["read"])
        return {"unread": unread, "items": [{"id": r["id"], "message": r["message"], "kind": r["kind"], "link": r["link"], "createdAt": r["created_at"], "read": bool(r["read"])} for r in rows]}


@router.post("/notifications/read")
def mark_read(user=Depends(current_user)):
    with connect() as con:
        con.execute("UPDATE notifications SET read = 1 WHERE user_id = ?", (user["id"],))
    return {"ok": True}
