export interface Palette {
  id: string;
  name: string;
  bg: string; // background
  c1: string; // block colours
  c2: string;
  c3: string;
}

export const palettes: Palette[] = [
  { id: 'cherry', name: 'Cherry Ribbon', bg: '#F6F0DF', c1: '#A50E15', c2: '#C8102E', c3: '#A8343F' },
  { id: 'peach', name: 'Peach Planner', bg: '#FAF4EE', c1: '#F28A8F', c2: '#FBA654', c3: '#6E8B78' },
  { id: 'sage', name: 'Sage Engineer', bg: '#53625A', c1: '#5E9471', c2: '#8DBF92', c3: '#F4F6F2' },
  { id: 'periwinkle', name: 'Periwinkle Notes', bg: '#D6E0F5', c1: '#B4C0E4', c2: '#6F84C6', c3: '#FFFDF5' },
  { id: 'olive', name: 'Olive Room', bg: '#D8D2C4', c1: '#4B4C3A', c2: '#7A756A', c3: '#B3AA98' },
  { id: 'matcha', name: 'Matcha Latte', bg: '#F3EEDF', c1: '#9CB380', c2: '#D9B48F', c3: '#6B7F4E' },
  { id: 'midnight', name: 'Midnight Ink', bg: '#1E2230', c1: '#E2B85C', c2: '#6C8EBF', c3: '#D9727B' },
  { id: 'lilac', name: 'Lilac Dream', bg: '#F4EFFA', c1: '#B79CD9', c2: '#F2B5D4', c3: '#7E6BA8' },
  { id: 'ocean', name: 'Ocean Tide', bg: '#EAF4F4', c1: '#2A7F8E', c2: '#7CC6C2', c3: '#F2A65A' },
  { id: 'mono', name: 'Mono Print', bg: '#FFFFFF', c1: '#1F1F1F', c2: '#7A7A7A', c3: '#D4D4D4' },
  { id: 'sunset', name: 'Sunset Pop', bg: '#FFF6E9', c1: '#FF6B4A', c2: '#FFC145', c3: '#5B3E96' },
  { id: 'berry', name: 'Berry Jam', bg: '#2B1B2E', c1: '#C2477A', c2: '#F0A6CA', c3: '#8E6AC8' },
];

// ---- colour helpers ----

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string) {
  const c = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Dark or light text, whichever reads better on `bg`. */
export function inkOn(bg: string, dark = '#2B2A28', light = '#FFFDF8') {
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light;
}

export function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as [number, number, number]);
}

export function alpha(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Colour for the i-th subject. Cycles c1 -> c2 -> c3, then repeats with
 * lighter / darker shades so 9+ subjects stay distinguishable.
 */
export function subjectColor(p: Palette, i: number) {
  const base = [p.c1, p.c2, p.c3][i % 3];
  const round = Math.floor(i / 3);
  if (round === 0) return base;
  const towards = round % 2 === 1 ? (luminance(base) > 0.5 ? '#000000' : '#FFFFFF') : p.bg;
  return mix(base, towards, 0.22 * Math.ceil(round / 2));
}
