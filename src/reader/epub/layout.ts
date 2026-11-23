import type { ReaderTheme, Typography } from '../../lib/types';
import { HIGHLIGHT_CSS } from '../annotations/paint';
import { rangeFromCfi } from './EpubDoc';

export interface EpubLayout {
  pageW: number;
  pageH: number;
  fontSize: number; // percent
  font: Typography['font'];
  lineSpacing: Typography['lineSpacing'];
  margins: Typography['margins'];
  theme: ReaderTheme;
}

export const layoutKey = (l: EpubLayout) => `${l.pageW}x${l.pageH}:${l.fontSize}:${l.theme}:${l.font}:${l.lineSpacing}:${l.margins}`;

const FONTS: Record<Exclude<Typography['font'], 'publisher'>, string> = {
  serif: "'Literata',Georgia,'Iowan Old Style','Palatino Linotype',serif",
  sans: "system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans',sans-serif",
};
const LINE_HEIGHT = { compact: 1.35, relaxed: 1.9 } as const;
const MARGIN_SCALE = { narrow: 0.55, normal: 1, wide: 1.7 } as const;

const THEMES: Record<ReaderTheme, { bg: string; fg: string; link: string }> = {
  light: { bg: '#ffffff', fg: '#1f2328', link: '#1d4ed8' },
  sepia: { bg: '#f4ecd8', fg: '#4b3a2a', link: '#8a4b0f' },
  dark: { bg: '#1d1f24', fg: '#d8d4cc', link: '#93c5fd' },
};

export function paddings(l: EpubLayout) {
  const m = MARGIN_SCALE[l.margins] ?? 1;
  const ph = Math.round(Math.max(12, Math.min(96, l.pageW * 0.075 * m)));
  const pv = Math.round(Math.max(18, Math.min(80, l.pageH * 0.055 * Math.sqrt(m))));
  return { ph, pv };
}

/**
 * CSS that turns a chapter into horizontally-flowing columns exactly one page wide.
 * Page i of the chapter is then simply `scrollLeft = ±i * pageW` (see pageScroll).
 */
