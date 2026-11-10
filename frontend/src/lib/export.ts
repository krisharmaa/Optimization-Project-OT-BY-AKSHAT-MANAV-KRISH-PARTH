import { toPng } from 'html-to-image';
import type { Block } from '../components/TimetablePoster';

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function exportPng(node: HTMLElement, name: string) {
  node.setAttribute('data-exporting', '');
  try {
    await document.fonts.ready;
    const url = await toPng(node, { pixelRatio: 2, cacheBust: true });
    download(url, name);
  } finally {
    node.removeAttribute('data-exporting');
  }
}

export function exportCsv(blocks: Block[], days: string[], name: string) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [['Day', 'Time', 'Code', 'Subject', 'Teacher', 'Room', 'Groups']];
  [...blocks]
    .sort((a, b) => a.day - b.day || a.period - b.period)
    .forEach((b) => rows.push([days[b.day], b.time, b.code, b.subject, b.teacher, b.room, b.groups]));
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
