import { PageFlip } from 'page-flip';
import type { FlipMode, PageLayout } from '../lib/types';

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
/** Single-page turn duration (touch screens a little snappier). */
const TURN_MS = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 420 : 480;
/**
 * How far a turning page rotates. Past 90° it's edge-on and then off the page area, so rotating
 * further only wastes animation time on something you can't see.
 */
const TURN_ANGLE = 100;

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
  /**
   * Single-page "turn" engine (curl mode with one page): the page swings over on its spine with a
   * CSS 3D transform. Compositor-only, so it stays smooth on phones and while the next page loads,
   * and nothing is cloned (StPageFlip clones the page in this mode, which for EPUB means reloading
   * a whole chapter mid-animation).
   */
  private turnMode = false;
  private anim: { finish: () => void } | null = null;
  private drag: { x: 0 | number; y: number; dir: 1 | -1 | 0; page: HTMLElement | null; start: number; angle: number; t: number } | null = null;

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
    if (o.mode === 'curl' && !o.spread) this.initTurn();
    else if (o.mode === 'curl') this.initCurl();
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
    if (this.turnMode || !this.o.spread || this.o.mode === 'scroll') return [this.current];
    const s = this.spreadStart(this.current);
    if (this.o.showCover && s === 0) return [0];
    return s + 1 < this.o.count ? [s, s + 1] : [s];
  }

  /**
   * Programmatic turns (keys, buttons, taps, swipes) must bypass `disableFlipByClick`: StPageFlip
   * implements flipPrev/flip(n) as a synthetic click, and in portrait (single page) mode that click
   * lands mid-page, so the guard we use to protect text selection would silently swallow it.
   */
  private turn(fn: (f: PageFlip) => void) {
    const f = this.flip!;
    const s = f.getSettings();
    const guard = s.disableFlipByClick;
    s.disableFlipByClick = false;
    try {
      fn(f);
    } finally {
      s.disableFlipByClick = guard;
    }
  }

  /** Make sure pages about to be shown by an animation are built (neighbours load lazily). */
  private ensureMounted(from: number, to: number) {
    for (let i = Math.max(0, from); i <= Math.min(this.o.count - 1, to); i++) {
      if (!this.mounted.has(i)) {
        this.mounted.add(i);
        this.o.mount(i, this.pages[i]);
      }
    }
  }

  next() {
    if (this.turnMode) return this.turnBy(1);
    this.ensureMounted(this.current + 1, this.current + 3);
    if (this.flip) return this.turn((f) => f.flipNext());
    const step = this.o.spread && this.o.mode === 'slide' ? this.visible().length : 1;
    this.goTo(this.spreadStart(this.current) + step);
  }

  prev() {
    if (this.turnMode) return this.turnBy(-1);
    this.ensureMounted(this.current - 3, this.current - 1);
    if (this.flip) return this.turn((f) => f.flipPrev());
    if (this.o.spread && this.o.mode === 'slide') {
      const s = this.spreadStart(this.current);
      return this.goTo(s === 0 ? 0 : this.spreadStart(s - 1));
    }
    this.goTo(this.current - 1);
  }

  goTo(index: number, animate = true) {
    index = clamp(index, 0, this.o.count - 1);
    if (this.turnMode) {
      if (animate && Math.abs(index - this.current) === 1) return this.turnBy(index > this.current ? 1 : -1);
      this.anim?.finish();
      this.setCurrent(index);
      this.layoutTurn();
      return;
    }
    if (this.flip) {
      if (animate && Math.abs(index - this.current) <= 2) this.turn((f) => f.flip(index));
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

  /**
   * Finger tracking for the single-page turn (the page follows your finger). Coordinates are in
   * the top window. Returns false when not in that mode so callers fall back to swipe detection.
   */
  touchStart(x: number, y: number): boolean {
    if (!this.turnMode) return false;
    this.drag = { x, y, dir: 0, page: null, start: 0, angle: 0, t: performance.now() };
    return true;
  }

  touchMove(x: number, y: number): boolean {
    const d = this.drag;
    if (!this.turnMode || !d) return false;
    const w = this.o.pageW;
    let dx = x - d.x;
    if (this.o.rtl) dx = -dx; // the book is mirrored
    if (!d.dir) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(y - d.y)) return true;
      if (!window.getSelection()?.isCollapsed) return true; // selecting text, not turning
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const target = this.current + dir;
      if (target < 0 || target >= this.o.count) return true;
      this.anim?.finish();
      d.dir = dir;
      d.page = this.prepareTurn(dir);
      d.start = dir === 1 ? 0 : -TURN_ANGLE;
    }
    const delta = clamp((dx / w) * TURN_ANGLE * 1.2, -TURN_ANGLE, TURN_ANGLE);
    d.angle = d.dir === 1 ? clamp(delta, -TURN_ANGLE, 0) : clamp(-TURN_ANGLE + delta, -TURN_ANGLE, 0);
    d.page!.style.transition = 'none';
    d.page!.style.transform = `rotateY(${d.angle}deg)`;
    return true;
  }

  touchEnd(x: number): boolean {
    const d = this.drag;
    this.drag = null;
    if (!this.turnMode || !d) return false;
    if (!d.dir) return true;
    const progress = Math.abs(d.angle - d.start) / TURN_ANGLE;
    const speed = Math.abs(x - d.x) / Math.max(1, performance.now() - d.t); // px/ms
    const complete = progress > 0.3 || (speed > 0.5 && progress > 0.08);
    this.animateTurn(d.dir, d.page!, d.angle, complete);
    return true;
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

  // ---- Single-page turn engine ----------------------------------------------------------------

  private initTurn() {
    const { container, pageW, pageH } = this.o;
    const book = document.createElement('div');
    book.className = 'turn-book';
    book.style.cssText = `position:relative;width:${pageW}px;height:${pageH}px;perspective:${Math.round(Math.max(1400, pageW * 2.4))}px;touch-action:pan-y;flex:none${this.o.rtl ? ';transform:scaleX(-1)' : ''}`;
    for (const p of this.pages) {
      p.classList.add('turn-page');
      p.style.setProperty('--turn-ms', `${TURN_MS}ms`);
      book.appendChild(p);
    }
    container.appendChild(book);
    this.viewport = book;
    this.turnMode = true;
    this.layoutTurn();
    // Finger tracking for content that delivers touch events to us (PDF pages)
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('a, button, .hl-box')) return;
      this.touchStart(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => e.pointerType === 'touch' && this.touchMove(e.clientX, e.clientY);
    const up = (e: PointerEvent) => e.pointerType === 'touch' && this.touchEnd(e.clientX);
    const cancel = () => {
      const d = this.drag;
      this.drag = null;
      if (d?.dir) this.animateTurn(d.dir, d.page!, d.angle, false);
    };
    book.addEventListener('pointerdown', down);
    book.addEventListener('pointermove', move);
    book.addEventListener('pointerup', up);
    book.addEventListener('pointercancel', cancel);
    this.cleanup.push(() => {
      book.removeEventListener('pointerdown', down);
      book.removeEventListener('pointermove', move);
      book.removeEventListener('pointerup', up);
      book.removeEventListener('pointercancel', cancel);
    });
  }

  /** Resting state: only the current page shown, nothing rotated. */
  private layoutTurn() {
    this.pages.forEach((p, i) => {
      p.style.transition = 'none';
      p.style.transform = '';
      p.classList.remove('--shade', '--turning');
      p.style.display = i === this.current ? 'block' : 'none';
      p.style.zIndex = i === this.current ? '2' : '1';
    });
  }

  /** Show the two pages involved in a turn; returns the page that swings. */
  private prepareTurn(dir: 1 | -1): HTMLElement {
    const target = this.current + dir;
    if (!this.mounted.has(target)) {
      this.mounted.add(target);
      this.o.mount(target, this.pages[target]);
    }
    const top = dir === 1 ? this.pages[this.current] : this.pages[target];
    const under = dir === 1 ? this.pages[target] : this.pages[this.current];
    under.style.display = 'block';
    under.style.zIndex = '1';
    top.style.display = 'block';
    top.style.zIndex = '3';
    top.classList.add('--turning');
    top.style.transition = 'none';
    top.style.transform = `rotateY(${dir === 1 ? 0 : -TURN_ANGLE}deg)`;
    return top;
  }

  private turnBy(dir: 1 | -1) {
    this.anim?.finish(); // quick taps: complete the running turn first
    const target = this.current + dir;
    if (target < 0 || target >= this.o.count) return;
    const page = this.prepareTurn(dir);
    this.animateTurn(dir, page, dir === 1 ? 0 : -TURN_ANGLE, true);
  }

  /** Animate the swinging page from `from` degrees to done (or back to where it started). */
  private animateTurn(dir: 1 | -1, page: HTMLElement, from: number, complete: boolean) {
    const target = this.current + dir;
    const end = complete ? (dir === 1 ? -TURN_ANGLE : 0) : dir === 1 ? 0 : -TURN_ANGLE;
    const span = Math.abs(end - from) / TURN_ANGLE;
    const ms = Math.max(140, Math.round(TURN_MS * span));
    page.style.transition = 'none';
    page.style.transform = `rotateY(${from}deg)`;
    void page.offsetWidth; // commit the start angle before transitioning
    // Ease-in-out: the page lifts, sweeps, and settles (a fast start would hide most of the motion)
    page.style.transition = `transform ${ms}ms cubic-bezier(.45,.05,.4,1)`;
    page.style.setProperty('--turn-ms', `${ms}ms`);
    page.classList.toggle('--shade', end === -TURN_ANGLE);
    page.style.transform = `rotateY(${end}deg)`;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.anim = null;
      if (complete) this.setCurrent(target);
      this.layoutTurn();
    };
    const timer = setTimeout(finish, ms + 30);
    this.anim = { finish };
  }

  isMounted(index: number) {
    return this.mounted.has(index);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.mountTimer);
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
      flippingTime: 520,
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

  /** Corners StPageFlip turns on click. With a single page (portrait) only the right corners are
   *  real: its left corners belong to the off-screen previous page, so taps there are ours. */
  private isFlipCorner(clientX: number, clientY: number) {
    const r = this.viewport.getBoundingClientRect();
    const d = Math.hypot(this.o.pageW, this.o.pageH) / 5;
    const x = clientX - r.left;
    const y = clientY - r.top;
    const vertical = y < d || y > r.height - d;
    if (!this.o.spread) return vertical && x > r.width - d;
    return vertical && (x < d || x > r.width - d);
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
    // Visible pages now; neighbours one per tick afterwards, so the page you land on paints first
    // and building the next ones (an EPUB chapter layout can be heavy) never blocks a turn.
    clearTimeout(this.mountTimer);
    const visible = new Set(this.visible());
    const later: number[] = [];
    for (const i of order) {
      if (this.mounted.has(i)) continue;
      if (visible.has(i)) {
        this.mounted.add(i);
        this.o.mount(i, this.pages[i]);
      } else later.push(i);
    }
    const step = () => {
      const i = later.shift();
      if (i === undefined || this.destroyed) return;
      if (!this.mounted.has(i)) {
        this.mounted.add(i);
        this.o.mount(i, this.pages[i]);
      }
      this.mountTimer = setTimeout(step, 40);
    };
    this.mountTimer = setTimeout(step, 60);
  }
  private mountTimer: ReturnType<typeof setTimeout> | undefined;

  private unmountPage(i: number, el: HTMLElement) {
    this.mounted.delete(i);
    if (this.o.unmount) this.o.unmount(i, el);
    else el.replaceChildren();
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Two-page spread? `auto` uses one on wide, landscape screens. Scroll mode is always single. */
export function wantsSpread(layout: PageLayout, mode: FlipMode, w: number, h: number): boolean {
  if (mode === 'scroll' || layout === 'single') return false;
  if (layout === 'double') return true;
  return w >= 900 && w / h > 1.15;
}

/**
 * Pick page size and spread for a content aspect ratio (w/h) inside an available box.
 */
export function fitPages(availW: number, availH: number, aspect: number, layout: PageLayout, mode: FlipMode) {
  const pad = availW < 640 ? 0 : 24;
  const W = Math.max(200, availW - pad * 2);
  const H = Math.max(200, availH - pad * 2);
  const spread = wantsSpread(layout, mode, W, H);
  const cols = spread ? 2 : 1;
  let pageH = H;
  let pageW = pageH * aspect;
  if (pageW * cols > W) {
    pageW = W / cols;
    pageH = pageW / aspect;
  }
  return { pageW: Math.floor(pageW), pageH: Math.floor(pageH), spread };
}
