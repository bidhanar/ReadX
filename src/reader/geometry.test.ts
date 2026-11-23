import { describe, expect, it } from 'vitest';
import { excerptAround, mergeLineRects, normalizeRects } from './geometry';

describe('mergeLineRects', () => {
  it('unions adjacent rects on the same line', () => {
    const out = mergeLineRects([
      { left: 10, top: 100, width: 40, height: 12 },
      { left: 52, top: 101, width: 30, height: 11 },
      { left: 84, top: 100, width: 20, height: 12 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ left: 10, top: 100, width: 94, height: 12 });
  });

  it('keeps separate lines apart', () => {
    const out = mergeLineRects([
      { left: 10, top: 100, width: 200, height: 12 },
      { left: 10, top: 116, width: 120, height: 12 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps distant rects on the same line apart (two columns)', () => {
    const out = mergeLineRects([
      { left: 10, top: 100, width: 100, height: 12 },
      { left: 300, top: 100, width: 100, height: 12 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('works with DOMRect-like objects whose fields are getters', () => {
    class FakeDOMRect {
      constructor(private x: number, private y: number, private w: number, private h: number) {}
      get left() { return this.x; }
      get top() { return this.y; }
      get width() { return this.w; }
      get height() { return this.h; }
    }
    const out = mergeLineRects([new FakeDOMRect(10, 100, 40, 12), new FakeDOMRect(50, 100, 40, 12)]);
    expect(out).toEqual([{ left: 10, top: 100, width: 80, height: 12 }]);
  });

  it('drops empty rects', () => {
    expect(mergeLineRects([{ left: 0, top: 0, width: 0, height: 10 }])).toEqual([]);
  });
});

describe('normalizeRects', () => {
  it('normalizes and clips to the reference box', () => {
    const ref = { left: 100, top: 50, width: 200, height: 400 };
    const out = normalizeRects([{ left: 80, top: 50, width: 120, height: 40 }], ref);
    expect(out).toEqual([{ x: 0, y: 0, w: 0.5, h: 0.1 }]);
  });

  it('drops rects outside the box', () => {
    const ref = { left: 0, top: 0, width: 100, height: 100 };
    expect(normalizeRects([{ left: 200, top: 0, width: 10, height: 10 }], ref)).toEqual([]);
  });
});

describe('excerptAround', () => {
  it('adds ellipses when trimmed', () => {
    const text = 'a'.repeat(100) + 'NEEDLE' + 'b'.repeat(100);
    const ex = excerptAround(text, 100, 6, 10);
    expect(ex).toBe('…' + 'a'.repeat(10) + 'NEEDLE' + 'b'.repeat(10) + '…');
  });
});
