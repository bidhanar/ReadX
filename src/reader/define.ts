/**
 * Look up a selected word or phrase. Free, keyless, CORS-enabled sources:
 *  - Free Dictionary API (dictionaryapi.dev): English definitions, pronunciation, audio
 *  - Wiktionary REST: fallback for other languages and forms the first one doesn't know
 *  - Wikipedia REST summary: names, places, concepts
 */

export interface Meaning {
  partOfSpeech: string;
  definitions: { text: string; example?: string }[];
}

export interface Definition {
  word: string;
  phonetic?: string;
  audio?: string;
  /** e.g. "English", "French" (Wiktionary) */
  language?: string;
  meanings: Meaning[];
  source: 'Free Dictionary' | 'Wiktionary';
  sourceUrl: string;
}

export interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  url: string;
  thumbnail?: string;
}

export interface LookupResult {
  term: string;
  definition: Definition | null;
  wiki: WikiSummary | null;
}

/** Trim punctuation and possessives: “Gatsby's,” → Gatsby */
export function cleanTerm(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/['’]s$/u, '');
}

/** Short enough to look up (a word or a short phrase). */
export const isLookupable = (text: string) => {
  const t = cleanTerm(text);
  return t.length > 0 && t.length <= 60 && t.split(' ').length <= 4;
};

const text = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  return (await res.json()) as T;
}

type FreeDictEntry = {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[];
};

async function freeDictionary(word: string, signal: AbortSignal): Promise<Definition | null> {
  const data = await getJson<FreeDictEntry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, signal);
  if (!data?.length) return null;
  const meanings = new Map<string, Meaning>();
  for (const e of data)
    for (const m of e.meanings) {
      const into = meanings.get(m.partOfSpeech) ?? { partOfSpeech: m.partOfSpeech, definitions: [] };
      for (const d of m.definitions) if (into.definitions.length < 4) into.definitions.push({ text: d.definition, example: d.example });
      meanings.set(m.partOfSpeech, into);
    }
  const phonetics = data.flatMap((e) => e.phonetics ?? []);
  return {
    word: data[0].word,
    phonetic: data.find((e) => e.phonetic)?.phonetic ?? phonetics.find((p) => p.text)?.text,
    audio: phonetics.find((p) => p.audio)?.audio || undefined,
    meanings: [...meanings.values()].slice(0, 5),
    source: 'Free Dictionary',
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  };
}

type WiktionaryResponse = Record<
  string,
  { partOfSpeech: string; language: string; definitions: { definition: string; examples?: string[] }[] }[]
>;

async function wiktionary(word: string, signal: AbortSignal, lang?: string): Promise<Definition | null> {
  const data = await getJson<WiktionaryResponse>(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, signal);
  if (!data) return null;
  // Prefer the book's language, then English, then whatever there is
  const code = (lang && data[lang] ? lang : data.en ? 'en' : Object.keys(data)[0]) as string | undefined;
  const list = code ? data[code] : undefined;
  if (!list?.length) return null;
  const meanings = list
    .map((m) => ({
      partOfSpeech: m.partOfSpeech,
      definitions: m.definitions
        .map((d) => ({ text: text(d.definition), example: d.examples?.[0] ? text(d.examples[0]) : undefined }))
        .filter((d) => d.text)
        .slice(0, 4),
    }))
    .filter((m) => m.definitions.length)
    .slice(0, 5);
  if (!meanings.length) return null;
  return {
    word,
    language: list[0].language,
    meanings,
    source: 'Wiktionary',
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  };
}

type WikiResponse = {
  type: string;
  title: string;
  description?: string;
  extract: string;
  content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } };
  thumbnail?: { source: string };
};

async function wikipedia(term: string, signal: AbortSignal, lang = 'en'): Promise<WikiSummary | null> {
  const host = /^[a-z]{2,3}$/.test(lang) ? lang : 'en';
  const data = await getJson<WikiResponse>(
    `https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, '_'))}?redirect=true`,
    signal,
  );
  if (!data || data.type === 'disambiguation' || !data.extract) return null;
  return {
    title: data.title,
    description: data.description,
    extract: data.extract,
    url: data.content_urls?.mobile?.page ?? data.content_urls?.desktop?.page ?? `https://${host}.wikipedia.org/wiki/${encodeURIComponent(term)}`,
    thumbnail: data.thumbnail?.source,
  };
}

const cache = new Map<string, Promise<LookupResult>>();

/** Definition + encyclopedia summary for a word or short phrase. `lang`: the book's language code. */
export function lookUp(raw: string, lang?: string): Promise<LookupResult> {
  const term = cleanTerm(raw);
  const key = `${lang ?? ''}|${term.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 12_000);
  const single = !term.includes(' ');
  const english = !lang || lang.startsWith('en');
  const p = (async (): Promise<LookupResult> => {
    const [definition, wiki] = await Promise.all([
      (async () => {
        const lower = term.toLowerCase();
        if (english) {
          const d = await freeDictionary(lower, ac.signal).catch(() => null);
          if (d) return d;
        }
        return (await wiktionary(single ? lower : term, ac.signal, lang?.slice(0, 2)).catch(() => null)) ??
          (single && term !== lower ? await wiktionary(term, ac.signal, lang?.slice(0, 2)).catch(() => null) : null);
      })(),
      wikipedia(term, ac.signal, lang?.slice(0, 2)).catch(() => null),
    ]);
    return { term, definition, wiki };
  })().finally(() => clearTimeout(timeout));
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
