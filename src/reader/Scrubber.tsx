import { useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/util';

/**
 * Progress bar you can drag (or tap) to jump anywhere in the book. While dragging, a bubble
 * previews the destination ("Page 120 of 300 · Chapter 7"); the jump happens on release.
 * In right-to-left books the bar fills from the right. `markers` (other readers' avatars) sit
 * on top and stay clickable.
 */
export function Scrubber({
  percent,
  rtl,
  dark,
  describe,
  onSeek,
  markers,
}: {
  percent: number;
  rtl: boolean;
  dark: boolean;
  describe: (f: number) => string;
  onSeek: (f: number) => void;
  markers?: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const fractionAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return rtl ? 1 - x : x;
  };

  const shown = drag ?? percent;
  const pos = (f: number) => `${(rtl ? 1 - f : f) * 100}%`;

  return (
    <div className="relative mx-auto h-7 max-w-3xl touch-none select-none">
      <div
        ref={track}
        className="absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 cursor-pointer"
        role="slider"
        aria-label="Position in book"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        aria-valuetext={describe(shown)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(fractionAt(e.clientX));
        }}
        onPointerMove={(e) => drag !== null && setDrag(fractionAt(e.clientX))}
        onPointerUp={(e) => {
          if (drag === null) return;
          const f = fractionAt(e.clientX);
          setDrag(null);
          onSeek(f);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
          const back = rtl ? 'ArrowRight' : 'ArrowLeft';
          if (e.key === fwd || e.key === back) {
            e.preventDefault();
            e.stopPropagation(); // don't also turn the page
            onSeek(Math.min(1, Math.max(0, percent + (e.key === fwd ? step : -step))));
          }
        }}
      >
        <div className={cx('absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full', dark ? 'bg-white/15' : 'bg-black/10')} />
        <div
          className={cx('absolute top-1/2 h-1 -translate-y-1/2 rounded-full', drag === null && 'transition-all', dark ? 'bg-[#ff9d5c]' : 'bg-brand')}
          style={rtl ? { right: 0, width: `${shown * 100}%` } : { left: 0, width: `${shown * 100}%` }}
        />
        <div
          className={cx(
            'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow ring-2 ring-white transition-transform',
            dark ? 'bg-[#ff9d5c]' : 'bg-brand',
            drag !== null && 'scale-125',
          )}
          style={{ left: pos(shown) }}
        />
      </div>
      {markers}
      {drag !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-lg bg-[#1c2433] px-2.5 py-1 text-xs whitespace-nowrap text-white shadow-lg"
          style={{ left: `clamp(80px, ${pos(drag)}, calc(100% - 80px))` }}
        >
          {describe(drag)}
        </div>
      )}
    </div>
  );
}

/** Position helper for markers placed on the scrubber track. */
export const markerLeft = (f: number, rtl: boolean) => `${Math.min(100, Math.max(0, (rtl ? 1 - f : f) * 100))}%`;
