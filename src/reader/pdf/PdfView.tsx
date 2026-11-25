import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { pdfjs, type PDFDocumentProxy } from '../../lib/pdfjs';
import type { Anchor } from '../../lib/types';
import { Pager, fitPages } from '../Pager';
import { excerptAround, mergeLineRects, normalizeRects } from '../geometry';
import { flashBoxes, hitTestBoxes, paintAnnotation } from '../annotations/paint';
import { findTextRanges, paintSearchBoxes } from '../annotations/searchMarks';
import {
  isPdfLocation,
  pdfLocation,
  pdfPageOf,
  type EngineHandle,
  type EngineProps,
  type TocItem,
} from '../engine';
import './textLayer.css';

interface Mounted {
  cancelled: boolean;
  url?: string;
  layer?: HTMLElement;
  inner?: HTMLElement;
  textDiv?: HTMLElement;
  task?: { cancel: () => void };
}

export const PdfView = forwardRef<EngineHandle, EngineProps>(function PdfView(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const tocRef = useRef<TocItem[]>([]);
  const [aspect, setAspect] = useState(0.707);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const pagerRef = useRef<Pager | null>(null);
  const mountedRef = useRef(new Map<number, Mounted>());
  const textCache = useRef(new Map<number, string>());
  const propsRef = useRef(props);
  propsRef.current = props;
  const locationRef = useRef<number>(props.initialLocation && isPdfLocation(props.initialLocation) ? pdfPageOf(props.initialLocation) : 0);

  // ---- Load document ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    const task = pdfjs.getDocument({ data: new Uint8Array(props.data.slice(0)) });
    task.promise
      .then(async (d) => {
        if (cancelled) return d.loadingTask.destroy();
        loaded = d;
        const first = await d.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setAspect(vp.width / vp.height);
        setDoc(d);
        tocRef.current = await buildToc(d).catch(() => []);
        propsRef.current.onReady(tocRef.current);
      })
      .catch((e) => !cancelled && propsRef.current.onError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
      task.destroy();
      loaded?.loadingTask.destroy();
      textCache.current.clear();
    };
  }, [props.data]);

  // ---- Track available size ----------------------------------------------------------------
  useEffect(() => {
    const el = hostRef.current!;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(([entry]) => {
      clearTimeout(t);
      t = setTimeout(() => {
        const { width, height } = entry.contentRect;
        setSize((s) => (s && Math.abs(s.w - width) < 2 && Math.abs(s.h - height) < 2 ? s : { w: width, h: height }));
      }, 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  // ---- Build pager -------------------------------------------------------------------------
  const { flipMode, theme, zoom, pageLayout, pdfFit } = props;
  useEffect(() => {
    if (!doc || !size || !containerRef.current) return;
    const scrollMode = flipMode === 'scroll';
    const fit = fitPages(size.w, size.h, aspect, pageLayout, flipMode);
    // Scroll mode fits page width to the screen (×zoom); paged modes fit the whole page.
    // Fit width: a single page on a screen wider than the page's shape fills the width and you
    // scroll down the page (paged modes only; scroll mode has its own zoom).
    const fitWidth = !scrollMode && !fit.spread && pdfFit === 'width' && size.w / size.h > aspect * 1.05;
    const pageW = scrollMode ? Math.min(size.w - 16, 1000) * zoom : fitWidth ? size.w - (size.w < 640 ? 0 : 32) : fit.pageW;
    const pageH = scrollMode ? pageW / aspect : fitWidth ? pageW / aspect : fit.pageH;
    const host = hostRef.current!;
    host.style.overflowY = fitWidth ? 'auto' : 'hidden';
    containerRef.current.style.alignItems = fitWidth ? 'flex-start' : 'center';
    containerRef.current.style.height = fitWidth ? 'auto' : '100%';
    containerRef.current.style.padding = fitWidth && size.w >= 640 ? '16px 0' : '0';
    const mounted = mountedRef.current;

    const pager = new Pager({
      container: containerRef.current,
      count: doc.numPages,
      pageW: Math.floor(pageW),
      pageH: Math.floor(pageH),
      spread: fit.spread && !scrollMode,
      showCover: true,
      mode: flipMode,
      start: locationRef.current,
      pageClass: `--${theme}`,
      window: scrollMode ? 2 : 3,
      mount: (i, el) => {
        const m: Mounted = { cancelled: false };
        mounted.set(i, m);
        renderPage(doc, i, el, m, Math.floor(pageW), Math.floor(pageH)).catch((e) => {
          if (!m.cancelled && e?.name !== 'RenderingCancelledException') console.warn('page render failed', i, e);
        });
      },
      unmount: (i, el) => {
        const m = mounted.get(i);
        if (m) {
          m.cancelled = true;
          m.task?.cancel();
          if (m.url) URL.revokeObjectURL(m.url);
        }
        mounted.delete(i);
        el.replaceChildren();
      },
      onChange: (i) => {
        locationRef.current = i;
        if (fitWidth) host.scrollTo({ top: 0 }); // new page starts at its top
        report();
      },
      onTap: (z) => propsRef.current.onTap(z),
    });
    pagerRef.current = pager;
    report();

    function report() {
      const vis = pager.visible();
      const n = doc!.numPages;
      const first = vis[0];
      const last = vis[vis.length - 1];
      const label =
        vis.length > 1 ? `Pages ${vis[0] + 1}–${vis[1] + 1} of ${n}` : `Page ${first + 1} of ${n}`;
      // Next chapter start after the pages on screen (no outline: chapters unknown)
      const toc = tocRef.current;
      const nextChapter = toc.length ? Math.min(n, ...toc.map((t) => pdfPageOf(t.location)).filter((p) => p > last)) : null;
      propsRef.current.onLocation({
        location: pdfLocation(first),
        percent: n > 1 ? last / (n - 1) : 1,
        label,
        end: pdfLocation(last),
        chapterPagesLeft: nextChapter === null ? undefined : nextChapter - last - 1,
        bookPagesLeft: n - 1 - last,
        section: 0,
        page: first,
      });
    }

    return () => {
      pager.destroy();
      pagerRef.current = null;
    };
  }, [doc, size, aspect, flipMode, theme, zoom, pageLayout, pdfFit]);

  // ---- Search matches ----------------------------------------------------------------------
  useEffect(() => {
    for (const m of mountedRef.current.values()) paintSearch(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.searchMark]);

  function paintSearch(m: Mounted) {
    if (!m.inner || !m.textDiv) return;
    m.inner.querySelector('.search-layer')?.remove();
    const q = propsRef.current.searchMark;
    if (!q) return;
    const layer = document.createElement('div');
    layer.className = 'search-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4';
    m.inner.appendChild(layer);
    const ref = m.inner.getBoundingClientRect();
    if (!ref.width) return;
    paintSearchBoxes(
      layer,
      findTextRanges(m.textDiv, q),
      (r) => ({
        left: ((r.left - ref.left) / ref.width) * 100,
        top: ((r.top - ref.top) / ref.height) * 100,
        width: (r.width / ref.width) * 100,
        height: (r.height / ref.height) * 100,
      }),
      '%',
    );
  }

  // ---- Repaint highlights when annotations change -----------------------------------------
  useEffect(() => {
    for (const [i, m] of mountedRef.current) if (m.layer) paintPage(i, m.layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, props.authorColors]);

  function paintPage(i: number, layer: HTMLElement) {
    layer.replaceChildren();
    const { annotations, authorColors } = propsRef.current;
    for (const a of annotations) {
      if (a.anchor.kind !== 'pdf' || a.anchor.page !== i) continue;
      paintAnnotation(
        layer,
        a,
        a.anchor.rects.map((r) => ({ left: r.x * 100, top: r.y * 100, width: r.w * 100, height: r.h * 100 })),
        '%',
        authorColors.get(a.authorId) ?? '#f59e0b',
      );
    }
  }

  async function renderPage(
    d: PDFDocumentProxy,
    i: number,
    el: HTMLElement,
    m: Mounted,
    boxW: number,
    boxH: number,
  ) {
    const page = await d.getPage(i + 1);
    if (m.cancelled) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(boxW / base.width, boxH / base.height);
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    const inner = document.createElement('div');
    inner.className = 'pdf-inner';
    inner.dataset.inner = '1';
    inner.style.cssText = `position:absolute;left:${(boxW - viewport.width) / 2}px;top:${(boxH - viewport.height) / 2}px;width:${viewport.width}px;height:${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    canvas.className = 'pdf-img';
    inner.appendChild(canvas);

    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none';
    layer.className = 'hl-layer-pdf';
    inner.appendChild(layer);
    m.layer = layer;

    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    textDiv.style.setProperty('--total-scale-factor', String(scale));
    textDiv.style.setProperty('--scale-round-x', '1px');
    textDiv.style.setProperty('--scale-round-y', '1px');
    inner.appendChild(textDiv);

    el.replaceChildren(inner);
    m.inner = inner;
    m.textDiv = textDiv;
    paintPage(i, layer);

    const task = page.render({ canvas, viewport: page.getViewport({ scale: scale * dpr }) });
    m.task = task;
    await task.promise;
    if (m.cancelled) return;

    // Swap the canvas for an <img>: StPageFlip clones page elements during the curl animation and
    // a cloned canvas would be blank.
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (blob && !m.cancelled) {
      const img = new Image();
      m.url = URL.createObjectURL(blob);
      img.src = m.url;
      img.className = 'pdf-img';
      img.draggable = false;
      img.style.cssText = canvas.style.cssText;
      await img.decode().catch(() => {});
      if (!m.cancelled) canvas.replaceWith(img);
    }

    if (m.cancelled) return;
    const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
    await tl.render();
    if (!m.cancelled) paintSearch(m);
  }

  // ---- Clicks on highlights ---------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current!;
    const onClick = (e: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      // Highlight boxes sit under the text layer (so text stays selectable); hit-test manually.
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.pdf-inner');
      if (!pageEl) return;
      const hit = hitTestBoxes(pageEl, e.clientX, e.clientY);
      if (hit) {
        e.stopPropagation();
        propsRef.current.onAnnotationClick(hit.dataset.id!, hit.getBoundingClientRect());
      }
    };
    host.addEventListener('click', onClick, true);
    return () => host.removeEventListener('click', onClick, true);
  }, []);

  // ---- Text selection → anchor -------------------------------------------------------------
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return propsRef.current.onSelection(null);
        const range = sel.getRangeAt(0);
        const startEl = elementOf(range.startContainer)?.closest<HTMLElement>('.pdf-inner');
        if (!startEl || !hostRef.current?.contains(startEl)) return;
        const pageEl = startEl.closest<HTMLElement>('[data-page]');
        const page = Number(pageEl?.dataset.page);
        const quote = sel.toString().replace(/\s+/g, ' ').trim();
        if (!quote || Number.isNaN(page)) return propsRef.current.onSelection(null);
        const ref = startEl.getBoundingClientRect();
        const rects = normalizeRects(mergeLineRects(Array.from(range.getClientRects())), ref);
        if (rects.length === 0) return;
        const b = range.getBoundingClientRect();
        const anchor: Anchor = { kind: 'pdf', page, rects, quote: quote.slice(0, 1000) };
        propsRef.current.onSelection({
          anchor,
          quote,
          rect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
          location: pdfLocation(page),
        });
      }, 220);
    };
    document.addEventListener('selectionchange', check);
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', check);
    };
  }, []);

  // ---- Imperative API ----------------------------------------------------------------------
  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      next: () => pagerRef.current?.next(),
      prev: () => pagerRef.current?.prev(),
      seek: (f) => {
        if (!doc) return;
        const p = Math.round(Math.min(1, Math.max(0, f)) * (doc.numPages - 1));
        locationRef.current = p;
        pagerRef.current?.goTo(p, false);
      },
      describe: (f) => {
        if (!doc) return '';
        const p = Math.round(Math.min(1, Math.max(0, f)) * (doc.numPages - 1));
        const chapter = tocRef.current.filter((t) => pdfPageOf(t.location) <= p).pop()?.label;
        return `Page ${p + 1} of ${doc.numPages}${chapter ? ' · ' + chapter : ''}`;
      },
      goTo: (loc) => {
        if (!isPdfLocation(loc)) return;
        locationRef.current = pdfPageOf(loc);
        pagerRef.current?.goTo(pdfPageOf(loc));
      },
      locationOf: (a: Anchor) => (a.kind === 'pdf' ? pdfLocation(a.page) : pdfLocation(0)),
      chapterOf: (a: Anchor) => (a.kind === 'pdf' ? chapterAt(tocRef.current, a.page) : ''),
      clearSelection: () => window.getSelection()?.removeAllRanges(),
      flash: (id) => setTimeout(() => hostRef.current && flashBoxes(hostRef.current, id), 450),
      search: async (query, signal, onHit) => {
        if (!doc) return;
        const q = query.toLowerCase();
        let hits = 0;
        for (let i = 0; i < doc.numPages && !signal.aborted; i++) {
          let text = textCache.current.get(i);
          if (text === undefined) {
            const page = await doc.getPage(i + 1);
            const content = await page.getTextContent();
            text = content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? ' ' : '') : '')).join('');
            textCache.current.set(i, text);
          }
          const lower = text.toLowerCase();
          let idx = lower.indexOf(q);
          let perPage = 0;
          while (idx !== -1 && perPage < 5 && !signal.aborted) {
            onHit({ location: pdfLocation(i), label: `Page ${i + 1}`, excerpt: excerptAround(text, idx, q.length) });
            hits++;
            perPage++;
            idx = lower.indexOf(q, idx + q.length);
          }
          if (hits >= 300) break;
        }
      },
    }),
    [doc],
  );

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="flex h-full w-full items-center justify-center" />
    </div>
  );
});

/** Outline entry a page belongs to: the one starting latest at or before it. */
function chapterAt(toc: TocItem[], page: number): string {
  let best: { label: string; page: number } | null = null;
  for (const t of toc) {
    const p = pdfPageOf(t.location);
    if (p <= page && (!best || p >= best.page)) best = { label: t.label, page: p };
  }
  return best?.label ?? '';
}

function elementOf(n: Node): HTMLElement | null {
  return n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n.parentElement;
}

async function buildToc(d: PDFDocumentProxy): Promise<TocItem[]> {
  const outline = await d.getOutline();
  if (!outline) return [];
  const out: TocItem[] = [];
  type Node = { title: string; dest: unknown; items?: Node[] };
  const walk = async (items: Node[], level: number) => {
    for (const it of items) {
      let index: number | null = null;
      try {
        const dest = typeof it.dest === 'string' ? await d.getDestination(it.dest) : (it.dest as unknown[] | null);
        if (Array.isArray(dest) && dest[0] != null) {
          const target = dest[0] as { num: number; gen: number } | number;
          index = typeof target === 'number' ? target : await d.getPageIndex(target);
        }
      } catch {
        /* unresolved destination */
      }
      if (index !== null) out.push({ label: it.title, location: pdfLocation(index), level });
      if (it.items?.length) await walk(it.items, level + 1);
    }
  };
  await walk(outline as unknown as Node[], 0);
  return out;
}

