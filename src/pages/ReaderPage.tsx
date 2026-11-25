import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthProvider';
import { useBook } from '../data/books';
import { useGroup, useMembers } from '../data/groups';
import { createAnnotation, useAnnotations } from '../data/annotations';
import { useProgress, saveProgress, DEVICE_ID } from '../data/progress';
import { isOnline } from '../data/sync';
import { useBookPrefs } from '../data/prefs';
import { loadBookFile } from '../data/files';
import { sendMessage } from '../data/messages';
import type { Anchor, Annotation, Book, Member, Progress, ReaderTheme, ThemeChoice } from '../lib/types';
import { cx, debounce, userColor } from '../lib/util';
import { PdfView } from '../reader/pdf/PdfView';
import { EpubView } from '../reader/epub/EpubView';
import type { EngineHandle, LocationInfo, SelectionInfo, TocItem } from '../reader/engine';
import type { TapZone } from '../reader/Pager';
import { SelectionMenu, type SelectionAction } from '../reader/annotations/SelectionMenu';
import { Composer } from '../reader/annotations/Composer';
import { ThreadPanel } from '../reader/annotations/ThreadPanel';
import { AnnotationList, ContentsPanel, LayersPanel, SearchBox, SettingsPanel } from '../reader/panels';
import { addBookmark, deleteBookmark, saveLibraryPosition, useBookmarks, useLibraryEntry } from '../data/library';
import { useAppSettings, useDeviceSetting, useNightLight } from '../data/settings';
import { useKeepAwake, useVolumeKeys } from '../lib/native';
import { useAppTheme } from '../lib/theme';
import { comparePos, isAhead, maxPos, posOfAnchor, posOfLocation, sortByPosition } from '../reader/position';
import { DefinePanel } from '../reader/DefinePanel';
import { ExportModal } from '../reader/export/ExportModal';
import { Scrubber, markerLeft } from '../reader/Scrubber';
import { useSeen, useUnread } from '../data/seen';
import { useMessages } from '../data/messages';
import { wantsSpread } from '../reader/Pager';
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
  IconPageSingle,
  IconPageDouble,
  IconMaximize,
  IconMinimize,
  IconBookmark,
  IconBookmarkFilled,
} from '../components/icons';
import { Capacitor, SystemBars } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Avatar, ErrorText, FullScreenSpinner, Modal, Panel, Spinner } from '../components/ui';

type PanelId = 'toc' | 'search' | 'notes' | 'layers' | 'settings' | 'chat' | 'define';

const STAGE_BG = { light: '#e8e4db', sepia: '#e3d8c1', dark: '#0c0d12' } as const;

/** 'auto' → the app's light / dark mode (which may itself follow the device). */
function useResolvedTheme(choice: ThemeChoice): ReaderTheme {
  const app = useAppTheme().resolved;
  return choice === 'auto' ? app : choice;
}

