import { useCallback, useEffect, useState } from 'react';
import { api, del, patch, post, put, type User } from '../auth';
import { iso, pretty, usePublished, type Published } from '../campus';
import Availability from '../components/Availability';
import LeavePanel from '../components/LeavePanel';
import SyllabusPanel from '../components/SyllabusPanel';

type Tab = 'accounts' | 'semester' | 'holidays' | 'assessments' | 'syllabus' | 'leave' | 'availability';
const TABS: [Tab, string][] = [
  ['accounts', 'Accounts'],
  ['semester', 'Semester'],
  ['holidays', 'Holidays'],
  ['assessments', 'Online assessments'],
  ['syllabus', 'Syllabus'],
  ['leave', 'Teacher leave'],
  ['availability', 'Availability'],
];

export default function Manage() {
  const [tab, setTab] = useState<Tab>('accounts');
  const { pub, reload } = usePublished();
  const ready = pub && pub !== 'none' ? pub : null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Manage</h1>
          <p>Accounts, the semester calendar and the rules every timetable change is checked against.</p>
        </div>
      </div>
      <div className="seg" style={{ marginBottom: 16 }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {pub === 'none' && tab !== 'accounts' && tab !== 'semester' && tab !== 'holidays' ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Publish a timetable first (Designer → Publish), so teachers, classes and courses are known.
          </p>
        </div>
      ) : (
        <section className="card">
          {tab === 'accounts' && <Accounts pub={ready} />}
          {tab === 'semester' && <Semester pub={ready} onRefresh={reload} />}
          {tab === 'holidays' && <Holidays />}
          {tab === 'assessments' && ready && <Assessments pub={ready} />}
          {tab === 'syllabus' && ready && <SyllabusPanel pub={ready} />}
          {tab === 'leave' && ready && <LeavePanel instance={ready.instance} />}
          {tab === 'availability' && ready && <AvailabilityTab pub={ready} />}
        </section>
      )}
    </>
  );
}

function useAsync() {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const view = (
    <>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="ok-box">{msg}</div>}
    </>
  );
  return { run, view };
}

