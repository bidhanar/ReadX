import type { Annotation, Anchor, FlipMode, PageLayout, PdfFit, ReaderTheme, Typography } from '../lib/types';
import type { TapZone } from './Pager';

export interface TocItem {
  label: string;
  location: string;
  level: number;
}

export interface SearchHit {
  location: string;
  excerpt: string;
  label: string;
}

export interface SelectionInfo {
  anchor: Anchor;
  quote: string;
  /** Bounding box of the selection in top-window viewport coordinates. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Location string to jump back to this passage (used in chat links). */
  location: string;
}

export interface LocationInfo {
  location: string;
  percent: number;
  label: string;
  /** End of what's on screen: everything up to here has been seen (spoiler shield, bookmarks). */
  end?: string;
  /** Pages after the ones on screen until the next chapter / the end of the book, when known. */
  chapterPagesLeft?: number;
  bookPagesLeft?: number;
  /** Section (EPUB spine item; 0 for PDFs) and page within it, to measure reading pace. */
  section?: number;
  page?: number;
}

/** Imperative API both renderers expose to the reader shell. */
export interface EngineHandle {
  next(): void;
  prev(): void;
  goTo(location: string): void;
  /** Location of an annotation's anchor (for jumping from the sidebar / chat). */
  locationOf(anchor: Anchor): string;
  /** Chapter title for an annotation's anchor ('' if the book has no table of contents). */
  chapterOf(anchor: Anchor): string;
  search(query: string, signal: AbortSignal, onHit: (hit: SearchHit) => void): Promise<void>;
  clearSelection(): void;
  /** Briefly pulse an annotation's highlight. */
  flash(annotationId: string): void;
  /** Jump to a position given as a fraction (0..1) of the whole book. */
  seek(fraction: number): void;
  /** Human label for a fraction, shown while dragging the progress bar ("Page 120 of 300 · Chapter 7"). */
  describe(fraction: number): string;
}

export interface EngineProps {
  data: ArrayBuffer;
  annotations: Annotation[];
  authorColors: Map<string, string>;
  theme: ReaderTheme;
  /** EPUB only. */
  typography: Typography;
  /** Text of the active search; its matches are outlined on visible pages. */
  searchMark: string | null;
  flipMode: FlipMode;
  pageLayout: PageLayout;
  /** PDF only. */
  pdfFit: PdfFit;
  zoom: number;
  initialLocation: string | null;
  /** `rtl`: the book turns pages right-to-left (Arabic, Hebrew, Japanese…). `lang`: the book's language code. */
  onReady: (toc: TocItem[], info?: { rtl?: boolean; lang?: string }) => void;
  onLocation: (info: LocationInfo) => void;
  onSelection: (sel: SelectionInfo | null) => void;
  onAnnotationClick: (id: string, rect: DOMRect) => void;
  onTap: (zone: TapZone) => void;
  onError: (e: Error) => void;
}

export const isPdfLocation = (loc: string) => /^p\d+$/.test(loc);
export const pdfLocation = (pageIndex: number) => `p${pageIndex}`;
export const pdfPageOf = (loc: string) => Number(loc.slice(1));
