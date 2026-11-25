import { HIGHLIGHT_COLORS, type HighlightColor } from '../../lib/types';

/** Everything an export can contain, already in reading order. */
export type ExportKind = 'highlight' | 'note' | 'comment' | 'link' | 'bookmark';

export interface ExportItem {
  kind: ExportKind;
  /** Highlighted passage ('' for bookmarks). */
  quote: string;
  /** Note / discussion text. */
  text: string;
  /** Link annotations. */
  url: string;
  color?: HighlightColor;
  author: string;
  mine: boolean;
  chapter: string;
  /** 1-based page (PDF). */
  page?: number;
  /** 0..1 (bookmarks). */
  percent?: number;
  /** 1-based reading-order index, used as "location" by Kindle/Readwise formats. */
  order: number;
  createdAt?: Date;
  /** Opens this spot in ReadX. */
  link: string;
  replies: { author: string; text: string; createdAt?: Date }[];
}

export interface ExportDoc {
  title: string;
  author: string;
  group: string;
  /** Opens the book in ReadX. */
  bookLink: string;
  exportedAt: Date;
  /** Name who wrote each item (exports that include other people). */
  showAuthors: boolean;
  items: ExportItem[];
}

export type ExportFormat = 'md' | 'html' | 'txt' | 'csv' | 'readwise' | 'kindle' | 'anki' | 'json';

