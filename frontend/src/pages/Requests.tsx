import { useCallback, useEffect, useState } from 'react';
import { api, post, useAuth } from '../auth';
import { pretty, usePublished, type Occurrence } from '../campus';
import type { User } from '../auth';

interface Req {
  id: number;
  eventId: string;
  date: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  message: string;
  reply: string;
  createdAt: string;
  toFacultyId: string;
  toName: string;
  from: User | null;
  lecture: Occurrence | null;
}

export default function Requests() {
  const user = useAuth((s) => s.user)!;
  const { pub } = usePublished();
  const periods = pub && pub !== 'none' ? pub.instance.grid.periods : [];
  const [data, setData] = useState<{ incoming: Req[]; outgoing: Req[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    api<{ incoming: Req[]; outgoing: Req[] }>('/requests').then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (path: string, body: unknown = {}) => {
    setError(null);
    try {
      await post(path, body);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const describe = (r: Req) =>
    r.lecture ? `${r.lecture.code} · ${pretty(r.date)}, ${periods[r.lecture.period] ?? ''}` : `${r.eventId} · ${pretty(r.date)}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Requests</h1>
          <p>
            {user.role === 'admin'
              ? 'Every request to take over a lecture. You can decide on any of them.'
              : 'Teachers asking to take your lectures, and your own requests. Open lectures can be requested from the calendar.'}
          </p>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="grid split">
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>{user.role === 'admin' ? 'All requests' : 'Asking for your lectures'}</h2>
            {data.incoming.length === 0 && <p className="muted">Nothing here yet.</p>}
            <div className="req-list">
              {data.incoming.map((r) => (
                <div key={r.id} className={`req ${r.status}`}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b>{describe(r)}</b>
                    <span className={`chip req-${r.status}`}>{r.status}</span>
                  </div>
                  <span className="muted">
                    {r.from?.displayName ?? 'Someone'} asks to take {user.role === 'admin' ? `${r.toName}'s` : 'your'} lecture
                    {r.message ? `: “${r.message}”` : '.'}
                  </span>
                  {r.reply && <span className="tiny">Reply: {r.reply}</span>}
                  {r.status === 'pending' && (user.role === 'admin' || r.toFacultyId === user.facultyId) && (
                    <div className="row">
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 140 }}
                        placeholder="Reply (optional)"
                        value={replies[r.id] ?? ''}
                        onChange={(e) => setReplies({ ...replies, [r.id]: e.target.value })}
                      />
                      <button className="btn sm accent" onClick={() => act(`/requests/${r.id}/accept`, { reply: replies[r.id] ?? '' })}>
                        Accept
                      </button>
                      <button className="btn sm ghost" onClick={() => act(`/requests/${r.id}/reject`, { reply: replies[r.id] ?? '' })}>
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          {user.role !== 'admin' && (
            <section className="card">
              <h2 style={{ marginBottom: 12 }}>Your requests</h2>
              {data.outgoing.length === 0 && <p className="muted">You have not asked for any lectures.</p>}
              <div className="req-list">
                {data.outgoing.map((r) => (
                  <div key={r.id} className={`req ${r.status}`}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b>{describe(r)}</b>
                      <span className={`chip req-${r.status}`}>{r.status}</span>
                    </div>
                    <span className="muted">Asked {r.toName}{r.message ? `: “${r.message}”` : ''}</span>
                    {r.reply && <span className="tiny">Reply: {r.reply}</span>}
                    {r.status === 'pending' && (
                      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => act(`/requests/${r.id}/withdraw`)}>
                        Withdraw
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
