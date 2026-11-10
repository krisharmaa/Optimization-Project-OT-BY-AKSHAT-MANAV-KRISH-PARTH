import type { ReactElement } from 'react';

// Hand-drawn style stickers as inline SVG so they theme with the palette and export cleanly.
// Each takes a fill colour and an ink (outline) colour.

type Draw = (fill: string, ink: string) => ReactElement;

const outline = (ink: string) => ({ stroke: ink, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const });

export const iconStickers: Record<string, { name: string; draw: Draw }> = {
  bow: {
    name: 'Bow',
    draw: (f) => (
      <svg viewBox="0 0 100 80">
        <path d="M50 38 C35 10 8 8 12 30 C15 48 38 44 50 38 Z" fill="none" stroke={f} strokeWidth="5" />
        <path d="M50 38 C65 10 92 8 88 30 C85 48 62 44 50 38 Z" fill="none" stroke={f} strokeWidth="5" />
        <path d="M50 38 C44 52 36 64 26 76 M50 38 C56 52 66 64 74 76" fill="none" stroke={f} strokeWidth="5" strokeLinecap="round" />
        <circle cx="50" cy="38" r="6" fill={f} />
      </svg>
    ),
  },
  leaf: {
    name: 'Leaf',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="44" fill="#fff" stroke={f} strokeWidth="6" />
        <path d="M34 70 C40 50 52 38 70 30" fill="none" {...outline(ink)} />
        <path d="M45 52 C34 50 30 40 33 34 C42 34 48 42 45 52 Z M55 42 C56 32 64 28 70 30 C70 38 62 44 55 42 Z M50 60 C58 64 66 60 68 54 C60 50 54 54 50 60 Z" fill={ink} />
      </svg>
    ),
  },
  star: {
    name: 'Star',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        <path d="M50 8 L61 37 L92 38 L67 57 L76 88 L50 70 L24 88 L33 57 L8 38 L39 37 Z" fill={f} {...outline(ink)} />
      </svg>
    ),
  },
  heart: {
    name: 'Heart',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        <path d="M50 86 C20 64 8 46 14 30 C20 14 42 12 50 30 C58 12 80 14 86 30 C92 46 80 64 50 86 Z" fill={f} {...outline(ink)} />
      </svg>
    ),
  },
  cat: {
    name: 'Cat',
    draw: (f) => (
      <svg viewBox="0 0 100 100">
        <path d="M18 30 L22 6 L40 22 C46 20 54 20 60 22 L78 6 L82 30 C92 44 90 70 74 82 C60 92 40 92 26 82 C10 70 8 44 18 30 Z" fill={f} stroke="#fff" strokeWidth="4" />
        <ellipse cx="36" cy="54" rx="10" ry="7" fill="#fff" />
        <ellipse cx="64" cy="54" rx="10" ry="7" fill="#fff" />
        <circle cx="38" cy="54" r="4" fill={f} />
        <circle cx="66" cy="54" r="4" fill={f} />
      </svg>
    ),
  },
  coffee: {
    name: 'Coffee',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        <path d="M20 40 H72 V66 C72 80 62 88 46 88 C30 88 20 80 20 66 Z" fill={f} {...outline(ink)} />
        <path d="M72 46 C88 46 88 66 72 66" fill="none" {...outline(ink)} />
        <path d="M36 30 C32 24 40 20 36 12 M52 30 C48 24 56 20 52 12" fill="none" {...outline(ink)} />
      </svg>
    ),
  },
  book: {
    name: 'Book',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        <path d="M50 26 C40 18 24 18 12 22 V80 C24 76 40 76 50 84 C60 76 76 76 88 80 V22 C76 18 60 18 50 26 Z" fill={f} {...outline(ink)} />
        <path d="M50 26 V84" {...outline(ink)} />
      </svg>
    ),
  },
  sparkle: {
    name: 'Sparkle',
    draw: (f) => (
      <svg viewBox="0 0 100 100">
        <path d="M50 6 C54 36 64 46 94 50 C64 54 54 64 50 94 C46 64 36 54 6 50 C36 46 46 36 50 6 Z" fill={f} />
        <path d="M82 12 C83 20 86 23 94 24 C86 25 83 28 82 36 C81 28 78 25 70 24 C78 23 81 20 82 12 Z" fill={f} opacity=".7" />
      </svg>
    ),
  },
  flower: {
    name: 'Flower',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="50" cy="26" rx="14" ry="20" fill={f} {...outline(ink)} transform={`rotate(${a} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="12" fill="#FFD66B" {...outline(ink)} />
      </svg>
    ),
  },
  sun: {
    name: 'Sun',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M50 4 V18" {...outline(ink)} transform={`rotate(${i * 45} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="24" fill={f} {...outline(ink)} />
      </svg>
    ),
  },
  pencil: {
    name: 'Pencil',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 100">
        <path d="M70 10 L90 30 L36 84 L12 90 L18 66 Z" fill={f} {...outline(ink)} />
        <path d="M18 66 L36 84 M62 18 L82 38" {...outline(ink)} />
      </svg>
    ),
  },
  cloud: {
    name: 'Cloud',
    draw: (f, ink) => (
      <svg viewBox="0 0 100 70">
        <path d="M24 60 C8 60 6 40 20 36 C18 20 40 12 50 26 C58 10 84 14 82 34 C96 36 94 60 78 60 Z" fill={f} {...outline(ink)} />
      </svg>
    ),
  },
};

export const wordStickers = ['MEETING', 'EXAM', 'STUDY', 'WORK', 'EXERCISE', 'DEADLINE', 'YAY!', 'QUIZ', 'BREAK', 'GYM'];

export const noteColors = ['#FFF3A6', '#FFD1DC', '#CDEBD3', '#CFE3FF', '#F3DDB5', '#FFFFFF'];

export const annotationIcons = ['★', '!', '✎', '♥', '✓', '?'];
