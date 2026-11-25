import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../auth/AuthProvider';
import { removeMember, renameGroup, resetInvite, setGroupLogo, useGroup, useMembers } from '../data/groups';
import { squareLogo } from '../lib/image';
import { deleteBook, updateBookMeta, useBooks } from '../data/books';
import { downloadBooks, useOnDevice } from '../data/files';
import { useOnline } from '../data/sync';
import type { Book, Group, LibraryEntry, Member, Progress } from '../lib/types';
import { appLink, cx, formatBytes } from '../lib/util';
import { Chat } from '../components/Chat';
import { useMessages } from '../data/messages';
import { useSeen, useUnread } from '../data/seen';
import { isFinished, libKey, useGroupProgress, useLibrary, useShelves } from '../data/library';
import { BookMenu } from '../components/BookMenu';
import { ThemeToggle } from '../components/ThemeToggle';
import {
  IconBack,
  IconBook,
  IconChat,
  IconCheck,
  IconDownload,
  IconCopy,
  IconImage,
  IconMore,
  IconRefresh,
  IconShare,
  IconUpload,
  IconUsers,
} from '../components/icons';
import { Avatar, EmptyState, ErrorText, FullScreenSpinner, Modal, Spinner } from '../components/ui';

type Tab = 'shelf' | 'chat' | 'members';

export default function GroupPage({ tab = 'shelf' }: { tab?: Tab }) {
  const { gid = '' } = useParams();
  const user = useUser();
  const group = useGroup(gid);
  const members = useMembers(gid);
  const messages = useMessages(gid);
  const chatSeen = useSeen(user.uid, `chat_${gid}`);
  const unreadChat = useUnread(messages.data, user.uid, chatSeen.seenAt).length;
  const memberMap = useMemo(() => new Map(members.data.map((m) => [m.uid, m as Member])), [members.data]);

  if (group.loading) return <FullScreenSpinner />;
  if (group.error || !group.data)
    return (
      <div className="mx-auto max-w-sm p-8 text-center">
        <ErrorText
          error={
            group.error ??
            new Error(
              group.fromCache && !navigator.onLine
                ? "This group hasn't been synced to this device yet. Open it once while online."
                : "This group doesn't exist or you're not a member.",
            )
          }
        />
        <Link to="/" className="btn-primary mt-6">
          Go home
        </Link>
      </div>
    );

  const g = group.data;
  const isOwner = g.ownerId === user.uid;
  const tabs: { id: Tab; label: string; icon: React.ReactNode; to: string }[] = [
    { id: 'shelf', label: 'Shelf', icon: <IconBook size={18} />, to: `/g/${gid}` },
    { id: 'chat', label: 'Chat', icon: <IconChat size={18} />, to: `/g/${gid}/chat` },
    { id: 'members', label: 'Members', icon: <IconUsers size={18} />, to: `/g/${gid}/members` },
  ];

  return (
    <div className="safe-top flex h-full flex-col">
      <header className="border-line bg-paper/90 flex items-center gap-2 border-b px-2 py-2 backdrop-blur">
        <Link to="/" className="icon-btn" aria-label="Back">
          <IconBack />
        </Link>
        <Avatar uid={g.id} name={g.name} photo={g.logo} size={34} square />
        <div className="min-w-0 flex-1">
          <h1 className="truncate leading-tight font-semibold">{g.name}</h1>
          <p className="text-ink-soft truncate text-xs">
            {members.data.length} member{members.data.length === 1 ? '' : 's'}
          </p>
        </div>
        <ThemeToggle />
      </header>

      <nav className="border-line flex border-b lg:hidden">
        {tabs.map((t) => (
          <Link
            key={t.id}
            to={t.to}
            replace
            className={cx(
              'flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium',
              tab === t.id ? 'text-brand border-brand border-b-2' : 'text-ink-soft',
            )}
          >
            {t.icon}
            {t.label}
            {t.id === 'chat' && unreadChat > 0 && tab !== 'chat' && <UnreadBadge n={unreadChat} />}
          </Link>
        ))}
      </nav>

      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[1fr_400px]">
        <div className={cx('h-full min-h-0 overflow-y-auto', tab === 'chat' && 'hidden lg:block')}>
          <nav className="hidden gap-1 px-5 pt-4 lg:flex">
            {tabs
              .filter((t) => t.id !== 'chat')
              .map((t) => (
                <Link
                  key={t.id}
                  to={t.to}
                  replace
                  className={cx('btn', tab === t.id || (tab === 'chat' && t.id === 'shelf') ? 'bg-brand-soft text-brand' : 'btn-ghost')}
                >
                  {t.icon}
                  {t.label}
                </Link>
              ))}
          </nav>
          {tab === 'members' ? (
            <MembersTab group={g} members={members.data as Member[]} isOwner={isOwner} />
          ) : (
            <ShelfTab gid={gid} isOwner={isOwner} members={memberMap} />
          )}
        </div>
        <div className={cx('border-line h-full min-h-0 lg:block lg:border-l', tab === 'chat' ? 'block' : 'hidden')}>
          <Chat gid={gid} members={memberMap} isOwner={isOwner} />
        </div>
      </div>
    </div>
  );
}

