import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '../auth/AuthProvider';
import { createGroup, joinGroup, useMyGroups } from '../data/groups';
import { IconChevronRight, IconLogout, IconPlus, IconUsers } from '../components/icons';
import { Avatar, EmptyState, ErrorText, Modal, Spinner } from '../components/ui';
import { publicUrl } from '../lib/util';

export default function HomePage() {
  const user = useUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { groups, loading, error } = useMyGroups(user.uid);
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      // Accept a full invite link as well as a bare code
      const code = value.trim().split('/join/').pop()!;
      const gid = mode === 'create' ? await createGroup(user, value) : await joinGroup(user, code);
      navigate(`/g/${gid}`);
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };

  const open = (m: 'create' | 'join') => {
    setMode(m);
    setValue('');
    setFormError(null);
  };

  return (
    <div className="safe-top mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="flex items-center gap-3 px-5 pt-6 pb-4">
        <img src={publicUrl('icon.svg')} alt="" className="h-11 w-11" />
        <h1 className="flex-1 font-serif text-2xl font-semibold">ReadX</h1>
        <Avatar uid={user.uid} name={user.displayName || ''} photo={user.photoURL} size={34} />
        <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
          <IconLogout />
        </button>
      </header>

      <div className="flex gap-2 px-5 pb-4">
        <button className="btn-primary" onClick={() => open('create')}>
          <IconPlus size={18} /> New group
        </button>
        <button className="btn-outline" onClick={() => open('join')}>
          Join with code
        </button>
      </div>

      <main className="flex-1 px-5 pb-10">
        <h2 className="text-ink-soft mb-2 text-xs font-semibold tracking-wider uppercase">Your groups</h2>
        {loading ? (
          <div className="text-ink-soft py-10 text-center">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorText error={error} />
        ) : groups.length === 0 ? (
          <EmptyState icon={<IconUsers />} title="No groups yet">
            Create a group for your book club, class or friends, then share the invite link.
          </EmptyState>
        ) : (
          <ul className="card divide-line divide-y overflow-hidden">
            {groups.map((g) => (
              <li key={g.id}>
                <Link to={`/g/${g.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-black/[0.02]">
                  <Avatar uid={g.id} name={g.name} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{g.name}</p>
                    <p className="text-ink-soft text-xs">{g.ownerId === user.uid ? 'You own this group' : 'Member'}</p>
                  </div>
                  <IconChevronRight className="text-ink-soft" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode === 'create' ? 'New group' : 'Join a group'}>
        <form onSubmit={submit} className="space-y-3">
          <input
            autoFocus
            className="input"
            placeholder={mode === 'create' ? 'Group name, e.g. Sunday Book Club' : 'Invite code or link'}
            value={value}
            maxLength={mode === 'create' ? 80 : 200}
            onChange={(e) => setValue(e.target.value)}
          />
          <ErrorText error={formError} />
          <button className="btn-primary w-full" disabled={busy || !value.trim()}>
            {busy && <Spinner className="h-4 w-4" />}
            {mode === 'create' ? 'Create group' : 'Join'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