/** "about 12 min", "1 h 5 min" */
function formatMinutes(min: number): string {
  if (min < 1) return 'under a minute';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Previous page counts as read when you turn forward from it (not when you jump far ahead). */
function isPageTurn(prev: LocationInfo, l: LocationInfo): boolean {
  if (prev.section === undefined || prev.page === undefined || l.section === undefined || l.page === undefined) return false;
  if (l.section === prev.section) return l.page - prev.page >= 1 && l.page - prev.page <= 4;
  return l.section === prev.section + 1 && l.page === 0;
}

const later = (a: string | null | undefined, b: string | null | undefined): string | null => {
  const pa = posOfLocation(a);
  const pb = posOfLocation(b);
  if (!pa) return pb ? (b as string) : null;
  if (!pb) return a as string;
  return comparePos(pa, pb) >= 0 ? (a as string) : (b as string);
};

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
  // The first progress snapshot is often this device's cached copy, which misses reading done on
  // other devices. Opening from it would also save that old position back over the newer one, so
  // wait (briefly) for the server's copy when online.
  const [stopWaitingForProgress, setStopWaitingForProgress] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStopWaitingForProgress(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const progressReady = !progress.loading && (!progress.fromCache || !isOnline() || stopWaitingForProgress);

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

  if (!book.data || !data || !progressReady || !prefsLoaded || members.loading)
    return <FullScreenSpinner label={book.data ? status : 'Opening book…'} />;

  return (
    <Reader
      gid={gid}
      book={book.data}
      data={data}
      isOwner={group.data?.ownerId === user.uid}
      groupName={group.data?.name ?? ''}
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
  groupName,
  members,
  progress,
  prefs,
  updatePrefs,
}: {
  gid: string;
  book: Book;
  data: ArrayBuffer;
  isOwner: boolean;
  groupName: string;
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
  // Unread badges: only things other people added since you last looked
  const notesSeen = useSeen(user.uid, `notes_${gid}_${book.id}`);
  const unreadNotes = useUnread(annotations.data, user.uid, notesSeen.seenAt);
  const chatMessages = useMessages(gid);
  const chatSeen = useSeen(user.uid, `chat_${gid}`);
  const unreadChat = useUnread(chatMessages.data, user.uid, chatSeen.seenAt).length;
  /** Items that were unread when the Notes panel was opened (marked "New" in the list). */
  const [newNoteIds, setNewNoteIds] = useState<Set<string>>(new Set());
  const { settings, update: updateSettings } = useAppSettings(user.uid);
  const [nightLight, setNightLight] = useNightLight();
  const theme = useResolvedTheme(prefs.theme);
  const libEntry = useLibraryEntry(user.uid, gid, book.id);
  const bookmarksLive = useBookmarks(user.uid, gid, book.id);
  const bookmarks = useMemo(
    () =>
      [...bookmarksLive.data].sort((x, y) => {
        const px = posOfLocation(x.location);
        const py = posOfLocation(y.location);
        return px && py ? comparePos(px, py) : 0;
      }),
    [bookmarksLive.data],
  );
  const [defineTerm, setDefineTerm] = useState<string | null>(null);
  const [bookLang, setBookLang] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

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
  // Android: hide the status + navigation bars along with the reader's own bars
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (chrome ? SystemBars.show() : SystemBars.hide()).catch(() => {});
  }, [chrome]);
  useEffect(() => () => void (Capacitor.isNativePlatform() && SystemBars.show().catch(() => {})), []);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [composer, setComposer] = useState<{ type: 'note' | 'comment' | 'link'; sel: SelectionInfo } | null>(null);
  const [share, setShare] = useState<{ quote: string; location: string; annotationId?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Browser full screen (the Android app is already full screen)
  const canFullscreen = !Capacitor.isNativePlatform() && !!document.fullscreenEnabled;
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);
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

  const myProgress = progressMap.get(user.uid);
  /** My saved position when the book was opened. */
  const openedFrom = useRef(myProgress?.location ?? null).current;
  // Where to open: deep link (?loc=) beats my saved progress
  const initialLocation = useRef(params.get('loc') ?? openedFrom).current;

  // ---- Save my reading position --------------------------------------------------------------
  /** Furthest point read: saved in your library, and read this session (spoiler shield). */
  const storedFurthest = useRef<string | null>(null);
  storedFurthest.current = later(libEntry.data?.furthest, openedFrom);
  const sessionFurthest = useRef<string | null>(null);
  const save = useRef(
    debounce((l: LocationInfo) => {
      saveProgress(gid, book.id, user.uid, l.location, l.percent);
      saveLibraryPosition(user.uid, gid, book.id, l.location, l.percent, later(storedFurthest.current, sessionFurthest.current) ?? undefined);
    }, 2000),
  ).current;
  /** First location the engine reported, i.e. where the book opened. */
  const firstReported = useRef<string | null>(null);
  const moved = useRef(false);
  const prevLoc = useRef<{ l: LocationInfo; at: number } | null>(null);

  // Reading pace (seconds per page) for "time left", per book and per format on this device
  const [bookPace, setBookPace] = useDeviceSetting(`pace:${book.id}`, { spp: 0, n: 0 });
  const [formatPace, setFormatPace] = useDeviceSetting(`pace:${book.format}`, { spp: 0, n: 0 });

  const onLocation = useCallback(
    (l: LocationInfo) => {
      setLoc(l);
      const prev = prevLoc.current;
      const now = Date.now();
      prevLoc.current = { l, at: now };
      if (prev && isPageTurn(prev.l, l)) {
        sessionFurthest.current = later(sessionFurthest.current, prev.l.end ?? prev.l.location);
        const pages = l.section === prev.l.section ? l.page! - prev.l.page! : 1;
        const secs = (now - prev.at) / 1000;
        // Ignore skimming and walking away; one sample per turn
        if (secs >= 2 && secs <= 600) {
          const spp = Math.min(300, Math.max(3, secs / pages));
          const blend = (p: { spp: number; n: number }) => ({ spp: p.n ? p.spp * 0.8 + spp * 0.2 : spp, n: p.n + 1 });
          setBookPace(blend);
          setFormatPace(blend);
        }
      }
      // Opening isn't reading: saving the opening spot could overwrite a newer position from another
      // device that hasn't reached this one yet. Save once you've actually moved.
      if (firstReported.current === null) firstReported.current = l.location;
      if (!moved.current && l.location === firstReported.current) return;
      moved.current = true;
      save(l);
    },
    [save, setBookPace, setFormatPace],
  );
  // Save the last page right away when leaving the book, closing the tab or backgrounding the app
  useEffect(() => {
    const onHidden = () => document.visibilityState === 'hidden' && save.flush();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', save.flush);
    const pause = Capacitor.isNativePlatform() ? CapApp.addListener('pause', save.flush) : null;
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', save.flush);
      pause?.then((s) => s.remove());
      save.flush();
    };
  }, [save]);

  // ---- My position moved on another device ----------------------------------------------------
  const [dismissedRemote, setDismissedRemote] = useState<string | null>(null);
  const remoteProgress =
    myProgress &&
    myProgress.device !== DEVICE_ID &&
    myProgress.location !== openedFrom &&
    myProgress.location !== loc?.location &&
    myProgress.location !== dismissedRemote
      ? myProgress
      : null;

  // ---- Keep the screen on while reading (until 10 idle minutes) --------------------------------
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 10 * 60 * 1000);
  }, []);
  useEffect(() => {
    poke();
    window.addEventListener('pointerdown', poke);
    window.addEventListener('keydown', poke);
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener('pointerdown', poke);
      window.removeEventListener('keydown', poke);
    };
  }, [poke]);
  useEffect(() => poke(), [loc, poke]);
  useKeepAwake(settings.keepAwake && !idle);
  useVolumeKeys(settings.volumeKeys && !composer && !share && !exporting, (key) =>
    key === 'down' ? engine.current?.next() : engine.current?.prev(),
  );

  // ---- Spoiler shield ---------------------------------------------------------------------------
  const readTo = maxPos(
    maxPos(posOfLocation(storedFurthest.current), posOfLocation(sessionFurthest.current)),
    posOfLocation(loc?.end ?? loc?.location),
  );
  const isSpoiler = settings.spoilerShield
    ? (a: Annotation) => a.authorId !== user.uid && isAhead(posOfAnchor(a.anchor), readTo)
    : undefined;

  // ---- Bookmarks --------------------------------------------------------------------------------
  const bookmarksHere = useMemo(() => {
    const start = posOfLocation(loc?.location);
    const end = posOfLocation(loc?.end ?? loc?.location);
    if (!start || !end) return [];
    return bookmarks.filter((b) => {
      const p = posOfLocation(b.location);
      return !!p && comparePos(p, start) >= 0 && comparePos(p, end) <= 0;
    });
  }, [bookmarks, loc]);
  const toggleBookmark = useCallback(() => {
    if (!loc) return;
    if (bookmarksHere.length) bookmarksHere.forEach((b) => deleteBookmark(user.uid, gid, book.id, b.id));
    else addBookmark(user.uid, gid, book.id, { location: loc.location, percent: loc.percent, label: loc.label });
  }, [loc, bookmarksHere, user.uid, gid, book.id]);

  // ---- Time left ----------------------------------------------------------------------------------
  const pace = bookPace.n >= 3 ? bookPace.spp : formatPace.n >= 3 ? formatPace.spp : 0;
  const timeLeft = (() => {
    if (!pace || !loc) return null;
    if (loc.chapterPagesLeft !== undefined)
      return loc.chapterPagesLeft === 0 ? 'Last page of chapter' : `${formatMinutes((loc.chapterPagesLeft * pace) / 60)} left in chapter`;
    if (loc.bookPagesLeft !== undefined) return `${formatMinutes((loc.bookPagesLeft * pace) / 60)} left in book`;
    return null;
  })();

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

  // ---- Notes panel = read ----------------------------------------------------------------------
  useEffect(() => {
    if (panel !== 'notes') return;
    if (unreadNotes.length) {
      setNewNoteIds((prev) => (unreadNotes.every((a) => prev.has(a.id)) ? prev : new Set([...prev, ...unreadNotes.map((a) => a.id)])));
      notesSeen.markSeen();
    }
  }, [panel, unreadNotes, notesSeen]);
  useEffect(() => {
    if (panel !== 'notes') setNewNoteIds(new Set());
  }, [panel]);

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
      } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && canFullscreen) {
        toggleFullscreen();
      } else if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) {
        toggleBookmark();
      } else if (e.key === 'Escape') {
        setPanel(null);
        setSelection(null);
        setSearchMark(null);
        engine.current?.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composer, share, goLeft, goRight, canFullscreen, toggleFullscreen, toggleBookmark]);

  // ---- Engine callbacks -----------------------------------------------------------------------
  const onTap = useCallback((zone: TapZone) => {
    if (zone === 'left') goLeft();
    else if (zone === 'right') goRight();
    else setChrome((c) => !c);
  }, [goLeft, goRight]);

  const onReady = useCallback((t: TocItem[], info?: { rtl?: boolean; lang?: string }) => {
    setToc(t);
    setRtl(!!info?.rtl);
    setBookLang(info?.lang);
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
    } else if (action === 'define') {
      setDefineTerm(sel.quote);
      setPanel('define');
    } else {
      setComposer({ type: action, sel });
    }
    engine.current?.clearSelection();
    setSelection(null);
  };

  const typography = useMemo(
    () => ({ fontSize: prefs.fontSize, font: prefs.font, lineSpacing: prefs.lineSpacing, margins: prefs.margins, hyphens: prefs.hyphens }),
    [prefs.fontSize, prefs.font, prefs.lineSpacing, prefs.margins, prefs.hyphens],
  );

  const engineProps = {
    data,
    annotations: visible,
    authorColors,
    theme,
    typography,
    searchMark,
    pageLayout: prefs.pageLayout,
    pdfFit: prefs.pdfFit,
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
  const dark = theme === 'dark';

  return (
    // The page always fills the screen; the bars float over it. (Shrinking the page when the bars
    // show would re-paginate EPUBs on every tap.)
    <div className="fixed inset-0 overflow-hidden" style={{ background: STAGE_BG[theme] }}>
      {/* Top bar */}
      <header
        className={cx(
          'safe-top absolute inset-x-0 top-0 z-30 flex items-center gap-1 px-1 py-1 transition-all duration-200',
          dark ? 'bg-[#15171f]/95 text-white/90' : 'bg-white/95',
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
          badge={unreadNotes.length}
          onClick={() => setPanel('notes')}
          dark={dark}
        />
        <ToolbarButton icon={<IconLayers />} label="Layers" onClick={() => setPanel('layers')} dark={dark} />
        {prefs.flipMode !== 'scroll' && (
          <span className="hidden md:contents">
            {wantsSpread(prefs.pageLayout, prefs.flipMode, window.innerWidth, window.innerHeight) ? (
              <ToolbarButton icon={<IconPageSingle />} label="Single page" onClick={() => updatePrefs({ pageLayout: 'single' })} dark={dark} />
            ) : (
              <ToolbarButton icon={<IconPageDouble />} label="Two pages" onClick={() => updatePrefs({ pageLayout: 'double' })} dark={dark} />
            )}
          </span>
        )}
        <ToolbarButton icon={<IconChat />} label="Chat" badge={unreadChat} onClick={() => setPanel('chat')} dark={dark} />
        <ToolbarButton icon={<IconSettings />} label="Display" onClick={() => setPanel('settings')} dark={dark} />
        {canFullscreen && (
          <ToolbarButton
            icon={fullscreen ? <IconMinimize /> : <IconMaximize />}
            label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
            onClick={toggleFullscreen}
            dark={dark}
          />
        )}
      </header>

      {/* Stage */}
      <main className="absolute inset-0">
        <div
          className="absolute left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 transition-all"
          style={{ top: chrome ? 'calc(env(safe-area-inset-top) + 60px)' : 'calc(env(safe-area-inset-top) + 8px)' }}
        >
          {remoteProgress && (
            <div className="flex items-center gap-1 rounded-full bg-[#1c2433]/90 py-1 pr-1 pl-3 text-xs whitespace-nowrap text-white shadow-lg">
              <span>Read on another device · {Math.round(remoteProgress.percent * 100)}%</span>
              <button
                className="ml-1 rounded-full bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25"
                onClick={() => {
                  setDismissedRemote(remoteProgress.location);
                  engine.current?.goTo(remoteProgress.location);
                }}
              >
                Go there
              </button>
              <button
                className="rounded-full p-1 hover:bg-white/15"
                onClick={() => setDismissedRemote(remoteProgress.location)}
                aria-label="Stay here"
              >
                <IconX size={14} />
              </button>
            </div>
          )}
          {searchMark && (
            <div className="flex items-center gap-2 rounded-full bg-[#1c2433]/90 py-1 pr-1 pl-3 text-xs text-white shadow-lg">
              <IconSearch size={14} />
              <span className="max-w-48 truncate">Matches for “{searchMark}”</span>
              <button className="rounded-full p-1 hover:bg-white/15" onClick={() => setSearchMark(null)} aria-label="Clear search highlights">
                <IconX size={14} />
              </button>
            </div>
          )}
        </div>
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
        {/* Bookmark ribbon: always shows on a bookmarked page; tap to add/remove while the bars are up */}
        {ready && (chrome || bookmarksHere.length > 0) && (
          <button
            className={cx(
              'absolute right-3 z-30 rounded-b-md px-1.5 pt-1 pb-1.5 transition-all md:right-16',
              bookmarksHere.length ? 'text-accent' : dark ? 'bg-white/10 text-white/60' : 'bg-black/5 text-black/40',
              !chrome && 'pointer-events-none',
            )}
            style={{ top: chrome ? 'calc(env(safe-area-inset-top) + 52px)' : 'env(safe-area-inset-top)' }}
            onClick={toggleBookmark}
            aria-label={bookmarksHere.length ? 'Remove bookmark (B)' : 'Bookmark this page (B)'}
            title={bookmarksHere.length ? 'Remove bookmark (B)' : 'Bookmark this page (B)'}
            aria-pressed={bookmarksHere.length > 0}
          >
            {bookmarksHere.length ? <IconBookmarkFilled size={26} /> : <IconBookmark size={22} />}
          </button>
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
          'safe-bottom absolute inset-x-0 bottom-0 z-30 px-4 pt-2 pb-2 transition-all duration-200',
          dark ? 'bg-[#15171f]/95 text-white/80' : 'bg-white/95',
          chrome ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
        )}
      >
        <Scrubber
          percent={loc?.percent ?? 0}
          rtl={rtl}
          dark={dark}
          describe={(f) => engine.current?.describe(f) ?? ''}
          onSeek={(f) => engine.current?.seek(f)}
          markers={[
            ...bookmarks.map((b) => (
              <button
                key={`bm-${b.id}`}
                className="text-accent absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1 transition hover:scale-125"
                style={{ left: markerLeft(b.percent, rtl) }}
                onClick={() => goTo(b.location)}
                title={`Bookmark: ${b.label}`}
              >
                <IconBookmarkFilled size={12} />
              </button>
            )),
            ...others.map((p) => {
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
          }),
          ]}
        />
        <p className={cx('text-center text-[11px]', dark ? 'text-white/50' : 'text-ink-soft')}>
          <span className="sm:hidden">{loc?.label ?? 'Loading…'} · </span>
          {Math.round((loc?.percent ?? 0) * 100)}%
          {timeLeft && ` · ${timeLeft}`}
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
        <ContentsPanel
          toc={toc}
          bookmarks={bookmarks}
          onRemoveBookmark={(id) => deleteBookmark(user.uid, gid, book.id, id)}
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
          newIds={newNoteIds}
          isSpoiler={isSpoiler}
          onPick={(a) => {
            jumpToAnnotation(a);
            setOpenId(a.id);
          }}
          onExport={() => setExporting(true)}
        />
      </Panel>
      <Panel open={panel === 'layers'} onClose={() => setPanel(null)} title="Layers">
        <LayersPanel
          members={members}
          counts={counts}
          prefs={prefs}
          myUid={user.uid}
          progress={progressMap}
          spoilerShield={settings.spoilerShield}
          onSpoilerShield={(spoilerShield) => updateSettings({ spoilerShield })}
          onChange={updatePrefs}
          onJumpTo={goTo}
        />
      </Panel>
      <Panel open={panel === 'settings'} onClose={() => setPanel(null)} title="Display">
        <SettingsPanel
          format={book.format}
          prefs={prefs}
          zoom={zoom}
          onZoom={setZoom}
          onChange={updatePrefs}
          nightLight={nightLight}
          onNightLight={setNightLight}
          settings={settings}
          onSettings={updateSettings}
        />
      </Panel>
      <Panel open={panel === 'define' && !!defineTerm} onClose={() => setPanel(null)} title="Look up">
        {defineTerm && <DefinePanel term={defineTerm} lang={bookLang} />}
      </Panel>
      <Panel open={panel === 'chat'} onClose={() => setPanel(null)} title="Group chat">
        <div className="h-[65vh] md:h-full">
          <Chat
            gid={gid}
            members={memberMap}
            isOwner={isOwner}
            compact
            liveReadTo={{ bookId: book.id, location: later(later(storedFurthest.current, sessionFurthest.current), loc?.end ?? loc?.location) }}
          />
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

      {exporting && (
        <ExportModal
          gid={gid}
          groupName={groupName}
          book={book}
          annotations={annotations.data}
          shown={visible}
          bookmarks={bookmarks}
          members={memberMap}
          myUid={user.uid}
          chapterOf={(a) => engine.current?.chapterOf(a) ?? ''}
          onClose={() => setExporting(false)}
        />
      )}

      {/* Night light: over everything, never catches taps */}
      {nightLight.warmth > 0 && (
        <div className="pointer-events-none fixed inset-0 z-[100] mix-blend-multiply" style={{ background: `rgba(255, 138, 30, ${nightLight.warmth})` }} />
      )}
      {nightLight.dim > 0 && <div className="pointer-events-none fixed inset-0 z-[100]" style={{ background: `rgba(0, 0, 0, ${nightLight.dim})` }} />}
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