function ShelfTab({ gid, isOwner, members }: { gid: string; isOwner: boolean; members: Map<string, Member> }) {
  const user = useUser();
  const navigate = useNavigate();
  const { data: books, loading, error } = useBooks(gid);
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Book | null>(null);
  const [menu, setMenu] = useState<Book | null>(null);
  const library = useLibrary(user.uid);
  const shelves = useShelves(user.uid);
  const progress = useGroupProgress(
    gid,
    books.map((b) => b.id),
  );
  const online = useOnline();
  const onDevice = useOnDevice(books.map((b) => b.filePath));
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [dlAll, setDlAll] = useState<string | null>(null);
  const missing = books.filter((b) => !onDevice.has(b.filePath));

  const download = async (paths: string[]) => {
    setDownloading((s) => new Set([...s, ...paths]));
    try {
      await downloadBooks(paths, (done, total) => total > 1 && setDlAll(`Saving ${done}/${total}…`));
    } catch (e) {
      setUploadError(e);
    } finally {
      setDownloading((s) => new Set([...s].filter((p) => !paths.includes(p))));
      setDlAll(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setStatus('Preparing…');
    try {
      const { uploadBook } = await import('../upload/uploadBook');
      const bookId = await uploadBook(user, gid, file, setStatus);
      setStatus(null);
      navigate(`/g/${gid}/b/${bookId}`);
    } catch (e) {
      setUploadError(e);
      setStatus(null);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-ink-soft text-xs font-semibold tracking-wider uppercase">Shared shelf</h2>
        <div className="flex-1" />
        {online && missing.length > 0 && (
          <button
            className="btn-ghost mr-1 text-sm"
            onClick={() => download(missing.map((b) => b.filePath))}
            disabled={!!dlAll}
            title="Download every book on this shelf so it opens without internet"
          >
            {dlAll ? <Spinner className="h-4 w-4" /> : <IconDownload size={16} />}
            <span className="hidden sm:inline">{dlAll ?? `Save all offline (${missing.length})`}</span>
          </button>
        )}
        <button
          className="btn-primary"
          onClick={() => fileInput.current?.click()}
          disabled={!!status || !online}
          title={online ? undefined : 'Adding a book needs an internet connection'}
        >
          {status ? <Spinner className="h-4 w-4" /> : <IconUpload size={18} />}
          {status ?? 'Add book'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.epub,application/pdf,application/epub+zip"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
      <ErrorText error={uploadError} />

      {loading ? (
        <div className="text-ink-soft py-10 text-center">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorText error={error} />
      ) : books.length === 0 ? (
        <EmptyState icon={<IconBook />} title="The shelf is empty">
          Add a PDF or EPUB. Everyone in the group can read it and see each other's highlights and notes.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-4 gap-y-6">
          {books.map((b) => (
            <li key={b.id} className="group relative">
              <Link to={`/g/${gid}/b/${b.id}`} className={cx('block', !online && !onDevice.has(b.filePath) && 'opacity-45 grayscale')}>
                <div className="bg-brand-soft relative aspect-[2/3] overflow-hidden rounded-lg shadow-md ring-1 ring-black/5 transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
                  {b.cover ? (
                    <img src={b.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="text-brand flex h-full flex-col items-center justify-center p-3 text-center">
                      <IconBook size={28} />
                      <span className="mt-2 line-clamp-4 font-serif text-sm">{b.title}</span>
                    </div>
                  )}
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase">
                    {b.format}
                  </span>
                  {onDevice.has(b.filePath) && (
                    <span
                      className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      title="Saved on this device: opens without internet"
                    >
                      <IconCheck size={11} /> Offline
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-tight font-medium">{b.title}</p>
                {b.author && <p className="text-ink-soft truncate text-xs">{b.author}</p>}
                <ReadingNow
                  mine={library.data.find((e) => e.id === libKey(gid, b.id))}
                  progress={progress.get(b.id) ?? []}
                  myUid={user.uid}
                  members={members}
                />
              </Link>
              {online && !onDevice.has(b.filePath) && (
                <button
                  className="text-brand absolute top-1 left-1 flex items-center gap-1 rounded-full bg-card/90 px-2 py-1 text-[11px] font-medium shadow"
                  onClick={() => download([b.filePath])}
                  disabled={downloading.has(b.filePath)}
                  title="Download so this book opens without internet"
                >
                  {downloading.has(b.filePath) ? <Spinner className="h-3 w-3" /> : <IconDownload size={13} />}
                  {downloading.has(b.filePath) ? 'Saving…' : 'Save offline'}
                </button>
              )}
              <button
                className="absolute top-1 right-1 rounded-full bg-card/90 p-1 opacity-100 shadow sm:opacity-0 sm:group-hover:opacity-100"
                onClick={() => setMenu(b)}
                aria-label="Book options"
              >
                <IconMore size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <BookMenu
          uid={user.uid}
          gid={gid}
          book={menu}
          entry={library.data.find((e) => e.id === libKey(gid, menu.id))}
          shelves={shelves.data}
          onClose={() => setMenu(null)}
        >
          {(menu.uploadedBy === user.uid || isOwner) && (
            <button
              className="btn-ghost w-full justify-center text-sm"
              onClick={() => {
                setEditing(menu);
                setMenu(null);
              }}
            >
              Edit details or remove from the shelf
            </button>
          )}
        </BookMenu>
      )}

      {editing && (
        <EditBookModal
          gid={gid}
          book={editing}
          uploader={members.get(editing.uploadedBy)?.displayName}
          isUploader={editing.uploadedBy === user.uid}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Under a book on the group shelf: how far you are, and who else is reading it. */
function ReadingNow({
  mine,
  progress,
  myUid,
  members,
}: {
  mine: LibraryEntry | undefined;
  progress: Progress[];
  myUid: string;
  members: Map<string, Member>;
}) {
  const myPct = Math.round((mine?.percent ?? progress.find((p) => p.uid === myUid)?.percent ?? 0) * 100);
  const readers = progress.filter((p) => p.uid !== myUid && p.percent > 0 && members.has(p.uid));
  if (!myPct && !readers.length && !isFinished(mine)) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {isFinished(mine) ? (
        <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Finished</p>
      ) : (
        myPct > 0 && (
          <div className="flex items-center gap-1.5" title={`You're ${myPct}% through`}>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
              <div className="bg-brand h-full" style={{ width: `${myPct}%` }} />
            </div>
            <span className="text-ink-soft text-[10px] tabular-nums">{myPct}%</span>
          </div>
        )
      )}
      {readers.length > 0 && (
        <div
          className="flex items-center"
          title={readers.map((p) => `${members.get(p.uid)!.displayName}: ${Math.round(p.percent * 100)}%`).join('\n')}
        >
          {readers.slice(0, 4).map((p, i) => {
            const m = members.get(p.uid)!;
            return (
              <span key={p.uid} className={cx('rounded-full ring-2 ring-paper', i > 0 && '-ml-1.5')}>
                <Avatar uid={m.uid} name={m.displayName} photo={m.photoURL} size={18} />
              </span>
            );
          })}
          <span className="text-ink-soft ml-1.5 text-[10px]">
            {readers.length > 4 ? `+${readers.length - 4} ` : ''}reading
          </span>
        </div>
      )}
    </div>
  );
}

function EditBookModal({
  gid,
  book,
  uploader,
  isUploader,
  onClose,
}: {
  gid: string;
  book: Book;
  uploader?: string;
  isUploader: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => unknown) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Book details">
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-ink-soft">Title</span>
          <input className="input mt-1" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Author</span>
          <input className="input mt-1" value={author} maxLength={200} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <p className="text-ink-soft text-xs">
          {book.format.toUpperCase()} · {formatBytes(book.size)} · added by {isUploader ? 'you' : (uploader ?? 'a former member')}
        </p>
        <ErrorText error={error} />
        <div className="flex gap-2 pt-2">
          <button
            className="btn-outline text-red-600 dark:text-red-400"
            disabled={busy}
            onClick={() =>
              confirm(`Remove “${book.title}” and all its highlights and notes for everyone?`) &&
              run(() => deleteBook(gid, book, isUploader))
            }
          >
            Delete
          </button>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !title.trim()} onClick={() => run(() => updateBookMeta(gid, book.id, title, author))}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MembersTab({ group, members, isOwner }: { group: Group; members: Member[]; isOwner: boolean }) {
  const user = useUser();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<unknown>(null);
  const link = appLink(`/join/${group.inviteCode}`);

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const share = () =>
    navigator.share?.({ title: `Join ${group.name} on ReadX`, text: `Read with us on ReadX — code ${group.inviteCode}`, url: link });

  const wrap = (fn: () => unknown) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="space-y-6 px-5 py-4">
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">Invite people</h2>
        <p className="text-ink-soft mb-3 text-sm">Anyone with this link or code can join after signing in.</p>
        <div className="mb-3 flex items-center gap-2">
          <code className="bg-brand-soft text-brand rounded-lg px-3 py-2 font-mono text-lg tracking-widest">{group.inviteCode}</code>
          <button className="btn-outline" onClick={copy}>
            <IconCopy size={16} /> {copied ? 'Copied!' : 'Copy link'}
          </button>
          {'share' in navigator && (
            <button className="btn-outline" onClick={share}>
              <IconShare size={16} />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}
        </div>
        {isOwner && (
          <button
            className="btn-ghost -ml-3 text-sm"
            onClick={wrap(async () => {
              if (confirm('Reset the invite code? The old link will stop working.')) await resetInvite(group);
            })}
          >
            <IconRefresh size={16} /> Reset code
          </button>
        )}
      </section>

      {isOwner && (
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Group name</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              wrap(() => renameGroup(group.id, name))();
            }}
          >
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary" disabled={!name.trim() || name === group.name}>
              Save
            </button>
          </form>
        </section>
      )}

      {isOwner && <LogoCard group={group} />}

      <section>
        <h2 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Members · {members.length}</h2>
        <ul className="card divide-line divide-y">
          {members.map((m) => (
            <li key={m.uid} className="flex items-center gap-3 px-4 py-3">
              <Avatar uid={m.uid} name={m.displayName} photo={m.photoURL} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.displayName} {m.uid === user.uid && <span className="text-ink-soft">(you)</span>}
                </p>
                <p className="text-ink-soft text-xs">{m.role === 'owner' ? 'Owner' : 'Member'}</p>
              </div>
              {isOwner && m.uid !== user.uid && (
                <button
                  className="btn-ghost text-sm text-red-600 dark:text-red-400"
                  onClick={wrap(async () => {
                    if (confirm(`Remove ${m.displayName} from the group?`)) await removeMember(group.id, m.uid);
                  })}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <ErrorText error={error} />

      {!isOwner && (
        <button
          className="btn-outline text-red-600 dark:text-red-400"
          onClick={wrap(async () => {
            if (!confirm(`Leave ${group.name}?`)) return;
            await removeMember(group.id, user.uid);
            navigate('/');
          })}
        >
          Leave group
        </button>
      )}
    </div>
  );
}

/** Owner: upload, change or remove the group's logo. */
function LogoCard({ group }: { group: Group }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setGroupLogo(group.id, await squareLogo(file));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Group logo</h2>
      <div className="flex items-center gap-4">
        <Avatar uid={group.id} name={group.name} photo={group.logo} size={64} square />
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <IconImage size={16} />}
            {group.logo ? 'Change logo' : 'Upload logo'}
          </button>
          {group.logo && (
            <button className="btn-ghost text-red-600 dark:text-red-400" onClick={() => setGroupLogo(group.id, null)} disabled={busy}>
              Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <p className="text-ink-soft mt-3 text-xs">Everyone in the group sees it next to the group's name. Square images work best; it's cropped to a square.</p>
      <ErrorText error={error} />
    </section>
  );
}

function UnreadBadge({ n }: { n: number }) {
  return (
    <span className="bg-accent ml-0.5 min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-white" aria-label={`${n} unread`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}
