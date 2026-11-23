import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Anchor } from '../../lib/types';
import { Pager } from '../Pager';
import { mergeLineRects } from '../geometry';
import { flashBoxes, hitTestBoxes, paintAnnotation } from '../annotations/paint';
import { findTextRanges, paintSearchBoxes } from '../annotations/searchMarks';
import type { EngineHandle, EngineProps } from '../engine';
import { EpubDoc, cfiFromRange, cfiSpineIndex, rangeFromCfi } from './EpubDoc';
import {
  Measurer,
  composeFixedHtml,
  composeHtml,
  fixedViewport,
  isRtl,
  layoutKey,
  makeFrame,
  pageScroll,
  type EpubLayout,
} from './layout';
import { fitPages } from '../Pager';

/** One page slot in the current window. `blank` pads spreads so chapters start on a left page. */
interface Entry {
  spine: number;
  page: number;
  count: number;
  blank?: boolean;
}

interface Win {
  /** Spine index the window is built around; -1 for fixed-layout books (one window, whole book). */
  center: number;
  fixed?: boolean;
  entries: Entry[];
  pager: Pager;
  host: HTMLDivElement;
  key: string;
  frames: Map<number, { iframe: HTMLIFrameElement; doc: Document; entry: Entry }>;
}

const SELECTION_DEBOUNCE = 220;

