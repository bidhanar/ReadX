import { useEffect, useState } from 'react';
import { useOnline } from '../data/sync';
import { lookUp, type LookupResult } from './define';
import { IconSearch } from '../components/icons';
import { EmptyState, Spinner } from '../components/ui';

/** Dictionary + Wikipedia for the selected word or phrase. */
export function DefinePanel({ term, lang }: { term: string; lang?: string }) {
  const online = useOnline();
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    setResult(null);
    setError(false);
    lookUp(term, lang)
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [term, lang, online]);

  const web = `https://www.google.com/search?q=${encodeURIComponent(`define ${term}`)}`;

  if (!online)
    return (
      <EmptyState icon={<IconSearch />} title="You're offline">
        Looking up words needs an internet connection.
      </EmptyState>
    );
  if (error)
    return (
      <EmptyState icon={<IconSearch />} title="Couldn't look that up">
        <a className="text-brand underline" href={web} target="_blank" rel="noopener noreferrer">
          Search the web instead
        </a>
      </EmptyState>
    );
  if (!result)
    return (
      <div className="text-ink-soft flex justify-center py-16">
        <Spinner />
      </div>
    );

  const { definition: d, wiki } = result;
  return (
    <div className="space-y-5 p-4">
      {d ? (
        <section>
          <div className="flex items-baseline gap-2">
            <h3 className="font-serif text-2xl font-semibold">{d.word}</h3>
            {d.phonetic && <span className="text-ink-soft">{d.phonetic}</span>}
            {d.audio && (
              <button className="text-brand text-sm hover:underline" onClick={() => new Audio(d.audio).play().catch(() => {})}>
                ▶ Listen
              </button>
            )}
          </div>
          {d.language && d.language !== 'English' && <p className="text-ink-soft text-xs">{d.language}</p>}
          <div className="mt-3 space-y-4">
            {d.meanings.map((m, i) => (
              <div key={i}>
                <p className="text-ink-soft mb-1 text-xs font-semibold tracking-wider uppercase">{m.partOfSpeech}</p>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                  {m.definitions.map((def, j) => (
                    <li key={j}>
                      {def.text}
                      {def.example && <p className="text-ink-soft mt-0.5 italic">“{def.example}”</p>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <p className="text-ink-soft mt-3 text-[11px]">
            From{' '}
            <a className="underline" href={d.sourceUrl} target="_blank" rel="noopener noreferrer">
              {d.source}
            </a>{' '}
            (Wiktionary, CC BY-SA)
          </p>
        </section>
      ) : (
        <p className="text-ink-soft text-sm">
          No dictionary entry for “<span className="text-ink">{result.term}</span>”.
        </p>
      )}

      {wiki && (
        <section className="border-line rounded-2xl border p-3">
          <div className="flex gap-3">
            {wiki.thumbnail && <img src={wiki.thumbnail} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0">
              <p className="font-semibold">{wiki.title}</p>
              {wiki.description && <p className="text-ink-soft text-xs">{wiki.description}</p>}
            </div>
          </div>
          <p className="mt-2 line-clamp-6 text-sm">{wiki.extract}</p>
          <a className="text-brand mt-1 inline-block text-xs hover:underline" href={wiki.url} target="_blank" rel="noopener noreferrer">
            Read more on Wikipedia
          </a>
        </section>
      )}

      <a className="btn-outline w-full justify-center text-sm" href={web} target="_blank" rel="noopener noreferrer">
        <IconSearch size={16} /> Search the web
      </a>
    </div>
  );
}
