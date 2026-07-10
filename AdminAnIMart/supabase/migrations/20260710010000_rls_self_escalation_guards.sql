-- ============================================================================
-- AniMart — close two self-escalation holes in RLS (security review H1 + H2)
--
-- The admin panel is a static client using the public anon key, so RLS is the
-- real security boundary. Two permissive policies let any signed-in mobile user
-- escalate their own privileges via the API (verified against the live DB):
--
--   H1  users_update_own grants UPDATE where auth.uid() = id with no column
--       limit. RLS cannot restrict columns, so a pending user could set their
--       own status='approved' / is_verified=true and skip User Approvals.
--
--   H2  subscriptions_insert_own only checks user_id = auth.uid(); it does not
--       constrain status, so a user could INSERT an 'approved' paid plan for
--       themselves and get premium without paying.
--
-- Fixes here are self-contained (a BEFORE-UPDATE guard trigger on users, and a
-- tighter WITH CHECK on the subscription self-insert policy) and do not change
-- the mobile app's legitimate flows:
--   • a user may still edit their own profile columns and (re)submit for
--     review by setting status back to a non-approved value like 'pending';
--   • a user may still file a premium request — those are inserted as
--     status='pending' with the real price and later approved by an admin;
--   • service-role / cron / SECURITY DEFINER backend writes carry a null
--     auth.uid() and are trusted (the guard skips them), and admins are allowed
--     through so approvals from the panel keep working.
-- ============================================================================

-- ── H1: block non-admin self-approval / self-verification on public.users ────
create or replace function public.guard_users_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    -- auth.uid() is null for the service role / cron / definer jobs (trusted);
    -- is_admin() is true for the admin panel's approval actions (allowed).
    -- Only a signed-in normal user editing their own row is constrained.
    if auth.uid() is not null and not public.is_admin() then
        if new.is_verified is distinct from old.is_verified and new.is_verified is true then
            raise exception 'Not allowed to change verification status'
                using errcode = '42501';
        end if;
        if new.status is distinct from old.status
           and lower(coalesce(new.status, '')) in ('approved', 'active', 'restricted', 'blocked') then
            raise exception 'Not allowed to change approval status'
                using errcode = '42501';
        end if;
    end if;
    return new;
end
$fn$;

drop trigger if exists trg_guard_users_privileged_columns on public.users;
create trigger trg_guard_users_privileged_columns
    before update on public.users
    for each row execute function public.guard_users_privileged_columns();

-- ── H2: a self-inserted subscription must start pending ───────────────────────
-- Admins still flip it to 'approved' via the admin UPDATE policies; the user can
-- never self-insert an already-approved (or active) paid plan.
alter policy subscriptions_insert_own on public.subscriptions
    with check ( user_id = auth.uid() and coalesce(status, 'pending') = 'pending' );
