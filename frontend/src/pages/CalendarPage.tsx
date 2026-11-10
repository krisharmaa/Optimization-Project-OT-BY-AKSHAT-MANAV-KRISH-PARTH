import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, post, del, useAuth } from '../auth';
import { addDays, iso, mondayOf, pretty, STATUS_LABEL, usePublished, type CalendarResponse, type Occurrence } from '../campus';

type FilterKind = 'mine' | 'group' | 'faculty' | 'room';

export default function CalendarPage() {
  const user = useAuth((s) => s.user)!;
  const { pub } = usePublished();
  const inst = pub && pub !== 'none' ? pub.instance : null;
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [filter, setFilter] = useState<{ kind: FilterKind; id: string }>(() =>
    user.role === 'teacher' ? { kind: 'mine', id: user.facultyId ?? '' } : user.role === 'student' ? { kind: 'group', id: user.groupId ?? '' } : { kind: 'group', id: '' },
  );
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Occurrence | null>(null);
  const [slot, setSlot] = useState<{ date: string; period: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // admins start on the first group once the timetable is known
  useEffect(() => {
    if (inst && filter.kind === 'group' && !filter.id) setFilter({ kind: 'group', id: inst.groups[0]?.id ?? '' });
  }, [inst, filter]);

  const days = data?.days.length ?? 5;
  const end = addDays(monday, days - 1);

  const latest = useRef(0);
  const load = useCallback(() => {
    if (!filter.id) return; // wait until a class / teacher / room is chosen
    const q = new URLSearchParams({ start: iso(monday), end: iso(addDays(monday, 6)) });
    q.set(filter.kind === 'mine' ? 'faculty' : filter.kind, filter.id);
    const ticket = ++latest.current; // ignore answers to requests that have been superseded
    api<CalendarResponse>(`/calendar?${q}`)
      .then((d) => {
        if (ticket !== latest.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => ticket === latest.current && setError(e.message));
  }, [monday, filter]);
  useEffect(load, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const done = (m: string) => {
    flash(m);
    setSel(null);
    setSlot(null);
    load();
  };

  const names = useMemo(() => {
    const f = new Map(inst?.faculty.map((x) => [x.id, x.name]) ?? []);
    const r = new Map(inst?.rooms.map((x) => [x.id, x.name]) ?? []);
    const g = new Map(inst?.groups.map((x) => [x.id, x.name]) ?? []);
    return { f: (id: string) => f.get(id) ?? id, r: (id: string) => r.get(id) ?? id, g: (id: string) => g.get(id) ?? id };
  }, [inst]);

  if (pub === 'none') return <Empty text="No timetable has been published yet. The administrator publishes one from the Designer." />;
  if (error && !data) return <Empty text={error} />;
  if (!data || !inst) return <Empty text="Loading…" />;

  const dates = Array.from({ length: days }, (_, i) => iso(addDays(monday, i)));
  const P = data.periods.length;
  const cells = new Map<string, Occurrence[]>();
  for (const o of data.occurrences) {
    const k = `${o.date}|${o.period}`;
    cells.set(k, [...(cells.get(k) ?? []), o]);
  }
  const staff = user.role !== 'student';
  const inSemester = (d: string) => d >= data.semester.start && d <= data.semester.end;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>
            {user.role === 'student'
              ? 'Your week, including cancellations, cover teachers, quizzes and holidays.'
              : user.role === 'teacher'
                ? 'Click one of your lectures to cancel it, another teacher’s lecture to ask to take it, or an empty slot to add a quiz.'
                : 'Click a lecture to cancel it or assign a substitute, or an empty slot to add a quiz or extra class.'}
          </p>
        </div>
      </div>

      <div className="card cal-toolbar">
        <div className="row">
          <button className="btn sm ghost" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
            ◀
          </button>
          <button className="btn sm ghost" onClick={() => setMonday(mondayOf(new Date()))}>
            This week
          </button>
          <button className="btn sm ghost" onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">
            ▶
          </button>
          <b style={{ marginLeft: 6 }}>
            {pretty(iso(monday))} – {pretty(iso(end))}
          </b>
        </div>
        <div className="row">
          <div className="seg">
            {user.role === 'teacher' && (
              <button className={filter.kind === 'mine' ? 'on' : ''} onClick={() => setFilter({ kind: 'mine', id: user.facultyId ?? '' })}>
                Mine
              </button>
            )}
            {(['group', 'faculty', 'room'] as const).map((k) => (
              <button
                key={k}
                className={filter.kind === k ? 'on' : ''}
                onClick={() =>
                  setFilter({ kind: k, id: k === 'group' ? (user.groupId ?? inst.groups[0].id) : k === 'faculty' ? inst.faculty[0].id : inst.rooms[0].id })
                }
              >
                {k === 'group' ? 'Class' : k === 'faculty' ? 'Teacher' : 'Room'}
              </button>
            ))}
          </div>
          {filter.kind !== 'mine' && (
            <select className="input" style={{ width: 'auto' }} value={filter.id} onChange={(e) => setFilter({ ...filter, id: e.target.value })}>
              {(filter.kind === 'group' ? inst.groups : filter.kind === 'faculty' ? inst.faculty : inst.rooms).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="legend-row">
        {(['scheduled', 'substituted', 'needs_cover', 'cancelled'] as const).map((s) => (
          <span key={s} className={`occ-dot st-${s}`}>
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="occ-dot st-quiz">Quiz / extra</span>
      </div>

      <div className="cal-wrap">
        <div className="cal-grid" style={{ gridTemplateColumns: `78px repeat(${days}, minmax(120px, 1fr))` }}>
          <div />
          {dates.map((d, i) => (
            <div key={d} className={`cal-head ${data.holidays[d] ? 'holiday' : ''} ${!inSemester(d) ? 'outside' : ''}`}>
              <b>{data.days[i]}</b>
              <span>{pretty(d).split(' ').slice(1).join(' ')}</span>
              {data.holidays[d] && <em>🎉 {data.holidays[d]}</em>}
              {data.assessments
                .filter((a) => a.day === d)
                .map((a) => (
                  <em key={a.id} className="oa">
                    📝 {a.title}
                  </em>
                ))}
            </div>
          ))}
          {Array.from({ length: P }, (_, p) => (
            <Row key={p}>
              <div className={`cal-time ${p === data.lunchPeriod ? 'lunch' : ''}`}>{data.periods[p]}</div>
              {dates.map((d) => {
                if (p === data.lunchPeriod) return <div key={d} className="cal-cell lunch">Lunch</div>;
                const list = cells.get(`${d}|${p}`) ?? [];
                const clickable = staff && list.length === 0 && inSemester(d) && !data.holidays[d];
                return (
                  <div
                    key={d}
                    className={`cal-cell ${clickable ? 'free' : ''}`}
                    onClick={clickable ? () => (setSel(null), setSlot({ date: d, period: p })) : undefined}
                    title={clickable ? 'Add a quiz or extra class here' : undefined}
                  >
                    {list.map((o) => (
                      <button key={o.id} className={`occ st-${o.kind === 'lecture' ? o.status : 'quiz'} ${o.length > 1 ? 'long' : ''}`} onClick={() => (setSlot(null), setSel(o))}>
                        <b>{o.code}</b>
                        <span>{o.kind !== 'lecture' ? o.subject : names.f(o.facultyId)}</span>
                        <span>
                          {names.r(o.roomId)}
                          {o.length > 1 ? ` · ${o.length} periods` : ''}
                        </span>
                        {o.status !== 'scheduled' && <i>{o.kind === 'lecture' ? STATUS_LABEL[o.status] : ''}</i>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </Row>
          ))}
        </div>
      </div>

      {sel && <LectureDrawer occ={sel} names={names} onClose={() => setSel(null)} onDone={done} periods={data.periods} />}
      {slot && <AddClassDrawer slot={slot} filter={filter} onClose={() => setSlot(null)} onDone={done} periods={data.periods} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h2>Calendar</h2>
      <p className="muted">{text}</p>
    </div>
  );
}

type Names = { f: (id: string) => string; r: (id: string) => string; g: (id: string) => string };

function LectureDrawer({ occ, names, onClose, onDone, periods }: { occ: Occurrence; names: Names; onClose: () => void; onDone: (m: string) => void; periods: string[] }) {
  const user = useAuth((s) => s.user)!;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freeTeachers, setFreeTeachers] = useState<{ id: string; name: string }[] | null>(null);
  const [sub, setSub] = useState('');
  const isOwner = !!user.facultyId && occ.originalFacultyId === user.facultyId;
  const admin = user.role === 'admin';
  const lecture = occ.kind === 'lecture';
  const ref = { eventId: occ.eventId, date: occ.date };

  useEffect(() => {
    if (admin && lecture && occ.status !== 'cancelled')
      api<{ teachers: { id: string; name: string }[] }>(`/free?date=${occ.date}&period=${occ.period}&length=${occ.length}`)
        .then((r) => setFreeTeachers(r.teachers.filter((t) => t.id !== occ.facultyId)))
        .catch(() => setFreeTeachers([]));
  }, [admin, lecture, occ]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canCancel = lecture && occ.status === 'scheduled' && (admin || (user.role === 'teacher' && isOwner));
  const canRestore = lecture && occ.status === 'needs_cover' && occ.reason !== 'Teacher on leave' && (admin || isOwner);
  const canRequest = lecture && user.role === 'teacher' && !isOwner && occ.facultyId !== user.facultyId && (occ.status === 'scheduled' || occ.status === 'needs_cover');
  const canDeleteExtra = !lecture && (admin || occ.facultyId === user.facultyId);

  return (
    <aside className="drawer card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>
          {occ.code} <span className="muted" style={{ fontSize: 15 }}>{occ.kind !== 'lecture' ? occ.kind : ''}</span>
        </h2>
        <button className="btn sm ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="facts">
        <dt>Course</dt>
        <dd>{occ.subject}</dd>
        <dt>When</dt>
        <dd>
          {pretty(occ.date)}, {periods[occ.period]}
          {occ.length > 1 ? ` (+${occ.length - 1} period)` : ''}
        </dd>
        <dt>Room</dt>
        <dd>{names.r(occ.roomId)}</dd>
        <dt>Class</dt>
        <dd>{occ.groupIds.map(names.g).join(', ')}</dd>
        <dt>Teacher</dt>
        <dd>
          {names.f(occ.facultyId)}
          {occ.facultyId !== occ.originalFacultyId && <span className="muted"> (instead of {names.f(occ.originalFacultyId)})</span>}
        </dd>
        <dt>Status</dt>
        <dd>
          <span className={`chip st-${lecture ? occ.status : 'quiz'}`}>{lecture ? STATUS_LABEL[occ.status] : 'Scheduled'}</span> {occ.reason && <span className="muted">{occ.reason}</span>}
        </dd>
      </dl>

      {(canCancel || canRequest) && (
        <label className="field">
          {canCancel ? 'Reason (optional)' : 'Message to the teacher (optional)'}
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={canCancel ? 'e.g. conference' : 'e.g. I can cover this'} />
        </label>
      )}
      {error && <div className="error-box">{error}</div>}
      <div className="row">
        {canCancel && (
          <button className="btn" disabled={busy} onClick={() => act(() => post('/lectures/cancel', { ...ref, reason: text }), 'Lecture cancelled; other teachers were told it needs cover.')}>
            Cancel this lecture
          </button>
        )}
        {canRestore && (
          <button className="btn" disabled={busy} onClick={() => act(() => post('/lectures/restore', ref), 'Lecture restored.')}>
            Undo cancellation
          </button>
        )}
        {canRequest && (
          <button className="btn accent" disabled={busy} onClick={() => act(() => post('/requests', { ...ref, message: text }), `Request sent to ${names.f(occ.originalFacultyId)}.`)}>
            Request to take this slot
          </button>
        )}
        {admin && occ.status === 'substituted' && (
          <button className="btn ghost" disabled={busy} onClick={() => act(() => post('/lectures/unassign', ref), 'Substitute removed.')}>
            Remove substitute
          </button>
        )}
        {canDeleteExtra && (
          <button className="btn ghost" disabled={busy} onClick={() => act(() => del(`/extra-classes/${occ.extraId}`), 'Class removed.')}>
            Remove this {occ.kind}
          </button>
        )}
      </div>
      {admin && lecture && occ.status !== 'cancelled' && (
        <div className="sub-box">
          <div className="section-title">Assign a substitute</div>
          {freeTeachers === null ? (
            <span className="tiny">Finding free teachers…</span>
          ) : freeTeachers.length === 0 ? (
            <span className="tiny">No other teacher is free then.</span>
          ) : (
            <div className="row">
              <select className="input" style={{ width: 'auto' }} value={sub} onChange={(e) => setSub(e.target.value)}>
                <option value="">Choose a free teacher…</option>
                {freeTeachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button className="btn sm" disabled={!sub || busy} onClick={() => act(() => post('/lectures/assign', { ...ref, facultyId: sub }), `${names.f(sub)} will teach it.`)}>
                Assign
              </button>
            </div>
          )}
        </div>
      )}
      {user.role === 'student' && <p className="tiny">Students can view the calendar; changes are made by teachers and the administrator.</p>}
    </aside>
  );
}

function AddClassDrawer({ slot, filter, onClose, onDone, periods }: { slot: { date: string; period: number }; filter: { kind: FilterKind; id: string }; onClose: () => void; onDone: (m: string) => void; periods: string[] }) {
  const user = useAuth((s) => s.user)!;
  const { pub } = usePublished();
  const inst = pub && pub !== 'none' ? pub : null;
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number }[] | null>(null);
  const [offering, setOffering] = useState('');
  const [room, setRoom] = useState('');
  const [kind, setKind] = useState<'quiz' | 'extra'>('quiz');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ rooms: { id: string; name: string; capacity: number }[] }>(`/free?date=${slot.date}&period=${slot.period}`)
      .then((r) => setRooms(r.rooms))
      .catch((e: Error) => setError(e.message));
  }, [slot]);

  const offerings = useMemo(() => {
    if (!inst) return [];
    const mine = inst.instance.offerings.filter((o) => user.role === 'admin' || inst.solution.facultyOf[o.id] === user.facultyId);
    return filter.kind === 'group' && filter.id ? mine.filter((o) => o.groupIds.includes(filter.id)) : mine;
  }, [inst, user, filter]);
  const size = (oid: string) => {
    const o = inst?.instance.offerings.find((x) => x.id === oid);
    return Math.max(0, ...(o?.groupIds.map((g) => inst?.instance.groups.find((x) => x.id === g)?.strength ?? 0) ?? [0]));
  };

  const submit = async () => {
    setError(null);
    try {
      await post('/extra-classes', { offeringId: offering, date: slot.date, period: slot.period, roomId: room, kind, title });
      onDone(`${kind === 'quiz' ? 'Quiz' : 'Extra class'} added; the students were notified.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside className="drawer card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Add a class</h2>
        <button className="btn sm ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {pretty(slot.date)}, {periods[slot.period]}. Clashes with the students, the teacher or the room are refused.
      </p>
      <div className="seg">
        <button className={kind === 'quiz' ? 'on' : ''} onClick={() => setKind('quiz')}>
          Quiz
        </button>
        <button className={kind === 'extra' ? 'on' : ''} onClick={() => setKind('extra')}>
          Extra class
        </button>
      </div>
      <label className="field">
        Course
        <select value={offering} onChange={(e) => setOffering(e.target.value)}>
          <option value="">Choose…</option>
          {offerings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.subject} ({o.groupIds.join(', ')})
            </option>
          ))}
        </select>
      </label>
      {offerings.length === 0 && <span className="tiny">You do not teach a course for this class.</span>}
      <label className="field">
        Room
        <select value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="">{rooms ? 'Choose a free room…' : 'Loading…'}</option>
          {rooms?.map((r) => (
            <option key={r.id} value={r.id} disabled={!!offering && r.capacity < size(offering)}>
              {r.name} ({r.capacity} seats){offering && r.capacity < size(offering) ? ' – too small' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Title (optional)
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'quiz' ? 'Quiz 2 – Units 3–4' : 'Revision class'} />
      </label>
      {error && <div className="error-box">{error}</div>}
      <button className="btn accent" disabled={!offering || !room} onClick={submit}>
        Add {kind === 'quiz' ? 'quiz' : 'class'}
      </button>
    </aside>
  );
}
