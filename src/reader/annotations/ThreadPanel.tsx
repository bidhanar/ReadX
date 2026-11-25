import { useState } from 'react';
import { useUser } from '../../auth/AuthProvider';
import { addReply, deleteAnnotation, deleteReply, updateAnnotation, useReplies } from '../../data/annotations';
import type { Annotation, Member } from '../../lib/types';
import { formatTime } from '../../lib/util';
import { IconLink, IconSend, IconShare, IconTrash } from '../../components/icons';
import { Avatar, ErrorText, Panel, Spinner } from '../../components/ui';
import { Composer, type ComposerValue } from './Composer';

const TYPE_LABEL = { highlight: 'Highlight', note: 'Note', comment: 'Discussion', link: 'Link' } as const;

/** Details of one annotation: body, link, replies, and owner actions. */
export function ThreadPanel({
  gid,
  bookId,
  annotation: a,
  members,
  isOwner,
  onClose,
  onShare,
  onJump,
}: {
  gid: string;
  bookId: string;
  annotation: Annotation;
  members: Map<string, Member>;
  isOwner: boolean;
  onClose: () => void;
  onShare: (a: Annotation) => void;
  onJump: (a: Annotation) => void;
}) {
  const user = useUser();
  const replies = useReplies(gid, bookId, a.id);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mine = a.authorId === user.uid;
  const author = members.get(a.authorId);

  const reply = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await addReply(gid, bookId, a.id, user.uid, t);
    } catch (err) {
      setText(t);
      setError(err);
    }
  };

  return (
    <Panel open onClose={onClose} title={TYPE_LABEL[a.type]}>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Avatar uid={a.authorId} name={author?.displayName ?? '?'} photo={author?.photoURL} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{mine ? 'You' : (author?.displayName ?? 'Former member')}</p>
            <p className="text-ink-soft text-xs">{formatTime(a.createdAt)}</p>
          </div>
        </div>

        <button
          className="border-accent text-ink-soft block w-full border-l-4 bg-amber-50/60 py-1.5 dark:bg-white/5 pr-2 pl-3 text-left font-serif text-sm italic hover:bg-amber-50 dark:hover:bg-white/10"
          onClick={() => onJump(a)}
          title="Go to passage"
        >
          “{a.anchor.quote}”
        </button>

        {a.url && (
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand bg-brand-soft flex items-center gap-2 rounded-xl px-3 py-2 text-sm break-all"
          >
            <IconLink size={16} className="shrink-0" />
            {a.url}
          </a>
        )}
        {a.text && <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{a.text}</p>}

        <div className="flex flex-wrap gap-2">
          <button className="btn-outline text-sm" onClick={() => onShare(a)}>
            <IconShare size={15} /> Share to chat
          </button>
          {mine && (
            <button className="btn-outline text-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {(mine || isOwner) && (
            <button
              className="btn-outline text-sm text-red-600 dark:text-red-400"
              onClick={async () => {
                if (!confirm('Delete this for everyone?')) return;
                try {
                  await deleteAnnotation(gid, bookId, a.id);
                  onClose();
                } catch (err) {
                  setError(err);
                }
              }}
            >
              <IconTrash size={15} /> Delete
            </button>
          )}
        </div>
        <ErrorText error={error} />

        <section>
          <h3 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">
            Replies {replies.data.length > 0 && `· ${replies.data.length}`}
          </h3>
          {replies.loading ? (
            <Spinner className="text-ink-soft" />
          ) : (
            <ul className="space-y-3">
              {replies.data.map((r) => {
                const m = members.get(r.authorId);
                return (
                  <li key={r.id} className="group flex gap-2">
                    <Avatar uid={r.authorId} name={m?.displayName ?? '?'} photo={m?.photoURL} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-medium">{r.authorId === user.uid ? 'You' : (m?.displayName ?? 'Former member')}</span>{' '}
                        <span className="text-ink-soft">{formatTime(r.createdAt)}</span>
                        {r.authorId === user.uid && (
                          <button
                            className="text-ink-soft ml-2 opacity-0 group-hover:opacity-100"
                            onClick={() => deleteReply(gid, bookId, a.id, r.id)}
                            aria-label="Delete reply"
                          >
                            <IconTrash size={12} />
                          </button>
                        )}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{r.text}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <form onSubmit={reply} className="mt-3 flex gap-2">
            <input className="input" placeholder="Reply…" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary px-3" disabled={!text.trim()} aria-label="Send reply">
              <IconSend size={16} />
            </button>
          </form>
        </section>
      </div>

      {editing && (
        <Composer
          initial={{ type: a.type, color: a.color, text: a.text, url: a.url } satisfies ComposerValue}
          quote={a.anchor.quote}
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await updateAnnotation(gid, bookId, a.id, { color: v.color, text: v.text, url: v.url });
            setEditing(false);
          }}
        />
      )}
    </Panel>
  );
}
