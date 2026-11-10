import { useCallback, useEffect, useState } from 'react';
import type { Instance, Solution } from './types';
import { api } from './auth';
import type { ThemeSettings, Deco, BlockNote } from './store';

export type OccStatus = 'scheduled' | 'substituted' | 'needs_cover' | 'cancelled';

export interface Occurrence {
  id: string;
  kind: 'lecture' | 'quiz' | 'extra';
  extraId?: number;
  eventId: string | null;
  offeringId: string;
  code: string;
  subject: string;
  date: string;
  day: number;
  period: number;
  length: number;
  roomId: string;
  groupIds: string[];
  facultyId: string;
  originalFacultyId: string;
  status: OccStatus;
  reason: string;
  coverOpen: boolean;
}

export interface CalendarResponse {
  published: boolean;
  semester: { start: string; end: string };
  occurrences: Occurrence[];
  holidays: Record<string, string>;
  assessments: { id: number; title: string; day: string; start_period: number; end_period: number; group_ids: string[] }[];
  days: string[];
  periods: string[];
  lunchPeriod: number | null;
}

export interface Published {
  instance: Instance;
  solution: Pick<Solution, 'assignments' | 'facultyOf' | 'id' | 'objectives'>;
  design: { theme?: ThemeSettings; decorations?: Deco[]; blockNotes?: Record<string, BlockNote> } | null;
  publishedAt: string;
  publishedBy: string;
}

/** The published timetable (null while loading, 'none' when nothing is published yet). */
export function usePublished() {
  const [pub, setPub] = useState<Published | null | 'none'>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<Published>('/timetable')
      .then(setPub)
      .catch((e: Error) => (e.message.includes('published') ? setPub('none') : setError(e.message)));
  }, []);
  useEffect(reload, [reload]);
  return { pub, error, reload };
}

// ---- dates (local calendar days, ISO strings) ----
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
export const pretty = (s: string) => fromIso(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export const STATUS_LABEL: Record<OccStatus, string> = {
  scheduled: 'Scheduled',
  substituted: 'Covered',
  needs_cover: 'Needs cover',
  cancelled: 'Cancelled',
};
