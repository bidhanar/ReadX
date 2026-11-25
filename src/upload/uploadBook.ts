import ePub from 'epubjs';
import type { User } from 'firebase/auth';
import { pdfjs } from '../lib/pdfjs';
import { uuid } from '../lib/util';
import { uploadBookFile } from '../data/files';
import { addBook } from '../data/books';
import type { BookFormat } from '../lib/types';
import { NeedsInternetError, isOnline } from '../data/sync';
import { useEmulators } from '../lib/firebase';

export const MAX_BOOK_BYTES = 50 * 1024 * 1024;

interface Extracted {
  title: string;
  author: string;
  cover: string | null;
}

function formatOf(file: File): BookFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') return 'epub';
  return null;
}

function baseTitle(file: File) {
  return file.name.replace(/\.(pdf|epub)$/i, '').replace(/[_-]+/g, ' ').trim();
}

/** Downscale any drawable to a small JPEG data URL (stored inline in Firestore, ~15–40 KB). */
function toCoverDataUrl(src: CanvasImageSource, w: number, h: number): string {
  const targetW = 240;
  const scale = Math.min(1, targetW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

async function extractPdf(buf: ArrayBuffer, file: File): Promise<Extracted> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  try {
    const meta = await pdf.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = 480 / vp.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return {
      title: info.Title?.trim() || baseTitle(file),
      author: info.Author?.trim() || '',
      cover: toCoverDataUrl(canvas, canvas.width, canvas.height),
    };
  } finally {
    pdf.loadingTask.destroy();
  }
}

async function extractEpub(buf: ArrayBuffer, file: File): Promise<Extracted> {
  const book = ePub(buf.slice(0) as unknown as string);
  try {
    await book.opened;
    const meta = await book.loaded.metadata;
    let cover: string | null = null;
    const coverUrl = await book.coverUrl().catch(() => null);
    if (coverUrl) {
      cover = await new Promise<string | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(toCoverDataUrl(img, img.naturalWidth, img.naturalHeight));
        img.onerror = () => resolve(null);
        img.src = coverUrl;
      });
    }
    return { title: meta.title?.trim() || baseTitle(file), author: meta.creator?.trim() || '', cover };
  } finally {
    // epub.js keeps loading the table of contents after `opened`; destroying the book mid-way makes
    // that finish against a torn-down object and throw. Let it settle first.
    await Promise.race([book.loaded.navigation.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    book.destroy();
  }
}

export async function uploadBook(
  user: User,
  gid: string,
  file: File,
  onStatus: (s: string) => void,
): Promise<string> {
  if (!isOnline() && !useEmulators) throw new NeedsInternetError('Adding a book');
  const format = formatOf(file);
  if (!format) throw new Error('Only PDF and EPUB files are supported.');
  if (file.size > MAX_BOOK_BYTES) throw new Error('Files must be 50 MB or smaller.');

  onStatus('Reading book details…');
  const buf = await file.arrayBuffer();
  let meta: Extracted;
  try {
    meta = format === 'pdf' ? await extractPdf(buf, file) : await extractEpub(buf, file);
  } catch (e) {
    console.warn('metadata extraction failed', e);
    if (format === 'epub') throw new Error('This EPUB could not be opened. Is the file valid?');
    meta = { title: baseTitle(file), author: '', cover: null };
  }

  onStatus('Uploading…');
  const filePath = `books/${uuid()}.${format}`;
  const contentType = format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
  await uploadBookFile(filePath, new Blob([buf], { type: contentType }), contentType, user.uid);

  onStatus('Adding to shelf…');
  return addBook(gid, {
    title: meta.title.slice(0, 300),
    author: meta.author.slice(0, 200),
    format,
    filePath,
    size: file.size,
    cover: meta.cover,
    uploadedBy: user.uid,
  });
}
