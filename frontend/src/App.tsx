import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ParetoExplorer from './pages/ParetoExplorer';
import Designer from './pages/Designer';
import Login from './pages/Login';
import CalendarPage from './pages/CalendarPage';
import Requests from './pages/Requests';
import Manage from './pages/Manage';
import MyAvailability from './pages/MyAvailability';
import TimetableView from './pages/TimetableView';
import Inbox from './components/Inbox';
import AccountBox from './components/AccountBox';
import { useAuth, type Role } from './auth';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS = {
  overview: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  pareto: 'M4 20V4M4 20h16M8 16l3-5 3 2 5-7',
  designer: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  timetable: 'M4 5h16v15H4zM4 10h16M9 5v15',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  requests: 'M7 7h10l-3-3M17 17H7l3 3',
  mine: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  manage: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
};

// which pages each role sees, in sidebar order
const PAGES: { path: string; label: string; icon: keyof typeof ICONS; roles: Role[]; element: JSX.Element }[] = [
  { path: '/', label: 'Overview', icon: 'overview', roles: ['admin'], element: <Dashboard /> },
  { path: '/pareto', label: 'Pareto front', icon: 'pareto', roles: ['admin'], element: <ParetoExplorer /> },
  { path: '/designer', label: 'Designer', icon: 'designer', roles: ['admin'], element: <Designer /> },
  { path: '/timetable', label: 'Timetable', icon: 'timetable', roles: ['admin', 'teacher', 'student'], element: <TimetableView /> },
  { path: '/calendar', label: 'Calendar', icon: 'calendar', roles: ['admin', 'teacher', 'student'], element: <CalendarPage /> },
  { path: '/requests', label: 'Requests', icon: 'requests', roles: ['admin', 'teacher'], element: <Requests /> },
  { path: '/mine', label: 'My teaching', icon: 'mine', roles: ['teacher'], element: <MyAvailability /> },
  { path: '/manage', label: 'Manage', icon: 'manage', roles: ['admin'], element: <Manage /> },
];

export default function App() {
  const user = useAuth((s) => s.user);
  if (!user) return <Login />;
  const pages = PAGES.filter((p) => p.roles.includes(user.role));
  const home = user.role === 'admin' ? '/' : user.role === 'teacher' ? '/calendar' : '/timetable';

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo">Clockwork</div>
        <div className="logo-sub">Multi-objective timetabling</div>
        <nav className="nav">
          {pages.map((p) => (
            <NavLink key={p.path} to={p.path} end={p.path === '/'}>
              <Icon d={ICONS[p.icon]} />
              <span>{p.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-tools">
          <Inbox />
        </div>
        <div className="side-foot">
          <AccountBox />
        </div>
      </aside>
      <main className="main">
        <Routes>
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={p.element} />
          ))}
          <Route path="*" element={<Navigate to={home} />} />
        </Routes>
      </main>
    </div>
  );
}
