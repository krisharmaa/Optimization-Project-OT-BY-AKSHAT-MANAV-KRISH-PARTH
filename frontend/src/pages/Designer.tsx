import { useRef, useState } from 'react';
import { useSelectedSolution, useStore } from '../store';
import TimetablePoster, { blocksForView, viewName } from '../components/TimetablePoster';
import PosterFrame from '../components/PosterFrame';
import { ContentPanel, DecoratePanel, StylePanel } from '../components/DesignPanels';
import { aspects } from '../themes/designs';
import { exportCsv, exportPng } from '../lib/export';
import { post } from '../auth';

type Tab = 'style' | 'content' | 'decorate';

export default function Designer() {
  const { theme, view, decorations, blockNotes, selectedDecoId, selectDeco, updateDeco, solutions, select } = useStore();
  const solution = useSelectedSolution();
  const inst = useStore((s) => s.instance);
  const [tab, setTab] = useState<Tab>('style');
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);
  const size = aspects.find((a) => a.id === theme.aspect)!;
  const fileBase = `timetable-${solution.id}-${viewName(inst, view).replace(/[^\w]+/g, '-')}`;
  const front = solutions.filter((s) => s.onFront);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Designer</h1>
          <p>Pick a colour scheme, font and design, then decorate with stickers, notes and annotations.</p>
        </div>
        <div className="spacer" />
        <label className="field" style={{ minWidth: 180 }}>
          Timetable
          <select className="input" value={solution.id} onChange={(e) => select(e.target.value)}>
            {front.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · gaps {s.objectives.f1.toFixed(1)} · waste {(s.objectives.f2 * 100).toFixed(0)}%
              </option>
            ))}
            {!solution.onFront && <option value={solution.id}>{solution.id} (dominated)</option>}
          </select>
        </label>
      </div>

      <div className="designer">
        <aside className="card panel">
          <div className="tabs">
            {(['style', 'content', 'decorate'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'style' ? '🎨 Style' : t === 'content' ? '📝 Content' : '✨ Decorate'}
              </button>
            ))}
          </div>
          <div className="panel-body">
            {tab === 'style' && <StylePanel />}
            {tab === 'content' && <ContentPanel />}
            {tab === 'decorate' && <DecoratePanel activeBlockId={activeBlock} onCloseBlock={() => setActiveBlock(null)} />}
          </div>
        </aside>

        <section className="stage">
          <div className="toolbar">
            <button
              className="btn accent"
              disabled={busy}
              onClick={async () => {
                if (!posterRef.current) return;
                setBusy(true);
                selectDeco(null);
                setActiveBlock(null);
                try {
                  await new Promise((r) => setTimeout(r, 50));
                  await exportPng(posterRef.current, fileBase + '.png');
                  flash('PNG downloaded');
                } catch (e) {
                  console.error(e);
                  flash('Export failed — see console');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <span className="spinner" /> : '⤓'} Export PNG
            </button>
            <button
              className="btn"
              onClick={() => {
                exportCsv(blocksForView(inst, solution, view), inst.grid.days, fileBase + '.csv');
                flash('CSV downloaded');
              }}
            >
              ⤓ CSV
            </button>
            <button className="btn ghost" onClick={() => window.print()}>
              Print
            </button>
            <button
              className="btn"
              title="Make this the official timetable for teachers and students, with this design"
              onClick={async () => {
                if (!confirm(`Publish timetable ${solution.id} as the official timetable? Everyone will be notified.`)) return;
                try {
                  await post('/timetable/publish', { instance: inst, solution, design: { theme, decorations, blockNotes } });
                  flash('Published. Teachers and students now see this timetable.');
                } catch (e) {
                  flash((e as Error).message);
                }
              }}
            >
              ★ Publish
            </button>
            <div style={{ flex: 1 }} />
            <span className="tiny">
              {viewName(inst, view)} · {size.name}
            </span>
          </div>
          <div className="frame">
            <PosterFrame w={size.w} h={size.h} maxH={Math.max(520, window.innerHeight - 190)}>
              <TimetablePoster
                ref={posterRef}
                instance={inst}
                solution={solution}
                view={view}
                theme={theme}
                decorations={decorations}
                blockNotes={blockNotes}
                interactive
                selectedDecoId={selectedDecoId}
                activeBlockId={activeBlock}
                onSelectDeco={(id) => {
                  selectDeco(id);
                  if (id) {
                    setTab('decorate');
                    setActiveBlock(null);
                  }
                }}
                onMoveDeco={(id, x, y) => updateDeco(id, { x, y })}
                onBlockClick={(id) => {
                  setActiveBlock(id);
                  selectDeco(null);
                  setTab('decorate');
                }}
              />
            </PosterFrame>
          </div>
          <p className="tiny" style={{ margin: 0, textAlign: 'center' }}>
            Click a class to annotate it · drag stickers and notes to move them
          </p>
        </section>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
