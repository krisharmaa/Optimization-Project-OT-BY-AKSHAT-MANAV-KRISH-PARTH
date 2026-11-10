import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, post, useAuth } from '../auth';

interface Note {
  id: number;
  message: string;
  kind: string;
  link: string;
  createdAt: string;
  read: boolean;
}

/** Bell with unread count. Opens by itself after login when there are unread notifications. */
export default function Inbox() {
  const { unread, setUnread, showInbox, setShowInbox, token } = useAuth();
  const [items, setItems] = useState<Note[]>([]);
  const nav = useNavigate();

  const load = useCallback(() => {
    api<{ unread: number; items: Note[] }>('/notifications')
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => {});
  }, [setUnread]);

  useEffect(() => {
    if (!token) return;
    load();
    const t = setInterval(load, 30_000); // keep the badge fresh
    return () => clearInterval(t);
  }, [token, load]);

  useEffect(() => {
    if (showInbox) load();
  }, [showInbox, load]);

  const close = () => {
    setShowInbox(false);
    if (unread) post('/notifications/read').then(load);
  };

  return (
    <>
      <button className="bell" onClick={() => (showInbox ? close() : setShowInbox(true))} aria-label={`Notifications (${unread} unread)`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span>Notifications</span>
        {unread > 0 && <b className="badge">{unread}</b>}
      </button>
      {showInbox && (
        <div className="inbox card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{unread ? `${unread} new` : 'Notifications'}</h3>
            <button className="btn sm ghost" onClick={close}>
              {unread ? 'Mark read' : 'Close'}
            </button>
          </div>
          {items.length === 0 && <p className="muted">Nothing yet.</p>}
          <ul>
            {items.map((n) => (
              <li
                key={n.id}
                className={n.read ? '' : 'new'}
                onClick={() => {
                  if (n.link) nav(n.link);
                  close();
                }}
              >
                <span>{n.message}</span>
                <time>{new Date(n.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
