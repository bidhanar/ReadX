import { describe, expect, it } from 'vitest';
import { FORMATS, renderExport, type ExportDoc, type ExportItem } from './formats';

const item = (over: Partial<ExportItem>): ExportItem => ({
  kind: 'highlight',
  quote: 'It was a bright cold day in April.',
  text: '',
  url: '',
  color: 'yellow',
  author: 'Asha',
  mine: true,
  chapter: 'Chapter 1',
  page: 3,
  order: 1,
  createdAt: new Date(2026, 10, 3, 14, 5, 9),
  link: 'https://example.test/#/g/G/b/B?a=1',
  replies: [],
  ...over,
});

const doc: ExportDoc = {
  title: 'Nineteen Eighty-Four',
  author: 'George Orwell',
  group: 'Book Club',
  bookLink: 'https://example.test/#/g/G/b/B',
  exportedAt: new Date(2026, 10, 25),
  showAuthors: true,
  items: [
    item({}),
    item({ kind: 'note', quote: 'Big Brother is watching, you', text: 'Chilling, "really"', order: 2, mine: false, author: 'Ravi' }),
    item({ kind: 'comment', chapter: 'Chapter 2', page: 9, order: 3, text: 'Thoughts?', replies: [{ author: 'Ravi', text: 'Agreed' }] }),
    item({ kind: 'bookmark', quote: '', color: undefined, chapter: 'Chapter 2', page: undefined, percent: 0.42, order: 4 }),
  ],
};

describe('exports', () => {
  it('renders every format without throwing', () => {
    for (const f of FORMATS) expect(renderExport(f.id, doc).length).toBeGreaterThan(20);
  });

  it('markdown groups by chapter and quotes passages', () => {
    const md = renderExport('md', doc);
    expect(md).toContain('# Nineteen Eighty-Four');
    expect(md.match(/^## Chapter 1$/gm)).toHaveLength(1);
    expect(md).toContain('> It was a bright cold day in April.');
    expect(md).toContain('- **Ravi:** Agreed');
    expect(md).toContain('Bookmark · 42%');
  });

  it('CSV escapes quotes and commas and starts with a BOM for Excel', () => {
    const csv = renderExport('csv', doc);
    expect(csv.startsWith('﻿Chapter,Page,Type')).toBe(true);
    expect(csv).toContain('"Big Brother is watching, you","Chilling, ""really"""');
  });

  it('Readwise uses its exact columns and skips bookmarks', () => {
    const rows = renderExport('readwise', doc).replace('﻿', '').trim().split('\r\n');
    expect(rows[0]).toBe('Highlight,Title,Author,URL,Note,Location,Date');
    expect(rows).toHaveLength(4); // header + 3 passages
    expect(rows[1]).toContain('2026-11-03 14:05:09');
  });

  it('Kindle clippings separate entries and keep notes apart from highlights', () => {
    const k = renderExport('kindle', doc);
    expect(k.split('==========').length - 1).toBe(6); // 3 highlights + 2 notes + 1 bookmark
    expect(k).toContain('- Your Highlight on page 3 | Location 1 | Added on Tuesday, November 3, 2026 2:05:09 PM');
    expect(k).toContain('[Ravi] Chilling');
  });

  it('HTML escapes text', () => {
    const h = renderExport('html', { ...doc, items: [item({ text: '<script>x</script>' })] });
    expect(h).toContain('&lt;script&gt;');
    expect(h).not.toContain('<script>x');
  });
});
