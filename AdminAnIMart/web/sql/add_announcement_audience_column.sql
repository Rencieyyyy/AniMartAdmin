-- ============================================================================
-- AniMart — add a target-audience column to announcements
-- Backs the "Target Audience" dropdown in web/pages/announcements.html.
-- Run in the Supabase SQL Editor.
--
-- Allowed values match the dropdown options:
--   all      -> All Users
--   sellers  -> Sellers Only
--   buyers   -> Buyers Only
--   premium  -> Premium Members
-- ============================================================================

alter table public.announcements
    add column if not exists audience text not null default 'all';

alter table public.announcements
    drop constraint if exists announcements_audience_check;

alter table public.announcements
    add constraint announcements_audience_check
    check (audience in ('all', 'sellers', 'buyers', 'premium'));
