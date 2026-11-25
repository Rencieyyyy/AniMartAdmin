-- ============================================================================
-- AniMart — Supabase Storage setup for image uploads
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent where shown).
--
-- Model: images live in Storage; the DB stores only public URLs.
--   - avatar   : admin/user profile pictures (2 MB cap)
--   - listings : marketplace listing images   (5 MB cap)
-- Both buckets are PUBLIC (read-only to anyone with the URL). This is the right
-- default for a marketplace where product/profile images are meant to be shown
-- publicly and benefit from CDN caching. Writes are still locked down by RLS so
-- a user can only upload/replace/delete files under their own user-id folder.
-- ============================================================================


-- 1) BUCKETS ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('avatar',   'avatar',   true, 2097152, array['image/jpeg','image/png','image/webp','image/gif']),
    ('listings', 'listings', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;


-- 2) RLS POLICIES on storage.objects ------------------------------------------
-- RLS is already enabled on storage.objects in Supabase by default.

-- Public read for both buckets (matches getPublicUrl in storage.js).
drop policy if exists "Public read avatars" on storage.objects;
create policy "Public read avatars"
    on storage.objects for select
    to public
    using ( bucket_id = 'avatar' );

drop policy if exists "Public read listings" on storage.objects;
create policy "Public read listings"
    on storage.objects for select
    to public
    using ( bucket_id = 'listings' );

-- Authenticated users may upload/update/delete ONLY inside their own folder,
-- i.e. the first path segment must equal their auth uid:
--   avatar/<uid>/avatar.png   |   listings/<uid>/<listing_id>/0.jpg
drop policy if exists "Users manage own avatar" on storage.objects;
create policy "Users manage own avatar"
    on storage.objects for all
    to authenticated
    using      ( bucket_id = 'avatar'  and (storage.foldername(name))[1] = auth.uid()::text )
    with check ( bucket_id = 'avatar'  and (storage.foldername(name))[1] = auth.uid()::text );

drop policy if exists "Sellers manage own listing images" on storage.objects;
create policy "Sellers manage own listing images"
    on storage.objects for all
    to authenticated
    using      ( bucket_id = 'listings' and (storage.foldername(name))[1] = auth.uid()::text )
    with check ( bucket_id = 'listings' and (storage.foldername(name))[1] = auth.uid()::text );


-- 3) DB COLUMNS ---------------------------------------------------------------
-- admins.pfp already exists (see add_pfp_column.sql). It now holds a URL string
-- instead of base64 — no schema change needed; text fits a URL fine.

-- Listings table does NOT exist yet anywhere in the project (the admin panel
-- uses mock data; the Flutter app is an empty scaffold). This is a STUB so the
-- listings bucket + helper have a home. Adjust columns to your real schema when
-- you build the create/edit-listing flow.  >>> FLAGGED: review before applying.
create table if not exists public.listings (
    id          uuid primary key default gen_random_uuid(),
    seller_id   uuid not null references auth.users(id) on delete cascade,
    title       text,
    description text,
    price       numeric(12,2),
    image_urls  text[] not null default '{}',   -- public URLs from uploadListingImages()
    created_at  timestamptz not null default now()
);

-- If you ALREADY have a listings table, skip the create above and just add the
-- image column instead:
-- alter table public.listings add column if not exists image_urls text[] not null default '{}';

-- Minimal RLS for the listings table (owner-write, public-read). Enable + adjust
-- when you build the feature.
-- alter table public.listings enable row level security;
-- create policy "Public read listings rows"   on public.listings for select to public using ( true );
-- create policy "Sellers manage own listings" on public.listings for all    to authenticated
--     using ( seller_id = auth.uid() ) with check ( seller_id = auth.uid() );
