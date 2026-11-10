export interface Design {
  id: string;
  name: string;
  hint: string;
  radius: number; // block corner radius in px
  dayHeader: 'pill' | 'text' | 'letter';
  emptyCells: 'none' | 'lines' | 'breaks' | 'grid';
  timeInBlock: boolean;
  card: boolean; // frosted card behind the grid
}

export const designs: Design[] = [
  { id: 'pill', name: 'Pill Blocks', hint: 'Rounded blocks, pill headers', radius: 18, dayHeader: 'pill', emptyCells: 'none', timeInBlock: false, card: false },
  { id: 'planner', name: 'Planner Lines', hint: 'Ruled rows, tinted day columns', radius: 14, dayHeader: 'text', emptyCells: 'lines', timeInBlock: true, card: false },
  { id: 'columns', name: 'Tall Columns', hint: 'Vertical days, times inside', radius: 16, dayHeader: 'letter', emptyCells: 'breaks', timeInBlock: true, card: false },
  { id: 'glass', name: 'Glass Card', hint: 'Frosted card, soft bubbles', radius: 22, dayHeader: 'pill', emptyCells: 'none', timeInBlock: true, card: true },
  { id: 'minimal', name: 'Minimal Grid', hint: 'Thin lines, print friendly', radius: 3, dayHeader: 'text', emptyCells: 'grid', timeInBlock: false, card: false },
];

export type BgStyle = 'solid' | 'dots' | 'grid' | 'lines' | 'gradient' | 'grain';
export const bgStyles: { id: BgStyle; name: string }[] = [
  { id: 'solid', name: 'Solid' },
  { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Grid paper' },
  { id: 'lines', name: 'Ruled' },
  { id: 'gradient', name: 'Soft glow' },
  { id: 'grain', name: 'Paper grain' },
];

export type Aspect = 'phone' | 'a4' | 'landscape';
export const aspects: { id: Aspect; name: string; w: number; h: number }[] = [
  { id: 'phone', name: 'Phone 9:16', w: 720, h: 1280 },
  { id: 'a4', name: 'A4 portrait', w: 794, h: 1123 },
  { id: 'landscape', name: 'Landscape', w: 1280, h: 860 },
];
