-- ============================================================================
-- AniMart — soft delete for announcements (trash / restore)
-- Backs the "Deleted" view in web/pages/announcements.html.
-- Run in the Supabase SQL Editor.
--
-- deleted_at IS NULL      -> active (shown in the normal list)
-- deleted_at IS NOT NULL  -> in the trash (shown in the Deleted view)
--
-- Moving to trash / restoring is an UPDATE of deleted_at; "Delete Permanently"
-- is a real DELETE. Both are already covered by the admin RLS policies in
-- announcements_rls.sql, so no extra policy is needed here.
-- ============================================================================

alter table public.announcements
    add column if not exists deleted_at timestamptz default null;
