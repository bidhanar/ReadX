import { PageFlip } from 'page-flip';
import type { FlipMode } from '../lib/types';

export type TapZone = 'left' | 'center' | 'right';

export interface PagerOptions {
  container: HTMLElement;
  count: number;
  pageW: number;
  pageH: number;
  /** Two pages side by side (desktop / landscape tablets). */
  spread: boolean;
  /** First page shown alone on the right in spread mode (PDF covers). */
  showCover: boolean;
  mode: FlipMode;
  start: number;
  /** Fill a page element with content. Called for pages entering the live window. */
  mount: (index: number, el: HTMLElement) => void;
  /** Called for pages leaving the live window; default clears the element. */
  unmount?: (index: number, el: HTMLElement) => void;
  /** Index of the first visible page changed. */
  onChange: (index: number) => void;
  onTap?: (zone: TapZone) => void;
  /** Extra class on every page element (theme). */
  pageClass?: string;
  /** How many pages either side of the current one stay rendered. */
  window?: number;
  /**
   * Right-to-left book: the whole book is mirrored so the first page sits on the right and pages
   * curl the other way. Content must counter-mirror itself (see EpubView). Mouse corner-dragging is
   * disabled (it would run backwards); taps, swipes and keys still work.
   */
  rtl?: boolean;
  /** StPageFlip clones the page being curled; lets content fix up the clone (e.g. iframe scroll). */
  onClone?: (clone: HTMLElement, index: number) => void;
}

const SCROLL_GAP = 12;

/**
 * Owns the page elements and the page-turn mechanics for every reading mode:
 *  - curl:   realistic page curl via StPageFlip (HTML mode)
 *  - slide:  horizontal sliding pages
 *  - scroll: vertical continuous pages
 * Content is mounted lazily in a window around the current page so 1000-page books stay light.
 */
export class Pager {
  readonly pages: HTMLElement[] = [];
  current: number;
  private o: PagerOptions;
  private flip: PageFlip | null = null;
  private mounted = new Set<number>();
  private viewport!: HTMLElement;
  private strip: HTMLElement | null = null;
  private cleanup: (() => void)[] = [];
  private destroyed = false;
  private downAt: { x: number; y: number } | null = null;

  constructor(o: PagerOptions) {
    this.o = o;
    this.current = clamp(o.start, 0, o.count - 1);
    for (let i = 0; i < o.count; i++) {
      const el = document.createElement('div');
      el.className = `flip-page ${o.pageClass ?? ''}`;
      el.dataset.page = String(i);
      el.style.width = `${o.pageW}px`;
      el.style.height = `${o.pageH}px`;
      this.pages.push(el);
    }
    if (o.mode === 'curl') this.initCurl();
    else if (o.mode === 'slide') this.initSlide();
    else this.initScroll();
    this.attachPointerHandlers();
    this.refreshWindow();
  }

  // ---- Public API ---------------------------------------------------------------------------

  get count() {
    return this.o.count;
  }

  /** Visible page indexes (1 or 2). */
  visible(): number[] {
    if (!this.o.spread || this.o.mode === 'scroll') return [this.current];
    const s = this.spreadStart(this.current);
    if (this.o.showCover && s === 0) return [0];
    return s + 1 < this.o.count ? [s, s + 1] : [s];
  }

  next() {
    if (this.flip) return this.flip.flipNext();
    const step = this.o.spread && this.o.mode === 'slide' ? this.visible().length : 1;
    this.goTo(this.spreadStart(this.current) + step);
  }

  prev() {
    if (this.flip) return this.flip.flipPrev();
    if (this.o.spread && this.o.mode === 'slide') {
      const s = this.spreadStart(this.current);
      return this.goTo(s === 0 ? 0 : this.spreadStart(s - 1));
    }
    this.goTo(this.current - 1);
  }

  goTo(index: number, animate = true) {
    index = clamp(index, 0, this.o.count - 1);
    if (this.flip) {
      if (animate && Math.abs(index - this.current) <= 2) this.flip.flip(index);
      else this.flip.turnToPage(index);
      this.setCurrent(index);
      return;
    }
    if (this.o.mode === 'slide') {
      this.setCurrent(index);
      this.positionStrip(animate);
    } else {
      this.viewport.scrollTo({ top: index * (this.o.pageH + SCROLL_GAP), behavior: animate ? 'smooth' : 'auto' });
      this.setCurrent(index);
    }
  }

  /** Forwarded taps from content that swallows events (EPUB iframes). clientX is in top-window coordinates. */
  tapAt(clientX: number) {
    const r = this.viewport.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const zone: TapZone = x < 0.3 ? 'left' : x > 0.7 ? 'right' : 'center';
    // Zones are reported as on-screen sides; the reader maps them to next/prev by book direction
    this.o.onTap?.(zone);
  }

  /** Forwarded horizontal swipe from content that swallows events. */
  swipe(direction: 'next' | 'prev') {
    if (this.o.mode === 'scroll') return;
    if (direction === 'next') this.next();
    else this.prev();
  }

