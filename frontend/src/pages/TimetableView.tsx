import { useRef, useState } from 'react';
import { useAuth } from '../auth';
import { usePublished } from '../campus';
import { useStore } from '../store';
import TimetablePoster, { blocksForView, viewName } from '../components/TimetablePoster';
import PosterFrame from '../components/PosterFrame';
import { aspects } from '../themes/designs';
import { exportCsv, exportPng } from '../lib/export';
import type { Solution, ViewKind } from '../types';

/** Read-only view of the published timetable, with PNG and CSV download. Every role can open it;
 *  it is the only timetable page students see. */
export default function TimetableView() {
  const user = useAuth((s) => s.user)!;
  const localTheme = useStore((s) => s.theme);
  const { pub, error } = usePublished();
  const [view, setView] = useState<{ kind: ViewKind; entityId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (error) return <p className="error-box">{error}</p>;
  if (pub === null) return <p className="muted">Loading…</p>;
  if (pub === 'none')
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h2>Timetable</h2>
        <p className="muted">No timetable has been published yet.</p>
      </div>
    );

  const inst = pub.instance;
  const v =
    view ??
    (user.role === 'student' && user.groupId
      ? { kind: 'group' as ViewKind, entityId: user.groupId }
      : user.role === 'teacher' && user.facultyId
        ? { kind: 'faculty' as ViewKind, entityId: user.facultyId }
        : { kind: 'group' as ViewKind, entityId: inst.groups[0].id });
  const theme = pub.design?.theme ?? localTheme;
  const size = aspects.find((a) => a.id === theme.aspect) ?? aspects[0];
  const solution = { ...pub.solution, objectives: pub.solution.objectives ?? { f1: 0, f2: 0, f3: 0 }, onFront: true } as Solution;
  const file = `timetable-${viewName(inst, v).replace(/[^\w]+/g, '-')}`;
  const entities = v.kind === 'group' ? inst.groups : v.kind === 'faculty' ? inst.faculty : inst.rooms;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Timetable</h1>
          <p>
            The weekly timetable published {new Date(pub.publishedAt).toLocaleDateString()}. Day-by-day changes (cancellations, cover, quizzes, holidays) are in the Calendar.
          </p>
        </div>
      </div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg">
          {(['group', 'faculty', 'room'] as ViewKind[]).map((k) => (
            <button
              key={k}
              className={v.kind === k ? 'on' : ''}
              onClick={() => setView({ kind: k, entityId: (k === 'group' ? inst.groups : k === 'faculty' ? inst.faculty : inst.rooms)[0].id })}
            >
              {k === 'group' ? 'Class' : k === 'faculty' ? 'Teacher' : 'Room'}
            </button>
          ))}
        </div>
        <select className="input" style={{ width: 'auto' }} value={v.entityId} onChange={(e) => setView({ ...v, entityId: e.target.value })}>
          {entities.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button
          className="btn accent"
          disabled={busy}
          onClick={async () => {
            if (!ref.current) return;
            setBusy(true);
            try {
              await exportPng(ref.current, file + '.png');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <span className="spinner" /> : '⤓'} Download picture
        </button>
        <button className="btn" onClick={() => exportCsv(blocksForView(inst, solution, v), inst.grid.days, file + '.csv')}>
          ⤓ Export CSV
        </button>
      </div>
      <div className="frame">
        <PosterFrame w={size.w} h={size.h} maxH={Math.max(520, window.innerHeight - 200)}>
          <TimetablePoster
            ref={ref}
            instance={inst}
            solution={solution}
            view={v}
            theme={theme}
            decorations={pub.design?.decorations ?? []}
            blockNotes={pub.design?.blockNotes ?? {}}
          />
        </PosterFrame>
      </div>
    </>
  );
}
