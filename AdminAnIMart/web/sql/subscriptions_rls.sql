-- ============================================================================
-- AniMart — RLS so admins can manage premium subscriptions
-- Backs web/pages/premium.html. Run in the Supabase SQL Editor.
-- Uses the SECURITY DEFINER public.is_admin() helper (see announcements_rls.sql).
-- ============================================================================

alter table public.subscriptions enable row level security;

drop policy if exists "Admins read subscriptions" on public.subscriptions;
create policy "Admins read subscriptions" on public.subscriptions
    for select to authenticated
    using ( public.is_admin() );

drop policy if exists "Admins update subscriptions" on public.subscriptions;
create policy "Admins update subscriptions" on public.subscriptions
    for update to authenticated
    using      ( public.is_admin() )
    with check ( public.is_admin() );
