import { HIGHLIGHT_COLORS, type Annotation } from '../../lib/types';
import { SEARCH_CSS } from './searchMarks';

export interface PaintBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Draw highlight boxes for one annotation into `layer`. Units are '%' (PDF, normalized rects)
 * or 'px' (EPUB, document coordinates inside the iframe).
 */
export function paintAnnotation(
  layer: HTMLElement,
  a: Annotation,
  boxes: PaintBox[],
  unit: '%' | 'px',
  authorColor: string,
  doc: Document = document,
) {
  boxes.forEach((b, i) => {
    const d = doc.createElement('div');
    d.className = 'hl-box';
    d.dataset.id = a.id;
    const s = d.style;
    s.left = `${b.left}${unit}`;
    s.top = `${b.top}${unit}`;
    s.width = `${b.width}${unit}`;
    s.height = `${b.height}${unit}`;
    if (a.type === 'link') {
      s.background = 'transparent';
      s.borderBottom = `2px dashed ${authorColor}`;
    } else {
      s.background = HIGHLIGHT_COLORS[a.color] ?? HIGHLIGHT_COLORS.yellow;
    }
    // Small author-colored dot on the last line marks notes / comments / links
    if (i === boxes.length - 1 && (a.type !== 'highlight' || a.text)) {
      d.classList.add('--note');
      s.setProperty('--hl-author', authorColor);
    }
    d.title = a.type === 'link' ? a.url : a.text.slice(0, 140);
    layer.appendChild(d);
  });
}

/** Highlight boxes don't take pointer events (so text under them stays selectable); hit-test by point. */
export function hitTestBoxes(root: ParentNode, clientX: number, clientY: number): HTMLElement | null {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.hl-box'));
  return (
    boxes.find((b) => {
      const r = b.getBoundingClientRect();
      return clientX >= r.left - 2 && clientX <= r.right + 2 && clientY >= r.top - 2 && clientY <= r.bottom + 2;
    }) ?? null
  );
}

export function flashBoxes(root: ParentNode, id: string) {
  root.querySelectorAll<HTMLElement>(`.hl-box[data-id="${CSS.escape(id)}"]`).forEach((el) => {
    el.animate(
      [
        { outline: '0px solid rgba(245,158,11,0)', transform: 'scale(1)' },
        { outline: '3px solid rgba(245,158,11,.9)', transform: 'scale(1.04)' },
        { outline: '0px solid rgba(245,158,11,0)', transform: 'scale(1)' },
      ],
      { duration: 900, iterations: 2 },
    );
  });
}

/** CSS injected into EPUB iframes so highlight boxes look the same as in PDFs. */
export const HIGHLIGHT_CSS = `
.hl-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:5}
.hl-box{position:absolute;mix-blend-mode:multiply;border-radius:2px;pointer-events:none}
.--dark .hl-box{mix-blend-mode:screen}
.hl-box.--note::after{content:'';position:absolute;right:-5px;top:-5px;width:9px;height:9px;border-radius:9999px;background:var(--hl-author,#f59e0b);box-shadow:0 0 0 2px #fff}
${SEARCH_CSS}
`;
