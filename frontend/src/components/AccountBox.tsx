import { useState } from 'react';
import { post, useAuth } from '../auth';

/** Who is logged in, change password, log out. Warns while an initial password (e.g. admin/admin) is in use. */
export default function AccountBox() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: '', new: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const save = async () => {
    setError(null);
    try {
      await post('/me/password', form);
      setMsg('Password changed.');
      setForm({ current: '', new: '' });
      useAuth.setState({ user: { ...user, defaultPassword: false } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="account">
      <button className="account-btn" onClick={() => setOpen(!open)}>
        <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
        <span>
          <b>{user.displayName}</b>
          <small>{user.role}</small>
        </span>
      </button>
      {user.defaultPassword && !open && (
        <button className="pw-warn" onClick={() => setOpen(true)}>
          You are using the initial password. Change it →
        </button>
      )}
      {open && (
        <div className="account-panel card">
          <label className="field">
            Current password
            <input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
          </label>
          <label className="field">
            New password
            <input type="password" value={form.new} onChange={(e) => setForm({ ...form, new: e.target.value })} />
          </label>
          {error && <div className="error-box">{error}</div>}
          {msg && <div className="ok-box">{msg}</div>}
          <div className="row">
            <button className="btn sm" disabled={!form.current || form.new.length < 4} onClick={save}>
              Change password
            </button>
            <button className="btn sm ghost" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