export function layoutCss(l: EpubLayout): string {
  const { pageW: W, pageH: H } = l;
  const { ph, pv } = paddings(l);
  const t = THEMES[l.theme];
  return `
html{width:${W}px!important;height:${H}px!important;max-width:none!important;overflow:hidden!important;margin:0!important;padding:0!important;font-size:${l.fontSize}%!important;background:${t.bg}!important;-webkit-text-size-adjust:none;text-size-adjust:none}
body{box-sizing:border-box!important;margin:0!important;width:${W}px!important;max-width:none!important;height:${H}px!important;min-height:0!important;padding:${pv}px ${ph}px!important;column-width:${W - 2 * ph}px!important;column-gap:${2 * ph}px!important;column-fill:auto!important;overflow:visible!important;background:transparent!important;color:${t.fg};font-family:'Literata',Georgia,'Iowan Old Style','Palatino Linotype',serif;line-height:1.6;overflow-wrap:break-word;hyphens:auto;-webkit-hyphens:auto;text-align:justify}
img,svg,video,image{max-width:100%!important;max-height:${H - 2 * pv - 4}px!important;object-fit:contain;break-inside:avoid;page-break-inside:avoid}
figure,table,pre,blockquote{max-width:100%;break-inside:avoid-column}
pre{white-space:pre-wrap}
a{color:${t.link}}
h1,h2,h3,h4{break-after:avoid;text-align:left}
::selection{background:rgba(30,90,200,.28)}
${l.theme === 'dark' ? `body *{color:${t.fg}!important;background-color:transparent!important;border-color:#444!important}a,a *{color:${t.link}!important}img{filter:brightness(.9)}` : ''}
${l.theme === 'sepia' ? `body *{background-color:transparent!important}` : ''}
${l.font !== 'publisher' ? `body,body :not(pre):not(code):not(kbd):not(samp):not(tt){font-family:${FONTS[l.font]}!important}` : ''}
${l.lineSpacing !== 'publisher' ? `body,body p,body li,body div,body span,body blockquote,body dd,body td{line-height:${LINE_HEIGHT[l.lineSpacing]}!important}` : ''}
${HIGHLIGHT_CSS}
`;
}

export function composeHtml(sectionHtml: string, l: EpubLayout): string {
  const style = `<style id="readx-layout">${layoutCss(l)}</style>`;
  const themeClass = l.theme === 'dark' ? ' class="--dark"' : '';
  // Insert our <style> last in <head> so it wins over the book's own CSS
  let html = sectionHtml.includes('</head>') ? sectionHtml.replace('</head>', `${style}</head>`) : style + sectionHtml;
  if (themeClass) html = html.replace(/<html\b/i, `<html${themeClass}`);
  return html;
}

// ---- Fixed-layout (pre-paginated) books ---------------------------------------------------------

/** Page size a fixed-layout page was designed for, from its <meta name="viewport">. */
export function fixedViewport(html: string): { w: number; h: number } | null {
  const meta = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i)?.[0];
  const content = meta?.match(/content=["']([^"']+)["']/i)?.[1] ?? '';
  const w = Number(content.match(/width\s*=\s*(\d+)/i)?.[1]);
  const h = Number(content.match(/height\s*=\s*(\d+)/i)?.[1]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Fixed-layout pages keep the publisher's styling; we only stop scrolling and add highlight CSS. */
export function composeFixedHtml(sectionHtml: string): string {
  const style = `<style id="readx-layout">html,body{margin:0!important;overflow:hidden!important}::selection{background:rgba(30,90,200,.28)}${HIGHLIGHT_CSS}</style>`;
  return sectionHtml.includes('</head>') ? sectionHtml.replace('</head>', `${style}</head>`) : style + sectionHtml;
}

/** Wait until the frame's fonts and images are ready (bounded). */
export async function settle(doc: Document, timeoutMs = 2500) {
  const imgs = Array.from(doc.images).filter((i) => !i.complete);
  const waits: Promise<unknown>[] = imgs.map((i) => i.decode().catch(() => {}));
  if (doc.fonts) waits.push(doc.fonts.ready.catch(() => {}));
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function loadFrame(iframe: HTMLIFrameElement, html: string): Promise<Document> {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      const doc = iframe.contentDocument;
      if (doc) resolve(doc);
      else reject(new Error('EPUB frame has no document'));
    };
    iframe.addEventListener('load', onLoad);
    iframe.srcdoc = html;
  });
}

export function makeFrame(l: EpubLayout): HTMLIFrameElement {
  const f = document.createElement('iframe');
  // Scripts are stripped from the markup; allow-scripts is needed so event listeners we attach
  // from the parent fire in Safari/WebKit.
  f.setAttribute('sandbox', 'allow-same-origin allow-scripts');
  f.setAttribute('scrolling', 'no');
  f.setAttribute('title', 'Book page');
  f.style.cssText = `border:0;display:block;width:${l.pageW}px;height:${l.pageH}px;background:transparent`;
  return f;
}

export function pageCountOf(doc: Document, l: EpubLayout): number {
  const w = doc.documentElement.scrollWidth;
  return Math.max(1, Math.ceil((w - 4) / l.pageW));
}

/** Right-to-left books (Arabic, Hebrew, Persian…) flow their columns from right to left. */
export function isRtl(doc: Document): boolean {
  const el = doc.body ?? doc.documentElement;
  return doc.defaultView?.getComputedStyle(el).direction === 'rtl';
}

/**
 * scrollLeft that shows page `page` of a chapter. In RTL documents the scroll origin is the right
 * edge and scrollLeft goes negative as you move to later columns.
 */
export function pageScroll(doc: Document, page: number, pageW: number): number {
  return (isRtl(doc) ? -1 : 1) * page * pageW;
}

/** Which page of the chapter a range starts on (works for LTR and RTL). */
export function pageOfRange(doc: Document, range: Range, l: EpubLayout): number {
  const rects = range.getClientRects();
  const r = rects.length ? rects[0] : range.getBoundingClientRect();
  const scrollX = doc.scrollingElement?.scrollLeft ?? 0;
  const x = (r.left + r.right) / 2 + scrollX; // document x of the range start
  const page = isRtl(doc) ? Math.floor((l.pageW - x) / l.pageW) : Math.floor(x / l.pageW);
  return Math.max(0, page);
}

/**
 * Offscreen iframe used to measure chapters (page counts, where a CFI or #fragment lands).
 * Keeps the last measured chapter loaded so repeated lookups are cheap.
 */
export class Measurer {
  private frame: HTMLIFrameElement;
  private loadedKey: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private counts = new Map<string, number>();

  constructor(private l: EpubLayout) {
    this.frame = makeFrame(l);
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.style.position = 'fixed';
    this.frame.style.left = '-100000px';
    this.frame.style.top = '0';
    this.frame.style.visibility = 'hidden';
    document.body.appendChild(this.frame);
  }

  destroy() {
    this.frame.remove();
  }

  cachedCount(spine: number) {
    return this.counts.get(`${spine}`);
  }

  /** Serialize work on the single frame. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  private async ensure(spine: number, html: () => Promise<string>): Promise<Document> {
    const key = `${spine}`;
    if (this.loadedKey === key && this.frame.contentDocument) return this.frame.contentDocument;
    const doc = await loadFrame(this.frame, composeHtml(await html(), this.l));
    await settle(doc);
    this.loadedKey = key;
    this.counts.set(key, pageCountOf(doc, this.l));
    return doc;
  }

  count(spine: number, html: () => Promise<string>): Promise<number> {
    const hit = this.counts.get(`${spine}`);
    if (hit !== undefined) return Promise.resolve(hit);
    return this.run(async () => {
      await this.ensure(spine, html);
      return this.counts.get(`${spine}`)!;
    });
  }

  pageOfCfi(spine: number, cfi: string, html: () => Promise<string>): Promise<number> {
    return this.run(async () => {
      const doc = await this.ensure(spine, html);
      const range = rangeFromCfi(cfi, doc);
      return range ? pageOfRange(doc, range, this.l) : 0;
    });
  }

  pageOfFragment(spine: number, id: string, html: () => Promise<string>): Promise<number> {
    return this.run(async () => {
      const doc = await this.ensure(spine, html);
      const el = id ? doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`) : null;
      if (!el) return 0;
      const range = doc.createRange();
      range.selectNode(el);
      return pageOfRange(doc, range, this.l);
    });
  }
}
