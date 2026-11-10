import { useCallback, useEffect, useState } from 'react';
import { api, del, post, useAuth } from '../auth';
import { iso, pretty, type Published } from '../campus';

/** Mark a course's syllabus complete: no classes of it are held after that date. */
export default function SyllabusPanel({ pub }: { pub: Published }) {
  const user = useAuth((s) => s.user)!;
  const [done, setDone] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const offerings = pub.instance.offerings.filter((o) => user.role === 'admin' || pub.solution.facultyOf[o.id] === user.facultyId);
  const group = (id: string) => pub.instance.groups.find((g) => g.id === id)?.name ?? id;

  const load = useCallback(() => {
    api<{ offering_id: string; completed_on: string }[]>('/syllabus')
      .then((rows) => setDone(Object.fromEntries(rows.map((r) => [r.offering_id, r.completed_on]))))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        When a course's syllabus is complete, its remaining lectures are removed from the calendar and the students are told.
      </p>
      <ul className="plain-list">
        {offerings.map((o) => (
          <li key={o.id}>
            <span>
              <b>{o.code}</b> {o.subject} <span className="muted">· {o.groupIds.map(group).join(', ')}</span>
              {done[o.id] && <span className="chip sage" style={{ marginLeft: 6 }}>complete {pretty(done[o.id])}</span>}
            </span>
            {done[o.id] ? (
              <button className="btn sm ghost" onClick={() => run(() => del(`/syllabus/${o.id}`))}>
                Reopen
              </button>
            ) : (
              <span className="row">
                <input className="input" style={{ width: 'auto' }} type="date" value={dates[o.id] ?? iso(new Date())} onChange={(e) => setDates({ ...dates, [o.id]: e.target.value })} />
                <button className="btn sm" onClick={() => run(() => post('/syllabus', { offeringId: o.id, completedOn: dates[o.id] ?? iso(new Date()) }))}>
                  Mark complete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
