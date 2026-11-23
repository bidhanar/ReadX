import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../auth/AuthProvider';
import { deleteMessage, sendMessage, useMessages } from '../data/messages';
import type { WithPending } from '../data/useLive';
import type { Member, Message } from '../lib/types';
import { cx, formatTime } from '../lib/util';
import { IconBook, IconChat, IconClock, IconSend, IconTrash } from './icons';
import { Avatar, EmptyState, ErrorText, Spinner } from './ui';

export function Chat({
  gid,
  members,
  isOwner,
  compact,
}: {
  gid: string;
  members: Map<string, Member>;
  isOwner: boolean;
  compact?: boolean;
}) {
  const user = useUser();
  const { data: messages, loading, error } = useMessages(gid);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    stick.current = true;
    // Appears in the list immediately; delivered when online (shown with a clock until then)
    sendMessage(gid, user.uid, t);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className={cx('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3 py-3' : 'px-4 py-4')}>
        {loading ? (
          <div className="text-ink-soft py-10 text-center">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorText error={error} />
        ) : messages.length === 0 ? (
          <EmptyState icon={<IconChat />} title="No messages yet">
            Say hi, or share a passage from a book using the selection menu while reading.
          </EmptyState>
        ) : (
          <ul className="space-y-1">
            {messages.map((m, i) => (
              <MessageRow
                key={m.id}
                gid={gid}
                m={m}
                prev={messages[i - 1]}
                mine={m.authorId === user.uid}
                canDelete={m.authorId === user.uid || isOwner}
                author={members.get(m.authorId)}
              />
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={send} className="border-line safe-bottom flex items-end gap-2 border-t p-2">
        <textarea
          className="input max-h-32 min-h-[42px] flex-1 resize-none"
          rows={1}
          placeholder="Message"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              send(e);
            }
          }}
        />
        <button className="btn-primary h-[42px] w-[42px] p-0" disabled={!text.trim()} aria-label="Send">
          <IconSend size={18} />
        </button>
      </form>
    </div>
  );
}

function MessageRow({
  gid,
  m,
  prev,
  mine,
  canDelete,
  author,
}: {
  gid: string;
  m: WithPending<Message>;
  prev?: Message;
  mine: boolean;
  canDelete: boolean;
  author?: Member;
}) {
  const grouped =
    prev?.authorId === m.authorId &&
    (m.createdAt?.toMillis() ?? 0) - (prev.createdAt?.toMillis() ?? 0) < 5 * 60 * 1000;
  const name = author?.displayName ?? 'Former member';
  return (
    <li className={cx('group flex items-end gap-2', mine && 'flex-row-reverse', !grouped && 'pt-3')}>
      <div className="w-7 shrink-0">
        {!mine && !grouped && <Avatar uid={m.authorId} name={name} photo={author?.photoURL} size={28} />}
      </div>
      <div className={cx('flex max-w-[80%] flex-col', mine ? 'items-end' : 'items-start')}>
        {!grouped && !mine && <span className="text-ink-soft mb-0.5 ml-1 text-xs font-medium">{name}</span>}
        <div
          className={cx(
            'rounded-2xl px-3 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap',
            mine ? 'bg-brand rounded-br-md text-white' : 'bg-card border-line rounded-bl-md border',
          )}
        >
          {m.ref && (
            <Link
              to={`/g/${gid}/b/${m.ref.bookId}?loc=${encodeURIComponent(m.ref.location)}${m.ref.annotationId ? `&a=${m.ref.annotationId}` : ''}`}
              className={cx(
                'mb-1.5 block rounded-xl border-l-4 px-2.5 py-1.5 text-sm',
                mine ? 'border-amber-300 bg-white/15' : 'border-accent bg-amber-50',
              )}
            >
              <span className="flex items-center gap-1 text-xs font-semibold opacity-80">
                <IconBook size={12} /> {m.ref.bookTitle}
              </span>
              <span className="line-clamp-4 italic">“{m.ref.quote}”</span>
            </Link>
          )}
          {m.text}
        </div>
        <span className="text-ink-soft mt-0.5 flex items-center gap-1 px-1 text-[11px]">
          {m._pending ? (
            <span className="flex items-center gap-1" title="Saved on this device; will be sent when you're online">
              <IconClock size={12} /> Waiting to send
            </span>
          ) : (
            formatTime(m.createdAt)
          )}
          {canDelete && (
            <button
              className="opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              onClick={() => confirm('Delete this message?') && deleteMessage(gid, m.id)}
              aria-label="Delete message"
            >
              <IconTrash size={12} />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
