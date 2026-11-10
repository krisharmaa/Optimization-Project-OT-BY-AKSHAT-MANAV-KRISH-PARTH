# Clockwork (frontend)

React + Vite + TypeScript frontend for the multi-objective college timetable optimiser. It runs the
project's final memetic NSGA-II through `api/server.py`; see `docs/web_application.md`.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Pages
- **Overview**: run the final optimizer (instance, evaluation budget, population, time cap, seeds), live progress, hypervolume vs the
  greedy baseline at equal evaluations, and the four recommended timetables (fewest gaps, least room wastage, most balanced, best compromise).
- **Pareto front**: pairwise scatter plots of f1/f2/f3 with the greedy front overlaid, a memetic-vs-greedy table for the run,
  and the non-dominated timetables with practical metrics.
- **Designer**: renders the chosen timetable as a poster you can style and export (PNG, CSV, print).

## Designer features
- **Colour schemes**: 4 colours each (background + 3 block colours), 12 presets, colour pickers, save your own.
- **Fonts**: 9 title/body pairs. **Designs**: Pill Blocks, Planner Lines, Tall Columns, Glass Card, Minimal Grid.
- **Backgrounds**: solid, dots, grid paper, ruled, soft glow, paper grain. **Sizes**: phone 9:16, A4, landscape.
- **Decorate**: drag-and-drop stickers, word stickers, sticky notes, arrow callouts, and notes pinned to a class (shown as a badge and a footnote).
- Views per class, teacher or room.

## Data
The website gets its timetables from the Python server (`api/server.py`). Vite forwards `/api` requests to
port 8000; see the project README for how to start both servers. If the server is not running, the website
falls back to clearly labelled offline demo data in `src/mock/` (not optimizer output). `src/types.ts` matches the JSON the server returns.
