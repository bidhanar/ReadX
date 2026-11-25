import { describe, expect, it } from 'vitest';
import { cfiPos, comparePos, isAhead, maxPos, posOfAnchor, posOfLocation, sortByPosition } from './position';

describe('cfiPos', () => {
  it('reads steps and the character offset', () => {
    expect(cfiPos('epubcfi(/6/14!/4/2/1:5)')).toEqual([6, 14, 4, 2, 1, 5]);
  });
  it('uses the start of a range CFI', () => {
    expect(cfiPos('epubcfi(/6/14!/4/2,/1:5,/1:9)')).toEqual([6, 14, 4, 2, 1, 5]);
  });
  it('ignores id assertions, including escaped brackets', () => {
    expect(cfiPos('epubcfi(/6/14[chap^]5]!/4[body]/2,/1:0,/1:3)')).toEqual([6, 14, 4, 2, 1, 0]);
  });
  it('rejects non-CFIs', () => {
    expect(cfiPos('href:ch1.xhtml')).toBeNull();
    expect(cfiPos('nonsense')).toBeNull();
  });
});

describe('comparePos', () => {
  it('orders chapters, then paragraphs, then characters', () => {
    const a = cfiPos('epubcfi(/6/14!/4/2/1:5)')!;
    expect(comparePos(a, cfiPos('epubcfi(/6/16!/4/2/1:0)')!)).toBeLessThan(0);
    expect(comparePos(a, cfiPos('epubcfi(/6/14!/4/10/1:0)')!)).toBeLessThan(0);
    expect(comparePos(a, cfiPos('epubcfi(/6/14!/4/2/1:2)')!)).toBeGreaterThan(0);
  });
  it('compares numerically, not as text', () => {
    expect(comparePos(cfiPos('epubcfi(/6/8!/4)')!, cfiPos('epubcfi(/6/10!/4)')!)).toBeLessThan(0);
  });
  it('treats a containing position as the same place', () => {
    expect(comparePos(posOfLocation('p4')!, [4, 0.7])).toBe(0);
    expect(comparePos(cfiPos('epubcfi(/6/14!)')!, cfiPos('epubcfi(/6/14!/4/2/1:5)')!)).toBe(0);
  });
});

describe('isAhead / maxPos', () => {
  it('blurs only what is past where you have read', () => {
    expect(isAhead([5, 0.2], [4])).toBe(true);
    expect(isAhead([4, 0.9], [4])).toBe(false);
    expect(isAhead([3], [4])).toBe(false);
    expect(isAhead([3], null)).toBe(true); // not started
    expect(isAhead(null, [4])).toBe(false); // unknown position: never hide
  });
  it('keeps the later position', () => {
    expect(maxPos([3], [5])).toEqual([5]);
    expect(maxPos(null, [5])).toEqual([5]);
  });
});

describe('sortByPosition', () => {
  it('sorts PDF annotations by page then height', () => {
    const mk = (page: number, y: number) => ({ anchor: { kind: 'pdf' as const, page, quote: '', rects: [{ x: 0, y, w: 1, h: 1 }] } });
    const out = sortByPosition([mk(2, 0.5), mk(1, 0.9), mk(2, 0.1)]);
    expect(out.map((a) => posOfAnchor(a.anchor))).toEqual([[1, 0.9], [2, 0.1], [2, 0.5]]);
  });
});
