import { useState, type ReactNode } from 'react';
import { createShelf, isFinished, setFinished, setOnShelf } from '../data/library';
import type { Book, LibraryEntry, Shelf } from '../lib/types';
import { cx } from '../lib/util';
import { IconCheck, IconPlus } from './icons';
import { Modal } from './ui';

/** Your own options for a book: which of your shelves it's on, and whether you've finished it. */
export function BookMenu({
  uid,
  gid,
  book,
  entry,
  shelves,
  subtitle,
  onClose,
  children,
}: {
  uid: string;
  gid: string;
  book: Book;
  entry: LibraryEntry | undefined;
  shelves: Shelf[];
  subtitle?: ReactNode;
  onClose: () => void;
  /** Extra actions (e.g. editing the book's details for its uploader). */
  children?: ReactNode;
}) {
  const [name, setName] = useState('');
  const on = new Set(entry?.shelves ?? []);
  const finished = isFinished(entry);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = createShelf(uid, name);
    setOnShelf(uid, gid, book.id, id, true);
    setName('');
  };

  return (
    <Modal open onClose={onClose} title={book.title}>
      <div className="space-y-5">
        {(book.author || subtitle) && (
          <p className="text-ink-soft -mt-3 text-sm">
            {book.author}
            {book.author && subtitle ? ' · ' : ''}
            {subtitle}
          </p>
        )}

        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Your shelves</h3>
          {shelves.length === 0 && <p className="text-ink-soft mb-2 text-sm">Make shelves like “Fiction”, “For class” or “Favourites”. Only you see them.</p>}
          <ul className="space-y-1">
            {shelves.map((s) => (
              <li key={s.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-ink/[0.04]"
                  onClick={() => setOnShelf(uid, gid, book.id, s.id, !on.has(s.id))}
                  role="checkbox"
                  aria-checked={on.has(s.id)}
                >
                  <span
                    className={cx(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                      on.has(s.id) ? 'bg-brand border-brand text-on-brand' : 'border-line',
                    )}
                  >
                    {on.has(s.id) && <IconCheck size={14} />}
                  </span>
                  <span className="text-sm">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={add} className="mt-2 flex gap-2">
            <input className="input" placeholder="New shelf" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button className="btn-outline shrink-0" disabled={!name.trim()}>
              <IconPlus size={16} /> Add
            </button>
          </form>
        </section>

        <button className="btn-outline w-full justify-center" onClick={() => setFinished(uid, gid, book.id, !finished)}>
          <IconCheck size={16} /> {finished ? 'Mark as not finished' : 'Mark as finished'}
        </button>

        {children}
      </div>
    </Modal>
  );
}
