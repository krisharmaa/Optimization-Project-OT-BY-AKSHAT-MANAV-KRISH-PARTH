import { useState } from 'react';
import { useStore, type Deco } from '../store';
import { palettes, inkOn, type Palette } from '../themes/palettes';
import { fontPairs } from '../themes/fonts';
import { aspects, bgStyles, designs } from '../themes/designs';
import { annotationIcons, iconStickers, noteColors, wordStickers } from '../themes/stickers';
import type { ViewKind } from '../types';
import { blocksForView, resolveColor } from './TimetablePoster';

function Swatch({ p, on, onClick, onDelete }: { p: Palette; on: boolean; onClick: () => void; onDelete?: () => void }) {
  return (
    <button className={`swatch ${on ? 'on' : ''}`} onClick={onClick} title={p.name}>
      <div className="chips">
        <i style={{ background: p.bg }} />
        <i style={{ background: p.c1 }} />
        <i style={{ background: p.c2 }} />
        <i style={{ background: p.c3 }} />
      </div>
      <span>{p.name}</span>
      {onDelete && (
        <span
          className="x"
          role="button"
          aria-label="Delete palette"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ✕
        </span>
      )}
    </button>
  );
}

/* ---------------- Style tab ---------------- */
export function StylePanel() {
  const { theme, setTheme, savedPalettes, savePalette, deletePalette } = useStore();
  const p = theme.palette;
  const setColor = (k: 'bg' | 'c1' | 'c2' | 'c3', v: string) => setTheme({ palette: { ...p, [k]: v, id: 'edited', name: 'Custom' } });

  return (
    <>
      <div>
        <div className="section-title">Colour scheme</div>
        <div className="swatches">
          {palettes.map((x) => (
            <Swatch key={x.id} p={x} on={p.id === x.id} onClick={() => setTheme({ palette: { ...x } })} />
          ))}
          {savedPalettes.map((x) => (
            <Swatch key={x.id} p={x} on={p.id === x.id} onClick={() => setTheme({ palette: { ...x } })} onDelete={() => deletePalette(x.id)} />
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Fine-tune the 4 colours</div>
        <div className="pickers">
          {(
            [
              ['bg', 'Background'],
              ['c1', 'Colour 1'],
              ['c2', 'Colour 2'],
              ['c3', 'Colour 3'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="picker">
              <input type="color" value={p[k]} onChange={(e) => setColor(k, e.target.value)} />
              {label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn sm ghost"
            onClick={() => {
              const name = prompt('Name this colour scheme', 'My palette');
              if (name) savePalette(name);
            }}
          >
            ＋ Save as my palette
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              const order = [p.c1, p.c2, p.c3].sort(() => Math.random() - 0.5);
              setTheme({ palette: { ...p, c1: order[0], c2: order[1], c3: order[2] } });
            }}
          >
            ⇄ Shuffle
          </button>
        </div>
      </div>

      <div>
        <div className="section-title">Background texture</div>
        <div className="seg">
          {bgStyles.map((b) => (
            <button key={b.id} className={theme.bgStyle === b.id ? 'on' : ''} onClick={() => setTheme({ bgStyle: b.id })}>
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Fonts</div>
        <div className="font-list">
          {fontPairs.map((f) => (
            <button key={f.id} className={`font-opt ${theme.fontId === f.id ? 'on' : ''}`} onClick={() => setTheme({ fontId: f.id })}>
              <span className="t" style={{ fontFamily: f.title, fontWeight: f.titleWeight }}>
                Weekly
              </span>
              <span className="b" style={{ fontFamily: f.body, textTransform: f.bodyUpper ? 'uppercase' : undefined }}>
                {f.name} · Maths
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Design</div>
        <div className="design-opts">
          {designs.map((d) => (
            <button key={d.id} className={`design-opt ${theme.designId === d.id ? 'on' : ''}`} onClick={() => setTheme({ designId: d.id })}>
              <div className="mini">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <i
                    key={i}
                    style={{
                      borderRadius: Math.min(d.radius / 2, 8),
                      opacity: i % 3 === 1 && d.emptyCells === 'none' ? 0 : 0.55,
                      background: i % 3 === 1 ? 'var(--ink-3)' : [p.c1, p.c2, p.c3][i % 3],
                    }}
                  />
                ))}
              </div>
              <b>{d.name}</b>
              <span>{d.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------- Content tab ---------------- */
export function ContentPanel() {
  const { theme, setTheme, view, setView } = useStore();
  const inst = useStore((s) => s.instance);
  const entities =
    view.kind === 'group'
      ? inst.groups.map((g) => [g.id, g.name])
      : view.kind === 'faculty'
        ? inst.faculty.map((f) => [f.id, f.name])
        : inst.rooms.map((r) => [r.id, r.name]);
  const toggles: [keyof typeof theme, string][] = [
    ['showTeacher', view.kind === 'faculty' ? 'Show class / group' : 'Show teacher'],
    ['showRoom', view.kind === 'room' ? 'Show class / group' : 'Show room'],
    ['showTimeCol', 'Show time column'],
    ['showLegend', 'Show subject legend'],
    ['useCodes', 'Short subject codes'],
  ];

  return (
    <>
      <div>
        <div className="section-title">Whose timetable?</div>
        <div className="seg" style={{ marginBottom: 8 }}>
          {(['group', 'faculty', 'room'] as ViewKind[]).map((k) => (
            <button key={k} className={view.kind === k ? 'on' : ''} onClick={() => setView(k)}>
              {k === 'group' ? 'Class' : k === 'faculty' ? 'Teacher' : 'Room'}
            </button>
          ))}
        </div>
        <select className="input" value={view.entityId} onChange={(e) => setView(view.kind, e.target.value)}>
          {entities.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <label className="field">
        Title
        <input type="text" value={theme.title} onChange={(e) => setTheme({ title: e.target.value })} />
      </label>
      <label className="field">
        Subtitle
        <input type="text" value={theme.subtitle} onChange={(e) => setTheme({ subtitle: e.target.value })} />
      </label>

      <div>
        <div className="section-title">Show</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {toggles.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={!!theme[k]} onChange={(e) => setTheme({ [k]: e.target.checked })} /> {label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Poster size</div>
        <div className="seg">
          {aspects.map((a) => (
            <button key={a.id} className={theme.aspect === a.id ? 'on' : ''} onClick={() => setTheme({ aspect: a.id })}>
              {a.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------- Decorate tab: stickers, notes, annotations ---------------- */
export function DecoratePanel({ activeBlockId, onCloseBlock }: { activeBlockId: string | null; onCloseBlock: () => void }) {
  const { theme, decorations, selectedDecoId, addDeco, updateDeco, removeDeco, selectDeco, clearDecos, blockNotes, setBlockNote, view, solutions, selectedId } =
    useStore();
  const inst = useStore((s) => s.instance);
  const [stickerColor, setStickerColor] = useState<string>('c1');
  const p = theme.palette;
  const ink = inkOn(p.bg);
  const sel = decorations.find((d) => d.id === selectedDecoId);
  const solution = solutions.find((s) => s.id === selectedId) ?? solutions[0];
  const activeBlock = activeBlockId ? blocksForView(inst, solution, view).find((b) => b.eventId === activeBlockId) : undefined;
  const note = activeBlockId ? blockNotes[activeBlockId] : undefined;

  // New items land near the middle with a little jitter so they don't stack exactly.
  const spot = () => ({ x: 35 + Math.random() * 30, y: 30 + Math.random() * 40, rot: Math.round(Math.random() * 16 - 8) });
  const paletteRefs = ['c1', 'c2', 'c3', 'ink'];

  return (
    <>
      {activeBlock && (
        <div className="edit-box">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>
              Annotate {activeBlock.code} · {inst.grid.days[activeBlock.day]} {activeBlock.time}
            </h3>
            <button className="btn sm ghost" onClick={onCloseBlock}>
              Done
            </button>
          </div>
          <div className="icon-row">
            {annotationIcons.map((i) => (
              <button
                key={i}
                className={note?.icon === i ? 'on' : ''}
                onClick={() => setBlockNote(activeBlock.eventId, { icon: note?.icon === i ? '' : i, text: note?.text ?? '' })}
              >
                {i}
              </button>
            ))}
          </div>
          <label className="field">
            Note (appears as a footnote)
            <input
              type="text"
              placeholder="e.g. Quiz on Unit 3"
              value={note?.text ?? ''}
              onChange={(e) => setBlockNote(activeBlock.eventId, { icon: note?.icon || '★', text: e.target.value })}
            />
          </label>
          {note && (
            <button className="btn sm ghost" onClick={() => setBlockNote(activeBlock.eventId, null)}>
              Remove annotation
            </button>
          )}
        </div>
      )}

      {sel && <SelectedDecoEditor deco={sel} paletteRefs={paletteRefs} ink={ink} onChange={(d) => updateDeco(sel.id, d)} onDelete={() => removeDeco(sel.id)} onDone={() => selectDeco(null)} />}

      {!activeBlock && !sel && <div className="empty-hint">Tip: click any class on the poster to pin a note to it. Drag stickers and notes to move them.</div>}

      <div>
        <div className="section-title">Stickers</div>
        <div className="color-row" style={{ marginBottom: 8 }}>
          {paletteRefs.map((c) => (
            <button
              key={c}
              className={`color-dot ${stickerColor === c ? 'on' : ''}`}
              style={{ background: resolveColor(c, theme, ink) }}
              onClick={() => setStickerColor(c)}
              aria-label={`Sticker colour ${c}`}
            />
          ))}
        </div>
        <div className="sticker-grid">
          {Object.entries(iconStickers).map(([id, s]) => (
            <button key={id} className="sticker-btn" title={s.name} onClick={() => addDeco({ kind: 'sticker', sticker: id, color: stickerColor, size: 90, ...spot() })}>
              {s.draw(resolveColor(stickerColor, theme, ink), '#3a3632')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Word stickers</div>
        <div className="word-grid">
          {wordStickers.map((w) => (
            <button key={w} className="word-btn" onClick={() => addDeco({ kind: 'word', text: w, color: stickerColor, size: 30, ...spot() })}>
              {w}
            </button>
          ))}
          <button
            className="word-btn"
            onClick={() => {
              const t = prompt('Sticker text');
              if (t) addDeco({ kind: 'word', text: t.toUpperCase(), color: stickerColor, size: 30, ...spot() });
            }}
          >
            ＋ Custom
          </button>
        </div>
      </div>

      <div>
        <div className="section-title">Notes & annotations</div>
        <div className="row">
          <button
            className="btn sm"
            onClick={() => addDeco({ kind: 'note', text: 'The future is not something you wait for.', color: noteColors[0], size: 200, ...spot() })}
          >
            🗒 Sticky note
          </button>
          <button className="btn sm" onClick={() => addDeco({ kind: 'callout', text: 'exam week!', color: 'ink', size: 30, arrowAngle: 35, arrowLen: 70, ...spot(), rot: 0 })}>
            ↘ Callout with arrow
          </button>
        </div>
      </div>

      {decorations.length > 0 && (
        <button
          className="btn sm ghost"
          onClick={() => {
            if (confirm('Remove all stickers and notes?')) clearDecos();
          }}
        >
          Clear all decorations ({decorations.length})
        </button>
      )}
    </>
  );
}

function SelectedDecoEditor({
  deco,
  paletteRefs,
  ink,
  onChange,
  onDelete,
  onDone,
}: {
  deco: Deco;
  paletteRefs: string[];
  ink: string;
  onChange: (d: Partial<Deco>) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { theme } = useStore();
  const label = { sticker: 'Sticker', word: 'Word sticker', note: 'Sticky note', callout: 'Callout' }[deco.kind];
  const sizeRange = deco.kind === 'note' ? [120, 340] : deco.kind === 'sticker' ? [40, 220] : [14, 64];
  const colors = deco.kind === 'note' ? noteColors : paletteRefs;

  return (
    <div className="edit-box">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Editing: {label}</h3>
        <div className="row">
          <button className="btn sm ghost" onClick={onDelete}>
            Delete
          </button>
          <button className="btn sm ghost" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
      {(deco.kind === 'note' || deco.kind === 'callout' || deco.kind === 'word') && (
        <label className="field">
          Text
          {deco.kind === 'note' ? (
            <textarea value={deco.text} onChange={(e) => onChange({ text: e.target.value })} />
          ) : (
            <input type="text" value={deco.text} onChange={(e) => onChange({ text: deco.kind === 'word' ? e.target.value.toUpperCase() : e.target.value })} />
          )}
        </label>
      )}
      <div className="color-row">
        {colors.map((c) => (
          <button key={c} className={`color-dot ${deco.color === c ? 'on' : ''}`} style={{ background: resolveColor(c, theme, ink) }} onClick={() => onChange({ color: c })} />
        ))}
        <input type="color" value={resolveColor(deco.color, theme, ink)} onChange={(e) => onChange({ color: e.target.value })} title="Any colour" style={{ width: 30, height: 30, border: 'none', background: 'none', padding: 0 }} />
      </div>
      <label className="field">
        Size
        <input type="range" min={sizeRange[0]} max={sizeRange[1]} value={deco.size} onChange={(e) => onChange({ size: +e.target.value })} />
      </label>
      <label className="field">
        Tilt
        <input type="range" min={-45} max={45} value={deco.rot} onChange={(e) => onChange({ rot: +e.target.value })} />
      </label>
      {deco.kind === 'callout' && (
        <>
          <label className="field">
            Arrow direction
            <input type="range" min={-180} max={180} value={deco.arrowAngle ?? 30} onChange={(e) => onChange({ arrowAngle: +e.target.value })} />
          </label>
          <label className="field">
            Arrow length
            <input type="range" min={20} max={220} value={deco.arrowLen ?? 70} onChange={(e) => onChange({ arrowLen: +e.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}