export const FORMATS: { id: ExportFormat; label: string; ext: string; mime: string; hint: string; text: boolean }[] = [
  { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown', hint: 'Obsidian, Notion, Logseq, Bear', text: true },
  { id: 'html', label: 'Web page / PDF', ext: 'html', mime: 'text/html', hint: 'Print or save as PDF; opens in Word and Google Docs', text: false },
  { id: 'txt', label: 'Plain text', ext: 'txt', mime: 'text/plain', hint: 'Email, messages, any notes app', text: true },
  { id: 'csv', label: 'Spreadsheet (CSV)', ext: 'csv', mime: 'text/csv', hint: 'Excel, Google Sheets, a Notion database', text: false },
  { id: 'readwise', label: 'Readwise', ext: 'csv', mime: 'text/csv', hint: 'Readwise → Add highlights → CSV import', text: false },
  { id: 'kindle', label: 'Kindle clippings', ext: 'txt', mime: 'text/plain', hint: '“My Clippings.txt” format for Kindle tools', text: false },
  { id: 'anki', label: 'Anki flashcards', ext: 'txt', mime: 'text/tab-separated-values', hint: 'Passage on the front, your note on the back', text: false },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json', hint: 'Complete data, for backups and scripts', text: false },
];

const KIND_LABEL: Record<ExportKind, string> = { highlight: 'Highlight', note: 'Note', comment: 'Discussion', link: 'Link', bookmark: 'Bookmark' };

const day = (d?: Date) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const pad = (n: number) => String(n).padStart(2, '0');
const isoish = (d?: Date) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '';

function place(it: ExportItem): string {
  if (it.page) return `Page ${it.page}`;
  if (it.percent !== undefined) return `${Math.round(it.percent * 100)}%`;
  return '';
}

function meta(it: ExportItem, doc: ExportDoc): string {
  return [KIND_LABEL[it.kind], place(it), doc.showAuthors ? it.author : '', day(it.createdAt)].filter(Boolean).join(' · ');
}

/** Consecutive items under the same chapter. */
function byChapter(items: ExportItem[]): { chapter: string; items: ExportItem[] }[] {
  const out: { chapter: string; items: ExportItem[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.chapter === it.chapter) last.items.push(it);
    else out.push({ chapter: it.chapter, items: [it] });
  }
  return out;
}

const countLine = (doc: ExportDoc) => `${doc.items.length} item${doc.items.length === 1 ? '' : 's'}`;

// ---- Markdown ---------------------------------------------------------------------------------------

function markdown(doc: ExportDoc): string {
  const L: string[] = [`# ${doc.title}`];
  if (doc.author) L.push('', `*${doc.author}*`);
  L.push('', `Exported from [ReadX](${doc.bookLink})${doc.group ? ` (${doc.group})` : ''} on ${day(doc.exportedAt)} · ${countLine(doc)}`);
  for (const sec of byChapter(doc.items)) {
    if (sec.chapter) L.push('', `## ${sec.chapter}`);
    for (const it of sec.items) {
      L.push('');
      if (it.quote) L.push(...it.quote.split('\n').map((l) => `> ${l}`), '');
      if (it.text) L.push(it.text, '');
      if (it.url) L.push(`<${it.url}>`, '');
      for (const r of it.replies) L.push(`- **${r.author}:** ${r.text.replace(/\n/g, ' ')}`);
      if (it.replies.length) L.push('');
      L.push(`*${meta(it, doc)}* · [Open in ReadX](${it.link})`);
    }
  }
  return L.join('\n') + '\n';
}

// ---- Plain text -------------------------------------------------------------------------------------

function plain(doc: ExportDoc): string {
  const L: string[] = [doc.title.toUpperCase()];
  if (doc.author) L.push(`by ${doc.author}`);
  L.push(`Exported from ReadX on ${day(doc.exportedAt)} · ${countLine(doc)}`);
  for (const sec of byChapter(doc.items)) {
    if (sec.chapter) L.push('', `== ${sec.chapter} ==`);
    for (const it of sec.items) {
      L.push('');
      if (it.quote) L.push(`“${it.quote}”`);
      if (it.text) L.push(`  ${it.kind === 'comment' ? 'Discussion' : 'Note'}: ${it.text}`);
      if (it.url) L.push(`  Link: ${it.url}`);
      for (const r of it.replies) L.push(`    ${r.author}: ${r.text}`);
      L.push(`  — ${meta(it, doc)}`);
    }
  }
  return L.join('\n') + '\n';
}

// ---- HTML (print / PDF / Word / Google Docs) ------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const multiline = (s: string) => esc(s).replace(/\n/g, '<br>');

function html(doc: ExportDoc): string {
  const body: string[] = [];
  for (const sec of byChapter(doc.items)) {
    if (sec.chapter) body.push(`<h2>${esc(sec.chapter)}</h2>`);
    for (const it of sec.items) {
      const bg = it.kind !== 'link' && it.color ? HIGHLIGHT_COLORS[it.color] : 'transparent';
      body.push('<div class="item">');
      if (it.quote) body.push(`<blockquote style="background:${bg}">${multiline(it.quote)}</blockquote>`);
      if (it.text) body.push(`<p>${multiline(it.text)}</p>`);
      if (it.url) body.push(`<p><a href="${esc(it.url)}">${esc(it.url)}</a></p>`);
      if (it.replies.length)
        body.push(`<ul>${it.replies.map((r) => `<li><b>${esc(r.author)}:</b> ${multiline(r.text)}</li>`).join('')}</ul>`);
      body.push(`<p class="meta">${esc(meta(it, doc))} · <a href="${esc(it.link)}">Open in ReadX</a></p>`, '</div>');
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)} — highlights &amp; notes</title>
<style>
body{font-family:Georgia,'Iowan Old Style',serif;color:#1f2328;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.55}
h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd}
.sub{color:#666;margin:0 0 4px}.item{margin:18px 0;break-inside:avoid}
blockquote{margin:0;padding:8px 12px;border-left:3px solid #c9a227;border-radius:4px;font-style:italic}
p{margin:6px 0}ul{margin:6px 0 6px 18px;padding:0}.meta{font:12px system-ui,sans-serif;color:#777}a{color:#15639e}
@media print{body{margin:0}a{color:inherit;text-decoration:none}}
</style></head><body>
<h1>${esc(doc.title)}</h1>
${doc.author ? `<p class="sub">${esc(doc.author)}</p>` : ''}
<p class="meta">Exported from ReadX${doc.group ? ` (${esc(doc.group)})` : ''} on ${esc(day(doc.exportedAt))} · ${countLine(doc)}</p>
${body.join('\n')}
</body></html>
`;
}

// ---- CSV ----------------------------------------------------------------------------------------------

const cell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRows = (rows: (string | number | undefined)[][]) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const repliesText = (it: ExportItem) => it.replies.map((r) => `${r.author}: ${r.text}`).join('\n');

function csv(doc: ExportDoc): string {
  return csvRows([
    ['Chapter', 'Page', 'Type', 'Color', 'Passage', 'Note', 'URL', 'Author', 'Date', 'Replies', 'Open in ReadX'],
    ...doc.items.map((it) => [
      it.chapter,
      it.page ?? (it.percent !== undefined ? `${Math.round(it.percent * 100)}%` : ''),
      KIND_LABEL[it.kind],
      it.color ?? '',
      it.quote,
      it.text,
      it.url,
      it.author,
      isoish(it.createdAt),
      repliesText(it),
      it.link,
    ]),
  ]);
}

/** https://readwise.io/import_bulk: Highlight, Title, Author, URL, Note, Location, Date. */
function readwise(doc: ExportDoc): string {
  return csvRows([
    ['Highlight', 'Title', 'Author', 'URL', 'Note', 'Location', 'Date'],
    ...doc.items
      .filter((it) => it.quote)
      .map((it) => {
        const note = [doc.showAuthors && !it.mine ? `[${it.author}]` : '', it.text, it.url, repliesText(it)].filter(Boolean).join('\n');
        return [it.quote, doc.title, doc.author, doc.bookLink, note, it.page ?? it.order, isoish(it.createdAt)];
      }),
  ]);
}

// ---- Kindle "My Clippings.txt" ---------------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function kindleDate(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

function kindle(doc: ExportDoc): string {
  const head = doc.author ? `${doc.title} (${doc.author})` : doc.title;
  const out: string[] = [];
  const entry = (what: string, it: ExportItem, body: string) => {
    const where = it.page ? `on page ${it.page} | Location ${it.order}` : `at location ${it.order}`;
    out.push(`${head}\r\n- Your ${what} ${where} | Added on ${kindleDate(it.createdAt ?? doc.exportedAt)}\r\n\r\n${body}\r\n==========\r\n`);
  };
  for (const it of doc.items) {
    const by = doc.showAuthors && !it.mine ? `[${it.author}] ` : '';
    if (it.kind === 'bookmark') entry('Bookmark', it, '');
    else {
      if (it.quote) entry('Highlight', it, it.quote.replace(/\s*\n\s*/g, ' '));
      const note = [it.text, it.url, repliesText(it)].filter(Boolean).join(' / ');
      if (note) entry('Note', it, by + note.replace(/\s*\n\s*/g, ' '));
    }
  }
  return '﻿' + out.join('');
}

// ---- Anki ---------------------------------------------------------------------------------------------------

function anki(doc: ExportDoc): string {
  const field = (s: string) => esc(s).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const tag = `ReadX ${doc.title.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')}`;
  const rows = doc.items
    .filter((it) => it.quote)
    .map((it) => {
      const back = [it.text && field(it.text), `<small>${field([doc.title, it.chapter, place(it)].filter(Boolean).join(' · '))}</small>`]
        .filter(Boolean)
        .join('<br><br>');
      return `${field(it.quote)}\t${back}\t${tag}`;
    });
  return ['#separator:tab', '#html:true', '#tags column:3', ...rows].join('\n') + '\n';
}

// ---- JSON ---------------------------------------------------------------------------------------------------

function json(doc: ExportDoc): string {
  return (
    JSON.stringify(
      {
        app: 'ReadX',
        version: 1,
        exportedAt: doc.exportedAt.toISOString(),
        book: { title: doc.title, author: doc.author, group: doc.group, link: doc.bookLink },
        items: doc.items.map((it) => ({
          ...it,
          createdAt: it.createdAt?.toISOString(),
          replies: it.replies.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString() })),
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

export function renderExport(format: ExportFormat, doc: ExportDoc): string {
  switch (format) {
    case 'md':
      return markdown(doc);
    case 'html':
      return html(doc);
    case 'txt':
      return plain(doc);
    case 'csv':
      return csv(doc);
    case 'readwise':
      return readwise(doc);
    case 'kindle':
      return kindle(doc);
    case 'anki':
      return anki(doc);
    case 'json':
      return json(doc);
  }
}
