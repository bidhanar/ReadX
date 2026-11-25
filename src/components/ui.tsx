import { useEffect, type ReactNode } from 'react';
import { cx, initials, userColor } from '../lib/util';
import { IconX } from './icons';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="text-ink-soft flex h-full flex-col items-center justify-center gap-3">
      <Spinner />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

/** A person's photo / initials, or (with `square`) a group's logo / initials. */
export function Avatar({
  uid,
  name,
  photo,
  size = 32,
  square,
}: {
  uid: string;
  name: string;
  photo?: string | null;
  size?: number;
  square?: boolean;
}) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  const shape = square ? 'rounded-[28%]' : 'rounded-full';
  if (photo)
    return (
      <img
        src={photo}
        alt={name}
        referrerPolicy="no-referrer"
        className={cx('shrink-0 object-cover', shape, square && 'bg-card ring-line ring-1')}
        style={style}
      />
    );
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center font-semibold text-white', shape)}
      style={{ ...style, background: userColor(uid) }}
      aria-label={name}
    >
      {initials(name) || '?'}
    </span>
  );
}

/** Centered dialog on desktop, bottom sheet on phones. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center" onMouseDown={onClose}>
      <div
        className={cx(
          'safe-bottom animate-slide-up bg-card max-h-[88vh] w-full overflow-y-auto rounded-t-3xl p-5 shadow-xl sm:rounded-3xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
              <IconX />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Side panel (right on desktop, bottom sheet on phones) used inside the reader. */
export function Panel({
  open,
  onClose,
  title,
  children,
  side = 'right',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  side?: 'left' | 'right';
}) {
  if (!open) return null;
  return (
    <>
      {/* Phones: dimmed backdrop, tap to close. Desktop: no backdrop, so the book stays usable beside the panel. */}
      <div className="fixed inset-0 z-40 bg-black/25 md:hidden" onClick={onClose} />
      <aside
        className={cx(
          'bg-card safe-bottom fixed z-50 flex flex-col shadow-2xl',
          'inset-x-0 bottom-0 max-h-[75vh] rounded-t-3xl',
          'md:inset-y-0 md:bottom-auto md:h-full md:max-h-none md:w-[380px] md:rounded-none',
          side === 'right' ? 'md:right-0 md:left-auto' : 'md:left-0 md:right-auto',
        )}
      >
        <div className="border-line flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="text-ink-soft flex flex-col items-center px-6 py-16 text-center">
      <div className="bg-brand-soft text-brand mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">{icon}</div>
      <h3 className="text-ink mb-1 font-semibold">{title}</h3>
      <div className="max-w-sm text-sm">{children}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{friendlyError(msg)}</p>;
}

export function friendlyError(msg: string): string {
  if (msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions'))
    return "You don't have access to this. You may have been removed from the group.";
  if (msg.includes('auth/popup-closed-by-user') || msg.includes('canceled')) return 'Sign-in was cancelled.';
  if (msg.includes('unavailable') || msg.includes('Failed to fetch') || msg.includes('network-request-failed'))
    return "Can't reach the server. Check your connection.";
  return msg;
}
