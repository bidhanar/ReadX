import { addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { isOnline, queued } from './sync';
import { db } from '../lib/firebase';
import type { Book } from '../lib/types';
import { useLiveDoc, useLiveQuery } from './useLive';
import { deleteBookFile } from './files';

export const booksCol = (gid: string) => collection(db, 'groups', gid, 'books');
export const bookRef = (gid: string, bookId: string) => doc(db, 'groups', gid, 'books', bookId);

export function useBooks(gid: string | undefined) {
  return useLiveQuery<Book>(gid ? query(booksCol(gid), orderBy('createdAt', 'desc')) : null, `books:${gid}`);
}

export function useBook(gid: string | undefined, bookId: string | undefined) {
  return useLiveDoc<Book>(gid && bookId ? bookRef(gid, bookId) : null, `book:${gid}/${bookId}`);
}

export async function addBook(gid: string, book: Omit<Book, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(booksCol(gid), { ...book, createdAt: serverTimestamp() });
  return ref.id;
}

export const updateBookMeta = (gid: string, bookId: string, title: string, author: string) =>
  queued(updateDoc(bookRef(gid, bookId), { title: title.trim(), author: author.trim() }), 'Edit book details');

export function deleteBook(gid: string, book: Book, byUploader: boolean) {
  queued(deleteDoc(bookRef(gid, book.id)), 'Delete book');
  // The storage policy only lets the uploader delete the file; the owner removing someone
  // else's book just unlists it. (Offline, the file is left behind; harmless, just unused.)
  if (byUploader && isOnline()) deleteBookFile(book.filePath).catch(() => {});
}
