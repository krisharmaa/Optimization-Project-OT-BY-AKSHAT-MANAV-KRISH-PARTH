# Accounts, roles and the semester calendar

Start the two servers from the project root (`python -m uvicorn api.server:app --port 8000` and `npm --prefix frontend run dev`),
open http://localhost:5173 and sign in as **admin / admin**. Change that password right away (the sidebar
reminds you). Data lives in `data/clockwork.db` (SQLite; delete it to start over).

## Getting started (admin)
1. **Overview**: run the optimiser (the final memetic NSGA-II). **Designer**: style a timetable and press **★ Publish**. Teachers and
   students only ever see the published timetable.
2. **Manage → Accounts**: "Accounts for every teacher and class" creates one login per teacher and per
   class and shows the passwords once. You can also add accounts one by one (several students per class are fine).
3. **Manage → Semester**: first and last day; the weekly timetable repeats every week in between.

## Roles
| | Admin | Teacher | Student |
|---|---|---|---|
| Run optimiser, design, publish | ✓ | | |
| View timetable, download picture / CSV | ✓ | ✓ | ✓ |
| Calendar (dated, with changes) | ✓ edit all | ✓ | ✓ view only |
| Cancel a lecture | any | own | |
| Ask to take another teacher's lecture | | ✓ | |
| Approve / decline requests | any | for own lectures | |
| Assign a substitute directly | ✓ | | |
| Quiz / extra class | any course | own courses | |
| Mark syllabus complete | any course | own courses | |
| Leave | any teacher | own | |
| Weekly availability (blocked periods, max per day) | any teacher | own | |
| Holidays, online assessments, accounts | ✓ | assessments | |

## Rules the calendar applies, per lecture and date
1. Syllabus marked complete before that date → the lecture is gone (no more classes).
2. Holiday → cancelled.
3. Online assessment for the class overlapping the lecture → cancelled.
4. Another teacher accepted (or the admin assigned a substitute) → **Covered**, taught by them.
5. The teacher cancelled it, or is on leave → **Needs cover**: other teachers are notified and can request it.

**No collisions:** every quiz, extra class, request, acceptance and substitution is checked against the
students, the teacher (lectures, leave and blocked periods) and the room, and refused if anything clashes.

## Notifications
Shown under the bell; the list opens by itself on login when something is new. Sent for: requests,
acceptances and declines, cancelled lectures needing cover, leave, cover assignments (to the class),
quizzes, holidays, online assessments, syllabus completion and newly published timetables.

## Teacher constraints
Availability saved by teachers (or the admin) becomes a hard constraint of the next optimiser run (blocked periods are
added to the instance's unavailability; a saved daily maximum replaces the instance's), and is respected when someone
looks for a substitute. Publishing re-checks the timetable with the optimizer's independent evaluator and refuses
any timetable that breaks a hard constraint.

Tests: `python -m pytest tests/test_web_campus.py tests/test_web_bridge.py`
