-- ============================================================================
-- AniMart — RLS so admins can read announcement views & likes
-- Backs the view / like counters in web/pages/announcements.html. Run in the
-- Supabase SQL Editor.
--
-- The admin page counts the per-user log tables `announcement_views` and
-- `announcement_likes` (one row per user per announcement) to show real view /
-- like totals on each card — the denormalized views_count / likes_count columns
-- on `announcements` aren't kept in sync, so they can't be trusted.
--
-- For an admin to count those rows, the tables need a SELECT policy that allows
-- admins — otherwise RLS silently returns 0 rows and every card shows 0.
--
-- "admin" is decided by public.is_admin() (defined in announcements_rls.sql):
-- a logged-in user whose email exists in public.admins. SECURITY DEFINER, so
-- the lookup isn't blocked by RLS on the admins table.
-- ============================================================================

alter table public.announcement_views enable row level security;
alter table public.announcement_likes enable row level security;

-- ── announcement_views: admins can read all ──
drop policy if exists "Admins read announcement_views" on public.announcement_views;
create policy "Admins read announcement_views"
    on public.announcement_views for select
    to authenticated
    using ( public.is_admin() );

-- ── announcement_likes: admins can read all ──
drop policy if exists "Admins read announcement_likes" on public.announcement_likes;
create policy "Admins read announcement_likes"
    on public.announcement_likes for select
    to authenticated
    using ( public.is_admin() );

-- NOTE: this only adds admin read access. It does not change how the mobile
-- app's normal users insert/read their own view & like rows — leave any
-- existing user-facing policies on these tables in place.
