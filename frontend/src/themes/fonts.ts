export interface FontPair {
  id: string;
  name: string;
  title: string; // CSS font-family for the big title
  body: string; // CSS font-family for blocks/labels
  titleWeight: number;
  bodyUpper?: boolean; // uppercase small labels (like the "Cherry Ribbon" example)
}

export const fontPairs: FontPair[] = [
  { id: 'retro', name: 'Retro Script', title: "'Lobster', cursive", body: "'Barlow Condensed', sans-serif", titleWeight: 400, bodyUpper: true },
  { id: 'handwritten', name: 'Handwritten', title: "'Sniglet', cursive", body: "'Merriweather', serif", titleWeight: 400 },
  { id: 'editorial', name: 'Editorial', title: "'Playfair Display', serif", body: "'Montserrat', sans-serif", titleWeight: 700 },
  { id: 'calligraphy', name: 'Calligraphy', title: "'Great Vibes', cursive", body: "'Inter', sans-serif", titleWeight: 400 },
  { id: 'notebook', name: 'Notebook', title: "'Caveat', cursive", body: "'Nunito', sans-serif", titleWeight: 700 },
  { id: 'modern', name: 'Modern Serif', title: "'Fraunces', serif", body: "'DM Sans', sans-serif", titleWeight: 600 },
  { id: 'tech', name: 'Tech Mono', title: "'Space Grotesk', sans-serif", body: "'Space Mono', monospace", titleWeight: 700, bodyUpper: true },
  { id: 'bubbly', name: 'Bubbly', title: "'Pacifico', cursive", body: "'Quicksand', sans-serif", titleWeight: 400 },
  { id: 'classic', name: 'Classic Italic', title: "'Cormorant Garamond', serif", body: "'Lato', sans-serif", titleWeight: 600 },
];

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?' +
  [
    'Lobster',
    'Barlow+Condensed:wght@500;600;700',
    'Sniglet:wght@400;800',
    'Merriweather:wght@400;700',
    'Playfair+Display:ital,wght@0,600;0,700;1,600',
    'Montserrat:wght@400;600;700',
    'Great+Vibes',
    'Inter:wght@400;600;700',
    'Caveat:wght@500;700',
    'Nunito:wght@400;700;800',
    'Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700',
    'DM+Sans:wght@400;500;700',
    'Space+Grotesk:wght@500;700',
    'Space+Mono:wght@400;700',
    'Pacifico',
    'Quicksand:wght@500;700',
    'Cormorant+Garamond:ital,wght@0,600;1,600',
    'Lato:wght@400;700',
    'Kalam:wght@400;700',
  ]
    .map((f) => 'family=' + f)
    .join('&') +
  '&display=swap';
