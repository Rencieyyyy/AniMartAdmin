-- ─────────────────────────────────────────────────────────────────────────────
-- Last sign-in per admin, for the Manage Admins "View profile" modal.
--
-- auth.users is never readable from the browser, so this SECURITY DEFINER
-- function surfaces just last_sign_in_at, and only to super admins (everyone
-- else gets zero rows). Joins by id OR email because one legacy admins row
-- has an id that differs from its auth user id.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admins_last_sign_in()
returns table (admin_id uuid, last_sign_in_at timestamptz)
language sql
security definer
set search_path = public
stable
as $fn$
    select a.id, max(u.last_sign_in_at)
    from public.admins a
    left join auth.users u
      on u.id = a.id
      or lower(u.email) = lower(a.email)
    where public.is_super_admin()
    group by a.id;
$fn$;

revoke all on function public.admins_last_sign_in() from public;
revoke all on function public.admins_last_sign_in() from anon;
grant execute on function public.admins_last_sign_in() to authenticated;
