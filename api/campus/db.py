"""SQLite storage for accounts, the published timetable, the semester calendar, requests and notifications.

One file on disk (data/clockwork.db by default, override with the CLOCKWORK_DB environment variable).
Every request opens its own short-lived connection, so the module is safe to use from FastAPI's
thread pool.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PBKDF2_ROUNDS = 200_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    display_name  TEXT NOT NULL,
    faculty_id    TEXT,            -- teacher: which faculty member of the timetable this account is
    group_id      TEXT,            -- student: which student group
    default_password INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS published (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instance_json TEXT NOT NULL,
    solution_json TEXT NOT NULL,
    design_json   TEXT,
    published_at  TEXT NOT NULL,
    published_by  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holidays (day TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT, faculty_id TEXT NOT NULL, start_date TEXT NOT NULL,
    end_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, day TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (event_id, day)
);
CREATE TABLE IF NOT EXISTS substitutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, day TEXT NOT NULL, faculty_id TEXT NOT NULL,
    original_faculty_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (event_id, day)
);
CREATE TABLE IF NOT EXISTS extra_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, offering_id TEXT NOT NULL, day TEXT NOT NULL, period INTEGER NOT NULL,
    room_id TEXT NOT NULL, faculty_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'quiz', title TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, day TEXT NOT NULL, start_period INTEGER NOT NULL,
    end_period INTEGER NOT NULL, group_ids TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS syllabus (
    offering_id TEXT PRIMARY KEY, completed_on TEXT NOT NULL, marked_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teacher_constraints (
    faculty_id TEXT PRIMARY KEY, unavailable TEXT NOT NULL DEFAULT '[]', max_daily INTEGER, note TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'take_slot', event_id TEXT NOT NULL,
    day TEXT NOT NULL, from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_faculty TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message TEXT NOT NULL DEFAULT '',
    reply TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT
);
CREATE TABLE IF NOT EXISTS optimizer_runs (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
    summary_json TEXT NOT NULL, result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info', link TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
"""


def db_path() -> Path:
    return Path(os.environ.get("CLOCKWORK_DB", ROOT / "data" / "clockwork.db"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


# ---------------------------------------------------------------------------
# passwords and tokens
# ---------------------------------------------------------------------------
def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    return hmac.compare_digest(hash_password(password, salt)[0], password_hash)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------
def init_db() -> None:
    """Create tables; on an empty database create the superuser admin/admin and a default semester."""
    with connect() as con:
        con.executescript(SCHEMA)
        if con.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            h, s = hash_password("admin")
            con.execute(
                "INSERT INTO users (username, password_hash, salt, role, display_name, default_password, created_at) "
                "VALUES ('admin', ?, ?, 'admin', 'Administrator', 1, ?)",
                (h, s, now()),
            )
        if not con.execute("SELECT 1 FROM settings WHERE key = 'semester_start'").fetchone():
            monday = date.today() - timedelta(days=date.today().weekday())
            con.execute("INSERT INTO settings VALUES ('semester_start', ?)", (monday.isoformat(),))
            con.execute("INSERT INTO settings VALUES ('semester_end', ?)", ((monday + timedelta(weeks=16, days=-3)).isoformat(),))


def get_setting(con, key: str, default: str | None = None) -> str | None:
    row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(con, key: str, value: str) -> None:
    con.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def notify(con, user_ids, message: str, kind: str = "info", link: str = "") -> None:
    for uid in set(user_ids):
        con.execute("INSERT INTO notifications (user_id, message, kind, link, created_at) VALUES (?, ?, ?, ?, ?)", (uid, message, kind, link, now()))


def users_for_faculty(con, faculty_id: str) -> list[int]:
    return [r["id"] for r in con.execute("SELECT id FROM users WHERE role = 'teacher' AND faculty_id = ?", (faculty_id,))]


def admin_ids(con) -> list[int]:
    return [r["id"] for r in con.execute("SELECT id FROM users WHERE role = 'admin'")]


def load_published(con):
    row = con.execute("SELECT * FROM published WHERE id = 1").fetchone()
    if not row:
        return None
    return {
        "instance": json.loads(row["instance_json"]),
        "solution": json.loads(row["solution_json"]),
        "design": json.loads(row["design_json"]) if row["design_json"] else None,
        "publishedAt": row["published_at"],
        "publishedBy": row["published_by"],
    }
