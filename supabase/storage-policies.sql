-- ReadX: book file storage on Supabase (free tier), authenticated by Firebase Auth.
--
-- Prerequisite (Supabase dashboard): Authentication → Sign In / Providers → Third-party Auth
--   → Add provider → Firebase → enter your Firebase project ID.
--
-- Then run this whole file in the SQL editor, after replacing YOUR_FIREBASE_PROJECT_ID (2 places).
--
-- Security model: the bucket is private. Only requests carrying a valid Firebase ID token for
-- *your* Firebase project may read/upload. Files live at unguessable paths (books/<uuid>.<ext>),
-- and only group members can learn a path (Firestore rules). Supabase cannot see Firestore group
-- membership, so a signed-in user of your app who somehow obtained a path could fetch that file.

-- 1) Private bucket, 50 MB per file, only PDF / EPUB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', false, 52428800, array['application/pdf', 'application/epub+zip'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Helper: is this request signed with a Firebase token from our project?
create or replace function public.is_readx_firebase_user()
returns boolean
language sql stable
as $$
  select coalesce(
    auth.jwt() ->> 'iss' = 'https://securetoken.google.com/YOUR_FIREBASE_PROJECT_ID'
    and auth.jwt() ->> 'aud' = 'YOUR_FIREBASE_PROJECT_ID',
    false
  );
$$;

-- 3) Policies. Firebase tokens have no `role` claim unless you add one, so Supabase treats them as
--    `anon`; we allow both roles but always require the Firebase issuer/audience check.
drop policy if exists "readx read books"   on storage.objects;
drop policy if exists "readx upload books" on storage.objects;
drop policy if exists "readx delete books" on storage.objects;

create policy "readx read books" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'books' and public.is_readx_firebase_user());

create policy "readx upload books" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'books'
    and public.is_readx_firebase_user()
    and name ~ '^books/[0-9a-f-]{36}\.(pdf|epub)$'
  );

-- Uploader may delete their own file (uploader uid is stored in object metadata by the app)
create policy "readx delete books" on storage.objects
  for delete to anon, authenticated
  using (
    bucket_id = 'books'
    and public.is_readx_firebase_user()
    and (user_metadata ->> 'uploadedBy') = (auth.jwt() ->> 'sub')
  );
