-- ============================================================================
-- AniMart — RLS so admins can read the app "Rate us" reviews on the Reviews page
-- Backs web/pages/reviews.html. The table is created/owned by the mobile app
-- (the "Rate us" screen); this only ADDS admin read access. Run in the Supabase
-- SQL Editor.
--
-- reviews shape (from the mobile app):
--   id          uuid
--   seller_id   uuid   -- subject of the review (may be unused for app ratings)
--   reviewer_id uuid   -- the user who left the rating
--   rating      int4   -- 1..5
--   comment     text   -- optional written feedback
--   created_at  timestamptz
--   updated_at  timestamptz
--
-- "admin" = public.is_admin() from announcements_rls.sql (a logged-in user whose
-- email is in public.admins). We only ADD a policy and deliberately do NOT toggle
-- RLS on/off, so we can't accidentally start enforcing it on the mobile app:
--   • if RLS is already on (with user-only policies), this lets admins read;
--   • if RLS is off, admins already have full access and this sits dormant.
-- The Reviews page is read-only, so admins only need SELECT.
-- ============================================================================

drop policy if exists "Admins read reviews" on public.reviews;
create policy "Admins read reviews" on public.reviews
    for select to authenticated using ( public.is_admin() );
