import { useState } from 'react';
import { post, useAuth, type User } from '../auth';

export default function Login() {
  const setSession = useAuth((s) => s.setSession);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string; user: User; unread: number }>('/auth/login', { username, password });
      setSession(r.token, r.user, r.unread);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card tape login-card" onSubmit={submit}>
        <div className="logo" style={{ margin: 0, fontSize: 34 }}>
          Clockwork
        </div>
        <p className="muted" style={{ margin: '4px 0 18px' }}>
          Sign in to see your timetable.
        </p>
        <label className="field">
          Username
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button className="btn accent" disabled={busy || !username || !password}>
          {busy ? <span className="spinner" /> : null} Sign in
        </button>
        <p className="tiny" style={{ margin: 0 }}>
          Teachers and students get their accounts from the administrator.
        </p>
      </form>
    </div>
  );
}
