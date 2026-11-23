import { useLayoutEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../lib/types';
import { IconComment, IconCopy, IconLink, IconNote, IconShare } from '../../components/icons';
import type { SelectionInfo } from '../engine';

export type SelectionAction = 'note' | 'link' | 'comment' | 'share' | 'copy';

/** Floating toolbar above (or below) the current text selection. */
export function SelectionMenu({
  sel,
  onHighlight,
  onAction,
}: {
  sel: SelectionInfo;
  onHighlight: (c: HighlightColor) => void;
  onAction: (a: SelectionAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const cx = (sel.rect.left + sel.rect.right) / 2;
    let top = sel.rect.top - h - 10;
    // Native selection handles sit below the text on touch devices, so prefer above; fall back below
    if (top < 8) top = sel.rect.bottom + 12;
    top = Math.min(top, window.innerHeight - h - 8);
    const left = Math.max(8, Math.min(vw - w - 8, cx - w / 2));
    setPos({ left, top });
  }, [sel]);

  const btn = 'flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] text-white/90 hover:bg-white/10';
  return (
    <div
      ref={ref}
      className="animate-slide-up fixed z-[60] flex items-center gap-1 rounded-2xl bg-[#1c2433] px-2 py-1.5 shadow-2xl"
      style={pos ?? { left: -9999, top: -9999 }}
      onMouseDown={(e) => e.preventDefault()} // keep the selection alive
    >
      <div className="flex items-center gap-1.5 px-1">
        {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
          <button
            key={c}
            className="h-6 w-6 rounded-full ring-2 ring-white/20 transition hover:scale-110"
            style={{ background: HIGHLIGHT_COLORS[c].replace(/[\d.]+\)$/, '1)') }}
            onClick={() => onHighlight(c)}
            aria-label={`Highlight ${c}`}
            title={`Highlight (${c})`}
          />
        ))}
      </div>
      <span className="mx-1 h-7 w-px bg-white/15" />
      <button className={btn} onClick={() => onAction('note')}>
        <IconNote size={17} />
        Note
      </button>
      <button className={btn} onClick={() => onAction('comment')}>
        <IconComment size={17} />
        Discuss
      </button>
      <button className={btn} onClick={() => onAction('link')}>
        <IconLink size={17} />
        Link
      </button>
      <button className={btn} onClick={() => onAction('share')}>
        <IconShare size={17} />
        Chat
      </button>
      <button className={`${btn} hidden sm:flex`} onClick={() => onAction('copy')}>
        <IconCopy size={17} />
        Copy
      </button>
    </div>
  );
}
