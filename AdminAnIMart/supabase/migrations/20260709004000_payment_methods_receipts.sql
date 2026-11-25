-- ============================================================================
-- AniMart — multiple GCash payment accounts + payment receipt uploads
--
-- 1. public.payment_methods — one row per GCash account the super admin
--    publishes ("Add another GCash" on the Payment Settings page). The mobile
--    app lists every ACTIVE row on the "Pay with GCash" sheet so users can
--    pay to any of them before submitting a premium request.
--
-- 2. Legacy bridge: current mobile builds still read the single-account
--    app_settings keys (gcash_number / gcash_account_name / gcash_qr_url).
--    A sync trigger mirrors the PRIMARY (first active) payment_methods row
--    into those keys, so old builds keep working until the app ships the
--    multi-account UI. premium_payment_instructions stays in app_settings
--    (it is global, not per-account).
--
-- 3. Receipts: the new mobile flow is pay → upload receipt → submit request.
--    subscriptions.receipt_url stores the uploaded object's PATH in the new
--    PRIVATE `payment-receipts` bucket (receipts hold personal data, so no
--    public read — the admin panel opens them via signed URLs).
--
-- Contracts for the mobile repo:
--   • payment_methods: select where is_active, order by sort_order —
--     columns: id, provider, account_name, account_number, qr_url, sort_order.
--   • upload receipt to bucket `payment-receipts` at '<auth.uid()>/<file>'
--     and set subscriptions.receipt_url to that PATH (not a URL).
-- ============================================================================

-- ── 1) payment_methods table ─────────────────────────────────────────────────
create table if not exists public.payment_methods (
    id             uuid primary key default gen_random_uuid(),
    provider       text not null default 'gcash',
    account_name   text not null default '',
    account_number text not null default '',
    qr_url         text not null default '',       -- public URL in payment-qr bucket
    sort_order     integer not null default 0,
    is_active      boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

alter table public.payment_methods enable row level security;

-- Mobile users must list active accounts; admins see all (for the editor).
drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select
    on public.payment_methods for select
    to authenticated
    using ( is_active or public.is_admin() );

-- Writes are super-admin-only (is_super_admin() already requires active
-- status, so restricted/blocked supers are excluded too).
drop policy if exists payment_methods_insert_super on public.payment_methods;
create policy payment_methods_insert_super
    on public.payment_methods for insert
    to authenticated
    with check ( public.is_super_admin() );

drop policy if exists payment_methods_update_super on public.payment_methods;
create policy payment_methods_update_super
    on public.payment_methods for update
    to authenticated
    using ( public.is_super_admin() )
    with check ( public.is_super_admin() );

drop policy if exists payment_methods_delete_super on public.payment_methods;
create policy payment_methods_delete_super
    on public.payment_methods for delete
    to authenticated
    using ( public.is_super_admin() );

-- ── 2) audit payment-method changes ──────────────────────────────────────────
create or replace function public.audit_payment_methods_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if tg_op = 'DELETE' then
        perform public.log_admin_action(
            'payment_method.delete', 'payment_method', old.id::text,
            jsonb_build_object('provider', old.provider, 'account_name', old.account_name,
                               'account_number', old.account_number)
        );
        return null;
    end if;

    if tg_op = 'INSERT' then
        perform public.log_admin_action(
            'payment_method.create', 'payment_method', new.id::text,
            jsonb_build_object('provider', new.provider, 'account_name', new.account_name,
                               'account_number', new.account_number, 'is_active', new.is_active)
        );
        return null;
    end if;

    perform public.log_admin_action(
        'payment_method.update', 'payment_method', new.id::text,
        jsonb_build_object(
            'old', jsonb_build_object('account_name', old.account_name, 'account_number', old.account_number,
                                      'qr_url', old.qr_url, 'is_active', old.is_active, 'sort_order', old.sort_order),
            'new', jsonb_build_object('account_name', new.account_name, 'account_number', new.account_number,
                                      'qr_url', new.qr_url, 'is_active', new.is_active, 'sort_order', new.sort_order)
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_payment_methods on public.payment_methods;
create trigger trg_audit_payment_methods
    after insert or update or delete on public.payment_methods
    for each row execute function public.audit_payment_methods_change();

-- ── 3) legacy single-account bridge ──────────────────────────────────────────
-- Mirrors the primary (lowest sort_order, oldest) ACTIVE account into the old
-- app_settings keys after every payment_methods change. SECURITY DEFINER so
-- it can write app_settings regardless of caller; sets a transaction-local
-- flag so the app_settings audit trigger doesn't double-log what the
-- payment_methods audit trigger already recorded.
create or replace function public.sync_legacy_gcash_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_primary public.payment_methods%rowtype;
begin
    select * into v_primary
    from public.payment_methods
    where is_active
    order by sort_order, created_at
    limit 1;

    perform set_config('animart.skip_settings_audit', '1', true);

    update public.app_settings set value = coalesce(v_primary.account_number, ''), updated_at = now()
     where key = 'gcash_number'       and value is distinct from coalesce(v_primary.account_number, '');
    update public.app_settings set value = coalesce(v_primary.account_name, ''), updated_at = now()
     where key = 'gcash_account_name' and value is distinct from coalesce(v_primary.account_name, '');
    update public.app_settings set value = coalesce(v_primary.qr_url, ''), updated_at = now()
     where key = 'gcash_qr_url'       and value is distinct from coalesce(v_primary.qr_url, '');

    perform set_config('animart.skip_settings_audit', '0', true);
    return null;
end
$fn$;

drop trigger if exists trg_sync_legacy_gcash on public.payment_methods;
create trigger trg_sync_legacy_gcash
    after insert or update or delete on public.payment_methods
    for each statement execute function public.sync_legacy_gcash_keys();

-- Teach the app_settings audit trigger to honour the skip flag (redefine
-- from 20260709002000 with the one extra guard).
create or replace function public.audit_app_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if current_setting('animart.skip_settings_audit', true) = '1' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
    end if;

    if tg_op = 'DELETE' then
        perform public.log_admin_action(
            'settings.update', 'app_setting', old.key,
            jsonb_build_object('key', old.key, 'op', 'delete', 'old_value', old.value, 'new_value', null)
        );
        return null;
    end if;

    perform public.log_admin_action(
        'settings.update', 'app_setting', new.key,
        jsonb_build_object(
            'key',       new.key,
            'op',        lower(tg_op),
            'old_value', case when tg_op = 'UPDATE' then old.value else null end,
            'new_value', new.value
        )
    );
    return null;
end
$fn$;

-- The legacy-key sync must also get past protect_payment_settings when a
-- super admin edits payment_methods — it already does (the caller's JWT is a
-- super admin), and server-side contexts pass its no-JWT branch. No change.

-- ── 4) seed payment_methods from the legacy keys (one-time, idempotent) ──────
insert into public.payment_methods (provider, account_name, account_number, qr_url, sort_order)
select 'gcash',
       coalesce((select value from public.app_settings where key = 'gcash_account_name'), ''),
       coalesce((select value from public.app_settings where key = 'gcash_number'), ''),
       coalesce((select value from public.app_settings where key = 'gcash_qr_url'), ''),
       0
