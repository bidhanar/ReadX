import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '../auth/AuthProvider';
import { createGroup, joinGroup, useMyGroups } from '../data/groups';
import {
  createShelf,
  deleteShelf,
  isFinished,
  isStarted,
  libKey,
  renameShelf,
  useAllBooks,
  useLibrary,
  useLibraryBackfill,
  useShelves,
  type LibraryBook,
} from '../data/library';
import { useDeviceSetting } from '../data/settings';
import type { LibraryEntry, Shelf } from '../lib/types';
import { BookMenu } from '../components/BookMenu';
import { ThemeToggle } from '../components/ThemeToggle';
import { IconBook, IconChevronRight, IconLibrary, IconLogout, IconMore, IconPlus, IconUsers } from '../components/icons';
import { Avatar, EmptyState, ErrorText, Modal, Spinner } from '../components/ui';
import { cx, publicUrl } from '../lib/util';

export default function HomePage() {
  const user = useUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { groups, loading, error } = useMyGroups(user.uid);
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      // Accept a full invite link as well as a bare code
      const code = value.trim().split('/join/').pop()!;
      const gid = mode === 'create' ? await createGroup(user, value) : await joinGroup(user, code);
      navigate(`/g/${gid}`);
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };

  const open = (m: 'create' | 'join') => {
    setMode(m);
    setValue('');
    setFormError(null);
  };

  return (
    <div className="safe-top mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="flex items-center gap-3 px-5 pt-6 pb-4">
        <img src={publicUrl('icon.svg')} alt="" className="h-11 w-11" />
        <h1 className="flex-1 font-serif text-2xl font-semibold">ReadX</h1>
        <ThemeToggle />
        <Avatar uid={user.uid} name={user.displayName || ''} photo={user.photoURL} size={34} />
        <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
          <IconLogout />
        </button>
      </header>

      <div className="flex gap-2 px-5 pb-4">
        <button className="btn-primary" onClick={() => open('create')}>
          <IconPlus size={18} /> New group
        </button>
        <button className="btn-outline" onClick={() => open('join')}>
          Join with code
        </button>
      </div>

      <main className="flex-1 px-5 pb-10">
        <Library uid={user.uid} groups={groups} />

        <h2 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Your groups</h2>
        {loading ? (
          <div className="text-ink-soft py-10 text-center">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorText error={error} />
        ) : groups.length === 0 ? (
          <EmptyState icon={<IconUsers />} title="No groups yet">
            Create a group for your book club, class or friends, then share the invite link.
          </EmptyState>
        ) : (
          <ul className="card divide-line divide-y overflow-hidden">
            {groups.map((g) => (
              <li key={g.id}>
                <Link to={`/g/${g.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-ink/[0.04]">
                  <Avatar uid={g.id} name={g.name} photo={g.logo} size={42} square />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{g.name}</p>
                    <p className="text-ink-soft text-xs">{g.ownerId === user.uid ? 'You own this group' : 'Member'}</p>
                  </div>
                  <IconChevronRight className="text-ink-soft" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode === 'create' ? 'New group' : 'Join a group'}>
        <form onSubmit={submit} className="space-y-3">
          <input
            autoFocus
            className="input"
            placeholder={mode === 'create' ? 'Group name, e.g. Sunday Book Club' : 'Invite code or link'}
            value={value}
            maxLength={mode === 'create' ? 80 : 200}
            onChange={(e) => setValue(e.target.value)}
          />
          <ErrorText error={formError} />
          <button className="btn-primary w-full" disabled={busy || !value.trim()}>
            {busy && <Spinner className="h-4 w-4" />}
            {mode === 'create' ? 'Create group' : 'Join'}
          </button>
        </form>
      </Modal>
    </div>
  );
}

// ---- Continue reading + your bookshelf ------------------------------------------------------------

type AutoShelf = 'all' | 'reading' | 'unread' | 'finished';
const AUTO: { id: AutoShelf; label: string; test: (e?: LibraryEntry) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'reading', label: 'Reading', test: (e) => isStarted(e) && !isFinished(e) },
  { id: 'unread', label: 'Not started', test: (e) => !isStarted(e) && !isFinished(e) },
  { id: 'finished', label: 'Finished', test: (e) => isFinished(e) },
];

function Library({ uid, groups }: { uid: string; groups: ReturnType<typeof useMyGroups>['groups'] }) {
  const { books, loading } = useAllBooks(groups);
  const library = useLibrary(uid);
  const shelves = useShelves(uid);
  const entries = useMemo(() => new Map(library.data.map((e) => [e.id, e])), [library.data]);
  useLibraryBackfill(uid, books, library.data, !loading && !library.loading && !library.fromCache);
  const [view, setView] = useDeviceSetting('homeShelf', { shelf: 'all' as string });
  const [menu, setMenu] = useState<LibraryBook | null>(null);
  const [editing, setEditing] = useState<Shelf | 'new' | null>(null);

  const entryOf = (b: LibraryBook) => entries.get(libKey(b.gid, b.book.id));
  const continuing = books
    .filter((b) => {
      const e = entryOf(b);
      return isStarted(e) && !isFinished(e);
    })
    .sort((a, b) => (entryOf(b)?.readAt?.toMillis() ?? 0) - (entryOf(a)?.readAt?.toMillis() ?? 0))
    .slice(0, 3);

  const custom = shelves.data.find((s) => s.id === view.shelf);
  const auto = AUTO.find((a) => a.id === view.shelf) ?? (custom ? null : AUTO[0]);
  const shown = books.filter((b) => (auto ? auto.test(entryOf(b)) : !!entryOf(b)?.shelves?.includes(custom!.id)));
  const countOf = (test: (b: LibraryBook) => boolean) => books.filter(test).length;

  if (groups.length === 0) return null;
  if (loading && books.length === 0)
    return (
      <div className="text-ink-soft py-6 text-center">
        <Spinner />
      </div>
    );
  if (books.length === 0) return null;

  return (
    <>
      {continuing.length > 0 && (
        <section className="mb-7">
          <h2 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Continue reading</h2>
          <ul className="space-y-2">
            {continuing.map((b) => {
              const pct = Math.round((entryOf(b)?.percent ?? 0) * 100);
              return (
                <li key={`${b.gid}/${b.book.id}`}>
                  <Link to={`/g/${b.gid}/b/${b.book.id}`} className="card flex items-center gap-3 p-2.5 pr-4 hover:bg-ink/[0.04]">
                    <Cover book={b.book} className="h-16 w-11 shrink-0 rounded" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.book.title}</p>
                      <p className="text-ink-soft truncate text-xs">{b.groupName}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
                          <div className="bg-brand h-full rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-ink-soft text-xs tabular-nums">{pct}%</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-ink-soft mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
          <IconLibrary size={14} /> My bookshelf
        </h2>
        <div className="no-scrollbar -mx-5 mb-3 flex gap-1.5 overflow-x-auto px-5 pb-1">
          {AUTO.map((a) => (
            <Chip key={a.id} on={view.shelf === a.id || (a.id === 'all' && !auto && !custom)} onClick={() => setView({ shelf: a.id })}>
              {a.label} <span className="opacity-60">{countOf((b) => a.test(entryOf(b)))}</span>
            </Chip>
          ))}
          {shelves.data.map((s) => (
            <Chip key={s.id} on={view.shelf === s.id} onClick={() => setView({ shelf: s.id })}>
              {s.name} <span className="opacity-60">{countOf((b) => !!entryOf(b)?.shelves?.includes(s.id))}</span>
            </Chip>
          ))}
          <Chip on={false} onClick={() => setEditing('new')}>
            <IconPlus size={14} /> New shelf
          </Chip>
        </div>
        {custom && (
          <div className="text-ink-soft -mt-1 mb-3 flex gap-3 text-xs">
            <button className="hover:text-ink underline" onClick={() => setEditing(custom)}>
              Rename shelf
            </button>
            <button
              className="underline hover:text-red-600 dark:text-red-400"
              onClick={() => {
                if (!confirm(`Delete the shelf “${custom.name}”? The books stay in your groups.`)) return;
                deleteShelf(uid, custom.id, library.data);
                setView({ shelf: 'all' });
              }}
            >
              Delete shelf
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="text-ink-soft rounded-2xl border border-dashed px-4 py-6 text-center text-sm">
            {custom ? 'No books on this shelf yet. Use a book’s ⋮ menu to add it.' : 'Nothing here yet.'}
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-5">
            {shown.map((b) => {
              const e = entryOf(b);
              const pct = Math.round((e?.percent ?? 0) * 100);
              return (
                <li key={`${b.gid}/${b.book.id}`} className="group relative">
                  <Link to={`/g/${b.gid}/b/${b.book.id}`} className="block">
                    <div className="relative">
                      <Cover book={b.book} className="aspect-[2/3] w-full rounded-lg shadow-md ring-1 ring-black/5 transition group-hover:-translate-y-0.5" />
                      {isFinished(e) ? (
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">Finished</span>
                      ) : (
                        pct > 0 && (
                          <div className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-white/80 shadow-sm ring-1 ring-black/10">
                            <div className="bg-brand h-full" style={{ width: `${pct}%` }} />
                          </div>
                        )
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-tight font-medium">{b.book.title}</p>
                    <p className="text-ink-soft truncate text-[11px]">{b.groupName}</p>
                  </Link>
                  <button
                    className="absolute top-1 right-1 rounded-full bg-card/90 p-1 shadow sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={() => setMenu(b)}
                    aria-label="Book options"
                  >
                    <IconMore size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {menu && (
        <BookMenu
          uid={uid}
          gid={menu.gid}
          book={menu.book}
          entry={entryOf(menu)}
          shelves={shelves.data}
          subtitle={menu.groupName}
          onClose={() => setMenu(null)}
        >
          <Link to={`/g/${menu.gid}`} className="btn-ghost w-full justify-center text-sm">
            Go to {menu.groupName}
          </Link>
        </BookMenu>
      )}
      {editing && (
        <ShelfNameModal
          shelf={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(name) => {
            if (editing === 'new') setView({ shelf: createShelf(uid, name) });
            else renameShelf(uid, editing.id, name);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cx('btn shrink-0 gap-1 px-3 py-1 text-sm whitespace-nowrap', on ? 'bg-brand text-on-brand' : 'text-ink-soft bg-ink/5')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Cover({ book, className }: { book: LibraryBook['book']; className?: string }) {
  return book.cover ? (
    <img src={book.cover} alt="" className={cx('bg-brand-soft object-cover', className)} />
  ) : (
    <div className={cx('bg-brand-soft text-brand flex flex-col items-center justify-center overflow-hidden p-1.5 text-center', className)}>
      <IconBook size={18} />
      <span className="mt-1 line-clamp-3 font-serif text-[10px] leading-tight">{book.title}</span>
    </div>
  );
}

function ShelfNameModal({ shelf, onClose, onSave }: { shelf: Shelf | null; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(shelf?.name ?? '');
  return (
    <Modal open onClose={onClose} title={shelf ? 'Rename shelf' : 'New shelf'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name);
        }}
      >
        <input autoFocus className="input" placeholder="e.g. Fiction, For class, Favourites" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary w-full" disabled={!name.trim()}>
          {shelf ? 'Save' : 'Create shelf'}
        </button>
      </form>
    </Modal>
  );
}
