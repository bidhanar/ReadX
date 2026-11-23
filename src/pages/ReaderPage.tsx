import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthProvider';
import { useBook } from '../data/books';
import { useGroup, useMembers } from '../data/groups';
import { createAnnotation, useAnnotations } from '../data/annotations';
import { useProgress, saveProgress } from '../data/progress';
import { useBookPrefs } from '../data/prefs';
import { loadBookFile } from '../data/files';
import { sendMessage } from '../data/messages';
import type { Anchor, Annotation, Book, Member, Progress } from '../lib/types';
import { cx, debounce, userColor } from '../lib/util';
import { PdfView } from '../reader/pdf/PdfView';
import { EpubView } from '../reader/epub/EpubView';
import type { EngineHandle, LocationInfo, SelectionInfo, TocItem } from '../reader/engine';
import type { TapZone } from '../reader/Pager';
import { SelectionMenu, type SelectionAction } from '../reader/annotations/SelectionMenu';
import { Composer } from '../reader/annotations/Composer';
import { ThreadPanel } from '../reader/annotations/ThreadPanel';
import { AnnotationList, LayersPanel, SearchBox, SettingsPanel, TocList } from '../reader/panels';
import { Scrubber, markerLeft } from '../reader/Scrubber';
import { Chat } from '../components/Chat';
import {
  IconBack,
  IconChat,
  IconChevronLeft,
  IconChevronRight,
  IconLayers,
  IconList,
  IconNote,
  IconSearch,
  IconSettings,
  IconX,
} from '../components/icons';
import { Avatar, ErrorText, FullScreenSpinner, Modal, Panel, Spinner } from '../components/ui';

type PanelId = 'toc' | 'search' | 'notes' | 'layers' | 'settings' | 'chat';

const STAGE_BG = { light: '#e8e4db', sepia: '#e3d8c1', dark: '#111215' } as const;

export default function ReaderPage() {
  const { gid = '', bookId = '' } = useParams();
  const user = useUser();
  const book = useBook(gid, bookId);
  const group = useGroup(gid);
  const members = useMembers(gid);
  const progress = useProgress(gid, bookId);
  const { prefs, loaded: prefsLoaded, update: updatePrefs } = useBookPrefs(user.uid, bookId);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [status, setStatus] = useState('Opening book…');
  const [error, setError] = useState<unknown>(null);

  const filePath = book.data?.filePath;
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    loadBookFile(filePath, (s) => !cancelled && setStatus(s))
      .then((buf) => !cancelled && setData(buf))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (book.error || error || (!book.loading && !book.data))
    return (
      <div className="mx-auto max-w-sm p-8 text-center">
        <ErrorText
          error={
            book.error ??
            error ??
            new Error(
              book.fromCache && !navigator.onLine
                ? "This book hasn't been synced to this device yet. Open it once while online to read it offline."
                : 'This book was removed from the shelf.',
            )
          }
        />
        <Link to={`/g/${gid}`} className="btn-primary mt-6">
          Back to group
        </Link>
      </div>
    );

  if (!book.data || !data || progress.loading || !prefsLoaded || members.loading)
    return <FullScreenSpinner label={book.data ? status : 'Opening book…'} />;

  return (
    <Reader
      gid={gid}
      book={book.data}
      data={data}
      isOwner={group.data?.ownerId === user.uid}
      members={members.data as Member[]}
      progress={progress.data}
      prefs={prefs}
      updatePrefs={updatePrefs}
    />
  );
}

