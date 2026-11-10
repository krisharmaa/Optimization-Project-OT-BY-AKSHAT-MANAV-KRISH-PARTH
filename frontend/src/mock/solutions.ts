import type { Assignment, Instance, Objectives, Solution } from '../types';

// Stand-in for the Python optimiser: builds random clash-free timetables with a randomised
// greedy placer, scores them with the proposal's f1/f2/f3 and marks the non-dominated ones.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], r: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOne(inst: Instance, r: () => number, compactBias: number, bestFitBias: number): Solution | null {
  const { days, periods, lunchPeriod } = inst.grid;
  const D = days.length;
  const P = periods.length;
  const key = (d: number, p: number) => d * P + p;
  const roomBusy = new Map<string, Set<number>>();
  const facBusy = new Map<string, Set<number>>();
  const grpBusy = new Map<string, Set<number>>();
  const facLoad = new Map<string, number>();
  const facDaily = new Map<string, number[]>();
  const offeringDays = new Map<string, Set<number>>();
  const facultyOf: Record<string, string> = {};
  const offById = new Map(inst.offerings.map((o) => [o.id, o]));
  const facById = new Map(inst.faculty.map((f) => [f.id, f]));

  // Pick teachers (C1, C7 weekly cap), random among eligible with room left.
  for (const o of shuffle(inst.offerings, r)) {
    const need = inst.events.filter((e) => e.offeringId === o.id).reduce((s, e) => s + e.length, 0);
    const options = shuffle(o.eligibleFaculty, r).filter((f) => (facLoad.get(f) ?? 0) + need <= facById.get(f)!.maxWeekly);
    if (!options.length) return null;
    const f = options[0];
    facultyOf[o.id] = f;
    facLoad.set(f, (facLoad.get(f) ?? 0) + need);
  }

  const get = (m: Map<string, Set<number>>, k: string) => {
    if (!m.has(k)) m.set(k, new Set());
    return m.get(k)!;
  };

  // DSatur-like order: labs first (longest), then random.
  const order = shuffle(inst.events, r).sort((a, b) => b.length - a.length);
  const assignments: Assignment[] = [];

  for (const ev of order) {
    const off = offById.get(ev.offeringId)!;
    const fac = facultyOf[off.id];
    const fac0 = facById.get(fac)!;
    const roomType = off.type === 'lab' ? 'lab' : 'classroom';
    let rooms = inst.rooms.filter((rm) => rm.type === roomType && rm.capacity >= ev.headcount);
    rooms = r() < bestFitBias ? [...rooms].sort((a, b) => a.capacity - b.capacity) : shuffle(rooms, r);

    let slots: [number, number][] = [];
    for (let d = 0; d < D; d++) for (let p = 0; p + ev.length <= P; p++) slots.push([d, p]);
    slots = shuffle(slots, r);
    if (r() < compactBias) {
      // Prefer slots adjacent to something the group already has that day.
      const gb = get(grpBusy, off.groupIds[0]);
      const score = ([d, p]: [number, number]) => (gb.has(key(d, p - 1)) || gb.has(key(d, p + ev.length)) ? 0 : 1) + (p > 5 ? 0.5 : 0);
      slots.sort((a, b) => score(a) - score(b));
    }

    let placed = false;
    for (const [d, p] of slots) {
      const cells = Array.from({ length: ev.length }, (_, i) => key(d, p + i));
      if (Array.from({ length: ev.length }, (_, i) => p + i).includes(lunchPeriod)) continue; // C6
      if (off.type !== 'lab' && offeringDays.get(off.id)?.has(d)) continue; // C8
      if (cells.some((c) => get(facBusy, fac).has(c))) continue; // C3
      if (off.groupIds.some((g) => cells.some((c) => get(grpBusy, g).has(c)))) continue; // C4
      const daily = facDaily.get(fac) ?? Array(D).fill(0);
      if (daily[d] + ev.length > fac0.maxDaily) continue; // C7 daily
      const room = rooms.find((rm) => cells.every((c) => !get(roomBusy, rm.id).has(c))); // C2, C5
      if (!room) continue;
      cells.forEach((c) => {
        get(roomBusy, room.id).add(c);
        get(facBusy, fac).add(c);
        off.groupIds.forEach((g) => get(grpBusy, g).add(c));
      });
      daily[d] += ev.length;
      facDaily.set(fac, daily);
      get(offeringDays, off.id).add(d);
      assignments.push({ eventId: ev.id, day: d, period: p, roomId: room.id });
      placed = true;
      break;
    }
    if (!placed) return null;
  }

  return { id: '', assignments, facultyOf, objectives: evaluate(inst, assignments, facultyOf), onFront: false };
}

