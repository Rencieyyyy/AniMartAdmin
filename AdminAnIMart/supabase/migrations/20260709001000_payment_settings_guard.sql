-- ============================================================================
-- AniMart Admin — protect GCash payment settings + payment-qr storage bucket
--
-- The mobile app renders its "Pay with GCash" sheet from these
-- public.app_settings keys (created by the mobile repo, migration
-- 20260708050000 — rows must NEVER be deleted, only blanked):
--
--   gcash_number, gcash_account_name, gcash_qr_url,
--   premium_payment_instructions
--
-- Existing policies on app_settings (kept as-is):
--   app_settings_select_all   — any authenticated user may read
--   app_settings_write_admin  — permissive ALL for anyone in public.admins
--
-- This migration adds DATABASE-level enforcement that only a super admin
-- (public.is_super_admin(), see 20260709000000) may write those four keys:
--   a) RESTRICTIVE policies that AND onto the permissive admin policy;
--   b) a BEFORE trigger that raises a clear error (defense in depth — it
--      also blocks renaming a protected row's key away, which WITH CHECK
--      alone would not catch, and gives the admin UI a readable message).
--
-- Trusted server-side contexts (migrations run as postgres, service_role,
-- pg_cron jobs) carry no JWT — the trigger lets those through so mobile-repo
-- migrations that seed/update these keys keep working. RLS already blocks
-- anon writes.
-- ============================================================================

-- ── 1) restrictive app_settings policies ────────────────────────────────────
-- NOTE: deliberately NOT "for all" — a restrictive ALL policy would also
-- apply to SELECT and hide the GCash keys from the mobile app.

drop policy if exists app_settings_protect_payment_insert on public.app_settings;
create policy app_settings_protect_payment_insert
    on public.app_settings
    as restrictive
    for insert
    to authenticated
    with check (
        key not in ('gcash_number','gcash_account_name','gcash_qr_url','premium_payment_instructions')
        or public.is_super_admin()
    );

-- USING is intentionally true: the row must stay targetable so the BEFORE
-- trigger below fires and raises a descriptive error (a restrictive USING
-- would silently filter the row to a 0-row update instead).
drop policy if exists app_settings_protect_payment_update on public.app_settings;
create policy app_settings_protect_payment_update
    on public.app_settings
    as restrictive
    for update
    to authenticated
    using ( true )
    with check (
        key not in ('gcash_number','gcash_account_name','gcash_qr_url','premium_payment_instructions')
        or public.is_super_admin()
    );

drop policy if exists app_settings_protect_payment_delete on public.app_settings;
create policy app_settings_protect_payment_delete
    on public.app_settings
    as restrictive
    for delete
    to authenticated
    using (
        key not in ('gcash_number','gcash_account_name','gcash_qr_url','premium_payment_instructions')
        or public.is_super_admin()
    );

-- ── 2) hard-stop trigger with a readable error ──────────────────────────────
create or replace function public.protect_payment_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_protected constant text[] := array[
        'gcash_number', 'gcash_account_name', 'gcash_qr_url',
        'premium_payment_instructions'
    ];
begin
    -- No JWT user → trusted server-side context (postgres / service_role /
    -- cron). Client roles without a JWT (anon) have no write policy anyway.
    if auth.uid() is null and coalesce(auth.jwt() ->> 'email', '') = '' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
    end if;

    if tg_op = 'DELETE' then
        if old.key = any(v_protected) and not public.is_super_admin() then
            raise exception 'Only a super admin can modify payment settings (key: %)', old.key
                using errcode = '42501';
        end if;
        return old;
    end if;

    if ( new.key = any(v_protected)
         or (tg_op = 'UPDATE' and old.key = any(v_protected)) )
       and not public.is_super_admin() then
        raise exception 'Only a super admin can modify payment settings (key: %)', new.key
            using errcode = '42501';
    end if;

    return new;
end
$fn$;

drop trigger if exists trg_protect_payment_settings on public.app_settings;
create trigger trg_protect_payment_settings
    before insert or update or delete on public.app_settings
    for each row execute function public.protect_payment_settings();

-- ── 3) payment-qr storage bucket ────────────────────────────────────────────
-- Public READ (the mobile app loads gcash_qr_url with no auth); writes are
-- super-admin-only. Fixed object name (gcash-qr.png etc.) — the admin UI
-- replaces on upload and cache-busts with a ?v= query param in the saved URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'payment-qr', 'payment-qr', true, 2097152,
    array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read payment QR" on storage.objects;
create policy "Public read payment QR"
    on storage.objects for select
    to public
    using ( bucket_id = 'payment-qr' );

drop policy if exists "Super admin manages payment QR" on storage.objects;
create policy "Super admin manages payment QR"
    on storage.objects for all
    to authenticated
    using      ( bucket_id = 'payment-qr' and public.is_super_admin() )
    with check ( bucket_id = 'payment-qr' and public.is_super_admin() );
