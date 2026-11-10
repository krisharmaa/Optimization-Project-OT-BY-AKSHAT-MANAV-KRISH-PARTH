import { useEffect, useState } from 'react';
import { api, put } from '../auth';
import type { Instance } from '../types';

/** Weekly availability of one teacher: blocked slots (day x period), max classes per day, a note.
 *  Saved to the server; the optimiser uses it the next time it runs, and substitutions respect it. */
export default function Availability({ facultyId, instance }: { facultyId: string; instance: Instance }) {
  const { days, periods, lunchPeriod } = instance.grid;
  const P = periods.length;
  const [blocked, setBlocked] = useState<Set<number>>(new Set());
  const [maxDaily, setMaxDaily] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMsg(null);
    api<Record<string, { unavailable: number[]; maxDaily: number | null; note: string }>>('/constraints')
      .then((all) => {
        const c = all[facultyId];
        setBlocked(new Set(c?.unavailable ?? []));
        setMaxDaily(c?.maxDaily ?? '');
        setNote(c?.note ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }, [facultyId]);

  // Functional update: rapid clicks must not overwrite each other with a stale set.
  const toggle = (k: number) =>
    setBlocked((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  const save = async () => {
    setError(null);
    try {
      await put(`/constraints/${facultyId}`, { unavailable: [...blocked], maxDaily: maxDaily === '' ? null : maxDaily, note });
      setMsg('Saved. The next optimiser run will respect it.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="avail">
      <p className="muted" style={{ marginTop: 0 }}>
        Click the periods you cannot teach. Blocked periods are also respected when someone looks for a substitute.
      </p>
      <div className="avail-grid" style={{ gridTemplateColumns: `90px repeat(${days.length}, minmax(44px, 1fr))` }}>
        <div />
        {days.map((d) => (
          <b key={d} className="avail-head">
            {d}
          </b>
        ))}
        {periods.map((label, p) => (
          <div key={label} style={{ display: 'contents' }}>
            <span className="avail-time">{label}</span>
            {days.map((_, d) => {
              const k = d * P + p;
              if (p === lunchPeriod) return <span key={d} className="avail-cell lunch" />;
              return (
                <button key={d} className={`avail-cell ${blocked.has(k) ? 'off' : ''}`} onClick={() => toggle(k)} aria-label={`${days[d]} ${label}`}>
                  {blocked.has(k) ? '✕' : ''}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <label className="field" style={{ width: 170 }}>
          Max classes per day
          <select value={maxDaily} onChange={(e) => setMaxDaily(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">No limit</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Note for the administrator
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lab duty on Wednesday mornings" />
        </label>
      </div>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="ok-box">{msg}</div>}
      <button className="btn accent" style={{ marginTop: 10 }} onClick={save}>
        Save availability
      </button>
    </div>
  );
}
