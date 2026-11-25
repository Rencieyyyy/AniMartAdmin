-- ============================================================================
-- PENDING — H3 part 2: lock public.users SELECT to own-row + admin
--
--   ⚠️  DO NOT APPLY YET.  This is a BREAKING change for the mobile app.
--
-- Why it's staged and not in supabase/migrations: the mobile app currently
-- reads OTHER users' rows straight from public.users to show seller/buyer/
-- reviewer/commenter names (listings.seller_id, offers.buyer_id, reviews.
-- reviewer_id, *_comments.user_id are bare FKs — no denormalized names). The
-- admin-panel migration 20260710020000 already added the safe read path:
--     public.public_profiles  (name/avatar/shop/badges only, no PII)
--
-- Rollout order:
--   1) Update the MOBILE app so every cross-user profile read (direct selects
--      AND PostgREST embeds like `listings?select=*,seller:users(...)`) targets
--      public_profiles instead of users. A user still reads their OWN full row
--      from users (RLS below allows auth.uid() = id).
--   2) Update this admin repo if any page reads another user's row from users
--      for non-admin reasons (the admin pages are fine — they run as an admin,
--      and the policy below keeps is_admin() full access).
--   3) THEN apply this file (Supabase SQL editor or as a new migration) and
--      re-run the H3 verification (a non-admin should read only their own row).
--
-- Also outstanding (separate from RLS): valid_id images are stored as PUBLIC
-- Cloudinary URLs, so anyone with the link can view a government ID regardless
-- of DB access. Move new uploads to a PRIVATE bucket with signed URLs (as the
-- premium payment-receipts flow already does) — a mobile-side change.
-- ============================================================================

begin;

-- Drop the blanket "any authenticated user can read every row" grants.
drop policy if exists "Authenticated read users" on public.users;
drop policy if exists "users_read_basic"        on public.users;

-- Keep/ensure own-row read (these already exist; recreated for safety).
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
    on public.users for select
    to authenticated
    using ( auth.uid() = id );

-- Admins keep full read (the panel relies on it). No such policy exists today —
-- broad read came from the USING(true) policy — so it MUST be added here or the
-- admin panel breaks.
drop policy if exists "users_select_admin" on public.users;
create policy "users_select_admin"
    on public.users for select
    to authenticated
    using ( public.is_admin() );

commit;

-- Verify afterwards (rolled back) that a normal user sees only themselves:
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<non-admin-uuid>","email":"<x>","role":"authenticated"}';
--   select count(*) from public.users;              -- expect 1
--   select count(*) from public.public_profiles;    -- expect all (safe cols)
--   rollback;
