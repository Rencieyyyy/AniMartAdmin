-- ============================================================================
-- AniMart — RLS so admins can run the Customer Service inbox on support_messages
-- Backs web/pages/customer-service.html. The table is created/owned by the
-- mobile app; this only ADDS admin access. Run in the Supabase SQL Editor.
--
-- support_messages shape (from the mobile app):
--   id         uuid
--   user_id    uuid   -- the user (seller/buyer) the thread belongs to
--   sender     text   -- 'user' | 'admin'
--   admin_id   uuid   -- which admin replied (null for user messages)
--   body       text
--   read       bool
--   created_at timestamptz
--
-- A user U's conversation = every row with user_id = U; `admin_id`/`sender`
-- decide which side a row is on.
--
-- "admin" = public.is_admin() from announcements_rls.sql (a logged-in user whose
-- email is in public.admins). We only ADD policies and deliberately do NOT toggle
-- RLS on/off, so we can't accidentally start enforcing it on the mobile app:
--   • if RLS is already on (with user-only policies), these let admins in;
--   • if RLS is off, admins already have full access and these sit dormant.
-- ============================================================================

drop policy if exists "Admins read support_messages" on public.support_messages;
create policy "Admins read support_messages" on public.support_messages
    for select to authenticated using ( public.is_admin() );

-- Admins reply (sender must be 'admin'); marking read is an update.
drop policy if exists "Admins reply support_messages" on public.support_messages;
create policy "Admins reply support_messages" on public.support_messages
    for insert to authenticated
    with check ( public.is_admin() and sender = 'admin' );

drop policy if exists "Admins update support_messages" on public.support_messages;
create policy "Admins update support_messages" on public.support_messages
    for update to authenticated
    using ( public.is_admin() ) with check ( public.is_admin() );

-- ── Realtime ──
-- Ensure the table streams live so the inbox can update without polling (guarded
-- so re-running doesn't error if the mobile app already added it).
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
    ) then
        alter publication supabase_realtime add table public.support_messages;
    end if;
end $$;
