-- ============================================================================
-- AniMart — admin read access to the sign-up liveness check
--
-- The mobile app's sign-up flow runs a 4-pose liveness check (center / right /
-- left / down), uploads each pose to Cloudinary and — via an AFTER INSERT
-- trigger on public.users — records the URLs in
-- public.user_liveness_verification. That table is created by the MOBILE repo's
-- migration 20260722000000_user_liveness_verification.sql; this migration does
-- NOT create it, it only makes sure the admin portal can read it.
--
-- Why this exists: the mobile migration adds its admin policies inside a
-- conditional block that is skipped when public.is_admin() does not yet exist
-- (and it is skipped entirely when the table was created by hand in the
-- Supabase dashboard). If that happened, RLS silently returns zero rows and the
-- User Approvals modal shows "Not submitted" for every applicant. Running this
-- migration from the admin repo — where is_admin() is guaranteed to exist —
-- repairs that.
--
-- Idempotent and safe to run repeatedly; a no-op when the table is absent.
-- ============================================================================

do $$
begin
    if to_regclass('public.user_liveness_verification') is null then
        raise notice 'user_liveness_verification not found — run the mobile repo migration first; skipping.';
        return;
    end if;

    execute 'alter table public.user_liveness_verification enable row level security';

    -- Admins review the poses before approving the account (read-only: nothing
    -- in the panel edits this table, and blocked admins fail is_admin()).
    execute 'drop policy if exists "user_liveness_select_admin" on public.user_liveness_verification';
    execute 'create policy "user_liveness_select_admin" '
         || 'on public.user_liveness_verification for select to authenticated '
         || 'using ( public.is_admin() )';

    -- Applicants keep read access to their own record (recreated here so this
    -- migration also repairs a hand-made dashboard table).
    execute 'drop policy if exists "user_liveness_select_own" on public.user_liveness_verification';
    execute 'create policy "user_liveness_select_own" '
         || 'on public.user_liveness_verification for select to authenticated '
         || 'using ( user_id = auth.uid() )';
end $$;

notify pgrst, 'reload schema';
