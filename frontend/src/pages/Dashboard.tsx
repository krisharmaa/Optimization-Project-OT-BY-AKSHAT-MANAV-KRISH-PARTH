import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSelectedSolution, useStore } from '../store';
import { pickLabels, representativePicks, type PickKind } from '../mock/solutions';
import type { RunProgress, RunStats, ScenarioInfo, Solution } from '../types';
import { fetchScenarios } from '../api';
import { api } from '../auth';
import TimetablePoster from '../components/TimetablePoster';
import PosterFrame from '../components/PosterFrame';
import { aspects } from '../themes/designs';

export function ObjectiveBars({ s, front }: { s: Solution; front: Solution[] }) {
  const rows = [
    { k: 'f1' as const, label: 'Idle gaps', color: 'var(--accent)', fmt: (v: number) => v.toFixed(1) },
    { k: 'f2' as const, label: 'Room waste', color: 'var(--mustard)', fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
    { k: 'f3' as const, label: 'Imbalance', color: 'var(--sage)', fmt: (v: number) => v.toFixed(3) },
  ];
  return (
    <div className="bars">
      {rows.map((r) => {
        const vals = front.map((x) => x.objectives[r.k]);
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const t = hi === lo ? 0.5 : (s.objectives[r.k] - lo) / (hi - lo);
        return (
          <div key={r.k} className="bar">
            <span>{r.label}</span>
            <div className="track">
              <div className="fill" style={{ width: `${8 + Math.max(0, Math.min(1, t)) * 92}%`, background: r.color }} />
            </div>
            <b>{r.fmt(s.objectives[r.k])}</b>
          </div>
        );
      })}
    </div>
  );
}

const FALLBACK_SCENARIOS: ScenarioInfo[] = [
  { id: 'demo', label: 'Demo: SY Computer, 2 divisions', events: 34, groups: 2, rooms: 5, faculty: 6, budget: 360, seconds: 6 },
  { id: 'small', label: 'Small synthetic', events: 40, groups: 2, rooms: 5, faculty: 6, budget: 720, seconds: 2.5 },
  { id: 'medium', label: 'Medium synthetic', events: 150, groups: 8, rooms: 12, faculty: 20, budget: 360, seconds: 6 },
  { id: 'large', label: 'Large synthetic', events: 400, groups: 20, rooms: 25, faculty: 50, budget: 240, seconds: 16 },
];
const SHORT: Record<string, string> = { demo: 'Demo', small: 'Small', medium: 'Medium', large: 'Large' };

const PHASE: Record<RunProgress['phase'], string> = {
  queued: 'Starting',
  memetic: 'Memetic NSGA-II searching',
  baseline: 'Running the greedy baseline (same evaluations)',
  export: 'Checking and saving timetables',
};

function Convergence({ stats }: { stats: RunStats }) {
  const pts = stats.convergence;
  if (pts.length < 2) return null;
  const W = 260;
  const H = 70;
  const values = pts.map((p) => p.hypervolume);
  if (stats.baselineMethod) values.push(stats.baselineHypervolume);
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values) * 0.98;
  const lastEval = pts[pts.length - 1].evaluations || 1;
  const x = (e: number) => (e / lastEval) * W;
  const y = (v: number) => H - 4 - ((v - min) / Math.max(max - min, 1e-9)) * (H - 14);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.evaluations).toFixed(1)} ${y(p.hypervolume).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Hypervolume against evaluations">
      {stats.baselineMethod && (
        <>
          <line x1="0" x2={W} y1={y(stats.baselineHypervolume)} y2={y(stats.baselineHypervolume)} stroke="#a39b8e" strokeDasharray="4 4" />
          <text x={W} y={y(stats.baselineHypervolume) - 4} fontSize="9" fill="#a39b8e" textAnchor="end">
            greedy (final)
          </text>
        </>
      )}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function RunPanel() {
  const { runParams, setRunParams, runOptimizer, running, progress, runError, source, stats, customName, setCustomInstance, loadLatestRun } = useStore();
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>(FALLBACK_SCENARIOS);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarios().then(setScenarios).catch(() => undefined);
    loadLatestRun();
    api<Record<string, { unavailable: number[]; maxDaily: number | null }>>('/constraints')
      .then((c) => setBlocked(Object.values(c).filter((x) => x.unavailable.length || x.maxDaily).length))
      .catch(() => setBlocked(null));
  }, [loadLatestRun]);

  const pickScenario = (s: ScenarioInfo) => setRunParams({ scenario: s.id, budget: s.budget, searchSeconds: s.seconds });
  // Published / uploaded instances use the study's budget for the preset closest in size (number of classes).
  const sizeDefaults = (events: number) => {
    const presets = scenarios.filter((s) => s.id !== 'demo');
    const s = presets.reduce((a, b) => (Math.abs(b.events - events) < Math.abs(a.events - events) ? b : a), presets[0]);
    return s ? { budget: s.budget, searchSeconds: s.seconds } : {};
  };
  const pickPublished = async () => {
    setRunParams({ scenario: 'published' });
    try {
      const pub = await api<{ instance: { events: unknown[] } }>('/timetable');
      setRunParams({ scenario: 'published', ...sizeDefaults(pub.instance.events.length) });
    } catch {
      setFileError('Nothing is published yet.');
    }
  };
  const onFile = async (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      setCustomInstance(data, f.name);
      const inst = data.instance ?? data;
      const events = Array.isArray(inst.events)
        ? inst.events.length
        : Array.isArray(inst.offerings)
          ? inst.offerings.reduce((n: number, o: { sessions?: number; sessionsPerWeek?: number }) => n + (o.sessions ?? o.sessionsPerWeek ?? 1), 0)
          : 0;
      setRunParams({ scenario: 'custom', ...(events ? sizeDefaults(events) : {}) });
    } catch {
      setFileError('That file is not valid JSON.');
    }
  };

  const evalPct = progress && progress.budget ? progress.evaluations / progress.budget : 0;
  const timePct = progress?.secondsLimit && progress.seconds != null ? progress.seconds / progress.secondsLimit : 0;
  const pct = progress?.phase === 'baseline' || progress?.phase === 'export' ? 100 : Math.round(Math.min(1, Math.max(evalPct, timePct)) * 100);
  const gain = stats && stats.baselineMethod && stats.baselineHypervolume > 0 ? (stats.hypervolume / stats.baselineHypervolume - 1) * 100 : null;
  const synthetic = ['small', 'medium', 'large'].includes(runParams.scenario);

  return (
    <section className="card run-panel" style={{ marginBottom: 22 }}>
      <div className="run-grid">
        <div className="run-controls">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Optimiser</h2>
            <span className={`chip ${source === 'backend' ? 'sage' : 'accent'}`}>{source === 'backend' ? '● Optimiser results' : '○ Offline demo data'}</span>
          </div>
          <p className="tiny" style={{ margin: 0 }}>
            Final method: <b>feasible memetic NSGA-II</b>, the method validated in the report against the repeated greedy/DSatur baseline. Every
            timetable is re-checked with the independent constraint checker before it is shown.
          </p>
          <div>
            <div className="section-title">Instance</div>
            <div className="scenario-row">
              {scenarios.map((s) => (
                <button key={s.id} className={`scenario ${runParams.scenario === s.id ? 'on' : ''}`} onClick={() => pickScenario(s)} disabled={running} title={s.label}>
                  <b>{SHORT[s.id] ?? s.id}</b>
                  <span>
                    {s.events} classes · {s.faculty} staff
                  </span>
                </button>
              ))}
              <button
                className={`scenario ${runParams.scenario === 'published' ? 'on' : ''}`}
                onClick={() => {
                  setFileError(null);
                  pickPublished();
                }}
                disabled={running}
                title="Re-optimise the instance of the currently published timetable"
              >
                <b>Published</b>
                <span>re-optimise current</span>
              </button>
              <label className={`scenario ${runParams.scenario === 'custom' ? 'on' : ''}`} style={{ cursor: running ? 'not-allowed' : 'pointer' }}>
                <b>Upload JSON</b>
                <span>{customName || 'website or CLI format'}</span>
                <input type="file" accept=".json,application/json" hidden disabled={running} onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
            {fileError && <div className="error-box">{fileError}</div>}
          </div>
          <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Evaluation budget: {runParams.budget}
              <input type="range" min={60} max={3000} step={20} value={runParams.budget} disabled={running} onChange={(e) => setRunParams({ budget: +e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Population: {runParams.population}
              <input type="range" min={4} max={80} step={2} value={runParams.population} disabled={running} onChange={(e) => setRunParams({ population: +e.target.value })} />
            </label>
          </div>
          <details className="advanced">
            <summary>Advanced: time cap, seeds and baseline</summary>
            <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <label className="field" style={{ width: 130 }}>
                Time cap (s)
                <input
                  className="input"
                  type="number"
                  min={0.5}
                  step={0.5}
                  placeholder="none"
                  value={runParams.searchSeconds ?? ''}
                  disabled={running}
                  onChange={(e) => setRunParams({ searchSeconds: e.target.value === '' ? null : Math.max(0.5, +e.target.value) })}
                />
              </label>
              <label className="field" style={{ width: 110 }}>
                Instance seed
                <input className="input" type="number" value={runParams.instanceSeed} disabled={running || !synthetic} onChange={(e) => setRunParams({ instanceSeed: +e.target.value || 0 })} />
              </label>
              <label className="field" style={{ width: 110 }}>
                Run seed
                <input className="input" type="number" value={runParams.seed} disabled={running} onChange={(e) => setRunParams({ seed: +e.target.value || 0 })} />
              </label>
            </div>
            <label className="check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={runParams.compareBaseline} disabled={running} onChange={(e) => setRunParams({ compareBaseline: e.target.checked })} />
              Also run the repeated greedy baseline with the same number of evaluations and seed
            </label>
            <p className="tiny" style={{ marginBottom: 0 }}>
              Defaults are the held-out validation study&apos;s budgets and time caps. Leave the time cap empty for a pure equal-evaluation run.
            </p>
          </details>
          <p className="tiny" style={{ margin: 0 }}>
            {blocked ? (
              <>
                Saved availability of <b>{blocked}</b> teacher{blocked === 1 ? '' : 's'} is applied as hard constraints. <Link to="/manage">Edit →</Link>
              </>
            ) : (
              <>Teachers&apos; saved availability (Manage → Availability, or My teaching) is applied automatically.</>
            )}
          </p>
          <div className="row">
            <button className="btn accent" onClick={runOptimizer} disabled={running || (runParams.scenario === 'custom' && !customName)}>
              {running ? <span className="spinner" /> : '▶'} {running ? 'Optimising…' : 'Run optimiser'}
            </button>
            {running && progress && (
              <span className="tiny">
                {PHASE[progress.phase] ?? progress.phase} · {progress.evaluations} / {progress.budget} evaluations
                {progress.seconds != null && ` · ${progress.seconds.toFixed(1)}s`}
                {progress.secondsLimit ? ` of ${progress.secondsLimit}s` : ''}
              </span>
            )}
          </div>
          {running && (
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
          {runError && <div className="error-box">{runError}</div>}
        </div>

        <div className="run-stats">
          {stats ? (
            <>
              <div className="section-title">
                Last run {stats.verified && <span className="chip sage" style={{ marginLeft: 6 }}>✓ independently checked</span>}
              </div>
              <div className="mini-stats">
                <div>
                  <b>{stats.frontSize}</b>
                  <span>timetables on the Pareto front</span>
                </div>
                <div>
                  <b>{stats.runtime.toFixed(1)}s</b>
                  <span>
                    {stats.evaluations.toLocaleString()} evaluations · {stats.generations} generations
                  </span>
                </div>
                <div>
                  <b>{stats.hypervolume.toFixed(4)}</b>
                  <span>hypervolume (memetic)</span>
                </div>
                <div>
                  <b>{gain == null ? '—' : `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%`}</b>
                  <span>{stats.baselineMethod ? `vs greedy ${stats.baselineHypervolume.toFixed(4)} (same evaluations)` : 'baseline not run'}</span>
                </div>
              </div>
              <div className="section-title" style={{ marginTop: 14 }}>
                Hypervolume against evaluations
              </div>
              <Convergence stats={stats} />
              <p className="tiny" style={{ marginBottom: 0 }}>
                One run on one seed; the report&apos;s claim rests on the paired multi-seed study, not on a single run.
                {stats.savedTo && (
                  <>
                    {' '}
                    Saved to <code>{stats.savedTo}</code>.
                  </>
                )}
              </p>
            </>
          ) : (
            <div className="empty-hint" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
              Run the optimiser to see the hypervolume, the greedy comparison and convergence here.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { solutions, select, selectedId, theme, view, decorations, blockNotes, instance: inst } = useStore();
  const selected = useSelectedSolution();
  const nav = useNavigate();
  const front = useMemo(() => solutions.filter((s) => s.onFront), [solutions]);
  const picks = useMemo(() => representativePicks(front), [front]);
  const size = aspects.find((a) => a.id === theme.aspect)!;

  const tiles = [
    { n: inst.groups.length, label: 'Student groups', bg: 'var(--accent-soft)' },
    { n: inst.events.length, label: 'Weekly classes', bg: '#f6e3b8' },
    { n: inst.rooms.length, label: 'Rooms & labs', bg: 'var(--sage-soft)' },
    { n: inst.faculty.length, label: 'Faculty', bg: '#dfe3f3' },
  ];

  return (
    <>
      <div className="page-head">
        <p style={{ marginTop: 0 }}>
          Clash-free timetables trading off idle gaps, room wastage and workload balance. Pick one of the recommended
          timetables, explore the full Pareto front, then style it in the Designer.
        </p>
      </div>

      <RunPanel />

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        {tiles.map((s) => (
          <div key={s.label} className="card stat">
            <div className="dot" style={{ background: s.bg }} />
            <b>{s.n}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="grid split">
        <section>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 22 }}>Recommended timetables</h2>
            <span className="tiny">
              {front.length} non-dominated of {solutions.length} feasible
            </span>
          </div>
          <div className="grid grid-2">
            {(Object.keys(pickLabels) as PickKind[]).map((k) => {
              const s = picks[k];
              const on = s.id === selectedId;
              return (
                <div key={k} className="card pick" style={on ? { boxShadow: '0 0 0 2px var(--ink), var(--shadow)' } : undefined}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3>{pickLabels[k].title}</h3>
                    <span className="chip">{s.id}</span>
                  </div>
                  <span className="tiny" style={{ marginTop: -6 }}>
                    {pickLabels[k].blurb}
                  </span>
                  <ObjectiveBars s={s} front={front} />
                  <div className="row">
                    <button className={`btn sm ${on ? '' : 'ghost'}`} onClick={() => select(s.id)}>
                      {on ? '✓ Selected' : 'Select'}
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        select(s.id);
                        nav('/designer');
                      }}
                    >
                      Design it →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="tiny" style={{ marginTop: 14 }}>
            Bars are relative to the Pareto front: shorter is better. <Link to="/pareto">Open the full front →</Link>
          </p>
        </section>

        <section className="card tape" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Preview</h2>
            <Link to="/designer" className="btn sm">
              Customise
            </Link>
          </div>
          <PosterFrame w={size.w} h={size.h} maxH={560}>
            <TimetablePoster instance={inst} solution={selected} view={view} theme={theme} decorations={decorations} blockNotes={blockNotes} />
          </PosterFrame>
        </section>
      </div>
    </>
  );
}
