import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'admin' | 'teacher' | 'student';

export interface User {
  id: number;
  username: string;
  role: Role;
  displayName: string;
  facultyId: string | null;
  groupId: string | null;
  defaultPassword: boolean;
}

interface AuthState {
  token: string | null;
  user: User | null;
  unread: number;
  showInbox: boolean;
  setSession: (token: string, user: User, unread: number) => void;
  setUnread: (n: number) => void;
  setShowInbox: (v: boolean) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      unread: 0,
      showInbox: false,
      setSession: (token, user, unread) => set({ token, user, unread, showInbox: unread > 0 }),
      setUnread: (n) => set({ unread: n }),
      setShowInbox: (v) => set({ showInbox: v }),
      logout: () => {
        const token = useAuth.getState().token;
        if (token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
        set({ token: null, user: null, unread: 0, showInbox: false });
      },
    }),
    { name: 'clockwork-auth', partialize: (s) => ({ token: s.token, user: s.user }) },
  ),
);

/** fetch() against the Python server with the login token; throws Error(message) on failure. */
export async function api<T = unknown>(path: string, init: RequestInit & { body?: BodyInit | null } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new Error('Cannot reach the server. Is it running? (python -m uvicorn api.server:app --port 8000)');
  }
  if (res.status === 401 && token) useAuth.getState().logout();
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      msg = typeof b.detail === 'string' ? b.detail : Array.isArray(b.detail) ? b.detail.map((d: { msg: string }) => d.msg).join('; ') : msg;
    } catch {
      /* keep status text */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });
