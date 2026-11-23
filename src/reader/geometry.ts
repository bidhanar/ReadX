import type { NRect } from '../lib/types';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Merge the many small rects a text selection produces (one per span/glyph run) into one rect
 * per line. Rects on the same line (vertical overlap ≥ 50% of the smaller one) that touch or
 * nearly touch horizontally are unioned.
 */
export function mergeLineRects(rects: Box[], gap = 4): Box[] {
  const rs = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    // Copy explicitly: DOMRect fields are prototype getters, so `{...rect}` would be empty
    .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
    .sort((a, b) => a.top - b.top);

  // 1) Bucket into lines
  const lines: { probe: Box; items: Box[] }[] = [];
  for (const r of rs) {
    const line = lines.find((l) => sameLine(l.probe, r));
    if (line) line.items.push(r);
    else lines.push({ probe: r, items: [r] });
  }

  // 2) Within each line, merge left→right runs that touch
  const out: Box[] = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.left - b.left);
    let cur: Box | null = null;
    for (const r of line.items) {
      if (cur && r.left <= cur.left + cur.width + gap) {
        const right = Math.max(cur.left + cur.width, r.left + r.width);
        const bottom = Math.max(cur.top + cur.height, r.top + r.height);
        cur.top = Math.min(cur.top, r.top);
        cur.width = right - cur.left;
        cur.height = bottom - cur.top;
      } else {
        cur = { ...r };
        out.push(cur);
      }
    }
  }
  return out;
}

function sameLine(a: Box, b: Box) {
  const overlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return overlap >= 0.5 * Math.min(a.height, b.height);
}

/** Convert client rects to rects normalized (0..1) against a reference box, clipped to it. */
export function normalizeRects(rects: Box[], ref: Box): NRect[] {
  const out: NRect[] = [];
  for (const r of rects) {
    const l = Math.max(r.left, ref.left);
    const t = Math.max(r.top, ref.top);
    const rr = Math.min(r.left + r.width, ref.left + ref.width);
    const b = Math.min(r.top + r.height, ref.top + ref.height);
    if (rr - l <= 0.5 || b - t <= 0.5) continue;
    out.push({
      x: round4((l - ref.left) / ref.width),
      y: round4((t - ref.top) / ref.height),
      w: round4((rr - l) / ref.width),
      h: round4((b - t) / ref.height),
    });
  }
  return out;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function excerptAround(text: string, index: number, len: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}
