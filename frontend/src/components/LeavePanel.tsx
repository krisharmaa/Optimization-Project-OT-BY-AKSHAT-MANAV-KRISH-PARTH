import { useCallback, useEffect, useState } from 'react';
import { api, del, post } from '../auth';
import { iso, pretty } from '../campus';
import type { Instance } from '../types';

interface Leave {
  id: number;
  faculty_id: string;
  start_date: string;
  end_date: string;
  reason: string;
}

/** Leave list + form. `own`: a teacher's own leave; otherwise (admin) any teacher. */
export default function LeavePanel({ instance, own = false }: { instance: Instance; own?: boolean }) {
  const [rows, setRows] = useState<Leave[]>([]);
  const today = iso(new Date());
  const [form, setForm] = useState({ facultyId: instance.faculty[0]?.id ?? '', start: today, end: today, reason: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => instance.faculty.find((f) => f.id === id)?.name ?? id;

  const load = useCallback(() => {
    api<Leave[]>('/leaves').then(setRows).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    setError(null);
    try {
      const r = await post<{ lecturesNeedingCover: number }>('/leaves', { ...form, facultyId: own ? null : form.facultyId });
      setMsg(r.lecturesNeedingCover ? `${r.lecturesNeedingCover} lecture(s) now need cover; other teachers were notified.` : 'Leave saved.');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No leave recorded.
        </p>
      ) : (
        <ul className="plain-list">
          {rows.map((l) => (
            <li key={l.id}>
              <span>
                {!own && <b>{name(l.faculty_id)} · </b>}
                {pretty(l.start_date)} – {pretty(l.end_date)} {l.reason && <span className="muted">({l.reason})</span>}
              </span>
              <button className="btn sm ghost" onClick={() => del(`/leaves/${l.id}`).then(load)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        {!own && (
          <select className="input" style={{ width: 'auto' }} value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })}>
            {instance.faculty.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <input className="input" style={{ width: 'auto' }} type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <span className="muted">to</span>
        <input className="input" style={{ width: 'auto' }} type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <button className="btn sm" onClick={add}>
          Add leave
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="ok-box">{msg}</div>}
    </div>
  );
}
