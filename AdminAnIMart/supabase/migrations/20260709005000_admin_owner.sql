-- ── 1) is_owner column ───────────────────────────────────────────────────────
alter table public.admins
    add column if not exists is_owner boolean not null default false;

-- ── 2) guard trigger — add owner protection ──────────────────────────────────
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
update public.admins
    set role = 'super_admin',
        status = 'active',
        is_owner = true
    where lower(trim(email)) = 'animartadmin@gmail.com';
