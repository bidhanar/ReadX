import type { Timestamp } from 'firebase/firestore';

export type BookFormat = 'pdf' | 'epub';
export type AnnotationType = 'highlight' | 'note' | 'link' | 'comment';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  /** Small square image as a data URL (set by the owner), or none. */
  logo?: string | null;
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
  /** Which app session wrote it, so a reader can tell your other devices' moves from its own. */
  device?: string;
  updatedAt?: Timestamp;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';
/** 'auto' follows the device's light/dark setting. */
export type ThemeChoice = ReaderTheme | 'auto';
export type FlipMode = 'curl' | 'slide' | 'scroll';
/** Single page, two-page spread, or decide from the screen shape. */
export type PageLayout = 'auto' | 'single' | 'double';
/** PDF single page: show the whole page, or fill the screen width and scroll down the page. */
export type PdfFit = 'page' | 'width';
export type FontChoice = 'publisher' | 'serif' | 'sans';
export type LineSpacing = 'compact' | 'publisher' | 'relaxed';
export type Margins = 'narrow' | 'normal' | 'wide';
export type Hyphenation = 'auto' | 'none';

/** EPUB typography (PDFs have fixed typesetting). */
export interface Typography {
  fontSize: number; // percent
  font: FontChoice;
  lineSpacing: LineSpacing;
  margins: Margins;
  hyphens: Hyphenation;
}

export interface BookPrefs {
  hiddenAuthors: string[];
  hiddenTypes: AnnotationType[];
  theme: ThemeChoice;
  fontSize: number; // percent, epub only
  font: FontChoice;
  lineSpacing: LineSpacing;
  margins: Margins;
  /** EPUB only. 'none' also ignores soft hyphens the book itself contains. */
  hyphens: Hyphenation;
  flipMode: FlipMode;
  pageLayout: PageLayout;
  pdfFit: PdfFit;
}

export const DEFAULT_PREFS: BookPrefs = {
  hiddenAuthors: [],
  hiddenTypes: [],
  theme: 'auto',
  fontSize: 100,
  font: 'publisher',
  lineSpacing: 'publisher',
  margins: 'normal',
  hyphens: 'none',
  flipMode: 'curl',
  pageLayout: 'auto',
  pdfFit: 'width',
};

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'rgba(250, 204, 21, 0.38)',
  green: 'rgba(74, 222, 128, 0.36)',
  blue: 'rgba(96, 165, 250, 0.36)',
  pink: 'rgba(244, 114, 182, 0.36)',
  purple: 'rgba(167, 139, 250, 0.38)',
};

// ---- Personal library (private, under users/{uid}) ------------------------------------------------

/** users/{uid}/library/{gid}__{bookId}: your own state for one book. */
export interface LibraryEntry {
  id: string;
  gid: string;
  bookId: string;
  location?: string;
  percent?: number;
  readAt?: Timestamp;
  /** Furthest point you've read up to (a location); the spoiler shield hides what's past it. */
  furthest?: string;
  /** Ids of your shelves this book is on. */
  shelves?: string[];
  /** Set by hand; otherwise a book counts as finished at the last page. */
  finished?: boolean;
}

/** users/{uid}/shelves/{id} */
export interface Shelf {
  id: string;
  name: string;
  createdAt?: Timestamp;
}

/** users/{uid}/library/{key}/bookmarks/{id} */
export interface Bookmark {
  id: string;
  location: string;
  percent: number;
  label: string;
  createdAt?: Timestamp;
}

/** users/{uid}/settings/app: reader behaviour, synced across your devices. */
export interface AppSettings {
  spoilerShield: boolean;
  keepAwake: boolean;
  volumeKeys: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { spoilerShield: true, keepAwake: true, volumeKeys: true };
