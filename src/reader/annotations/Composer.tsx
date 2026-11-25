import { useState } from 'react';
import { Modal, ErrorText, Spinner } from '../../components/ui';
import { HIGHLIGHT_COLORS, type AnnotationType, type HighlightColor } from '../../lib/types';
import { cx } from '../../lib/util';

const TITLES: Record<AnnotationType, string> = {
  highlight: 'Highlight',
  note: 'Add a note',
  comment: 'Start a discussion',
  link: 'Attach a link',
};

const HINTS: Partial<Record<AnnotationType, string>> = {
  note: 'Your thoughts on this passage. Everyone in the group can see it.',
  comment: 'Ask a question or start a thread. Others can reply.',
  link: 'Add a reference: an article, video, definition…',
};

export interface ComposerValue {
  type: AnnotationType;
  color: HighlightColor;
  text: string;
  url: string;
}

export function Composer({
  initial,
  quote,
  onCancel,
  onSubmit,
  submitLabel = 'Save',
}: {
  initial: ComposerValue;
  quote: string;
  onCancel: () => void;
  onSubmit: (v: ComposerValue) => Promise<void>;
  submitLabel?: string;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const urlOk = v.type !== 'link' || /^https?:\/\/\S+\.\S+/.test(v.url.trim());
  const textOk = v.type === 'highlight' || v.type === 'link' || v.text.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlOk || !textOk) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...v, text: v.text.trim(), url: v.url.trim() });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onCancel} title={TITLES[v.type]}>
      <form onSubmit={submit} className="space-y-3">
        <blockquote className="border-accent text-ink-soft line-clamp-4 border-l-4 bg-amber-50/60 py-1.5 dark:bg-white/5 pr-2 pl-3 font-serif text-sm italic">
          {quote}
        </blockquote>
        {HINTS[v.type] && <p className="text-ink-soft text-xs">{HINTS[v.type]}</p>}
        {v.type === 'link' && (
          <input
            autoFocus
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={v.url}
            onChange={(e) => setV({ ...v, url: e.target.value })}
          />
        )}
        {v.type !== 'highlight' && (
          <textarea
            autoFocus={v.type !== 'link'}
            className="input min-h-28 resize-y"
            placeholder={v.type === 'link' ? 'Why is this relevant? (optional)' : v.type === 'comment' ? 'What do you think?' : 'Write a note…'}
            maxLength={10000}
            value={v.text}
            onChange={(e) => setV({ ...v, text: e.target.value })}
          />
        )}
        <div className="flex items-center gap-2">
          <span className="text-ink-soft text-xs">Color</span>
          {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
            <button
              type="button"
              key={c}
              className={cx('h-6 w-6 rounded-full transition', v.color === c ? 'ring-brand ring-2 ring-offset-2' : 'ring-1 ring-black/10')}
              style={{ background: HIGHLIGHT_COLORS[c].replace(/[\d.]+\)$/, '1)') }}
              onClick={() => setV({ ...v, color: c })}
              aria-label={c}
            />
          ))}
        </div>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !urlOk || !textOk}>
            {busy && <Spinner className="h-4 w-4" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
