import { useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, AnnotationType, BookFormat, BookPrefs, FlipMode, Member, Progress, ReaderTheme } from '../lib/types';
import { HIGHLIGHT_COLORS } from '../lib/types';
import { cx, formatTime } from '../lib/util';
import { IconEye, IconEyeOff, IconSearch, IconZoomIn, IconZoomOut } from '../components/icons';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import type { SearchHit, TocItem } from './engine';

// ---- Table of contents ------------------------------------------------------------------------

export function TocList({ toc, onPick }: { toc: TocItem[]; onPick: (loc: string) => void }) {
  if (toc.length === 0)
    return (
      <EmptyState icon={<IconSearch />} title="No table of contents">
        This book doesn't include one. Try search instead.
      </EmptyState>
    );
  return (
    <ul className="py-2">
      {toc.map((t, i) => (
        <li key={i}>
          <button
            className="w-full truncate px-4 py-2.5 text-left text-sm hover:bg-black/[0.03]"
            style={{ paddingLeft: 16 + t.level * 16 }}
            onClick={() => onPick(t.location)}
          >
            {t.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---- Search -----------------------------------------------------------------------------------

export function SearchBox({
  search,
  onPick,
}: {
  search: (q: string, signal: AbortSignal, onHit: (h: SearchHit) => void) => Promise<void>;
  onPick: (loc: string, query: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const ac = useRef<AbortController | null>(null);

  useEffect(() => () => ac.current?.abort(), []);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    ac.current?.abort();
    const query = q.trim();
    if (query.length < 2) return;
    const ctl = new AbortController();
    ac.current = ctl;
    setHits([]);
    setDone(false);
    setRunning(true);
    const buf: SearchHit[] = [];
    let raf = 0;
    try {
      await search(query, ctl.signal, (h) => {
        buf.push(h);
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (!ctl.signal.aborted) setHits([...buf]);
          });
      });
    } finally {
      if (!ctl.signal.aborted) {
        setHits([...buf]);
        setRunning(false);
        setDone(true);
      }
    }
  };

  return (
    <div>
      <form onSubmit={run} className="border-line sticky top-0 flex gap-2 border-b bg-white p-3">
        <input autoFocus className="input" placeholder="Search in book…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary px-3" aria-label="Search" disabled={q.trim().length < 2}>
          {running ? <Spinner className="h-4 w-4" /> : <IconSearch size={18} />}
        </button>
      </form>
      {done && hits.length === 0 && <p className="text-ink-soft p-4 text-sm">No matches.</p>}
      <ul>
        {hits.map((h, i) => (
          <li key={i}>
            <button className="w-full px-4 py-3 text-left hover:bg-black/[0.03]" onClick={() => onPick(h.location, q.trim())}>
              <span className="text-ink-soft block text-xs font-medium">{h.label}</span>
              <span className="line-clamp-3 text-sm">
                <Mark text={h.excerpt} q={q.trim()} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hits.length >= 300 && <p className="text-ink-soft p-4 text-xs">Showing the first 300 matches.</p>}
    </div>
  );
}

function Mark({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-200 px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

// ---- Annotation list --------------------------------------------------------------------------

const TYPE_LABEL: Record<AnnotationType, string> = { highlight: 'Highlights', note: 'Notes', comment: 'Discussions', link: 'Links' };

export function AnnotationList({
  annotations,
  members,
  myUid,
  hiddenCount,
  onPick,
}: {
  annotations: Annotation[];
  members: Map<string, Member>;
  myUid: string;
  hiddenCount: number;
  onPick: (a: Annotation) => void;
}) {
  const [filter, setFilter] = useState<AnnotationType | 'all'>('all');
  const shown = useMemo(
    () => (filter === 'all' ? annotations : annotations.filter((a) => a.type === filter)),
    [annotations, filter],
  );
  return (
    <div>
      <div className="no-scrollbar border-line sticky top-0 flex gap-1.5 overflow-x-auto border-b bg-white p-3">
        {(['all', 'note', 'comment', 'link', 'highlight'] as const).map((f) => (
          <button
            key={f}
            className={cx('btn shrink-0 px-3 py-1', filter === f ? 'bg-brand text-white' : 'bg-black/5 text-ink-soft')}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : TYPE_LABEL[f]}
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <p className="text-ink-soft px-4 pt-3 text-xs">{hiddenCount} hidden by your layer settings.</p>
      )}
      {shown.length === 0 ? (
        <EmptyState icon={<IconSearch />} title="Nothing here yet">
          Select text while reading to highlight, add notes, links or start a discussion.
        </EmptyState>
      ) : (
        <ul className="divide-line divide-y">
          {shown.map((a) => {
            const m = members.get(a.authorId);
            return (
              <li key={a.id}>
                <button className="flex w-full gap-3 px-4 py-3 text-left hover:bg-black/[0.03]" onClick={() => onPick(a)}>
                  <Avatar uid={a.authorId} name={m?.displayName ?? '?'} photo={m?.photoURL} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-soft mb-1 text-xs">
                      <span className="text-ink font-medium">{a.authorId === myUid ? 'You' : (m?.displayName ?? 'Former member')}</span> ·{' '}
                      {a.type} · {formatTime(a.createdAt)}
                    </p>
                    <p
                      className="line-clamp-2 rounded px-1 font-serif text-sm italic"
                      style={{ background: a.type === 'link' ? undefined : HIGHLIGHT_COLORS[a.color] }}
                    >
                      “{a.anchor.quote}”
                    </p>
                    {a.text && <p className="mt-1 line-clamp-3 text-sm">{a.text}</p>}
                    {a.url && <p className="text-brand mt-1 truncate text-xs">{a.url}</p>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- Layers -----------------------------------------------------------------------------------

export function LayersPanel({
  members,
  counts,
  prefs,
  myUid,
  progress,
  onChange,
  onJumpTo,
}: {
  members: Member[];
  counts: Map<string, number>;
  prefs: BookPrefs;
  myUid: string;
  progress: Map<string, Progress>;
  onChange: (p: Partial<BookPrefs>) => void;
  onJumpTo: (loc: string) => void;
}) {
  const hidden = new Set(prefs.hiddenAuthors);
  const hiddenTypes = new Set(prefs.hiddenTypes);
  const toggleAuthor = (uid: string) => {
    const next = new Set(hidden);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    onChange({ hiddenAuthors: [...next] });
  };
  const toggleType = (t: AnnotationType) => {
    const next = new Set(hiddenTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ hiddenTypes: [...next] });
  };
  const sorted = [...members].sort((a, b) => (a.uid === myUid ? -1 : b.uid === myUid ? 1 : a.displayName.localeCompare(b.displayName)));

  return (
    <div className="space-y-5 p-4">
      <p className="text-ink-soft text-sm">Choose whose highlights and notes appear on the page. Only you see this choice.</p>
      <div className="flex gap-2">
        <button className="btn-outline text-sm" onClick={() => onChange({ hiddenAuthors: [] })}>
          Show everyone
        </button>
        <button className="btn-outline text-sm" onClick={() => onChange({ hiddenAuthors: members.map((m) => m.uid).filter((u) => u !== myUid) })}>
          Only mine
        </button>
        <button className="btn-outline text-sm" onClick={() => onChange({ hiddenAuthors: members.map((m) => m.uid) })}>
          None
        </button>
      </div>
      <ul className="space-y-1">
        {sorted.map((m) => {
          const on = !hidden.has(m.uid);
          const p = progress.get(m.uid);
          return (
            <li key={m.uid} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/[0.03]">
              <Avatar uid={m.uid} name={m.displayName} photo={m.photoURL} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.uid === myUid ? 'You' : m.displayName}</p>
                <p className="text-ink-soft text-xs">
                  {counts.get(m.uid) ?? 0} annotations
                  {p && (
                    <>
                      {' · '}
                      <button className="text-brand hover:underline" onClick={() => onJumpTo(p.location)}>
                        at {Math.round(p.percent * 100)}%
                      </button>
                    </>
                  )}
                </p>
              </div>
              <button
                className={cx('icon-btn', on ? 'text-brand' : 'text-ink-soft/50')}
                onClick={() => toggleAuthor(m.uid)}
                aria-label={on ? `Hide ${m.displayName}` : `Show ${m.displayName}`}
                aria-pressed={on}
              >
                {on ? <IconEye /> : <IconEyeOff />}
              </button>
            </li>
          );
        })}
      </ul>
      <div>
        <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Types</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_LABEL) as AnnotationType[]).map((t) => (
            <button
              key={t}
              className={cx('btn px-3 py-1.5 text-sm', hiddenTypes.has(t) ? 'bg-black/5 text-ink-soft line-through' : 'bg-brand-soft text-brand')}
              onClick={() => toggleType(t)}
              aria-pressed={!hiddenTypes.has(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Display settings -------------------------------------------------------------------------

export function SettingsPanel({
  format,
  prefs,
  zoom,
  onZoom,
  onChange,
}: {
  format: BookFormat;
  prefs: BookPrefs;
  zoom: number;
  onZoom: (z: number) => void;
  onChange: (p: Partial<BookPrefs>) => void;
}) {
  const themes: { id: ReaderTheme; label: string; cls: string }[] = [
    { id: 'light', label: 'Light', cls: 'bg-white text-ink' },
    { id: 'sepia', label: 'Sepia', cls: 'bg-[#f4ecd8] text-[#4b3a2a]' },
    { id: 'dark', label: 'Dark', cls: 'bg-[#1d1f24] text-[#d8d4cc]' },
  ];
  const modes: { id: FlipMode; label: string; desc: string }[] = [
    { id: 'curl', label: 'Page curl', desc: 'Realistic page turn' },
    { id: 'slide', label: 'Slide', desc: 'Quick horizontal slide' },
    ...(format === 'pdf' ? [{ id: 'scroll' as FlipMode, label: 'Scroll', desc: 'Continuous, zoomable' }] : []),
  ];
  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Theme</h3>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => (
            <button
              key={t.id}
              className={cx('rounded-xl border py-3 text-sm font-medium', t.cls, prefs.theme === t.id ? 'border-brand ring-brand/30 ring-2' : 'border-line')}
              onClick={() => onChange({ theme: t.id })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Page turning</h3>
        <div className="space-y-2">
          {modes.map((m) => (
            <button
              key={m.id}
              className={cx('flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left', prefs.flipMode === m.id ? 'border-brand bg-brand-soft' : 'border-line')}
              onClick={() => onChange({ flipMode: m.id })}
            >
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-ink-soft text-xs">{m.desc}</span>
            </button>
          ))}
        </div>
      </section>
      {format === 'epub' && (
        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Text size · {prefs.fontSize}%</h3>
          <div className="flex items-center gap-3">
            <button className="btn-outline w-12 text-sm" onClick={() => onChange({ fontSize: Math.max(70, prefs.fontSize - 10) })}>
              A−
            </button>
            <input
              type="range"
              min={70}
              max={200}
              step={10}
              value={prefs.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className="flex-1 accent-[#15639e]"
            />
            <button className="btn-outline w-12 text-base" onClick={() => onChange({ fontSize: Math.min(200, prefs.fontSize + 10) })}>
              A+
            </button>
          </div>
        </section>
      )}
      {format === 'epub' && (
        <>
          <Choice
            title="Font"
            value={prefs.font}
            onChange={(font) => onChange({ font })}
            options={[
              { id: 'publisher', label: "Book's", style: {} },
              { id: 'serif', label: 'Serif', style: { fontFamily: 'Georgia, serif' } },
              { id: 'sans', label: 'Sans', style: { fontFamily: 'system-ui, sans-serif' } },
            ]}
          />
          <Choice
            title="Line spacing"
            value={prefs.lineSpacing}
            onChange={(lineSpacing) => onChange({ lineSpacing })}
            options={[
              { id: 'compact', label: 'Compact' },
              { id: 'publisher', label: "Book's" },
              { id: 'relaxed', label: 'Relaxed' },
            ]}
          />
          <Choice
            title="Margins"
            value={prefs.margins}
            onChange={(margins) => onChange({ margins })}
            options={[
              { id: 'narrow', label: 'Narrow' },
              { id: 'normal', label: 'Normal' },
              { id: 'wide', label: 'Wide' },
            ]}
          />
        </>
      )}
      {format === 'pdf' && prefs.flipMode === 'scroll' && (
        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Zoom · {Math.round(zoom * 100)}%</h3>
          <div className="flex items-center gap-2">
            <button className="btn-outline" onClick={() => onZoom(Math.max(0.5, +(zoom - 0.25).toFixed(2)))} aria-label="Zoom out">
              <IconZoomOut size={18} />
            </button>
            <button className="btn-outline" onClick={() => onZoom(1)}>
              Fit width
            </button>
            <button className="btn-outline" onClick={() => onZoom(Math.min(4, +(zoom + 0.25).toFixed(2)))} aria-label="Zoom in">
              <IconZoomIn size={18} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Choice<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: { id: T; label: string; style?: React.CSSProperties }[];
  onChange: (v: T) => void;
}) {
  return (
    <section>
      <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">{title}</h3>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            className={cx('rounded-xl border py-2.5 text-sm', value === o.id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line')}
            style={o.style}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
