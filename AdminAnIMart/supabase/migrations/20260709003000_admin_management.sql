-- ============================================================================
-- AniMart Admin — admin account management (create / delete / block / restrict)
--
-- Adds admins.status ('active' | 'restricted' | 'blocked') and enforces it in
-- the database:
--
--   active     — full admin (super admins additionally need active status for
--                their super powers).
--   restricted — may sign in and READ panel data, but every admin write is
--                blocked by RESTRICTIVE policies added here.
--   blocked    — public.is_admin() returns false: loses admin reads AND
--                writes; config.js also refuses the login.
--
-- Also fixes two pre-existing holes found while auditing:
--   1. "Admins update own row" had no column guard, so ANY admin could set
--      role='super_admin' on their own row via PostgREST. A BEFORE trigger
--      now restricts role/status changes to super admins acting on OTHER
--      admins' rows, and keeps at least one active super admin alive.
--   2. users had "Authenticated update users" USING(true) — ANY signed-in
--      user (including every mobile user) could update ANY user's row
--      (plan, is_verified, status...). Replaced with an admins-only policy;
--      mobile users keep their existing own-row update policies.
--
-- Admin CREATE/DELETE need the auth admin API (service role) and live in the
-- Edge Function `admin-users`; it enforces the same guards and writes its own
-- audit rows. There is deliberately NO client INSERT/DELETE policy on admins.
--
-- Must NOT rename/drop: public.admins, public.current_admin_id() (mobile-repo
-- triggers depend on them). is_admin()/is_super_admin() are redefined
-- in-place with the same signatures.
-- ============================================================================

-- ── 1) status column ─────────────────────────────────────────────────────────
alter table public.admins
    add column if not exists status text not null default 'active';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'admins_status_check'
          and conrelid = 'public.admins'::regclass
    ) then
        alter table public.admins
            add constraint admins_status_check
            check (status in ('active', 'restricted', 'blocked'));
    end if;
end
$$;

-- ── 2) helpers ───────────────────────────────────────────────────────────────
-- is_admin(): caller has an admins row that is NOT blocked. Matches by auth
-- uid OR (legacy) email — one old row's id doesn't match its auth user id.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
    select exists (
        select 1 from public.admins a
        where a.status <> 'blocked'
          and (
                a.id = auth.uid()
             or lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
          )
          and coalesce(auth.uid()::text, auth.jwt() ->> 'email') is not null
    )
$fn$;

-- is_super_admin(): now also requires ACTIVE status — a restricted or blocked
-- super admin loses payment-settings / audit-log / admin-management powers.
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
    select exists (
        select 1
        from public.admins a
        where a.role = 'super_admin'
          and a.status = 'active'
          and (
                a.id = auth.uid()
             or lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
          )
          and coalesce(auth.uid()::text, auth.jwt() ->> 'email') is not null
    )
$fn$;

-- is_limited_admin(): caller is an admin whose status is NOT active
-- (restricted or blocked). Used by the RESTRICTIVE write-block policies —
-- false for mobile users, so their own writes are never affected.
create or replace function public.is_limited_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
    select exists (
        select 1 from public.admins a
        where a.status <> 'active'
          and (
                a.id = auth.uid()
             or lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
          )
          and coalesce(auth.uid()::text, auth.jwt() ->> 'email') is not null
    )
$fn$;

grant execute on function public.is_admin(), public.is_super_admin(), public.is_limited_admin()
    to authenticated, anon;

-- ── 3) guard trigger on admins ───────────────────────────────────────────────
-- BEFORE UPDATE/DELETE. Enforces, regardless of which policy allowed the DML:
--   • role/status may only be changed by an active super admin (or a trusted
--     no-JWT server context, i.e. the admin-users Edge Function / migrations);
--   • nobody may change their OWN role or status (no self-promotion — this
--     closes the pre-existing escalation hole — and no self-block);
--   • the last ACTIVE super admin can never be demoted, restricted, blocked
--     or deleted (applies to server contexts too, so the Edge Function
--     cannot be talked into locking everyone out).
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
    if new.role is distinct from old.role
       or new.status is distinct from old.status then

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

drop trigger if exists trg_protect_admins_row on public.admins;
create trigger trg_protect_admins_row
    before update or delete on public.admins
    for each row execute function public.protect_admins_row();

