-- ============================================================================
-- AniMart — add a `status` column to support_messages
-- Lets the Customer Service inbox track Open vs Resolved separately from the
-- per-message `read` flag, so that an admin simply *reading* a thread clears the
-- unread badge WITHOUT marking the whole conversation resolved. Run in the
-- Supabase SQL Editor.
--
--   read    : per message — has the admin seen this user message? (the "2" badge)
--   status  : per conversation — Open until an admin clicks "Mark resolved".
--
-- Nullable-safe: existing rows default to 'open', and the mobile app can keep
-- inserting user messages without setting status (they default to 'open', which
-- naturally re-opens a previously resolved thread).
-- ============================================================================

alter table public.support_messages
    add column if not exists status text not null default 'open'
        check (status in ('open', 'pending', 'closed'));
