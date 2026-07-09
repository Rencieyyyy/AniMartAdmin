-- ============================================================================
-- AniMart Admin — owner-protected super admin
--
-- Adds public.admins.is_owner. An owner is a super admin that NO other super
-- admin can touch through the panel: they cannot be demoted, restricted,
-- blocked or deleted, and the owner flag itself cannot be granted or revoked
-- from the client. Only a direct database / migration change (a trusted
-- "server context" — no admin JWT) can alter an owner.
--
-- This is a hard rule in the database, so it holds even if the UI is bypassed
-- (devtools / direct PostgREST). The Edge Function `admin-users` re-checks it
-- for delete, because that path runs as the service role (a server context the
-- trigger below deliberately trusts).
--
-- Must NOT rename/drop public.admins or public.protect_admins_row() — the
-- trigger function is redefined in place with the same signature.
-- ============================================================================

-- ── 1) is_owner column ───────────────────────────────────────────────────────
alter table public.admins
    add column if not exists is_owner boolean not null default false;

-- ── 2) guard trigger — add owner protection ──────────────────────────────────
-- Redefines protect_admins_row() from 20260709003000, adding three owner rules
-- on top of the existing self / last-super-admin guards:
--   • an owner cannot be demoted, restricted, blocked or deleted from the panel;
--   • the is_owner flag can only be changed in a server context (so a super
--     admin can't strip the flag first and then demote the owner);
--   • server contexts (migrations / the admin-users Edge Function) are still
--     trusted — the Edge Function separately refuses to delete an owner.
create or replace function public.protect_admins_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_is_server boolean :=
        auth.uid() is null and coalesce(auth.jwt() ->> 'email', '') = '';
    v_is_self boolean;
begin
    if tg_op = 'DELETE' then
        if old.is_owner and not v_is_server then
            raise exception 'The owner account is protected and cannot be deleted'
                using errcode = '42501';
        end if;

        if old.role = 'super_admin' and old.status = 'active' and not exists (
            select 1 from public.admins a
            where a.id <> old.id and a.role = 'super_admin' and a.status = 'active'
        ) then
            raise exception 'Cannot delete the last active super admin'
                using errcode = '42501';
        end if;
        return old;
    end if;

    -- UPDATE

    -- Owner flag itself: only a trusted server context may grant or revoke it,
    -- so no super admin can un-own the owner (via the client) and then demote.
    if new.is_owner is distinct from old.is_owner and not v_is_server then
        raise exception 'Owner status can only be changed directly in the database'
            using errcode = '42501';
    end if;

    if new.role is distinct from old.role
       or new.status is distinct from old.status then

        -- An owner cannot be demoted, restricted or blocked through the panel.
        if old.is_owner and not v_is_server then
            raise exception 'The owner account cannot be demoted, restricted or blocked'
                using errcode = '42501';
        end if;

        if not v_is_server then
            if not public.is_super_admin() then
                raise exception 'Only a super admin can change an admin''s role or status'
                    using errcode = '42501';
            end if;

            v_is_self := old.id = auth.uid()
                or lower(trim(old.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')));
            if v_is_self then
                raise exception 'You cannot change your own role or status'
                    using errcode = '42501';
            end if;
        end if;

        if old.role = 'super_admin' and old.status = 'active'
           and (new.role <> 'super_admin' or new.status <> 'active')
           and not exists (
               select 1 from public.admins a
               where a.id <> old.id and a.role = 'super_admin' and a.status = 'active'
           ) then
            raise exception 'Cannot demote, restrict or block the last active super admin'
                using errcode = '42501';
        end if;
    end if;

    return new;
end
$fn$;

-- ── 3) designate the owner ───────────────────────────────────────────────────
-- The owner is a super admin. Ensure the account is a super admin and active,
-- then mark it as owner. To move ownership later, run this update for the new
-- email (and set is_owner = false on the old one) directly in the database.
update public.admins
    set role = 'super_admin',
        status = 'active',
        is_owner = true
    where lower(trim(email)) = 'animartadmin@gmail.com';