-- ── 4) admins policies ───────────────────────────────────────────────────────
-- Super admins may update any admins row (role/status flips from the Manage
-- Admins page; the trigger above still guards the sensitive columns).
drop policy if exists "Super admin updates admins" on public.admins;
create policy "Super admin updates admins"
    on public.admins for update
    to authenticated
    using ( public.is_super_admin() )
    with check ( public.is_super_admin() );

-- Restricted/blocked admins may not even edit their own profile row.
drop policy if exists admins_block_limited_update on public.admins;
create policy admins_block_limited_update
    on public.admins
    as restrictive
    for update
    to authenticated
    using ( not public.is_limited_admin() )
    with check ( not public.is_limited_admin() );

-- ── 5) fix the users free-for-all update policy ──────────────────────────────
-- "Authenticated update users" was USING(true)/CHECK(true): any signed-in
-- user could update anyone. The admin panel is the only legitimate
-- cross-user writer; mobile users keep "Users can update own row" /
-- "users_update_own" (auth.uid() = id), which remain untouched.
drop policy if exists "Authenticated update users" on public.users;
drop policy if exists "Admins update users" on public.users;
create policy "Admins update users"
    on public.users for update
    to authenticated
    using ( public.is_admin() )
    with check ( public.is_admin() );

-- ── 6) RESTRICTIVE write-blocks for restricted/blocked admins ────────────────
-- AND-ed onto every permissive policy: a limited admin loses all panel writes
-- while mobile users (is_limited_admin() = false) are unaffected. SELECT is
-- deliberately not restricted — restricted admins keep read access, and
-- blocked admins already lost admin-gated reads via is_admin().
do $$
declare
    t record;
begin
    for t in
        select * from (values
            ('users',              array['update']),
            ('subscriptions',      array['update','delete']),
            ('reports',            array['update']),
            ('announcements',      array['insert','update','delete']),
            ('announcement_tags',  array['insert','delete']),
            ('prices',             array['update']),
            ('support_messages',   array['insert','update']),
            ('app_settings',       array['insert','update','delete']),
            ('admins',             array['delete'])
        ) as v(tbl, ops)
    loop
        declare op text;
        begin
            foreach op in array t.ops loop
                execute format(
                    'drop policy if exists %I on public.%I',
                    t.tbl || '_block_limited_' || op, t.tbl);
                execute format(
                    'create policy %I on public.%I as restrictive for %s to authenticated %s',
                    t.tbl || '_block_limited_' || op,
                    t.tbl,
                    op,
                    case op
                        when 'insert' then 'with check ( not public.is_limited_admin() )'
                        when 'update' then 'using ( not public.is_limited_admin() ) with check ( not public.is_limited_admin() )'
                        else               'using ( not public.is_limited_admin() )'
                    end);
            end loop;
        end;
    end loop;
end
$$;

-- ── 7) audit the admin lifecycle ─────────────────────────────────────────────
-- Client-side role/status flips carry the super admin's JWT, so
-- log_admin_action() attributes them. Edge Function create/delete run as
-- service role (no JWT) and write their own audit rows directly.
create or replace function public.audit_admins_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_action text;
begin
    if tg_op = 'INSERT' then
        perform public.log_admin_action(
            'admin.create', 'admin', new.id::text,
            jsonb_build_object('email', new.email, 'role', new.role, 'status', new.status)
        );
        return null;
    end if;

    if tg_op = 'DELETE' then
        perform public.log_admin_action(
            'admin.delete', 'admin', old.id::text,
            jsonb_build_object('email', old.email, 'role', old.role, 'status', old.status)
        );
        return null;
    end if;

    -- UPDATE: only log meaningful account changes, not profile edits
    -- (name/phone/pfp updates from the My Profile page would be noise).
    if new.role is distinct from old.role then
        v_action := 'admin.role_change';
    elsif new.status is distinct from old.status then
        v_action := 'admin.status_change';
    elsif new.email is distinct from old.email then
        v_action := 'admin.update';
    else
        return null;
    end if;

    perform public.log_admin_action(
        v_action, 'admin', new.id::text,
        jsonb_build_object(
            'email',      new.email,
            'old_role',   old.role,   'new_role',   new.role,
            'old_status', old.status, 'new_status', new.status
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_admins on public.admins;
create trigger trg_audit_admins
    after insert or update or delete on public.admins
    for each row execute function public.audit_admins_change();
