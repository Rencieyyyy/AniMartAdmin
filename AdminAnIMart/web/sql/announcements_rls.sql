-- ============================================================================
-- AniMart — RLS so admins can manage announcements
-- Backs web/pages/announcements.html. Run in the Supabase SQL Editor.
--
-- An "admin" = a logged-in (authenticated) user whose email exists in the
-- public.admins table. We check that via a SECURITY DEFINER helper, public
-- .is_admin(), so the lookup is NOT blocked by RLS on the admins table itself
-- (a common reason inline "select 1 from admins" predicates silently fail and
-- writes affect 0 rows). The email match is case/whitespace-insensitive.
-- ============================================================================

-- ── Helper: is the current request an admin? ──
-- Body uses a single-quoted string (no $$ dollar-quoting) so the Supabase SQL
-- editor can't mis-split the multi-line definition. The literal 'email' is
-- escaped as ''email''.
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable
as 'select exists (select 1 from public.admins a where lower(trim(a.email)) = lower(trim(auth.jwt() ->> ''email'')))';

grant execute on function public.is_admin() to authenticated;

-- ── Helper: the current admin's id (for announcements.admin_id on insert) ──
-- Also SECURITY DEFINER so it isn't blocked by RLS on the admins table.
create or replace function public.current_admin_id()
returns uuid language sql security definer set search_path = public stable
as 'select id from public.admins where lower(trim(email)) = lower(trim(auth.jwt() ->> ''email'')) limit 1';

grant execute on function public.current_admin_id() to authenticated;

alter table public.announcements      enable row level security;
alter table public.announcement_tags  enable row level security;

-- ── announcements: admins can read all ──
drop policy if exists "Admins read announcements" on public.announcements;
create policy "Admins read announcements"
    on public.announcements for select
    to authenticated
    using ( public.is_admin() );

-- ── announcements: admins can create ──
drop policy if exists "Admins insert announcements" on public.announcements;
create policy "Admins insert announcements"
    on public.announcements for insert
    to authenticated
    with check ( public.is_admin() );

-- ── announcements: admins can edit (title / body / status) ──
drop policy if exists "Admins update announcements" on public.announcements;
create policy "Admins update announcements"
    on public.announcements for update
    to authenticated
    using      ( public.is_admin() )
    with check ( public.is_admin() );

-- ── announcements: admins can delete ──
drop policy if exists "Admins delete announcements" on public.announcements;
create policy "Admins delete announcements"
    on public.announcements for delete
    to authenticated
    using ( public.is_admin() );

-- ── announcement_tags: admins can read / create / delete ──
-- The page replaces the tag on every save (delete old, insert new), so admins
-- need insert + delete here too, not just select.
drop policy if exists "Admins read announcement_tags" on public.announcement_tags;
create policy "Admins read announcement_tags"
    on public.announcement_tags for select
    to authenticated
    using ( public.is_admin() );

drop policy if exists "Admins insert announcement_tags" on public.announcement_tags;
create policy "Admins insert announcement_tags"
    on public.announcement_tags for insert
    to authenticated
    with check ( public.is_admin() );

drop policy if exists "Admins delete announcement_tags" on public.announcement_tags;
create policy "Admins delete announcement_tags"
    on public.announcement_tags for delete
    to authenticated
    using ( public.is_admin() );
