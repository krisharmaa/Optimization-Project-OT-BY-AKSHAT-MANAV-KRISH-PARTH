import type { Instance, Offering, TEvent } from '../types';

// Small synthetic instance (proposal "Small" scenario: ~40 events, 2 groups, 5 rooms, 6 faculty).

const subjects: { code: string; subject: string; type: 'theory' | 'lab'; sessions: number; faculty: string[] }[] = [
  { code: 'DSA', subject: 'Data Structures', type: 'theory', sessions: 3, faculty: ['f1', 'f2'] },
  { code: 'DBMS', subject: 'Database Systems', type: 'theory', sessions: 3, faculty: ['f2', 'f3'] },
  { code: 'OS', subject: 'Operating Systems', type: 'theory', sessions: 3, faculty: ['f3', 'f4'] },
  { code: 'MATHS', subject: 'Engineering Maths III', type: 'theory', sessions: 3, faculty: ['f5', 'f6'] },
  { code: 'COA', subject: 'Computer Organisation', type: 'theory', sessions: 2, faculty: ['f4', 'f1'] },
  { code: 'EVS', subject: 'Environmental Studies', type: 'theory', sessions: 1, faculty: ['f6', 'f5'] },
  { code: 'DSA LAB', subject: 'Data Structures Lab', type: 'lab', sessions: 1, faculty: ['f1', 'f2'] },
  { code: 'DBMS LAB', subject: 'Database Lab', type: 'lab', sessions: 1, faculty: ['f3', 'f2'] },
];

const groups = [
  { id: 'gA', name: 'SY-Comp Div A', strength: 58 },
  { id: 'gB', name: 'SY-Comp Div B', strength: 52 },
];

const offerings: Offering[] = [];
const events: TEvent[] = [];

for (const g of groups) {
  for (const s of subjects) {
    const id = `${g.id}-${s.code.replace(/\s/g, '')}`;
    offerings.push({
      id,
      subject: s.subject,
      code: s.code,
      groupIds: [g.id],
      type: s.type,
      sessionsPerWeek: s.sessions,
      eligibleFaculty: s.faculty,
    });
    for (let i = 0; i < s.sessions; i++) {
      events.push({ id: `${id}-${i + 1}`, offeringId: id, length: s.type === 'lab' ? 2 : 1, headcount: g.strength });
    }
  }
}

export const mockInstance: Instance = {
  name: 'SY Computer Engineering — Semester III',
  grid: {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periods: ['9:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00', '12:00 - 1:00', '1:00 - 2:00', '2:00 - 3:00', '3:00 - 4:00', '4:00 - 5:00'],
    lunchPeriod: 4,
  },
  groups,
  faculty: [
    { id: 'f1', name: 'Prof. Mehta', maxWeekly: 12, maxDaily: 4 },
    { id: 'f2', name: 'Dr. Iyer', maxWeekly: 12, maxDaily: 4 },
    { id: 'f3', name: 'Prof. Kulkarni', maxWeekly: 10, maxDaily: 4 },
    { id: 'f4', name: 'Dr. Fernandes', maxWeekly: 10, maxDaily: 3 },
    { id: 'f5', name: 'Prof. Rao', maxWeekly: 8, maxDaily: 3 },
    { id: 'f6', name: 'Dr. Shaikh', maxWeekly: 8, maxDaily: 3 },
  ],
  rooms: [
    { id: 'r1', name: 'CR-101', capacity: 60, type: 'classroom' },
    { id: 'r2', name: 'CR-102', capacity: 72, type: 'classroom' },
    { id: 'r3', name: 'LH-201', capacity: 120, type: 'classroom' },
    { id: 'r4', name: 'Lab A-301', capacity: 64, type: 'lab' },
    { id: 'r5', name: 'Lab B-302', capacity: 70, type: 'lab' },
  ],
  offerings,
  events,
};
