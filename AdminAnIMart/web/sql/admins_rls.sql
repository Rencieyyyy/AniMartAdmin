-- ============================================================================
-- AniMart — let a logged-in admin read their own row in public.admins
-- Backs web/pages/profile.html (loadAdminProfile reads admins directly).
-- Run in the Supabase SQL Editor.
--
-- Without this, RLS on the admins table returns 0 rows to the authenticated
-- client, so .single() fails with:
--   PGRST116 "Cannot coerce the result to a single JSON object"
--
-- This policy is additive and email-scoped: each admin can read only their own
-- record (matched against the email claim in their JWT). It does not affect
-- login (that uses Supabase auth, not this table).
-- ============================================================================

alter table public.admins enable row level security;

-- Read own row (fixes the profile-load PGRST116 error).
drop policy if exists "Admins read own row" on public.admins;
create policy "Admins read own row" on public.admins
    for select to authenticated
    using ( lower(trim(email)) = lower(trim(auth.jwt() ->> 'email')) );

-- Update own row (so profile.html "Save Changes" and the profile-picture
-- upload can persist name / phone / location / messenger / pfp).
drop policy if exists "Admins update own row" on public.admins;
create policy "Admins update own row" on public.admins
    for update to authenticated
    using      ( lower(trim(email)) = lower(trim(auth.jwt() ->> 'email')) )
    with check ( lower(trim(email)) = lower(trim(auth.jwt() ->> 'email')) );
