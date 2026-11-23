import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../auth/AuthProvider';
import { joinGroup } from '../data/groups';
import { ErrorText, FullScreenSpinner } from '../components/ui';

export default function JoinPage() {
  const { code = '' } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    joinGroup(user, code)
      .then((gid) => navigate(`/g/${gid}`, { replace: true }))
      .catch(setError);
  }, [code, user, navigate]);

  if (!error) return <FullScreenSpinner label="Joining group…" />;
  return (
    <div className="mx-auto max-w-sm p-8 text-center">
      <h1 className="mb-2 text-lg font-semibold">Couldn't join</h1>
      <ErrorText error={error} />
      <Link to="/" className="btn-primary mt-6">
        Go home
      </Link>
    </div>
  );
}
