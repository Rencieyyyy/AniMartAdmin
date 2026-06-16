-- ============================================================================
-- AniMart — RLS so admins can review & approve/reject users
-- Backs web/pages/user.html. Run in the Supabase SQL Editor.
--
-- An "admin" = a logged-in (authenticated) user whose email exists in the
-- public.admins table. These policies let such users READ all users and
-- UPDATE their status / is_verified. The seller_profiles read policy is needed
-- because the page embeds seller_profiles(shop_name) to detect Sellers.
-- ============================================================================

alter table public.users          enable row level security;
alter table public.seller_profiles enable row level security;

-- Helper predicate (inlined in each policy):
--   exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'))

-- ── users: admins can read everyone ──
drop policy if exists "Admins read users" on public.users;
create policy "Admins read users"
    on public.users for select
    to authenticated
    using ( exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')) );

-- ── users: admins can approve / reject (update status & is_verified) ──
drop policy if exists "Admins update users" on public.users;
create policy "Admins update users"
    on public.users for update
    to authenticated
    using      ( exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')) )
    with check ( exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')) );

-- ── seller_profiles: admins can read (for role detection in the list) ──
drop policy if exists "Admins read seller_profiles" on public.seller_profiles;
create policy "Admins read seller_profiles"
    on public.seller_profiles for select
    to authenticated
    using ( exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')) );

-- NOTE: This does NOT add an INSERT policy for users — that belongs to your
-- sign-up flow (the mobile app), where new rows should be created with
-- status = 'pending'. Keep that policy separate.
