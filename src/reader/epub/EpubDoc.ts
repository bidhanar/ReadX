import ePub, { EpubCFI, type Book } from 'epubjs';
import type Section from 'epubjs/types/section';
import type { NavItem } from 'epubjs/types/navigation';
import type { TocItem, SearchHit } from '../engine';

export interface SpineEntry {
  index: number;
  href: string;
  cfiBase: string;
  linear: boolean;
}

/**
 * Thin wrapper over epub.js used purely as an EPUB parser / CFI toolkit. Rendering and
 * pagination are done by our own code (see EpubView) so pages can be fed to the page-curl engine.
 */
export class EpubDoc {
  readonly book: Book;
  spine: SpineEntry[] = [];
  toc: TocItem[] = [];
  /** Character length of each section's text, for progress estimation. */
  weights: number[] = [];
  /** Book-level page-progression-direction="rtl". */
  rtl = false;
  /** rendition:layout = pre-paginated (comics, picture books). */
  fixedLayout = false;
  private htmlCache = new Map<number, Promise<string>>();
  private tocBySpine = new Map<number, string>();
  /** Every TOC entry that points into a spine item, in reading order (fragment '' = start). */
  readonly tocInSpine = new Map<number, { label: string; fragment: string }[]>();

  private constructor(book: Book) {
    this.book = book;
  }

  static async open(data: ArrayBuffer): Promise<EpubDoc> {
    const book = ePub(data.slice(0) as unknown as string);
    await book.opened;
    const doc = new EpubDoc(book);
    const meta = (book as unknown as { packaging: { metadata: { direction?: string; layout?: string } } }).packaging.metadata;
    doc.rtl = meta.direction === 'rtl';
    doc.fixedLayout = meta.layout === 'pre-paginated';
    const spine = book.spine as unknown as { length: number; get(i: number): Section };
    for (let i = 0; i < spine.length; i++) {
      const s = spine.get(i);
      if (s) doc.spine.push({ index: s.index, href: s.href, cfiBase: s.cfiBase, linear: s.linear !== false });
    }
    doc.weights = doc.spine.map(() => 1);
    const nav = await book.loaded.navigation;
    const walk = (items: NavItem[], level: number) => {
      for (const it of items) {
        const sec = doc.sectionForHref(it.href);
        if (sec) {
          doc.toc.push({ label: it.label.trim(), location: `href:${it.href}`, level });
          if (!doc.tocBySpine.has(sec.index)) doc.tocBySpine.set(sec.index, it.label.trim());
          const list = doc.tocInSpine.get(sec.index) ?? [];
          list.push({ label: it.label.trim(), fragment: decodeURIComponent(it.href.split('#')[1] ?? '') });
          doc.tocInSpine.set(sec.index, list);
        }
        if (it.subitems?.length) walk(it.subitems, level + 1);
      }
    };
    walk(nav.toc, 0);
    return doc;
  }

  destroy() {
    this.book.destroy();
  }

  get length() {
    return this.spine.length;
  }

  /** Nearest TOC label at or before a spine index ("Chapter 3"). */
  chapterLabel(spineIndex: number): string {
    for (let i = spineIndex; i >= 0; i--) {
      const label = this.tocBySpine.get(i);
      if (label) return label;
    }
    return '';
  }

  sectionForHref(href: string): SpineEntry | null {
    const path = decodeURIComponent(href.split('#')[0]);
    const s = this.book.spine.get(path) as Section | null;
    if (s) return this.spine[s.index] ?? null;
    // Fall back to suffix matching (TOC hrefs are sometimes relative to a different folder)
    const tail = path.split('/').pop();
    return this.spine.find((e) => decodeURIComponent(e.href).split('/').pop() === tail) ?? null;
  }

  /** Resolve a link found inside section `fromIndex` to [spineIndex, fragment]. */
  resolveLink(fromIndex: number, href: string): { spine: number; fragment: string } | null {
    const from = this.spine[fromIndex];
    if (!from) return null;
    const url = new URL(href, `https://epub.invalid/${from.href}`);
    if (url.host !== 'epub.invalid') return null;
    const target = this.sectionForHref(url.pathname.slice(1));
    return target ? { spine: target.index, fragment: url.hash.slice(1) } : null;
  }

  /**
   * Section markup ready to drop into an iframe: resources already point to blob: URLs, scripts
   * and inline handlers stripped. The reader's layout <style> is appended separately.
   */
  sectionHtml(index: number): Promise<string> {
    let p = this.htmlCache.get(index);
    if (!p) {
      p = (async () => {
        const section = this.book.spine.get(index) as Section;
        const raw = (await (section.render(this.book.load.bind(this.book)) as unknown as Promise<string>)) || '';
        const parsed = new DOMParser().parseFromString(raw, 'text/html');
        parsed.querySelectorAll('script, iframe, object, embed').forEach((n) => n.remove());
        parsed.querySelectorAll('*').forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
          }
        });
        this.weights[index] = Math.max(200, (parsed.body?.textContent ?? '').length);
        return '<!DOCTYPE html>' + parsed.documentElement.outerHTML;
      })();
      this.htmlCache.set(index, p);
    }
    return p;
  }

  /** Load every section's text in the background so progress percentages are accurate. */
  async computeWeights(signal: AbortSignal) {
    for (let i = 0; i < this.spine.length && !signal.aborted; i++) {
      await this.sectionHtml(i).catch(() => '');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  percentAt(spineIndex: number, fractionInSection: number): number {
    const total = this.weights.reduce((a, b) => a + b, 0) || 1;
    let before = 0;
    for (let i = 0; i < spineIndex; i++) before += this.weights[i];
    return Math.min(1, (before + this.weights[spineIndex] * fractionInSection) / total);
  }

  async search(query: string, signal: AbortSignal, onHit: (h: SearchHit) => void) {
    const q = query.toLowerCase();
    let count = 0;
    for (const entry of this.spine) {
      if (signal.aborted || count >= 300) return;
      const section = this.book.spine.get(entry.index) as unknown as Omit<Section, 'find'> & {
        find(q: string): { cfi: string; excerpt: string }[];
      };
      try {
        await (section.load(this.book.load.bind(this.book)) as unknown as Promise<Document>);
        const results = section.find(q).slice(0, 30);
        for (const r of results) {
          onHit({
            location: r.cfi,
            excerpt: r.excerpt.replace(/\s+/g, ' ').trim(),
            label: this.chapterLabel(entry.index) || `Section ${entry.index + 1}`,
          });
          count++;
        }
      } catch {
        /* unreadable section */
      } finally {
        section.unload();
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

export function cfiSpineIndex(cfi: string): number | null {
  try {
    return new EpubCFI(cfi).spinePos;
  } catch {
    return null;
  }
}

export function cfiFromRange(range: Range, cfiBase: string): string | null {
  try {
    return new EpubCFI(range, cfiBase, 'hl-layer').toString();
  } catch {
    return null;
  }
}

export function rangeFromCfi(cfi: string, doc: Document): Range | null {
  try {
    return new EpubCFI(cfi).toRange(doc, 'hl-layer') ?? null;
  } catch {
    return null;
  }
}
