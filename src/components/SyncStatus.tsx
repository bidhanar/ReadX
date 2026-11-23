import { dismissSyncError, useOnline, useSyncState } from '../data/sync';
import { friendlyError, Spinner } from './ui';
import { IconCloudOff, IconX } from './icons';

/**
 * Small floating pill: offline / syncing / a change the server rejected. Hidden when all is well.
 * Sits above the reader's footer so it never covers page controls.
 */
export function SyncStatus() {
  const online = useOnline();
  const { pending, error } = useSyncState();

  let body: React.ReactNode = null;
  if (error) {
    body = (
      <div className="flex items-center gap-2 rounded-full bg-red-600 py-1.5 pr-1.5 pl-3.5 text-xs text-white shadow-lg" role="alert">
        <span className="max-w-[70vw] truncate">
          {error.what} didn't sync: {friendlyError(error.message)}
        </span>
        <button className="rounded-full p-1 hover:bg-white/20" onClick={dismissSyncError} aria-label="Dismiss">
          <IconX size={14} />
        </button>
      </div>
    );
  } else if (!online) {
    body = (
      <div className="flex items-center gap-2 rounded-full bg-[#1c2433] px-3.5 py-1.5 text-xs text-white shadow-lg" role="status">
        <IconCloudOff size={14} />
        {/* No exact count: changes queued before a reload/restart are kept by Firestore but not counted here */}
        Offline{pending > 0 ? " · your changes are saved and will sync when you're back" : ' · reading from this device'}
      </div>
    );
  } else if (pending > 0) {
    body = (
      <div className="flex items-center gap-2 rounded-full bg-[#1c2433] px-3.5 py-1.5 text-xs text-white shadow-lg" role="status">
        <Spinner className="h-3 w-3" />
        Syncing changes…
      </div>
    );
  }
  if (!body) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4 [&>*]:pointer-events-auto"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 84px)' }}
    >
      {body}
    </div>
  );
}