export function evaluate(inst: Instance, assignments: Assignment[], facultyOf: Record<string, string>): Objectives {
  const { days, periods } = inst.grid;
  const evById = new Map(inst.events.map((e) => [e.id, e]));
  const offById = new Map(inst.offerings.map((o) => [o.id, o]));
  const roomById = new Map(inst.rooms.map((r) => [r.id, r]));
  const busy = new Map<string, boolean[][]>(); // entity -> day -> period
  const mark = (k: string, d: number, p: number) => {
    if (!busy.has(k)) busy.set(k, days.map(() => periods.map(() => false)));
    busy.get(k)![d][p] = true;
  };
  let waste = 0;
  let totalLen = 0;
  const load = new Map<string, number>();
  for (const a of assignments) {
    const ev = evById.get(a.eventId)!;
    const off = offById.get(ev.offeringId)!;
    const f = facultyOf[off.id];
    for (let i = 0; i < ev.length; i++) {
      off.groupIds.forEach((g) => mark('g:' + g, a.day, a.period + i));
      mark('f:' + f, a.day, a.period + i);
    }
    const cap = roomById.get(a.roomId)!.capacity;
    waste += (ev.length * (cap - ev.headcount)) / cap;
    totalLen += ev.length;
    load.set(f, (load.get(f) ?? 0) + ev.length);
  }
  let gG = 0;
  let gF = 0;
  for (const [k, grid] of busy) {
    for (const row of grid) {
      const idx = row.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      // Lunch is not counted as a gap.
      const span = idx[idx.length - 1] - idx[0] + 1;
      const lunchInside = inst.grid.lunchPeriod > idx[0] && inst.grid.lunchPeriod < idx[idx.length - 1] ? 1 : 0;
      const gap = span - idx.length - lunchInside;
      if (k.startsWith('g:')) gG += gap;
      else gF += gap;
    }
  }
  const rho = inst.faculty.map((f) => (load.get(f.id) ?? 0) / f.maxWeekly);
  const mean = rho.reduce((s, x) => s + x, 0) / rho.length;
  const f3 = Math.sqrt(rho.reduce((s, x) => s + (x - mean) ** 2, 0) / rho.length);
  return { f1: gG + 0.5 * gF, f2: waste / totalLen, f3 };
}

const dominates = (a: Objectives, b: Objectives) =>
  a.f1 <= b.f1 && a.f2 <= b.f2 && a.f3 <= b.f3 && (a.f1 < b.f1 || a.f2 < b.f2 || a.f3 < b.f3);

export function generateSolutions(inst: Instance, seed = 7, samples = 160): Solution[] {
  const r = rng(seed);
  const out: Solution[] = [];
  let tries = 0;
  while (out.length < samples && tries < samples * 20) {
    tries++;
    const s = buildOne(inst, r, r(), r());
    if (s) out.push(s);
  }
  out.forEach((s, i) => {
    s.id = `S${String(i + 1).padStart(3, '0')}`;
    s.onFront = !out.some((o) => o !== s && dominates(o.objectives, s.objectives));
  });
  return out;
}

export type PickKind = 'gaps' | 'rooms' | 'balance' | 'knee';

export const pickLabels: Record<PickKind, { title: string; blurb: string }> = {
  gaps: { title: 'Fewest gaps', blurb: 'Student-friendly: compact days' },
  rooms: { title: 'Least room wastage', blurb: 'Rooms sized to the class' },
  balance: { title: 'Most balanced', blurb: 'Fair teaching load' },
  knee: { title: 'Best compromise', blurb: 'Closest to the normalised ideal (report: normalized_compromise)' },
};

/** The four representative solutions from Section 14 of the proposal. */
export function representativePicks(front: Solution[]): Record<PickKind, Solution> {
  const by = (k: keyof Objectives) => [...front].sort((a, b) => a.objectives[k] - b.objectives[k])[0];
  const keys: (keyof Objectives)[] = ['f1', 'f2', 'f3'];
  const lo = keys.map((k) => Math.min(...front.map((s) => s.objectives[k])));
  const hi = keys.map((k) => Math.max(...front.map((s) => s.objectives[k])));
  const norm = (s: Solution) => keys.map((k, i) => (hi[i] === lo[i] ? 0 : (s.objectives[k] - lo[i]) / (hi[i] - lo[i])));
  const knee = [...front].sort((a, b) => Math.hypot(...norm(a)) - Math.hypot(...norm(b)))[0];
  return { gaps: by('f1'), rooms: by('f2'), balance: by('f3'), knee };
}
