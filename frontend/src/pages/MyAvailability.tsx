import { useAuth } from '../auth';
import { usePublished } from '../campus';
import Availability from '../components/Availability';
import LeavePanel from '../components/LeavePanel';
import SyllabusPanel from '../components/SyllabusPanel';

export default function MyAvailability() {
  const user = useAuth((s) => s.user)!;
  const { pub } = usePublished();
  if (pub === null) return <p className="muted">Loading…</p>;
  if (pub === 'none') return <p className="muted">No timetable has been published yet.</p>;
  if (!user.facultyId) return <p className="muted">Your account is not linked to a teacher yet; ask the administrator.</p>;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My teaching</h1>
          <p>Your weekly availability, leave and course progress.</p>
        </div>
      </div>
      <div className="grid split">
        <section className="card">
          <h2>Weekly availability</h2>
          <Availability facultyId={user.facultyId} instance={pub.instance} />
        </section>
        <div className="grid" style={{ alignContent: 'start' }}>
          <section className="card">
            <h2>Leave</h2>
            <LeavePanel instance={pub.instance} own />
          </section>
          <section className="card">
            <h2>Syllabus</h2>
            <SyllabusPanel pub={pub} />
          </section>
        </div>
      </div>
    </>
  );
}
