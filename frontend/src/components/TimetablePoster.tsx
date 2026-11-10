import { forwardRef, useMemo, useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { Instance, Solution, ViewKind } from '../types';
import type { BlockNote, Deco, ThemeSettings } from '../store';
import { alpha, contrast, inkOn, subjectColor } from '../themes/palettes';
import { fontPairs } from '../themes/fonts';
import { aspects, designs } from '../themes/designs';
import { iconStickers } from '../themes/stickers';

interface Props {
  instance: Instance;
  solution: Solution;
  view: { kind: ViewKind; entityId: string };
  theme: ThemeSettings;
  decorations: Deco[];
  blockNotes: Record<string, BlockNote>;
  interactive?: boolean;
  selectedDecoId?: string | null;
  activeBlockId?: string | null;
  onSelectDeco?: (id: string | null) => void;
  onMoveDeco?: (id: string, x: number, y: number) => void;
  onBlockClick?: (eventId: string) => void;
}

export interface Block {
  eventId: string;
  day: number;
  period: number;
  length: number;
  code: string;
  subject: string;
  teacher: string;
  room: string;
  groups: string;
  colorIndex: number;
  time: string;
}

/** Blocks visible in one per-group / per-faculty / per-room view. */
export function blocksForView(instance: Instance, solution: Solution, view: { kind: ViewKind; entityId: string }): Block[] {
  const evById = new Map(instance.events.map((e) => [e.id, e]));
  const offById = new Map(instance.offerings.map((o) => [o.id, o]));
  const subjectOrder = [...new Set(instance.offerings.map((o) => o.code))];
  const { periods } = instance.grid;
  const out: Block[] = [];
  for (const a of solution.assignments) {
    const ev = evById.get(a.eventId)!;
    const off = offById.get(ev.offeringId)!;
    const fac = solution.facultyOf[off.id];
    const hit =
      view.kind === 'group' ? off.groupIds.includes(view.entityId) : view.kind === 'faculty' ? fac === view.entityId : a.roomId === view.entityId;
    if (!hit) continue;
    const start = periods[a.period].split('-')[0].trim();
    const end = periods[a.period + ev.length - 1].split('-')[1].trim();
    out.push({
      eventId: ev.id,
      day: a.day,
      period: a.period,
      length: ev.length,
      code: off.code,
      subject: off.subject,
      teacher: instance.faculty.find((f) => f.id === fac)?.name ?? fac,
      room: instance.rooms.find((r) => r.id === a.roomId)?.name ?? a.roomId,
      groups: off.groupIds.map((g) => instance.groups.find((x) => x.id === g)?.name ?? g).join(', '),
      colorIndex: subjectOrder.indexOf(off.code),
      time: `${start} - ${end}`,
    });
  }
  return out;
}

export function viewName(instance: Instance, view: { kind: ViewKind; entityId: string }) {
  if (view.kind === 'group') return instance.groups.find((g) => g.id === view.entityId)?.name ?? '';
  if (view.kind === 'faculty') return instance.faculty.find((f) => f.id === view.entityId)?.name ?? '';
  return instance.rooms.find((r) => r.id === view.entityId)?.name ?? '';
}

const TimetablePoster = forwardRef<HTMLDivElement, Props>(function TimetablePoster(props, ref) {
  const { instance, solution, view, theme, decorations, blockNotes, interactive } = props;
  const { palette } = theme;
  const font = fontPairs.find((f) => f.id === theme.fontId) ?? fontPairs[0];
  const design = designs.find((d) => d.id === theme.designId) ?? designs[0];
  const size = aspects.find((a) => a.id === theme.aspect) ?? aspects[0];
  const { days, periods, lunchPeriod } = instance.grid;
  const blocks = useMemo(() => blocksForView(instance, solution, view), [instance, solution, view]);

  const ink = inkOn(palette.bg);
  // Title takes the strongest palette colour that still reads on the background.
  const strongest = [palette.c1, palette.c2, palette.c3].sort((a, b) => contrast(b, palette.bg) - contrast(a, palette.bg))[0];
  const titleColor = contrast(strongest, palette.bg) >= 2.3 ? strongest : ink;
  const fs = Math.min(size.w / 46, size.h / 62);
  const timeCol = theme.showTimeCol;

  const vars = {
    '--bg': palette.bg,
    '--c1': palette.c1,
    '--c2': palette.c2,
    '--c3': palette.c3,
    '--ink': ink,
    '--ink-soft': alpha(ink, 0.55),
    '--ink-faint': alpha(ink, 0.14),
    '--title-color': titleColor,
    '--title-ink': inkOn(titleColor),
    '--c1-ink': inkOn(palette.c1),
    '--c2-ink': inkOn(palette.c2),
    '--c3-ink': inkOn(palette.c3),
    '--font-title': font.title,
    '--font-body': font.body,
    '--title-weight': font.titleWeight,
    '--radius': `${design.radius}px`,
    '--fs': `${fs}px`,
    '--card': alpha('#FFFFFF', ink === '#2B2A28' ? 0.45 : 0.12),
    width: size.w,
    height: size.h,
  } as CSSProperties;

  const occupied = new Set(blocks.flatMap((b) => Array.from({ length: b.length }, (_, i) => `${b.day}-${b.period + i}`)));
  const col = (d: number) => d + (timeCol ? 2 : 1);
  const row = (p: number) => p + 2;
  const legend = [...new Map(blocks.map((b) => [b.code, b])).values()].sort((a, b) => a.colorIndex - b.colorIndex);
  const notes = blocks.filter((b) => blockNotes[b.eventId]).sort((a, b) => a.day - b.day || a.period - b.period);

  const secondLine = (b: Block) => (view.kind === 'faculty' ? b.groups : b.teacher);
  const thirdLine = (b: Block) => (view.kind === 'room' ? b.groups : b.room);

  return (
    <div
      ref={ref}
      className={`poster design-${design.id} bg-${theme.bgStyle} aspect-${size.id} ${font.bodyUpper ? 'upper' : ''} ${interactive ? 'interactive' : ''}`}
      style={vars}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onSelectDeco?.(null);
      }}
    >
      {(design.card || theme.bgStyle === 'gradient') && (
        <div className="poster-glow" aria-hidden>
          <span style={{ background: palette.c1 }} />
          <span style={{ background: palette.c2 }} />
          <span style={{ background: palette.c3 }} />
        </div>
      )}

      <header className="poster-head">
        <h1 className="poster-title">{theme.title}</h1>
        {theme.subtitle && <div className="poster-sub">{theme.subtitle}</div>}
        <div className="poster-view">{viewName(instance, view)}</div>
      </header>

      <div className="tt-card">
        <div
          className="tt-grid"
          style={{
            gridTemplateColumns: `${timeCol ? 'minmax(0, 0.85fr) ' : ''}repeat(${days.length}, minmax(0, 1fr))`,
            gridTemplateRows: `auto repeat(${periods.length}, minmax(0, 1fr))`,
          }}
        >
          {timeCol && <div className="tt-head tt-corner" style={{ gridColumn: 1, gridRow: 1 }}><span>Time</span></div>}
          {days.map((d, i) => (
            <div key={d} className="tt-head" style={{ gridColumn: col(i), gridRow: 1 }}>
              <span>{design.dayHeader === 'letter' ? d.slice(0, d === 'Thu' ? 2 : 1) : d}</span>
            </div>
          ))}

          {timeCol &&
            periods.map((p, i) => (
              <div key={p} className="tt-time" style={{ gridColumn: 1, gridRow: row(i) }}>
                {p}
              </div>
            ))}

          {/* Design-specific backdrops */}
          {design.emptyCells === 'lines' &&
            periods.map((_, i) => <div key={'l' + i} className="tt-rule" style={{ gridColumn: `1 / -1`, gridRow: row(i) }} />)}
          {design.emptyCells === 'lines' &&
            days.map((_, i) =>
              i % 2 === 0 ? <div key={'c' + i} className="tt-colshade" style={{ gridColumn: col(i), gridRow: `1 / -1` }} /> : null,
            )}
          {(design.emptyCells === 'grid' || design.emptyCells === 'breaks') &&
            days.flatMap((_, d) =>
              periods.map((__, p) =>
                p === lunchPeriod || occupied.has(`${d}-${p}`) ? null : (
                  <div key={`e${d}-${p}`} className="tt-empty" style={{ gridColumn: col(d), gridRow: row(p) }}>
                    {design.emptyCells === 'breaks' && <span>free</span>}
                  </div>
                ),
              ),
            )}

          <div className="tt-lunch" style={{ gridColumn: `${timeCol ? 2 : 1} / -1`, gridRow: row(lunchPeriod) }}>
            <span>Lunch Break</span>
          </div>

          {blocks.map((b) => {
            const bg = subjectColor(palette, b.colorIndex);
            const note = blockNotes[b.eventId];
            return (
              <div
                key={b.eventId}
                className={`tt-block ${props.activeBlockId === b.eventId ? 'active' : ''} ${b.length > 1 ? 'tall' : ''}`}
                style={{ gridColumn: col(b.day), gridRow: `${row(b.period)} / span ${b.length}`, background: bg, color: inkOn(bg) }}
                onClick={() => props.onBlockClick?.(b.eventId)}
                title={interactive ? 'Click to annotate this class' : undefined}
              >
                {design.timeInBlock && <div className="b-time">{b.time}</div>}
                <div className="b-code">{theme.useCodes ? b.code : b.subject}</div>
                {theme.showTeacher && <div className="b-sub">{secondLine(b)}</div>}
                {theme.showRoom && <div className="b-room">{thirdLine(b)}</div>}
                {note && (
                  <div className="b-badge" style={{ background: inkOn(bg), color: bg }}>
                    {note.icon || '•'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {(theme.showLegend || notes.length > 0) && (
        <footer className="poster-foot">
          {theme.showLegend && (
            <div className="legend">
              {legend.map((b) => (
                <div key={b.code} className="legend-item">
                  <i style={{ background: subjectColor(palette, b.colorIndex) }} />
                  <span>
                    <b>{b.code}</b> {b.subject}
                  </span>
                </div>
              ))}
            </div>
          )}
          {notes.length > 0 && (
            <ul className="foot-notes">
              {notes.map((b) => (
                <li key={b.eventId}>
                  <b>{blockNotes[b.eventId].icon || '•'}</b> {b.code}, {days[b.day]} {b.time.split(' - ')[0]}: {blockNotes[b.eventId].text}
                </li>
              ))}
            </ul>
          )}
        </footer>
      )}

      <div className="deco-layer">
        {decorations.map((d) => (
          <DecoItem
            key={d.id}
            deco={d}
            theme={theme}
            ink={ink}
            interactive={!!interactive}
            selected={props.selectedDecoId === d.id}
            onSelect={() => props.onSelectDeco?.(d.id)}
            onMove={(x, y) => props.onMoveDeco?.(d.id, x, y)}
          />
        ))}
      </div>
    </div>
  );
});

export default TimetablePoster;

export function resolveColor(c: string, theme: ThemeSettings, ink: string) {
  if (c === 'c1' || c === 'c2' || c === 'c3') return theme.palette[c];
  if (c === 'ink') return ink;
  return c;
}

function DecoItem({
  deco,
  theme,
  ink,
  interactive,
  selected,
  onSelect,
  onMove,
}: {
  deco: Deco;
  theme: ThemeSettings;
  ink: string;
  interactive: boolean;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const drag = useRef<{ px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  const color = resolveColor(deco.color, theme, ink);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect();
    const poster = (e.currentTarget.closest('.poster') as HTMLElement).getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, x: deco.x, y: deco.y, w: poster.width, h: poster.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    if (!s) return;
    const x = Math.max(0, Math.min(100, s.x + ((e.clientX - s.px) / s.w) * 100));
    const y = Math.max(0, Math.min(100, s.y + ((e.clientY - s.py) / s.h) * 100));
    onMove(x, y);
  };
  const up = () => (drag.current = null);

  let body;
  if (deco.kind === 'sticker') {
    const st = iconStickers[deco.sticker ?? 'star'] ?? iconStickers.star;
    body = <div style={{ width: deco.size }}>{st.draw(color, inkOn(color) === '#2B2A28' ? '#3A3632' : alpha('#FFFFFF', 0.9))}</div>;
  } else if (deco.kind === 'word') {
    body = (
      <div className="deco-word" style={{ fontSize: deco.size, background: color, color: inkOn(color), borderColor: inkOn(color) }}>
        {deco.text}
      </div>
    );
  } else if (deco.kind === 'note') {
    body = (
      <div className="deco-note" style={{ width: deco.size, background: color, color: '#3A3632' }}>
        <span className="tape" />
        {deco.text}
      </div>
    );
  } else {
    const len = deco.arrowLen ?? 80;
    const ang = ((deco.arrowAngle ?? 30) * Math.PI) / 180;
    const hw = (deco.text?.length ?? 4) * deco.size * 0.26 + 6;
    const hh = deco.size * 0.75;
    const t = Math.min(Math.abs(Math.cos(ang)) < 1e-3 ? 1e9 : hw / Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)) < 1e-3 ? 1e9 : hh / Math.abs(Math.sin(ang)));
    const r0 = t + 4;
    body = (
      <div className="deco-callout" style={{ fontSize: deco.size, color }}>
        {deco.text}
        <svg
          className="callout-arrow"
          width={r0 + len + 12}
          height={40}
          style={{ transform: `translateY(-50%) rotate(${deco.arrowAngle ?? 30}deg)` }}
          viewBox={`0 0 ${r0 + len + 12} 40`}
        >
          <path d={`M${r0} 20 Q ${r0 + len / 2} 6 ${r0 + len} 20`} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
          <path d={`M${r0 + len - 10} 12 L${r0 + len} 20 L${r0 + len - 11} 26`} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`deco ${selected ? 'selected' : ''}`}
      style={{ left: `${deco.x}%`, top: `${deco.y}%`, transform: `translate(-50%, -50%) rotate(${deco.rot}deg)` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {body}
    </div>
  );
}