function Accounts({ pub }: { pub: Published | null }) {
  const [users, setUsers] = useState<User[]>([]);
  const [created, setCreated] = useState<(User & { password: string })[]>([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'teacher', displayName: '', facultyId: '', groupId: '' });
  const { run, view } = useAsync();
  const load = useCallback(() => {
    api<User[]>('/users').then(setUsers).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const faculty = pub?.instance.faculty ?? [];
  const groups = pub?.instance.groups ?? [];
  const link = (u: User) =>
    u.role === 'teacher' ? faculty.find((f) => f.id === u.facultyId)?.name ?? u.facultyId : u.role === 'student' ? groups.find((g) => g.id === u.groupId)?.name ?? u.groupId : '—';

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Accounts ({users.length})</h2>
        <button
          className="btn sm"
          disabled={!pub}
          onClick={() =>
            run(async () => {
              const r = await post<{ created: (User & { password: string })[] }>('/users/bulk');
              setCreated(r.created);
              load();
            }, 'Accounts created. Copy the passwords below now: they are shown only once.')
          }
        >
          ＋ Accounts for every teacher and class
        </button>
      </div>
      {view}
      {created.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Password</th>
                <th>Role</th>
                <th>For</th>
              </tr>
            </thead>
            <tbody>
              {created.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.username}</b>
                  </td>
                  <td>
                    <code>{u.password}</code>
                  </td>
                  <td>{u.role}</td>
                  <td>{link(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Role</th>
              <th>Linked to</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.username}</b> {u.defaultPassword && <span className="chip accent">initial password</span>}
                </td>
                <td>{u.displayName}</td>
                <td>{u.role}</td>
                <td>{link(u)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      const pw = prompt(`New password for ${u.username} (at least 4 characters)`);
                      if (pw) run(() => patch(`/users/${u.id}`, { password: pw }), `Password of ${u.username} reset.`);
                    }}
                  >
                    Reset password
                  </button>{' '}
                  {u.username !== 'admin' && (
                    <button className="btn sm ghost" onClick={() => confirm(`Delete ${u.username}?`) && run(() => del(`/users/${u.id}`)).then(load)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Add an account</h3>
      <div className="form-grid">
        <label className="field">
          Username
          <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label className="field">
          Initial password
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <label className="field">
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Teacher</option>
            <option value="student">Student</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <label className="field">
          Display name
          <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </label>
        {form.role === 'teacher' && (
          <label className="field">
            Teacher
            <select value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })}>
              <option value="">Choose…</option>
              {faculty.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {form.role === 'student' && (
          <label className="field">
            Class
            <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
              <option value="">Choose…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        className="btn accent"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          run(() => post('/users', { ...form, facultyId: form.facultyId || null, groupId: form.groupId || null }), `Account ${form.username} created.`).then((ok) => {
            if (ok) {
              setForm({ ...form, username: '', password: '', displayName: '' });
              load();
            }
          })
        }
      >
        Create account
      </button>
    </div>
  );
}

function Semester({ pub, onRefresh }: { pub: Published | null; onRefresh: () => void }) {
  const [sem, setSem] = useState({ start: '', end: '' });
  const { run, view } = useAsync();
  useEffect(() => {
    api<{ start: string; end: string }>('/semester').then(setSem).catch(() => {});
  }, []);
  return (
    <div className="stack">
      <h2>Semester</h2>
      <p className="muted" style={{ margin: 0 }}>
        The weekly timetable repeats every week between these dates. Holidays, leave, assessments and quizzes apply to specific dates inside it.
      </p>
      <div className="row">
        <label className="field">
          First day
          <input type="date" value={sem.start} onChange={(e) => setSem({ ...sem, start: e.target.value })} />
        </label>
        <label className="field">
          Last day
          <input type="date" value={sem.end} onChange={(e) => setSem({ ...sem, end: e.target.value })} />
        </label>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => run(() => put('/semester', sem), 'Semester saved.')}>
          Save
        </button>
      </div>
      {view}
      <h3>Published timetable</h3>
      {pub ? (
        <p style={{ margin: 0 }}>
          Timetable <b>{pub.solution.id ?? ''}</b> published {new Date(pub.publishedAt).toLocaleString()} by {pub.publishedBy}. To change it, run the optimiser, pick a timetable and press <b>Publish</b> in the Designer.
        </p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Nothing published yet. Run the optimiser, pick a timetable and press <b>Publish</b> in the Designer.
        </p>
      )}
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
}

function Holidays() {
  const [rows, setRows] = useState<{ date: string; name: string }[]>([]);
  const [form, setForm] = useState({ date: iso(new Date()), name: '' });
  const { run, view } = useAsync();
  const load = useCallback(() => {
    api<{ date: string; name: string }[]>('/holidays').then(setRows).catch(() => {});
  }, []);
  useEffect(load, [load]);
  return (
    <div className="stack">
      <h2>Holidays</h2>
      <p className="muted" style={{ margin: 0 }}>
        No classes are held on a holiday; everyone is notified.
      </p>
      <ul className="plain-list">
        {rows.map((h) => (
          <li key={h.date}>
            <span>
              <b>{pretty(h.date)}</b> {h.name}
            </span>
            <button className="btn sm ghost" onClick={() => run(() => del(`/holidays/${h.date}`)).then(load)}>
              Remove
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No holidays yet.</li>}
      </ul>
      <div className="row">
        <input className="input" style={{ width: 'auto' }} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Name, e.g. Diwali" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button className="btn sm" onClick={() => run(() => post('/holidays', form), 'Holiday added.').then(load)}>
          Add holiday
        </button>
      </div>
      {view}
    </div>
  );
}

function Assessments({ pub }: { pub: Published }) {
  const { periods, lunchPeriod } = pub.instance.grid;
  const [rows, setRows] = useState<{ id: number; title: string; day: string; start_period: number; end_period: number; group_ids: string[] }[]>([]);
  const [form, setForm] = useState({ title: '', date: iso(new Date()), startPeriod: 0, endPeriod: 1, groupIds: [] as string[] });
  const { run, view } = useAsync();
  const load = useCallback(() => {
    api<typeof rows>('/assessments').then(setRows).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const group = (id: string) => pub.instance.groups.find((g) => g.id === id)?.name ?? id;
  return (
    <div className="stack">
      <h2>Online assessments</h2>
      <p className="muted" style={{ margin: 0 }}>
        Lectures of the chosen classes that overlap the assessment are cancelled for that day; students and teachers are notified.
      </p>
      <ul className="plain-list">
        {rows.map((a) => (
          <li key={a.id}>
            <span>
              <b>{a.title}</b> · {pretty(a.day)}, {periods[a.start_period].split('-')[0]}–{periods[a.end_period].split('-')[1]} · {a.group_ids.map(group).join(', ')}
            </span>
            <button className="btn sm ghost" onClick={() => run(() => del(`/assessments/${a.id}`)).then(load)}>
              Remove
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No online assessments yet.</li>}
      </ul>
      <div className="form-grid">
        <label className="field">
          Title
          <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="OA 1 – Data Structures" />
        </label>
        <label className="field">
          Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="field">
          From
          <select value={form.startPeriod} onChange={(e) => setForm({ ...form, startPeriod: Number(e.target.value) })}>
            {periods.map((p, i) => (i === lunchPeriod ? null : <option key={i} value={i}>{p}</option>))}
          </select>
        </label>
        <label className="field">
          To
          <select value={form.endPeriod} onChange={(e) => setForm({ ...form, endPeriod: Number(e.target.value) })}>
            {periods.map((p, i) => (i === lunchPeriod ? null : <option key={i} value={i}>{p}</option>))}
          </select>
        </label>
      </div>
      <div className="row">
        {pub.instance.groups.map((g) => (
          <label key={g.id} className="check">
            <input
              type="checkbox"
              checked={form.groupIds.includes(g.id)}
              onChange={(e) => setForm({ ...form, groupIds: e.target.checked ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id) })}
            />
            {g.name}
          </label>
        ))}
      </div>
      <button
        className="btn accent"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => run(async () => {
          const r = await post<{ cancelledLectures: number }>('/assessments', form);
          load();
          return r;
        }, 'Assessment added; overlapping lectures are cancelled.')}
      >
        Add assessment
      </button>
      {view}
    </div>
  );
}

function AvailabilityTab({ pub }: { pub: Published }) {
  const [fid, setFid] = useState(pub.instance.faculty[0]?.id ?? '');
  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Teacher availability</h2>
        <select className="input" style={{ width: 'auto' }} value={fid} onChange={(e) => setFid(e.target.value)}>
          {pub.instance.faculty.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <Availability facultyId={fid} instance={pub.instance} />
    </div>
  );
}
