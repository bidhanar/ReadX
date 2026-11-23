import type { Timestamp } from 'firebase/firestore';

export type BookFormat = 'pdf' | 'epub';
export type AnnotationType = 'highlight' | 'note' | 'link' | 'comment';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt?: Timestamp;
}

export interface Member {
  uid: string;
  role: 'owner' | 'member';
  displayName: string;
  photoURL: string | null;
  joinedAt?: Timestamp;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  filePath: string;
  size: number;
  cover: string | null; // small JPEG data URL
  uploadedBy: string;
  createdAt?: Timestamp;
}

/** Normalized rectangle (0..1) relative to a PDF page box. */
export interface NRect { x: number; y: number; w: number; h: number }

export type Anchor =
  | { kind: 'pdf'; page: number; rects: NRect[]; quote: string }
  | { kind: 'epub'; cfi: string; spine: number; quote: string };

export interface Annotation {
  id: string;
  authorId: string;
  type: AnnotationType;
  color: HighlightColor;
  text: string; // note / comment body ('' for plain highlight)
  url: string; // for links ('' otherwise)
  anchor: Anchor;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Reply {
  id: string;
  authorId: string;
  text: string;
  createdAt?: Timestamp;
}

export interface Message {
  id: string;
  authorId: string;
  text: string;
  createdAt?: Timestamp;
  editedAt?: Timestamp;
  /** A passage shared from a book */
  ref?: { bookId: string; bookTitle: string; annotationId?: string; location: string; quote: string } | null;
}

export interface Progress {
  uid: string;
  location: string; // pdf: page number as string; epub: CFI
  percent: number; // 0..1
  updatedAt?: Timestamp;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type FlipMode = 'curl' | 'slide' | 'scroll';
export type FontChoice = 'publisher' | 'serif' | 'sans';
export type LineSpacing = 'compact' | 'publisher' | 'relaxed';
export type Margins = 'narrow' | 'normal' | 'wide';

/** EPUB typography (PDFs have fixed typesetting). */
export interface Typography {
  fontSize: number; // percent
  font: FontChoice;
  lineSpacing: LineSpacing;
  margins: Margins;
}

export interface BookPrefs {
  hiddenAuthors: string[];
  hiddenTypes: AnnotationType[];
  theme: ReaderTheme;
  fontSize: number; // percent, epub only
  font: FontChoice;
  lineSpacing: LineSpacing;
  margins: Margins;
  flipMode: FlipMode;
}

export const DEFAULT_PREFS: BookPrefs = {
  hiddenAuthors: [],
  hiddenTypes: [],
  theme: 'light',
  fontSize: 100,
  font: 'publisher',
  lineSpacing: 'publisher',
  margins: 'normal',
  flipMode: 'curl',
};

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'rgba(250, 204, 21, 0.38)',
  green: 'rgba(74, 222, 128, 0.36)',
  blue: 'rgba(96, 165, 250, 0.36)',
  pink: 'rgba(244, 114, 182, 0.36)',
  purple: 'rgba(167, 139, 250, 0.38)',
};