  /** Re-mount a page's content (e.g. annotations changed). */
  remount(index: number) {
    if (!this.mounted.has(index)) return;
    const el = this.pages[index];
    this.unmountPage(index, el);
    this.o.mount(index, el);
    this.mounted.add(index);
  }

  remountAll() {
    for (const i of [...this.mounted]) this.remount(i);
  }

  isMounted(index: number) {
    return this.mounted.has(index);
  }

  destroy() {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    for (const i of this.mounted) this.o.unmount?.(i, this.pages[i]);
    this.mounted.clear();
    try {
      this.flip?.destroy();
    } catch {
      /* StPageFlip throws if its DOM was already detached */
    }
    this.flip = null;
    this.o.container.replaceChildren();
    this.o.container.removeAttribute('style');
    this.o.container.className = '';
  }

  // ---- Modes --------------------------------------------------------------------------------

  private initCurl() {
    const { container, pageW, pageH, spread } = this.o;
    const book = document.createElement('div');
    container.appendChild(book);
    book.style.width = `${spread ? pageW * 2 : pageW}px`;
    book.style.height = `${pageH}px`;
    if (this.o.rtl) book.style.transform = 'scaleX(-1)';
    this.viewport = book;

    this.flip = new PageFlip(book, {
      width: pageW,
      height: pageH,
      size: 'fixed',
      autoSize: false,
      usePortrait: !spread,
      showCover: this.o.showCover && spread,
      startPage: this.current,
      flippingTime: 650,
      maxShadowOpacity: 0.35,
      drawShadow: true,
      showPageCorners: true,
      mobileScrollSupport: false,
      disableFlipByClick: true,
      clickEventForward: true,
      useMouseEvents: !this.o.rtl,
      swipeDistance: 30,
    });
    this.flip.loadFromHTML(this.pages);
    this.flip.on('flip', (e) => this.setCurrent(Number(e.data)));
    if (this.o.onClone) {
      const known = new Set<Node>(this.pages);
      const mo = new MutationObserver((records) => {
        for (const r of records)
          r.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement && n.classList.contains('flip-page') && !known.has(n))
              this.o.onClone!(n, Number(n.dataset.page));
          });
      });
      mo.observe(book, { childList: true, subtree: true });
      this.cleanup.push(() => mo.disconnect());
    }
    // StPageFlip starts a drag on *any* mousedown and calls preventDefault, which kills text
    // selection. Only let it see mousedowns near the outer edges (where you'd grab a page).
    let selecting = false;
    for (const el of this.pages) {
      const onDown = (e: MouseEvent) => {
        const r = book.getBoundingClientRect();
        const edge = Math.min(64, r.width * 0.12);
        const x = e.clientX - r.left;
        if (x > edge && x < r.width - edge) {
          e.stopPropagation();
          selecting = true;
        }
      };
      el.addEventListener('mousedown', onDown);
      this.cleanup.push(() => el.removeEventListener('mousedown', onDown));
    }
    // StPageFlip listens for mousemove on window and folds a corner when the pointer nears one.
    // While the user is drag-selecting text, swallow those moves (capture phase runs first).
    const onMove = (e: MouseEvent) => {
      if (selecting) e.stopPropagation();
    };
    const onUp = () => {
      selecting = false;
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    this.cleanup.push(() => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    });
  }

  private initSlide() {
    const { container, pageW, pageH, spread } = this.o;
    const vp = document.createElement('div');
    vp.style.cssText = `position:relative;overflow:hidden;width:${spread ? pageW * 2 : pageW}px;height:${pageH}px;margin:0 auto;box-shadow:0 2px 14px rgba(0,0,0,.12)${this.o.rtl ? ';transform:scaleX(-1)' : ''}`;
    const strip = document.createElement('div');
    strip.style.cssText = `display:flex;height:100%;will-change:transform`;
    for (const p of this.pages) {
      p.style.flex = '0 0 auto';
      strip.appendChild(p);
    }
    vp.appendChild(strip);
    container.appendChild(vp);
    this.viewport = vp;
    this.strip = strip;
    this.positionStrip(false);

    // Touch swipe
    let sx = 0,
      sy = 0,
      st = 0,
      tracking = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      tracking = true;
      sx = e.clientX;
      sy = e.clientY;
      st = Date.now();
    };
    const up = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 40 && Math.abs(e.clientY - sy) < 80 && Date.now() - st < 600) {
        // Swiping toward the spine side turns forward: leftward in LTR, rightward in RTL
        if (dx < 0 !== !!this.o.rtl) this.next();
        else this.prev();
      }
    };
    vp.addEventListener('pointerdown', down);
    vp.addEventListener('pointerup', up);
    this.cleanup.push(() => {
      vp.removeEventListener('pointerdown', down);
      vp.removeEventListener('pointerup', up);
    });
  }

  private positionStrip(animate: boolean) {
    if (!this.strip) return;
    const { pageW, spread, showCover } = this.o;
    const s = spread ? this.spreadStart(this.current) : this.current;
    const offset = -s * pageW + (spread && showCover && s === 0 ? pageW : 0);
    this.strip.style.transition = animate ? 'transform 320ms cubic-bezier(.2,.7,.2,1)' : 'none';
    this.strip.style.transform = `translateX(${offset}px)`;
  }

  private initScroll() {
    const { container, pageW, pageH } = this.o;
    const vp = document.createElement('div');
    vp.style.cssText = `height:100%;width:100%;overflow-y:auto;overflow-x:auto;-webkit-overflow-scrolling:touch`;
    const col = document.createElement('div');
    col.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:${SCROLL_GAP}px;padding:${SCROLL_GAP}px 0;min-width:${pageW}px`;
    for (const p of this.pages) {
      p.style.flex = '0 0 auto';
      p.style.boxShadow = '0 1px 8px rgba(0,0,0,.12)';
      col.appendChild(p);
    }
    vp.appendChild(col);
    container.appendChild(vp);
    this.viewport = vp;
    requestAnimationFrame(() => {
      if (!this.destroyed) vp.scrollTop = this.current * (pageH + SCROLL_GAP);
    });
    const onScroll = () => {
      const i = Math.round(vp.scrollTop / (pageH + SCROLL_GAP));
      if (i !== this.current) this.setCurrent(clamp(i, 0, this.o.count - 1));
    };
    vp.addEventListener('scroll', onScroll, { passive: true });
    this.cleanup.push(() => vp.removeEventListener('scroll', onScroll));
  }

  // ---- Internals ----------------------------------------------------------------------------

  private attachPointerHandlers() {
    const vp = this.viewport;
    const down = (e: PointerEvent) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    };
    const click = (e: MouseEvent) => {
      const start = this.downAt;
      this.downAt = null;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return; // was a drag
      const target = e.target as HTMLElement;
      if (target.closest('.hl-box, a, button, input, textarea')) return;
      if (!window.getSelection()?.isCollapsed) return;
      if (this.flip && this.isFlipCorner(e.clientX, e.clientY)) return; // StPageFlip handles corner clicks
      this.tapAt(e.clientX);
    };
    vp.addEventListener('pointerdown', down, true);
    vp.addEventListener('click', click);
    this.cleanup.push(() => {
      vp.removeEventListener('pointerdown', down, true);
      vp.removeEventListener('click', click);
    });
  }

  private isFlipCorner(clientX: number, clientY: number) {
    const r = this.viewport.getBoundingClientRect();
    const d = Math.hypot(this.o.pageW, this.o.pageH) / 5;
    const x = clientX - r.left;
    const y = clientY - r.top;
    return (x < d || x > r.width - d) && (y < d || y > r.height - d);
  }

  private spreadStart(i: number) {
    if (!this.o.spread) return i;
    if (this.o.showCover) return i === 0 ? 0 : i % 2 === 1 ? i : i - 1;
    return i - (i % 2);
  }

  private setCurrent(i: number) {
    if (this.destroyed) return;
    const changed = i !== this.current;
    this.current = i;
    this.refreshWindow();
    if (changed) this.o.onChange(i);
  }

  private refreshWindow() {
    const w = this.o.window ?? 3;
    const lo = Math.max(0, this.current - w);
    const hi = Math.min(this.o.count - 1, this.current + w + 1);
    for (const i of [...this.mounted]) {
      if (i < lo || i > hi) this.unmountPage(i, this.pages[i]);
    }
    // Mount the visible pages first, then neighbours outward
    const order: number[] = [];
    for (let d = 0; d <= w + 1; d++) {
      if (this.current + d <= hi) order.push(this.current + d);
      if (d > 0 && this.current - d >= lo) order.push(this.current - d);
    }
    for (const i of order) {
      if (!this.mounted.has(i)) {
        this.mounted.add(i);
        this.o.mount(i, this.pages[i]);
      }
    }
  }

  private unmountPage(i: number, el: HTMLElement) {
    this.mounted.delete(i);
    if (this.o.unmount) this.o.unmount(i, el);
    else el.replaceChildren();
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pick page size and spread for a content aspect ratio (w/h) inside an available box.
 */
export function fitPages(availW: number, availH: number, aspect: number, allowSpread: boolean) {
  const pad = availW < 640 ? 0 : 24;
  const W = Math.max(200, availW - pad * 2);
  const H = Math.max(200, availH - pad * 2);
  const spread = allowSpread && W >= 900 && W / H > 1.15;
  const cols = spread ? 2 : 1;
  let pageH = H;
  let pageW = pageH * aspect;
  if (pageW * cols > W) {
    pageW = W / cols;
    pageH = pageW / aspect;
  }
  return { pageW: Math.floor(pageW), pageH: Math.floor(pageH), spread };
}