export const EpubView = forwardRef<EngineHandle, EngineProps>(function EpubView(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [epub, setEpub] = useState<EpubDoc | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const winRef = useRef<Win | null>(null);
  const layoutRef = useRef<EpubLayout | null>(null);
  const spreadRef = useRef(false);
  const measurerRef = useRef<Measurer | null>(null);
  /** Last known reading position (CFI); survives relayouts. */
  const cfiRef = useRef<string | null>(props.initialLocation?.startsWith('epubcfi(') ? props.initialLocation : null);
  const pendingHref = useRef<string | null>(props.initialLocation?.startsWith('href:') ? props.initialLocation.slice(5) : null);
  const genRef = useRef(0);
  /** Page where each TOC entry starts, per chapter and layout: `${layoutKey}|${spine}` → sorted list. */
  const tocPages = useRef(new Map<string, { page: number; label: string }[]>());
  /** Page count of every chapter at the current layout, filled in the background. */
  const countsRef = useRef<{ key: string; counts: number[]; done: boolean } | null>(null);

  // ---- Open the EPUB -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let opened: EpubDoc | null = null;
    const ac = new AbortController();
    EpubDoc.open(props.data)
      .then((d) => {
        if (cancelled) return d.destroy();
        opened = d;
        setEpub(d);
        propsRef.current.onReady(d.toc, { rtl: d.rtl });
        d.computeWeights(ac.signal);
      })
      .catch((e) => !cancelled && propsRef.current.onError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
      ac.abort();
      opened?.destroy();
    };
  }, [props.data]);

  // ---- Size --------------------------------------------------------------------------------
  useEffect(() => {
    const el = hostRef.current!;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(([entry]) => {
      clearTimeout(t);
      t = setTimeout(() => {
        const { width, height } = entry.contentRect;
        setSize((s) => (s && Math.abs(s.w - width) < 2 && Math.abs(s.h - height) < 2 ? s : { w: width, h: height }));
      }, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  // ---- (Re)layout: new measurer, rebuild window at the current position ----------------------
  const { theme, flipMode } = props;
  const { fontSize, font, lineSpacing, margins } = props.typography;
  useEffect(() => {
    if (!epub || !size) return;
    const { w, h } = size;
    if (epub.fixedLayout) {
      const gen = ++genRef.current;
      (async () => {
        const first = Math.max(0, epub.spine.findIndex((s) => s.linear));
        const vp = fixedViewport(await epub.sectionHtml(first));
        const fit = fitPages(w, h, vp ? vp.w / vp.h : 0.75, flipMode !== 'scroll');
        layoutRef.current = { pageW: fit.pageW, pageH: fit.pageH, fontSize, theme, font, lineSpacing, margins };
        spreadRef.current = fit.spread;
        let start = first;
        const s = cfiRef.current ? cfiSpineIndex(cfiRef.current) : null;
        if (s !== null && s >= 0 && s < epub.length) start = s;
        if (pendingHref.current) {
          start = epub.sectionForHref(pendingHref.current.slice(0))?.index ?? start;
          pendingHref.current = null;
        }
        if (gen === genRef.current) await showFixed(epub, start, false);
      })().catch((e) => propsRef.current.onError(e instanceof Error ? e : new Error(String(e))));
      return () => {
        genRef.current++;
      };
    }
    const spread = flipMode !== 'scroll' && w >= 900 && w / h > 1.15;
    const pad = w < 640 ? 0 : 16;
    const availW = w - pad * 2;
    const pageH = Math.floor(h - pad * 2);
    const pageW = Math.floor(spread ? Math.min(availW / 2, pageH * 0.75) : Math.min(availW, Math.max(pageH * 0.8, Math.min(availW, 560))));
    const layout: EpubLayout = { pageW, pageH, fontSize, theme, font, lineSpacing, margins };
    layoutRef.current = layout;
    spreadRef.current = spread;
    measurerRef.current?.destroy();
    const measurer = new Measurer(layout);
    measurerRef.current = measurer;
    const gen = ++genRef.current;

    (async () => {
      let spine = epub.spine.findIndex((s) => s.linear);
      if (spine < 0) spine = 0;
      let page = 0;
      const html = (i: number) => () => epub.sectionHtml(i);
      try {
        if (pendingHref.current) {
          const href = pendingHref.current;
          pendingHref.current = null;
          const sec = epub.sectionForHref(href);
          if (sec) {
            spine = sec.index;
            page = await measurer.pageOfFragment(spine, href.split('#')[1] ?? '', html(spine));
          }
        } else if (cfiRef.current) {
          const s = cfiSpineIndex(cfiRef.current);
          if (s !== null && s >= 0 && s < epub.length) {
            spine = s;
            page = await measurer.pageOfCfi(s, cfiRef.current, html(s));
          }
        }
      } catch (e) {
        console.warn('could not restore position', e);
      }
      if (gen !== genRef.current) return;
      await showAt(epub, spine, page, spread, false);
    })().catch((e) => propsRef.current.onError(e instanceof Error ? e : new Error(String(e))));

    return () => {
      genRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epub, size, theme, fontSize, font, lineSpacing, margins, flipMode]);

  // Tear down on unmount
  useEffect(
    () => () => {
      destroyWin(winRef.current);
      winRef.current = null;
      measurerRef.current?.destroy();
    },
    [],
  );

  // ---- Repaint highlights when annotations change --------------------------------------------
  useEffect(() => {
    const win = winRef.current;
    if (!win) return;
    for (const f of win.frames.values()) paintFrame(f.doc, f.entry.spine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, props.authorColors, props.searchMark]);

  // ---- Window building -----------------------------------------------------------------------

  /** Build a window centred on `spine` and show `page` of it. Swaps in without a blank flash. */
  async function showAt(d: EpubDoc, spine: number, page: number, spread: boolean, animate: boolean) {
    const layout = layoutRef.current!;
    const measurer = measurerRef.current!;
    const gen = genRef.current;
    const html = (i: number) => () => d.sectionHtml(i);
    const has = (i: number) => i >= 0 && i < d.length;

    const [prevCount, curCount, nextCount] = await Promise.all([
      has(spine - 1) ? measurer.count(spine - 1, html(spine - 1)) : Promise.resolve(0),
      measurer.count(spine, html(spine)),
      has(spine + 1) ? measurer.count(spine + 1, html(spine + 1)) : Promise.resolve(0),
    ]);
    if (gen !== genRef.current) return;
    page = Math.max(0, Math.min(page, curCount - 1));

    // Same chapter already showing → just turn the page
    const existing = winRef.current;
    if (existing && existing.center === spine && sameLayout(existing)) {
      const idx = existing.entries.findIndex((e) => !e.blank && e.spine === spine && e.page === page);
      if (idx >= 0) {
        existing.pager.goTo(idx, animate);
        return;
      }
    }

    const entries: Entry[] = [];
    if (prevCount > 0) {
      const tail = Math.min(2, prevCount);
      if (spread && tail < 2) entries.push({ spine: spine - 1, page: 0, count: prevCount, blank: true });
      for (let p = prevCount - tail; p < prevCount; p++) entries.push({ spine: spine - 1, page: p, count: prevCount });
    }
    const offset = entries.length;
    for (let p = 0; p < curCount; p++) entries.push({ spine, page: p, count: curCount });
    if (spread && curCount % 2 === 1 && nextCount > 0) entries.push({ spine, page: curCount, count: curCount, blank: true });
    for (let p = 0; p < Math.min(2, nextCount); p++) entries.push({ spine: spine + 1, page: p, count: nextCount });

    const host = document.createElement('div');
    host.className = 'absolute inset-0 flex items-center justify-center';
    host.style.visibility = 'hidden';
    hostRef.current!.appendChild(host);

    const frames: Win['frames'] = new Map();
    const ready = new Map<number, Promise<void>>();
    const win: Win = { center: spine, entries, host, frames, key: windowKey(), pager: null as unknown as Pager };

    win.pager = new Pager({
      container: host,
      count: entries.length,
      pageW: layout.pageW,
      pageH: layout.pageH,
      spread,
      showCover: false,
      mode: propsRef.current.flipMode === 'scroll' ? 'slide' : propsRef.current.flipMode,
      start: offset + page,
      pageClass: `--${layout.theme}`,
      window: 2,
      rtl: d.rtl,
      mount: (i, el) => {
        const entry = entries[i];
        if (entry.blank) return;
        ready.set(i, mountPage(d, win, i, el, entry, layout));
      },
      unmount: (i, el) => {
        frames.delete(i);
        el.querySelector('iframe')?.dispatchEvent(new Event('readx-unmount'));
        el.replaceChildren();
      },
      onChange: (i) => onPageChange(d, win, i, spread),
      onTap: (z) => propsRef.current.onTap(z),
      onClone: (clone, i) => {
        const entry = entries[i];
        const f = clone.querySelector('iframe');
        if (!f || !entry) return;
        f.addEventListener('load', () => {
          const cd = f.contentDocument;
          if (cd?.scrollingElement) cd.scrollingElement.scrollLeft = pageScroll(cd, entry.page, layout.pageW);
        });
      },
    });

    // Wait for the visible pages to render (bounded), then swap windows
    const visible = win.pager.visible();
    await Promise.race([
      Promise.all(visible.map((i) => ready.get(i) ?? Promise.resolve())),
      new Promise((r) => setTimeout(r, 900)),
    ]);
    if (gen !== genRef.current) {
      destroyWin(win);
      return;
    }
    const old = winRef.current;
    winRef.current = win;
    host.style.visibility = 'visible';
    destroyWin(old);
    reportLocation(d, win);
    countAllPages(d);
  }

  /**
   * Measure every chapter at the current layout (in the background, one at a time) so the reader
   * can show whole-book page numbers and the progress bar can seek precisely.
   */
  async function countAllPages(d: EpubDoc) {
    const measurer = measurerRef.current;
    const key = layoutKey(layoutRef.current!);
    if (!measurer || countsRef.current?.key === key) return;
    const state = { key, counts: new Array<number>(d.length).fill(0), done: false };
    countsRef.current = state;
    for (let i = 0; i < d.length; i++) {
      if (measurerRef.current !== measurer || countsRef.current !== state) return; // layout changed
      state.counts[i] = await measurer.count(i, () => d.sectionHtml(i)).catch(() => 1);
      await new Promise((r) => setTimeout(r, 0));
    }
    state.done = true;
    if (winRef.current && !winRef.current.fixed) reportLocation(d, winRef.current);
  }

  /** Whole-book page numbers, once every chapter has been counted at this layout. */
  function bookPages(): { counts: number[]; total: number } | null {
    const c = countsRef.current;
    if (!c?.done || c.key !== layoutKey(layoutRef.current!)) return null;
    return { counts: c.counts, total: c.counts.reduce((a, b) => a + b, 0) || 1 };
  }

  /** Spine + page for a fraction of the book (exact once counted, estimated from text length before). */
  async function locateFraction(d: EpubDoc, f: number): Promise<{ spine: number; page: number }> {
    f = Math.min(1, Math.max(0, f));
    const bp = bookPages();
    if (bp) {
      let g = Math.round(f * (bp.total - 1));
      for (let i = 0; i < bp.counts.length; i++) {
        if (g < bp.counts[i]) return { spine: i, page: g };
        g -= bp.counts[i];
      }
      return { spine: d.length - 1, page: Math.max(0, bp.counts[d.length - 1] - 1) };
    }
    const total = d.weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    for (let i = 0; i < d.length; i++) {
      const w = d.weights[i] / total;
      if (f <= acc + w || i === d.length - 1) {
        const within = w > 0 ? (f - acc) / w : 0;
        const count = (await measurerRef.current?.count(i, () => d.sectionHtml(i))) ?? 1;
        return { spine: i, page: Math.min(count - 1, Math.floor(within * count)) };
      }
      acc += w;
    }
    return { spine: 0, page: 0 };
  }

  /** Everything that requires rebuilding the page window (not just turning to another page). */
  function windowKey() {
    return `${layoutKey(layoutRef.current!)}|${propsRef.current.flipMode}|${spreadRef.current}`;
  }

  function sameLayout(win: Win) {
    return win.key === windowKey();
  }

  function onPageChange(d: EpubDoc, win: Win, i: number, spread: boolean) {
    if (winRef.current !== win) return;
    const entry = win.entries[i];
    if (!entry) return;
    if (!win.fixed && entry.spine !== win.center) {
      // Flipped into a neighbouring chapter's preview pages → recentre on that chapter
      const page = entry.blank ? 0 : entry.page;
      setTimeout(() => showAt(d, entry.spine, page, spread, false), 30);
      return;
    }
    reportLocation(d, win);
  }

  function reportLocation(d: EpubDoc, win: Win) {
    // Label by the first page of the visible spread, however the spread was reached
    const i = win.pager.visible()[0] ?? win.pager.current;
    let entry = win.entries[i];
    if (entry?.blank) entry = win.entries[i + 1] ?? win.entries[i - 1];
    if (!entry || entry.blank) return;
    const f = win.frames.get(win.entries.indexOf(entry));
    if (win.fixed) {
      const n = win.entries.length;
      const lastVisible = Math.max(...win.pager.visible());
      // Fixed pages may have no text (art only): fall back to the page's own body
      const cfi = (f && cfiAtPageStart(f.doc, d.spine[entry.spine].cfiBase)) || `epubcfi(${d.spine[entry.spine].cfiBase}!/4)`;
      cfiRef.current = cfi;
      const toc = d.chapterLabel(entry.spine);
      propsRef.current.onLocation({
        location: cfi,
        percent: n > 1 ? lastVisible / (n - 1) : 1,
        label: `${toc ? toc + ' · ' : ''}Page ${win.pager.current + 1} of ${n}`,
      });
      return;
    }
    const cfi = f ? cfiAtPageStart(f.doc, d.spine[entry.spine].cfiBase) : null;
    if (cfi) cfiRef.current = cfi;
    const chapter = labelFor(d, entry.spine, entry.page);
    const last = win.pager.visible().map((v) => win.entries[v]).filter((e) => e && !e.blank && e.spine === entry!.spine).pop() ?? entry;
    const bp = bookPages();
    const before = bp ? bp.counts.slice(0, entry.spine).reduce((a, b) => a + b, 0) : 0;
    propsRef.current.onLocation({
      location: cfi ?? cfiRef.current ?? `href:${d.spine[entry.spine].href}`,
      percent: bp ? (before + last.page + 1) / bp.total : d.percentAt(entry.spine, (last.page + 1) / entry.count),
      label: bp ? `${chapter} · ${before + entry.page + 1} of ${bp.total}` : `${chapter} · ${entry.page + 1} of ${entry.count}`,
    });
  }

  /**
   * Nearest TOC entry at or before this page. Books often put several chapters in one file (e.g.
   * a poem's parts), so the file's first TOC label isn't enough. TOC entry pages are measured in
   * the background the first time a chapter is shown.
   */
  function labelFor(d: EpubDoc, spine: number, page: number): string {
    const key = `${layoutKey(layoutRef.current!)}|${spine}`;
    const known = tocPages.current.get(key);
    if (known) {
      const hit = known.filter((t) => t.page <= page).pop();
      if (hit) return hit.label;
    } else {
      const entries = d.tocInSpine.get(spine) ?? [];
      const measurer = measurerRef.current;
      if (entries.some((e) => e.fragment) && measurer) {
        tocPages.current.set(key, []); // mark as in progress
        Promise.all(
          entries.map(async (e) => ({
            label: e.label,
            page: e.fragment ? await measurer.pageOfFragment(spine, e.fragment, () => d.sectionHtml(spine)) : 0,
          })),
        )
          .then((list) => {
            tocPages.current.set(key, list.sort((a, b) => a.page - b.page));
            if (winRef.current) reportLocation(d, winRef.current); // refresh the label
          })
          .catch(() => tocPages.current.delete(key));
      }
    }
    return d.chapterLabel(spine) || `Section ${spine + 1}`;
  }

  /** Fixed-layout books: one page per spine item, one window for the whole book. */
  async function showFixed(d: EpubDoc, start: number, animate: boolean) {
    const layout = layoutRef.current!;
    const spread = spreadRef.current;
    const gen = genRef.current;
    const existing = winRef.current;
    if (existing?.fixed && existing.key === windowKey()) return existing.pager.goTo(start, animate);

    const entries: Entry[] = d.spine.map((_, i) => ({ spine: i, page: 0, count: 1 }));
    const host = document.createElement('div');
    host.className = 'absolute inset-0 flex items-center justify-center';
    host.style.visibility = 'hidden';
    hostRef.current!.appendChild(host);
    const frames: Win['frames'] = new Map();
    const ready = new Map<number, Promise<void>>();
    const win: Win = { center: -1, fixed: true, entries, host, frames, key: windowKey(), pager: null as unknown as Pager };
    win.pager = new Pager({
      container: host,
      count: entries.length,
      pageW: layout.pageW,
      pageH: layout.pageH,
      spread,
      showCover: true,
      mode: propsRef.current.flipMode === 'scroll' ? 'slide' : propsRef.current.flipMode,
      start,
      pageClass: `--${layout.theme}`,
      window: 2,
      rtl: d.rtl,
      mount: (i, el) => ready.set(i, mountFixedPage(d, win, i, el, entries[i], layout)),
      unmount: (i, el) => {
        frames.delete(i);
        el.querySelector('iframe')?.dispatchEvent(new Event('readx-unmount'));
        el.replaceChildren();
      },
      onChange: () => winRef.current === win && reportLocation(d, win),
      onTap: (z) => propsRef.current.onTap(z),
    });
    await Promise.race([
      Promise.all(win.pager.visible().map((i) => ready.get(i) ?? Promise.resolve())),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    if (gen !== genRef.current) return destroyWin(win);
    const old = winRef.current;
    winRef.current = win;
    host.style.visibility = 'visible';
    destroyWin(old);
    reportLocation(d, win);
  }

  async function mountFixedPage(d: EpubDoc, win: Win, i: number, el: HTMLElement, entry: Entry, layout: EpubLayout) {
    const html = composeFixedHtml(await d.sectionHtml(entry.spine));
    const vp = fixedViewport(html) ?? { w: layout.pageW, h: layout.pageH };
    const k = Math.min(layout.pageW / vp.w, layout.pageH / vp.h);
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;overflow:hidden;left:${(layout.pageW - vp.w * k) / 2}px;top:${(layout.pageH - vp.h * k) / 2}px;width:${vp.w * k}px;height:${vp.h * k}px`;
    const iframe = makeFrame({ ...layout, pageW: vp.w, pageH: vp.h });
    iframe.style.transformOrigin = '0 0';
    iframe.style.transform = `scale(${k})`;
    box.appendChild(iframe);
    if (d.rtl) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;inset:0;transform:scaleX(-1)';
      wrap.appendChild(box);
      el.replaceChildren(wrap);
    } else el.replaceChildren(box);
    await new Promise<void>((resolve) => {
      iframe.addEventListener(
        'load',
        () => {
          const doc = iframe.contentDocument;
          if (doc && iframe.isConnected) {
            setupFrame(d, win, i, iframe, doc, entry, layout);
            if (winRef.current === win && win.pager.visible().includes(i)) reportLocation(d, win);
          }
          resolve();
        },
        { once: true },
      );
      iframe.srcdoc = html;
    });
  }

  // ---- Page frames ---------------------------------------------------------------------------

  async function mountPage(d: EpubDoc, win: Win, i: number, el: HTMLElement, entry: Entry, layout: EpubLayout) {
    const iframe = makeFrame(layout);
    if (d.rtl) {
      // The Pager mirrors RTL books; mirror the page back so its text reads normally
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:100%;height:100%;transform:scaleX(-1)';
      wrap.appendChild(iframe);
      el.replaceChildren(wrap);
    } else el.replaceChildren(iframe);
    // Thin edge strips stay outside the iframe so the page-curl engine can catch corner drags
    for (const side of d.rtl ? [] : (['left', 'right'] as const)) {
      const strip = document.createElement('div');
      strip.style.cssText = `position:absolute;top:0;bottom:0;${side}:0;width:22px;z-index:4`;
      el.appendChild(strip);
    }
    const html = composeHtml(await d.sectionHtml(entry.spine), layout);
    await new Promise<void>((resolve) => {
      iframe.addEventListener(
        'load',
        () => {
          const doc = iframe.contentDocument;
          if (doc && iframe.isConnected) {
            setupFrame(d, win, i, iframe, doc, entry, layout);
            // The page we were waiting on to compute a CFI just arrived
            if (winRef.current === win && win.pager.visible().includes(i)) reportLocation(d, win);
          }
          resolve();
        },
        { once: true },
      );
      iframe.srcdoc = html;
    });
  }

  function setupFrame(
    d: EpubDoc,
    win: Win,
    i: number,
    iframe: HTMLIFrameElement,
    doc: Document,
    entry: Entry,
    layout: EpubLayout,
  ) {
    const scroller = doc.scrollingElement as HTMLElement;
    const target = pageScroll(doc, entry.page, layout.pageW);
    scroller.scrollLeft = target;
    // Selecting text can auto-scroll the frame sideways; pin it to its page
    doc.addEventListener('scroll', () => {
      if (scroller.scrollLeft !== target) scroller.scrollLeft = target;
    });
    win.frames.set(i, { iframe, doc, entry });
    paintFrame(doc, entry.spine);
    // Neighbouring pages are pre-rendered while the page-curl engine keeps them display:none. A
    // hidden frame has no layout, so the scroll above and highlight geometry are lost; redo both
    // whenever the frame is actually laid out.
    let laidOut = iframe.offsetWidth > 0;
    const ro = new ResizeObserver(() => {
      const visible = iframe.offsetWidth > 0;
      if (visible && !laidOut) {
        scroller.scrollLeft = target;
        paintFrame(doc, entry.spine);
      }
      laidOut = visible;
    });
    ro.observe(iframe);
    iframe.addEventListener('readx-unmount', () => ro.disconnect(), { once: true });

    // Fixed-layout pages are scaled with a CSS transform; convert frame coordinates to the top window
    const scale = () => iframe.getBoundingClientRect().width / (iframe.offsetWidth || 1);
    const toTop = (r: { left: number; top: number; right: number; bottom: number }) => {
      const fr = iframe.getBoundingClientRect();
      const k = scale();
      return { left: fr.left + r.left * k, top: fr.top + r.top * k, right: fr.left + r.right * k, bottom: fr.top + r.bottom * k };
    };

    // Selection → CFI anchor
    let t: ReturnType<typeof setTimeout>;
    let hadSelection = false;
    doc.addEventListener('selectionchange', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          if (hadSelection) propsRef.current.onSelection(null);
          hadSelection = false;
          return;
        }
        const range = sel.getRangeAt(0);
        const quote = sel.toString().replace(/\s+/g, ' ').trim();
        const cfi = cfiFromRange(range, d.spine[entry.spine].cfiBase);
        if (!quote || !cfi) return;
        hadSelection = true;
        // Only one active selection across all page frames
        for (const f of win.frames.values()) if (f.doc !== doc) f.doc.getSelection()?.removeAllRanges();
        const anchor: Anchor = { kind: 'epub', cfi, spine: entry.spine, quote: quote.slice(0, 1000) };
        propsRef.current.onSelection({ anchor, quote, rect: toTop(range.getBoundingClientRect()), location: cfi });
      }, SELECTION_DEBOUNCE);
    });

    // Clicks: highlights, links, tap zones
    doc.addEventListener('click', (e) => {
      const hit = hitTestBoxes(doc, e.clientX, e.clientY);
      if (hit && doc.getSelection()?.isCollapsed !== false) {
        const r = toTop(hit.getBoundingClientRect());
        propsRef.current.onAnnotationClick(hit.dataset.id!, new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top));
        return;
      }
      const a = (e.target as Element).closest?.('a[href]');
      if (a) {
        e.preventDefault();
        const href = a.getAttribute('href')!;
        const internal = d.resolveLink(entry.spine, href);
        if (internal) goToSpine(d, internal.spine, internal.fragment);
        else if (/^https?:|^mailto:/i.test(href)) window.open(href, '_blank', 'noopener');
        return;
      }
      if (!doc.getSelection()?.isCollapsed) return;
      winRef.current?.pager.tapAt(iframe.getBoundingClientRect().left + e.clientX * scale());
    });

    // Touch swipes (events inside the iframe never reach the page-curl engine)
    let sx = 0,
      sy = 0,
      st = 0;
    doc.addEventListener(
      'touchstart',
      (e) => {
        const p = e.changedTouches[0];
        sx = p.clientX;
        sy = p.clientY;
        st = Date.now();
      },
      { passive: true },
    );
    doc.addEventListener(
      'touchend',
      (e) => {
        const p = e.changedTouches[0];
        const dx = p.clientX - sx;
        if (Math.abs(dx) > 40 && Math.abs(p.clientY - sy) < 80 && Date.now() - st < 500 && doc.getSelection()?.isCollapsed) {
          // Forward is a leftward swipe in LTR books, rightward in RTL books
          winRef.current?.pager.swipe(dx < 0 !== d.rtl ? 'next' : 'prev');
        }
      },
      { passive: true },
    );

    // Keyboard shortcuts work even when the frame has focus
    doc.addEventListener('keydown', (e) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }));
    });
  }

  function paintFrame(doc: Document, spine: number) {
    let layer = doc.querySelector<HTMLElement>('.hl-layer');
    if (!layer) {
      layer = doc.createElement('div');
      layer.className = 'hl-layer';
      // Child of <html>, not <body>, so it never shifts CFI paths
      doc.documentElement.appendChild(layer);
    }
    layer.replaceChildren();
    const se = doc.scrollingElement!;
    const { annotations, authorColors } = propsRef.current;
    for (const a of annotations) {
      if (a.anchor.kind !== 'epub' || a.anchor.spine !== spine) continue;
      const range = rangeFromCfi(a.anchor.cfi, doc);
      if (!range) continue;
      const boxes = mergeLineRects(Array.from(range.getClientRects())).map((r) => ({
        left: r.left + se.scrollLeft,
        top: r.top + se.scrollTop,
        width: r.width,
        height: r.height,
      }));
      paintAnnotation(layer, a, boxes, 'px', authorColors.get(a.authorId) ?? '#f59e0b', doc);
    }
    const q = propsRef.current.searchMark;
    if (q && doc.body) {
      paintSearchBoxes(
        layer,
        findTextRanges(doc.body, q),
        (r) => ({ left: r.left + se.scrollLeft, top: r.top + se.scrollTop, width: r.width, height: r.height }),
        'px',
      );
    }
  }

  async function goToSpine(d: EpubDoc, spine: number, fragment: string) {
    if (winRef.current?.fixed) return winRef.current.pager.goTo(spine);
    const measurer = measurerRef.current;
    if (!measurer) return;
    const page = fragment ? await measurer.pageOfFragment(spine, fragment, () => d.sectionHtml(spine)) : 0;
    await showAt(d, spine, page, spreadRef.current, true);
  }

  async function goToCfi(d: EpubDoc, cfi: string) {
    const spine = cfiSpineIndex(cfi);
    if (winRef.current?.fixed) {
      if (spine !== null) winRef.current.pager.goTo(spine);
      return;
    }
    const measurer = measurerRef.current;
    if (spine === null || !measurer) return;
    const page = await measurer.pageOfCfi(spine, cfi, () => d.sectionHtml(spine));
    await showAt(d, spine, page, spreadRef.current, true);
  }

  // ---- Imperative API ------------------------------------------------------------------------
  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      next: () => winRef.current?.pager.next(),
      seek: (f) => {
        const win = winRef.current;
        if (!epub || !win) return;
        if (win.fixed) return win.pager.goTo(Math.round(Math.min(1, Math.max(0, f)) * (win.entries.length - 1)), false);
        locateFraction(epub, f).then(({ spine, page }) => showAt(epub, spine, page, spreadRef.current, false));
      },
      describe: (f) => {
        const win = winRef.current;
        if (!epub || !win) return '';
        f = Math.min(1, Math.max(0, f));
        if (win.fixed) {
          const n = win.entries.length;
          return `Page ${Math.round(f * (n - 1)) + 1} of ${n}`;
        }
        const bp = bookPages();
        if (bp) {
          let g = Math.round(f * (bp.total - 1));
          const pageNo = g + 1;
          let spine = 0;
          while (spine < bp.counts.length - 1 && g >= bp.counts[spine]) g -= bp.counts[spine++];
          return `Page ${pageNo} of ${bp.total} · ${labelFor(epub, spine, g)}`;
        }
        // Not counted yet: estimate the chapter from text length
        const total = epub.weights.reduce((a, b) => a + b, 0) || 1;
        let acc = 0,
          spine = 0;
        while (spine < epub.length - 1 && acc + epub.weights[spine] / total < f) acc += epub.weights[spine++] / total;
        return `${epub.chapterLabel(spine) || 'Section ' + (spine + 1)} · ${Math.round(f * 100)}%`;
      },
      prev: () => winRef.current?.pager.prev(),
      goTo: (loc) => {
        if (!epub) {
          if (loc.startsWith('epubcfi(')) cfiRef.current = loc;
          return;
        }
        if (loc.startsWith('epubcfi(')) {
          cfiRef.current = loc;
          goToCfi(epub, loc);
        } else if (loc.startsWith('href:')) {
          const href = loc.slice(5);
          const sec = epub.sectionForHref(href);
          if (sec) goToSpine(epub, sec.index, href.split('#')[1] ?? '');
        }
      },
      locationOf: (a: Anchor) => (a.kind === 'epub' ? a.cfi : ''),
      clearSelection: () => {
        for (const f of winRef.current?.frames.values() ?? []) f.doc.getSelection()?.removeAllRanges();
      },
      flash: (id) =>
        setTimeout(() => {
          for (const f of winRef.current?.frames.values() ?? []) flashBoxes(f.doc, id);
        }, 700),
      search: async (query, signal, onHit) => {
        if (epub) await epub.search(query, signal, onHit);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epub, size],
  );

  return <div ref={hostRef} className="relative h-full w-full overflow-hidden" />;
});

function destroyWin(win: Win | null) {
  if (!win) return;
  win.pager.destroy();
  win.host.remove();
  win.frames.clear();
}

/** CFI of the first character visible on the frame's current page (LTR or RTL). */
function cfiAtPageStart(doc: Document, cfiBase: string): string | null {
  const body = doc.body;
  if (!body) return null;
  const W = doc.documentElement.clientWidth;
  const rtl = isRtl(doc);
  // The frame is scrolled so its page occupies viewport x ∈ [0, W). Earlier pages lie to the
  // left in LTR books and to the right in RTL books.
  const earlier = (r: DOMRect) => (rtl ? r.left >= W : r.right <= 0);
  const later = (r: DOMRect) => (rtl ? r.right <= 0 : r.left >= W);
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent && n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = doc.createRange();
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    range.selectNodeContents(n);
    const rects = Array.from(range.getClientRects());
    if (!rects.length) continue;
    if (rects.every(earlier)) continue; // entirely on an earlier page
    if (later(rects[0])) break; // first text is already past this page: an image-only page
    // The node may start on an earlier page → binary-search the first visible character
    let lo = 0,
      hi = n.length - 1;
    if (earlier(rects[0])) {
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(n, mid);
        range.setEnd(n, mid + 1);
        if (earlier(range.getBoundingClientRect())) lo = mid + 1;
        else hi = mid;
      }
    }
    range.setStart(n, lo);
    range.setEnd(n, Math.min(n.length, lo + 1));
    return cfiFromRange(range, cfiBase);
  }
  return null;
}
