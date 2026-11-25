import { useEffect, useMemo, useState } from 'react';
import { fetchReplies } from '../../data/annotations';
import { useDeviceSetting } from '../../data/settings';
import type { Anchor, Annotation, AnnotationType, Book, Bookmark, Member, Reply } from '../../lib/types';
import { appLink, cx } from '../../lib/util';
import { canShareFiles, copyText, printHtml, safeFileName, saveFile, shareFile } from '../../lib/saveFile';
import { isNative } from '../../lib/native';
import { anchorAt, comparePos, posOfAnchor, posOfLocation } from '../position';
import { pdfLocation } from '../engine';
import { FORMATS, renderExport, type ExportFormat, type ExportItem, type ExportKind } from './formats';
import { IconCopy, IconDownload, IconShare } from '../../components/icons';
import { ErrorText, Modal, Spinner } from '../../components/ui';

type Scope = 'mine' | 'everyone' | 'shown';

const KINDS: { id: ExportKind; label: string }[] = [
  { id: 'highlight', label: 'Highlights' },
  { id: 'note', label: 'Notes' },
  { id: 'comment', label: 'Discussions' },
  { id: 'link', label: 'Links' },
  { id: 'bookmark', label: 'Bookmarks' },
];

/** Export highlights, notes, discussions and bookmarks in many formats, to many places. */
export function ExportModal({
  gid,
  groupName,
  book,
  annotations,
  shown,
  bookmarks,
  members,
  myUid,
  chapterOf,
  onClose,
}: {
  gid: string;
  groupName: string;
  book: Book;
  annotations: Annotation[];
  /** What the layer settings currently show. */
  shown: Annotation[];
  bookmarks: Bookmark[];
  members: Map<string, Member>;
  myUid: string;
  chapterOf: (a: Anchor) => string;
  onClose: () => void;
}) {
  const [opts, setOpts] = useDeviceSetting('export', {
    scope: 'mine' as Scope,
    format: 'md' as ExportFormat,
    kinds: ['highlight', 'note', 'comment', 'link', 'bookmark'] as ExportKind[],
  });
  const [replies, setReplies] = useState<Map<string, Reply[]> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Discussion threads go along with the export
  useEffect(() => {
    let cancelled = false;
    const comments = annotations.filter((a) => a.type === 'comment');
    Promise.all(comments.map(async (a) => [a.id, await fetchReplies(gid, book.id, a.id).catch(() => [])] as const)).then(
      (pairs) => !cancelled && setReplies(new Map(pairs)),
    );
    return () => {
      cancelled = true;
    };
  }, [gid, book.id, annotations]);

  const pool = opts.scope === 'mine' ? annotations.filter((a) => a.authorId === myUid) : opts.scope === 'shown' ? shown : annotations;
  const kinds = new Set(opts.kinds);
  const name = (uid: string) => (uid === myUid ? 'You' : (members.get(uid)?.displayName ?? 'Former member'));

  const items = useMemo<ExportItem[]>(() => {
    const keyed: { pos: number[] | null; item: Omit<ExportItem, 'order'> }[] = [];
    for (const a of pool) {
      if (!kinds.has(a.type as AnnotationType)) continue;
      const loc = a.anchor.kind === 'pdf' ? pdfLocation(a.anchor.page) : a.anchor.cfi;
      keyed.push({
        pos: posOfAnchor(a.anchor),
        item: {
          kind: a.type,
          quote: a.anchor.quote,
          text: a.text,
          url: a.url,
          color: a.color,
          author: name(a.authorId),
          mine: a.authorId === myUid,
          chapter: chapterOf(a.anchor),
          page: a.anchor.kind === 'pdf' ? a.anchor.page + 1 : undefined,
          createdAt: a.createdAt?.toDate(),
          link: appLink(`/g/${gid}/b/${book.id}?loc=${encodeURIComponent(loc)}&a=${a.id}`),
          replies: (replies?.get(a.id) ?? []).map((r) => ({ author: name(r.authorId), text: r.text, createdAt: r.createdAt?.toDate() })),
        },
      });
    }
    if (kinds.has('bookmark'))
      for (const b of bookmarks) {
        const anchor = anchorAt(b.location);
        keyed.push({
          pos: posOfLocation(b.location),
          item: {
            kind: 'bookmark',
            quote: '',
            text: b.label,
            url: '',
            author: 'You',
            mine: true,
            chapter: anchor ? chapterOf(anchor) : '',
            page: anchor?.kind === 'pdf' ? anchor.page + 1 : undefined,
            percent: anchor?.kind === 'pdf' ? undefined : b.percent,
            createdAt: b.createdAt?.toDate(),
            link: appLink(`/g/${gid}/b/${book.id}?loc=${encodeURIComponent(b.location)}`),
            replies: [],
          },
        });
      }
    keyed.sort((x, y) => (x.pos && y.pos ? comparePos(x.pos, y.pos) : 0));
    return keyed.map((k, i) => ({ ...k.item, order: i + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, opts.kinds, bookmarks, replies, chapterOf]);

  const format = FORMATS.find((f) => f.id === opts.format) ?? FORMATS[0];
  const scopeLabel = opts.scope === 'mine' ? 'my notes' : 'notes';
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `${safeFileName(book.title)} - ReadX ${scopeLabel} ${stamp}.${format.ext}`;

  const render = () =>
    renderExport(format.id, {
      title: book.title,
      author: book.author,
      group: groupName,
      bookLink: appLink(`/g/${gid}/b/${book.id}`),
      exportedAt: new Date(),
      showAuthors: opts.scope !== 'mine',
      items,
    });

  const run = (label: string, fn: () => Promise<string | null | void>) => async () => {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      const msg = await fn();
      if (msg) setDone(msg);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const toggleKind = (k: ExportKind) =>
    setOpts((o) => ({ ...o, kinds: o.kinds.includes(k) ? o.kinds.filter((x) => x !== k) : [...o.kinds, k] }));

  const counts = {
    mine: annotations.filter((a) => a.authorId === myUid).length,
    everyone: annotations.length,
    shown: shown.length,
  };
  const empty = items.length === 0;
  const loadingReplies = replies === null && kinds.has('comment');

  return (
    <Modal open onClose={onClose} title="Export highlights & notes" wide>
      <div className="space-y-5">
        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Whose</h3>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['mine', 'Only mine'],
                ['everyone', 'Everyone'],
                ['shown', 'As shown'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={cx('rounded-xl border px-2 py-2 text-sm', opts.scope === id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line')}
                onClick={() => setOpts((o) => ({ ...o, scope: id }))}
                title={id === 'shown' ? 'Only the people and types your Layers settings show' : undefined}
              >
                {label} <span className="opacity-60">· {counts[id]}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Include</h3>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={cx('btn px-3 py-1.5 text-sm', kinds.has(k.id) ? 'bg-brand-soft text-brand' : 'text-ink-soft bg-ink/5 line-through')}
                onClick={() => toggleKind(k.id)}
                aria-pressed={kinds.has(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kinds.has('comment') && <p className="text-ink-soft mt-2 text-xs">Discussions include their replies.</p>}
        </section>

        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Format</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                className={cx('rounded-xl border px-3 py-2 text-left', opts.format === f.id ? 'border-brand bg-brand-soft' : 'border-line')}
                onClick={() => setOpts((o) => ({ ...o, format: f.id }))}
                role="radio"
                aria-checked={opts.format === f.id}
              >
                <span className="block text-sm font-medium">
                  {f.label} <span className="text-ink-soft font-normal">.{f.ext}</span>
                </span>
                <span className="text-ink-soft block text-xs">{f.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <ErrorText error={error} />
        {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{done}</p>}

        <div className="border-line flex flex-wrap items-center gap-2 border-t pt-4">
          <p className="text-ink-soft mr-auto text-sm">
            {loadingReplies ? 'Loading discussions…' : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </p>
          {format.id !== 'html' && (
            <button className="btn-ghost" disabled={empty || !!busy} onClick={run('copy', async () => (await copyText(render()), 'Copied to clipboard'))}>
              <IconCopy size={16} /> Copy
            </button>
          )}
          {format.id === 'html' && !isNative && (
            <button
              className="btn-ghost"
              disabled={empty || !!busy}
              onClick={run('print', async () => (printHtml(render()) ? 'Opened the print view: choose “Save as PDF” to make a PDF' : 'Allow pop-ups to print'))}
            >
              Print / PDF
            </button>
          )}
          {canShareFiles() && (
            <button
              className="btn-outline"
              disabled={empty || !!busy}
              onClick={run('share', async () => {
                await shareFile(fileName, render(), format.mime, `${book.title}: highlights & notes`);
              })}
            >
              {busy === 'share' ? <Spinner className="h-4 w-4" /> : <IconShare size={16} />} Share
            </button>
          )}
          <button className="btn-primary" disabled={empty || !!busy} onClick={run('save', () => saveFile(fileName, render(), format.mime))}>
            {busy === 'save' ? <Spinner className="h-4 w-4" /> : <IconDownload size={16} />} {isNative ? 'Save' : 'Download'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
