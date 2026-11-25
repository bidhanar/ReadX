import type { Anchor, Annotation } from '../lib/types';
import { isPdfLocation, pdfPageOf } from './engine';

/**
 * A place in a book as numbers compared in order: PDF `[page, y]`, EPUB the CFI's steps. Lets
 * annotations, saved progress, bookmarks and chat links be compared ("is this ahead of me?").
 */
export type Pos = number[];

/** `epubcfi(/6/14[ch5]!/4/2,/1:5,/1:9)` → `[6, 14, 4, 2, 1, 5]` (a range CFI counts from its start). */
export function cfiPos(cfi: string): Pos | null {
  const m = /^epubcfi\((.*)\)$/s.exec(cfi.trim());
  if (!m) return null;
  const body = m[1].replace(/\[(?:\^.|[^\]])*\]/g, ''); // id assertions; ^ escapes ] inside them
  const [parent, start = ''] = body.split(',');
  const out: number[] = [];
  for (const part of (parent + start).split(/[/!]/)) {
    if (!part) continue;
    const [step, offset] = part.split(':');
    const n = parseInt(step, 10);
    if (Number.isNaN(n)) break; // spatial/temporal offsets: ignore the rest
    out.push(n);
    const o = offset === undefined ? NaN : parseInt(offset, 10);
    if (!Number.isNaN(o)) out.push(o);
  }
  return out.length ? out : null;
}

/** Position of a reader location string (`p12` or an EPUB CFI). */
export function posOfLocation(loc: string | null | undefined): Pos | null {
  if (!loc) return null;
  if (isPdfLocation(loc)) return [pdfPageOf(loc)];
  return loc.startsWith('epubcfi(') ? cfiPos(loc) : null;
}

export function posOfAnchor(a: Anchor): Pos | null {
  return a.kind === 'pdf' ? [a.page, a.rects[0]?.y ?? 0] : cfiPos(a.cfi);
}

/**
 * < 0: a comes first; > 0: a comes later; 0: same place, or one contains the other (a page and a
 * spot on that page).
 */
export function comparePos(a: Pos, b: Pos): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export const maxPos = (a: Pos | null, b: Pos | null): Pos | null => (!a ? b : !b ? a : comparePos(a, b) >= 0 ? a : b);

/** Later than everything you've read (`readTo` null: you haven't started the book). */
export function isAhead(item: Pos | null, readTo: Pos | null): boolean {
  if (!item) return false;
  if (!readTo) return true;
  return comparePos(item, readTo) > 0;
}

/** Reading order. */
export function sortByPosition<T extends Pick<Annotation, 'anchor'>>(list: T[]): T[] {
  const keyed = list.map((a) => ({ a, p: posOfAnchor(a.anchor) }));
  keyed.sort((x, y) => (x.p && y.p ? comparePos(x.p, y.p) : 0));
  return keyed.map((k) => k.a);
}

/** An anchor standing for a bare location (bookmarks, progress), to ask the engine its chapter. */
export function anchorAt(loc: string): Anchor | null {
  if (isPdfLocation(loc)) return { kind: 'pdf', page: pdfPageOf(loc), rects: [], quote: '' };
  const p = cfiPos(loc);
  // CFI spine step /6/14 → the 7th itemref → spine index 6
  return p && p.length > 1 ? { kind: 'epub', cfi: loc, spine: p[1] / 2 - 1, quote: '' } : null;
}
