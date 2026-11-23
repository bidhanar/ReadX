import { mergeLineRects, type Box } from '../geometry';

/**
 * Find case-insensitive occurrences of `query` in the text under `root`, including matches that
 * span several text nodes (pdf.js splits lines into many spans). Whitespace in the query matches
 * any run of whitespace in the text.
 */
export function findTextRanges(root: Node, query: string, max = 200): Range[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.parentElement?.closest('.hl-layer, .search-layer, script, style')) continue;
    nodes.push(n);
    starts.push(text.length);
    text += n.data;
  }
  // Collapse whitespace while remembering where each normalized char came from
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (norm.endsWith(' ')) continue;
      norm += ' ';
    } else norm += ch.toLowerCase();
    map.push(i);
  }
  const locate = (abs: number) => {
    let lo = 0,
      hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= abs) lo = mid;
      else hi = mid - 1;
    }
    return { node: nodes[lo], offset: abs - starts[lo] };
  };
  const out: Range[] = [];
  for (let i = norm.indexOf(q); i !== -1 && out.length < max; i = norm.indexOf(q, i + q.length)) {
    const a = locate(map[i]);
    const b = locate(map[i + q.length - 1]); // last matched character
    const r = doc.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, Math.min(b.node.length, b.offset + 1));
    out.push(r);
  }
  return out;
}

/** Paint outlined boxes for every range into `layer`. `toBox` converts a client rect to layer units. */
export function paintSearchBoxes(
  layer: HTMLElement,
  ranges: Range[],
  toBox: (r: Box) => Box | null,
  unit: '%' | 'px',
) {
  const doc = layer.ownerDocument;
  for (const range of ranges) {
    for (const rect of mergeLineRects(Array.from(range.getClientRects()))) {
      const b = toBox(rect);
      if (!b) continue;
      const d = doc.createElement('div');
      d.className = 'search-box';
      d.style.left = `${b.left}${unit}`;
      d.style.top = `${b.top}${unit}`;
      d.style.width = `${b.width}${unit}`;
      d.style.height = `${b.height}${unit}`;
      layer.appendChild(d);
    }
  }
}

export const SEARCH_CSS = `.search-box{position:absolute;background:rgba(255,160,0,.28);outline:2px solid rgba(234,120,0,.95);outline-offset:1px;border-radius:2px;pointer-events:none;z-index:6}`;
