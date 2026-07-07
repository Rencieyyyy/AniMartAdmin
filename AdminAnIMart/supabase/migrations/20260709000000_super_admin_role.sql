-- ============================================================================
-- AniMart Admin — super admin role
--
-- Adds a role column to public.admins ('admin' | 'super_admin') and a
-- SECURITY DEFINER helper public.is_super_admin() used by RLS policies for
-- the GCash payment settings and the audit log.
--
-- IMPORTANT (shared project with the mobile app): this migration must NOT
-- rename/drop public.admins or public.current_admin_id() — mobile-repo
-- triggers depend on both. It only ADDS a column, a helper and one policy.
--
-- Matching rule: an admin session is a Supabase auth user whose id exists in
-- public.admins. One legacy admin row (animart@ani.com) has an id that does
-- not match its auth.users id, so — like the existing public.is_admin() —
-- we also accept a case/whitespace-insensitive match on the JWT email claim.
-- ============================================================================

-- ── 1) role column ──────────────────────────────────────────────────────────
alter table public.admins
    add column if not exists role text not null default 'admin';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'admins_role_check'
          and conrelid = 'public.admins'::regclass
    ) then
        alter table public.admins
            add constraint admins_role_check check (role in ('admin', 'super_admin'));
    end if;
end
$$;

-- ── 2) helper: is the caller a super admin? ─────────────────────────────────
-- SECURITY DEFINER so the admins lookup is not blocked by RLS on admins.
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
          and (
                a.id = auth.uid()
             or lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
          )
          and coalesce(auth.uid()::text, auth.jwt() ->> 'email') is not null
    )
$fn$;

grant execute on function public.is_super_admin() to authenticated, anon;

-- ── 3) super admin may read the full admins roster ──────────────────────────
-- Needed by the Audit Logs page to show admin names and build the
-- filter-by-admin dropdown (regular admins keep seeing only their own row).
drop policy if exists "Super admin reads all admins" on public.admins;
create policy "Super admin reads all admins"
    on public.admins for select
    to authenticated
    using ( public.is_super_admin() );

-- ── 4) promote exactly one account ──────────────────────────────────────────
-- Documented one-liner. To promote a different account later, run:
--   update public.admins set role = 'super_admin' where lower(email) = '<email>';
-- (and demote with role = 'admin')
update public.admins set role = 'super_admin' where lower(email) = 'admin@ani.com';
