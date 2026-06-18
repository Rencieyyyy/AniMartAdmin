-- ============================================================================
-- AniMart — RLS so admins can read (and moderate) announcement comments
-- Backs the comments modal in web/pages/announcements.html. Run in the
-- Supabase SQL Editor.
--
-- The page reads `announcement_comments` (id, announcement_id, user_id, text,
-- created_at) and embeds the author from `users` (name, is_seller). For an
-- admin to see those rows, the table needs a SELECT policy that allows admins —
-- otherwise RLS silently returns 0 rows and the modal looks empty.
--
-- "admin" is decided by public.is_admin() (defined in announcements_rls.sql):
-- a logged-in user whose email exists in public.admins. SECURITY DEFINER, so
-- the lookup isn't blocked by RLS on the admins table.
-- ============================================================================

alter table public.announcement_comments enable row level security;

-- ── admins can read every comment ──
drop policy if exists "Admins read announcement_comments" on public.announcement_comments;
create policy "Admins read announcement_comments"
    on public.announcement_comments for select
    to authenticated
    using ( public.is_admin() );

-- ── admins can delete comments (moderation) ──
-- The modal's "Remove" button is currently client-side only; this policy lets a
-- future wired-up delete actually remove the row.
drop policy if exists "Admins delete announcement_comments" on public.announcement_comments;
create policy "Admins delete announcement_comments"
    on public.announcement_comments for delete
    to authenticated
    using ( public.is_admin() );

-- NOTE: this does not grant the mobile app's normal users permission to read or
-- write their own comments. If those policies don't already exist, add them
-- separately (e.g. authors can insert/select their own rows via user_id = auth.uid()).