where not exists (select 1 from public.payment_methods)
  and coalesce(
        (select value from public.app_settings where key = 'gcash_number'), ''
      ) <> '';

-- ── 5) subscriptions.receipt_url ─────────────────────────────────────────────
-- PATH of the uploaded receipt inside the payment-receipts bucket (set by the
-- mobile app when submitting the premium request). Nullable: legacy requests
-- have none.
alter table public.subscriptions
    add column if not exists receipt_url text;

-- Include it in the subscription audit details (redefine from 20260709002000).
create or replace function public.audit_subscriptions_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    perform public.log_admin_action(
        case
            when new.status = 'approved' and old.status is distinct from new.status then 'subscription.approve'
            when new.status = 'rejected' and old.status is distinct from new.status then 'subscription.reject'
            else 'subscription.update'
        end,
        'subscription',
        new.id::text,
        jsonb_build_object(
            'user_id',       new.user_id,
            'plan',          new.plan,
            'price',         new.price,
            'billing_cycle', new.billing_cycle,
            'receipt_url',   new.receipt_url,
            'old_status',    old.status,
            'new_status',    new.status
        )
    );
    return null;
end
$fn$;

-- ── 6) payment-receipts bucket (PRIVATE) ─────────────────────────────────────
-- Receipts contain personal payment data: no public read. Users upload into
-- their own folder ('<uid>/...'); users read their own; admins (not blocked)
-- read all via signed URLs from the panel; only super admins may delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'payment-receipts', 'payment-receipts', false, 5242880,
    array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own payment receipts" on storage.objects;
create policy "Users upload own payment receipts"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'payment-receipts'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "Read own or admin payment receipts" on storage.objects;
create policy "Read own or admin payment receipts"
    on storage.objects for select
    to authenticated
    using (
        bucket_id = 'payment-receipts'
        and ( (storage.foldername(name))[1] = auth.uid()::text or public.is_admin() )
    );

drop policy if exists "Super admin deletes payment receipts" on storage.objects;
create policy "Super admin deletes payment receipts"
    on storage.objects for delete
    to authenticated
    using ( bucket_id = 'payment-receipts' and public.is_super_admin() );