function Reader({
  gid,
  book,
  data,
  isOwner,
  members,
  progress,
  prefs,
  updatePrefs,
}: {
  gid: string;
  book: Book;
  data: ArrayBuffer;
  isOwner: boolean;
  members: Member[];
  progress: Progress[];
  prefs: ReturnType<typeof useBookPrefs>['prefs'];
  updatePrefs: ReturnType<typeof useBookPrefs>['update'];
}) {
  const user = useUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const engine = useRef<EngineHandle>(null);
  const annotations = useAnnotations(gid, book.id);

  const [ready, setReady] = useState(false);
  /** Right-to-left book: the left side of the screen is "forward". */
  const [rtl, setRtl] = useState(false);
  const rtlRef = useRef(false);
  rtlRef.current = rtl;

  // Screen-side navigation (taps, arrow keys, edge buttons) follows the book's direction
  const goLeft = useCallback(() => (rtlRef.current ? engine.current?.next() : engine.current?.prev()), []);
  const goRight = useCallback(() => (rtlRef.current ? engine.current?.prev() : engine.current?.next()), []);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loc, setLoc] = useState<LocationInfo | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [chrome, setChrome] = useState(true);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [composer, setComposer] = useState<{ type: 'note' | 'comment' | 'link'; sel: SelectionInfo } | null>(null);
  const [share, setShare] = useState<{ quote: string; location: string; annotationId?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  /** Active search text; its matches are outlined on the page until cleared. */
  const [searchMark, setSearchMark] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const progressMap = useMemo(() => new Map(progress.map((p) => [p.uid, p])), [progress]);
  const authorColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of annotations.data) m.set(a.authorId, userColor(a.authorId));
    return m;
  }, [annotations.data]);

  const visible = useMemo(() => {
    const hiddenA = new Set(prefs.hiddenAuthors);
    const hiddenT = new Set(prefs.hiddenTypes);
    return annotations.data.filter((a) => !hiddenA.has(a.authorId) && !hiddenT.has(a.type));
  }, [annotations.data, prefs.hiddenAuthors, prefs.hiddenTypes]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of annotations.data) m.set(a.authorId, (m.get(a.authorId) ?? 0) + 1);
    return m;
  }, [annotations.data]);

  // Where to open: deep link (?loc=) beats my saved progress
  const initialLocation = useRef(params.get('loc') ?? progressMap.get(user.uid)?.location ?? null).current;

  // ---- Save my reading position --------------------------------------------------------------
  const save = useRef(
    debounce((l: LocationInfo) => {
      saveProgress(gid, book.id, user.uid, l.location, l.percent);
    }, 2000),
  ).current;
  const onLocation = useCallback(
    (l: LocationInfo) => {
      setLoc(l);
      save(l);
    },
    [save],
  );

  // ---- Deep link to an annotation (?a=) ---------------------------------------------------------
  const handledDeepLink = useRef(false);
  useEffect(() => {
    if (handledDeepLink.current || !ready || annotations.loading) return;
    const aid = params.get('a');
    handledDeepLink.current = true;
    if (!aid) return;
    const a = annotations.data.find((x) => x.id === aid);
    if (a) {
      setOpenId(a.id);
      engine.current?.flash(a.id);
    }
    params.delete('a');
    params.delete('loc');
    setParams(params, { replace: true });
  }, [ready, annotations.loading, annotations.data, params, setParams]);

  // ---- Keyboard -------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (composer || share) return;
      if (['PageDown', ' '].includes(e.key)) {
        e.preventDefault?.();
        engine.current?.next();
      } else if (e.key === 'PageUp') {
        e.preventDefault?.();
        engine.current?.prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault?.();
        goRight();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault?.();
        goLeft();
      } else if (e.key === 'Escape') {
        setPanel(null);
        setSelection(null);
        setSearchMark(null);
        engine.current?.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composer, share, goLeft, goRight]);

  // ---- Engine callbacks -----------------------------------------------------------------------
  const onTap = useCallback((zone: TapZone) => {
    if (zone === 'left') goLeft();
    else if (zone === 'right') goRight();
    else setChrome((c) => !c);
  }, [goLeft, goRight]);

  const onReady = useCallback((t: TocItem[], info?: { rtl?: boolean }) => {
    setToc(t);
    setRtl(!!info?.rtl);
    setReady(true);
  }, []);

  const onAnnotationClick = useCallback((id: string) => {
    setSelection(null);
    setOpenId(id);
  }, []);

  const goTo = (location: string) => {
    engine.current?.goTo(location);
    if (window.innerWidth < 768) setPanel(null);
  };

  const jumpToAnnotation = (a: Annotation) => {
    const l = engine.current?.locationOf(a.anchor);
    if (l) engine.current?.goTo(l);
    engine.current?.flash(a.id);
    if (window.innerWidth < 768) setPanel(null);
  };

  // ---- Selection actions ----------------------------------------------------------------------
  const create = async (sel: SelectionInfo, fields: Omit<Annotation, 'id' | 'anchor' | 'authorId' | 'createdAt' | 'updatedAt'>) => {
    const anchor: Anchor = sel.anchor;
    return createAnnotation(gid, book.id, { ...fields, authorId: user.uid, anchor });
  };

  const onSelectionAction = async (action: SelectionAction) => {
    const sel = selection;
    if (!sel) return;
    setActionError(null);
    if (action === 'copy') {
      await navigator.clipboard.writeText(sel.quote).catch(() => {});
    } else if (action === 'share') {
      setShare({ quote: sel.quote, location: sel.location });
    } else {
      setComposer({ type: action, sel });
    }
    engine.current?.clearSelection();
    setSelection(null);
  };

  const typography = useMemo(
    () => ({ fontSize: prefs.fontSize, font: prefs.font, lineSpacing: prefs.lineSpacing, margins: prefs.margins }),
    [prefs.fontSize, prefs.font, prefs.lineSpacing, prefs.margins],
  );

  const engineProps = {
    data,
    annotations: visible,
    authorColors,
    theme: prefs.theme,
    typography,
    searchMark,
    flipMode: book.format === 'epub' && prefs.flipMode === 'scroll' ? 'slide' : prefs.flipMode,
    zoom,
    initialLocation,
    onReady,
    onLocation,
    onSelection: setSelection,
    onAnnotationClick,
    onTap,
    onError: setEngineError,
  } as const;

  const openAnnotation = openId ? annotations.data.find((a) => a.id === openId) : null;
  const others = progress.filter((p) => p.uid !== user.uid && memberMap.has(p.uid));
  const dark = prefs.theme === 'dark';

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: STAGE_BG[prefs.theme] }}>
      {/* Top bar */}
      <header
        className={cx(
          'safe-top z-30 flex items-center gap-1 px-1 py-1 transition-all duration-200',
          dark ? 'bg-[#1d1f24]/95 text-white/90' : 'bg-white/95',
          chrome ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
          'shadow-sm backdrop-blur',
        )}
      >
        <button className="icon-btn" onClick={() => navigate(`/g/${gid}`)} aria-label="Back to group">
          <IconBack />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-sm leading-tight font-semibold">{book.title}</h1>
          <p className={cx('hidden truncate text-xs sm:block', dark ? 'text-white/50' : 'text-ink-soft')}>{loc?.label ?? 'Loading…'}</p>
        </div>
        <ToolbarButton icon={<IconList />} label="Contents" onClick={() => setPanel('toc')} dark={dark} />
        <ToolbarButton icon={<IconSearch />} label="Search" onClick={() => setPanel('search')} dark={dark} />
        <ToolbarButton
          icon={<IconNote />}
          label="Notes"
          badge={annotations.data.length}
          onClick={() => setPanel('notes')}
          dark={dark}
        />
        <ToolbarButton icon={<IconLayers />} label="Layers" onClick={() => setPanel('layers')} dark={dark} />
        <ToolbarButton icon={<IconChat />} label="Chat" onClick={() => setPanel('chat')} dark={dark} />
        <ToolbarButton icon={<IconSettings />} label="Display" onClick={() => setPanel('settings')} dark={dark} />
      </header>

      {/* Stage */}
      <main className="relative min-h-0 flex-1">
        {searchMark && (
          <div className="absolute top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#1c2433]/90 py-1 pr-1 pl-3 text-xs text-white shadow-lg">
            <IconSearch size={14} />
            <span className="max-w-48 truncate">Matches for “{searchMark}”</span>
            <button className="rounded-full p-1 hover:bg-white/15" onClick={() => setSearchMark(null)} aria-label="Clear search highlights">
              <IconX size={14} />
            </button>
          </div>
        )}
        {engineError ? (
          <div className="mx-auto max-w-md p-8 text-center">
            <ErrorText error={new Error(`This book couldn't be displayed: ${engineError.message}`)} />
          </div>
        ) : book.format === 'pdf' ? (
          <PdfView ref={engine} {...engineProps} />
        ) : (
          <EpubView ref={engine} {...engineProps} />
        )}
        {!ready && !engineError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className={dark ? 'text-white/60' : 'text-ink-soft'} />
          </div>
        )}
        {/* Desktop arrows */}
        {prefs.flipMode !== 'scroll' && (
          <>
            <button
              className={cx('absolute top-1/2 left-2 z-20 hidden -translate-y-1/2 rounded-full p-2 md:block', dark ? 'text-white/40 hover:bg-white/10' : 'text-black/30 hover:bg-black/5')}
              onClick={goLeft}
              aria-label={rtl ? 'Next page' : 'Previous page'}
            >
              <IconChevronLeft size={28} />
            </button>
            <button
              className={cx('absolute top-1/2 right-2 z-20 hidden -translate-y-1/2 rounded-full p-2 md:block', dark ? 'text-white/40 hover:bg-white/10' : 'text-black/30 hover:bg-black/5')}
              onClick={goRight}
              aria-label={rtl ? 'Previous page' : 'Next page'}
            >
              <IconChevronRight size={28} />
            </button>
          </>
        )}
      </main>

      {/* Bottom: progress + where everyone is */}
      <footer
        className={cx(
          'safe-bottom z-30 px-4 pt-2 pb-2 transition-all duration-200',
          dark ? 'bg-[#1d1f24]/95 text-white/80' : 'bg-white/95',
          chrome ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
        )}
      >
        <Scrubber
          percent={loc?.percent ?? 0}
          rtl={rtl}
          dark={dark}
          describe={(f) => engine.current?.describe(f) ?? ''}
          onSeek={(f) => engine.current?.seek(f)}
          markers={others.map((p) => {
            const m = memberMap.get(p.uid)!;
            return (
              <button
                key={p.uid}
                className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition hover:scale-125"
                style={{ left: markerLeft(p.percent, rtl) }}
                onClick={() => goTo(p.location)}
                title={`${m.displayName} is here (${Math.round(p.percent * 100)}%) — jump`}
              >
                <Avatar uid={m.uid} name={m.displayName} photo={m.photoURL} size={20} />
              </button>
            );
          })}
        />
        <p className={cx('text-center text-[11px]', dark ? 'text-white/50' : 'text-ink-soft')}>
          <span className="sm:hidden">{loc?.label ?? 'Loading…'} · </span>
          {Math.round((loc?.percent ?? 0) * 100)}%
          {others.length > 0 ? ` · ${others.length} other reader${others.length > 1 ? 's' : ''}` : <span className="hidden sm:inline"> · tap the middle to hide controls</span>}
        </p>
      </footer>

      {/* Selection toolbar */}
      {selection && !composer && (
        <SelectionMenu
          sel={selection}
          onHighlight={async (color) => {
            const sel = selection;
            engine.current?.clearSelection();
            setSelection(null);
            try {
              await create(sel, { type: 'highlight', color, text: '', url: '' });
            } catch (e) {
              setActionError(e);
            }
          }}
          onAction={onSelectionAction}
        />
      )}

      {actionError ? (
        <div className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md" onClick={() => setActionError(null)}>
          <ErrorText error={actionError} />
        </div>
      ) : null}

      {composer && (
        <Composer
          initial={{ type: composer.type, color: composer.type === 'link' ? 'blue' : composer.type === 'comment' ? 'pink' : 'yellow', text: '', url: '' }}
          quote={composer.sel.quote}
          submitLabel={composer.type === 'comment' ? 'Post' : 'Save'}
          onCancel={() => setComposer(null)}
          onSubmit={async (v) => {
            const id = await create(composer.sel, { type: v.type, color: v.color, text: v.text, url: v.url });
            setComposer(null);
            if (v.type === 'comment') setOpenId(id);
          }}
        />
      )}

      {share && (
        <ShareModal
          bookTitle={book.title}
          quote={share.quote}
          onClose={() => setShare(null)}
          onSend={async (text) => {
            await sendMessage(gid, user.uid, text, {
              bookId: book.id,
              bookTitle: book.title,
              location: share.location,
              quote: share.quote.slice(0, 500),
              ...(share.annotationId ? { annotationId: share.annotationId } : {}),
            });
            setShare(null);
          }}
        />
      )}

      {/* Panels */}
      <Panel open={panel === 'toc'} onClose={() => setPanel(null)} title="Contents" side="left">
        <TocList
          toc={toc}
          onPick={(l) => {
            engine.current?.goTo(l);
            setPanel(null); // you jump to a chapter to read it
          }}
        />
      </Panel>
      <Panel open={panel === 'search'} onClose={() => setPanel(null)} title="Search">
        <SearchBox
          search={(q, s, h) => engine.current?.search(q, s, h) ?? Promise.resolve()}
          onPick={(loc, q) => {
            setSearchMark(q);
            goTo(loc);
          }}
        />
      </Panel>
      <Panel open={panel === 'notes'} onClose={() => setPanel(null)} title={`Highlights & notes · ${visible.length}`}>
        <AnnotationList
          annotations={sortByPosition(visible)}
          members={memberMap}
          myUid={user.uid}
          hiddenCount={annotations.data.length - visible.length}
          onPick={(a) => {
            jumpToAnnotation(a);
            setOpenId(a.id);
          }}
        />
      </Panel>
      <Panel open={panel === 'layers'} onClose={() => setPanel(null)} title="Layers">
        <LayersPanel
          members={members}
          counts={counts}
          prefs={prefs}
          myUid={user.uid}
          progress={progressMap}
          onChange={updatePrefs}
          onJumpTo={goTo}
        />
      </Panel>
      <Panel open={panel === 'settings'} onClose={() => setPanel(null)} title="Display">
        <SettingsPanel format={book.format} prefs={prefs} zoom={zoom} onZoom={setZoom} onChange={updatePrefs} />
      </Panel>
      <Panel open={panel === 'chat'} onClose={() => setPanel(null)} title="Group chat">
        <div className="h-[65vh] md:h-full">
          <Chat gid={gid} members={memberMap} isOwner={isOwner} compact />
        </div>
      </Panel>

      {openAnnotation && (
        <ThreadPanel
          gid={gid}
          bookId={book.id}
          annotation={openAnnotation}
          members={memberMap}
          isOwner={isOwner}
          onClose={() => setOpenId(null)}
          onJump={jumpToAnnotation}
          onShare={(a) =>
            setShare({ quote: a.anchor.quote, location: engine.current?.locationOf(a.anchor) ?? '', annotationId: a.id })
          }
        />
      )}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  badge,
  dark,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: number;
  dark: boolean;
}) {
  return (
    <button className={cx('icon-btn relative shrink-0', dark && 'text-white/80 hover:bg-white/10')} onClick={onClick} aria-label={label} title={label}>
      {icon}
      {!!badge && (
        <span className="bg-accent absolute top-1 right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function ShareModal({
  bookTitle,
  quote,
  onClose,
  onSend,
}: {
  bookTitle: string;
  quote: string;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title="Share to group chat">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSend(text.trim());
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <div className="border-accent rounded-xl border-l-4 bg-amber-50 px-3 py-2">
          <p className="text-ink-soft text-xs font-semibold">{bookTitle}</p>
          <p className="line-clamp-4 font-serif text-sm italic">“{quote}”</p>
        </div>
        <textarea
          autoFocus
          className="input min-h-20"
          placeholder="Add a message (optional)"
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            Send
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Reading order: PDF by page then vertical position; EPUB by spine then CFI string. */
function sortByPosition(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => {
    const A = a.anchor;
    const B = b.anchor;
    if (A.kind === 'pdf' && B.kind === 'pdf') return A.page - B.page || (A.rects[0]?.y ?? 0) - (B.rects[0]?.y ?? 0);
    if (A.kind === 'epub' && B.kind === 'epub') return A.spine - B.spine || A.cfi.localeCompare(B.cfi, undefined, { numeric: true });
    return 0;
  });
}
