# Final integration check (website + final optimizer)

Date: 2026-11-10 · Machine: Windows 11, Python 3.13.7, Node 22.19 · Branch: `clockwork-integration` (uncommitted
working tree at the time of the check).

**Result: 61 / 61 automated end-to-end checks passed, 0 failed, 0 skipped**, plus the browser checks below. The
repository test suite passes in the fresh environment except the optional CP-SAT tests (see finding 3).

## How it was run

1. **Fresh clone (simulated).** The work was not yet committed, so a real `git clone` would not contain it. Instead,
   exactly the files a clone would contain (`git ls-files -co --exclude-standard`: tracked + new, nothing ignored, so
   no `node_modules`, no database, no saved runs) were copied to an empty folder outside OneDrive.
2. **Installation from the README**, in a new virtual environment: `python -m venv .venv`, upgrade pip,
   `pip install -r requirements-lock.txt`, `pip install -e . --no-deps`, then the website section's
   `pip install -r requirements.txt` and `npm --prefix frontend ci`; then `python -m pytest -q`.
3. **Servers from the fresh copy** on an empty database: backend `uvicorn api.server:app`, frontend `vite`
   (ports 8001 / 5274, because the user's own servers were already on 8000 / 5173).
4. **Automated checklist**: `python experiments/web_integration_check.py --api http://127.0.0.1:8001 --web http://localhost:5274`.
   It talks HTTP only, like the website, and includes its own collision checker written independently of
   `timetable.evaluation`.
5. **Browser checks** of every role through the real login form and pages.

## Checklist results

| Requirement | Result | Evidence |
|---|---|---|
| Fresh clone + installation using README | **Pass, with a README gap (fixed)** | All installs succeed. The README's install section alone did not install the website's packages (finding 1). |
| Backend starts properly | Pass | `/api/health` reports the feasible memetic NSGA-II; no server errors logged. |
| Frontend starts properly | Pass | App served; `/api` proxied to the backend (verified with a token that only the fresh database knows). Production build and type-check pass. |
| Login / accounts work | Pass | Wrong password 401, no token 401; admin login; bulk accounts (20 teachers + 8 classes); student sees own class; students cannot run/cancel/manage users; teachers cannot run/manage users; login form and log-out tested in the browser for admin, teacher and student. |
| Optimizer can be run from the frontend | Pass | Started from the Overview page (Small, then Published re-optimisation); live phases shown: Starting → Memetic NSGA-II searching → greedy baseline → checking and saving. |
| Generated timetable displays correctly | Pass | For the published 150-class timetable, every block of all **40 views** (8 classes, 20 teachers, 12 rooms) is in exactly the day/period cell given by the data; counts match (e.g. G01 19/19). |
| Pareto / results display correctly | Pass | 3 scatter plots with greedy front overlay, memetic-vs-greedy table, four representative picks; hypervolume and convergence on the Overview. Axis no longer shows negative values (fixed). |
| No student / teacher / room collisions | Pass | All **30** returned timetables pass the independent re-check (clashes, lunch, capacity, room kind, availability, daily/weekly limits, distinct days). After all calendar changes, a sweep of **1,925** dated classes (incl. covers and quizzes) found no double booking. A deliberately clashing timetable is refused at publish. |
| Teacher constraints affect optimization | Pass | Blocking the periods a teacher used, plus max 2/day: no Pareto timetable uses them, the daily cap holds, and the same seed now yields different timetables. Repeated through the UI: availability saved under *My teaching* was applied to the next *Published* run (0 of 21 Pareto timetables violate it). |
| Leave → cover / substitute flow | Pass | Leave marks the teacher's 3 lectures *needs cover*; others notified; free teacher requests; owner notified; requester cannot self-approve; accept → *covered* by the substitute, who is notified; admin direct assignment works; a busy teacher cannot be assigned. |
| Quiz / extra class collision checks | Pass | Refused when the class has a class, when the teacher teaches elsewhere, when the room is taken, inside an assessment, on a holiday, after syllabus completion, and for a course the teacher does not teach; accepted in a free slot, shown in the calendar, class notified; the room is then blocked for others. |
| OA cancellation | Pass | 4 lectures inside the window cancelled with the assessment as reason; the lecture outside the window and other classes untouched; class notified; no quiz inside. |
| Holidays | Pass | All 32 lectures that day cancelled; everyone notified; no quiz that day; teachers cannot declare holidays. |
| Syllabus completion | Pass | Only the course's teacher/admin may mark it; 13 lectures before, 0 after the date; no extra class afterwards. |
| Requests / notifications | Pass | Incoming/outgoing lists; decline leaves the lecture unchanged and notifies the requester; a teacher cannot request a slot while teaching; mark-read works; bell shows the right messages per role in the browser. |

### Optimizer runs during the check (single seed, illustration only)

| Run | Settings | Memetic HV | Greedy HV (same evaluations) | Front |
|---|---|---:|---:|---:|
| Medium, seed 0 | 360 evaluations, 6 s cap (study protocol) | 1.0437 | 1.0115 (+3.18 %) | 16 |
| Small, seed 0 | 720 evaluations, 2.5 s cap | 0.9353 | 0.9353 (equal; the certified single ideal point) | 1 |
| Published medium + teacher constraint, **mis-set** | 720 evaluations, **2.5 s** cap carried over from Small | 0.9887 | 1.0061 (**−1.73 %**) | 9 |
| Published medium + teacher constraint | 360 evaluations, 6 s cap (study protocol) | 1.0632 | 1.0083 (+5.45 %) | 21 |

The third row is a genuine result outside the validated protocol: with only 2.5 s for a 150-class instance the
memetic search lost to greedy. It exposed a UI default problem (finding 4), now fixed. Single runs do not change the
report's conclusions, which rest on the paired multi-seed study.

## Findings and fixes

1. **README install gap (fixed).** Section 7 installs `requirements-lock.txt`, which has no FastAPI/uvicorn; a new
   user following it could not start the website. Section 7 now says to also install `requirements.txt` and run
   `npm ci`, and a `web` extra was added (`pip install -e '.[test,exact,web]'`).
2. **Rapid clicks in the availability grid lost a blocked period (fixed).** `Availability.tsx` built the new set from
   a stale render; it now uses a functional state update. Re-tested: three quick clicks give exactly the expected
   periods.
3. **CP-SAT does not load inside a fresh virtual environment on this machine (open, optional component).**
   `from ortools.sat.python import cp_model` raises `ImportError: initialization failed` in the venv (OR-Tools 9.15
   and 9.14, protobuf 6.31/6.33, numpy 2.3.5/2.5.3 all tried), so 10 tests in `tests/test_exact.py` fail there. The
   same OR-Tools 9.15 works in the machine's user-level Python, where the full suite passes (224 passed). This
   affects only the optional exact reference, not the website or the memetic optimizer. The lock file was
   validated on Linux / Python 3.12; on Windows either install without a venv or use Python 3.12.
4. **Published/uploaded runs kept the previous instance's budget (fixed).** Choosing *Published* after *Small* ran a
   150-class instance with Small's 2.5 s cap. *Published* and *Upload JSON* now take the validation study's
   budget/time for the preset closest in size (Published medium → 360 evaluations, 6 s; verified in the browser).
5. **Backend port configurable (added).** `frontend/vite.config.ts` reads `CLOCKWORK_API` (default
   `http://127.0.0.1:8000`), so the website can run when port 8000 is taken.
6. **Check-script note.** Python's `urllib` sends `Connection: close`, and on Windows uvicorn then reset the socket
   while sending the large Medium result; `curl`, browsers and `http.client` read it fine. The check script uses
   `http.client`. Not an application defect.
7. **Cosmetic (not changed).** The poster's default subtitle is Clockwork's "Third Year, First Semester" even for
   synthetic instances, and synthetic instances show generated names ("Faculty F13"). Both can be edited in the
   Designer before publishing.

## Repeat the check

```bash
# terminal 1 (fresh database: delete data/clockwork.db first)
python -m uvicorn api.server:app --port 8000
# terminal 2
npm --prefix frontend run dev
# terminal 3
python experiments/web_integration_check.py --web http://localhost:5173
```

The JSON report is written to `work/web_integration_check.json`.
