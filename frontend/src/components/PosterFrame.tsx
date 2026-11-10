import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Scales a fixed-size poster down to fit the available width (and optional max height). */
export default function PosterFrame({ w, h, maxH, children }: { w: number; h: number; maxH?: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(el.clientWidth / w, maxH ? maxH / h : Infinity, 1);
      setScale(Math.max(0.1, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, maxH]);

  return (
    <div ref={box} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div className="frame-inner" style={{ width: w * scale, height: h * scale }}>
        <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>{children}</div>
      </div>
    </div>
  );
}
