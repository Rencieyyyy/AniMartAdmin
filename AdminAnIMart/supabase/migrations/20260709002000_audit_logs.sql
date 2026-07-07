-- ============================================================================
-- AniMart Admin — append-only audit log of admin actions
--
-- public.audit_logs is written ONLY by SECURITY DEFINER triggers (no client
-- INSERT/UPDATE/DELETE policies), so admins can neither skip nor forge
-- entries. Rows are logged only when the request carries a JWT that maps to
-- a row in public.admins — mobile-app user actions are never logged, and
-- server-side jobs (cron subscription expiry, promo auto-clear, mobile-repo
-- notification triggers) carry no JWT so they are skipped too.
--
-- Readable only by super admins (public.is_super_admin(),
-- see 20260709000000). Backs web/pages/audit-logs.html.
-- ============================================================================

-- ── 1) table ────────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
    id          uuid primary key default gen_random_uuid(),
    admin_id    uuid references public.admins(id) on delete set null,
    admin_email text,                       -- denormalised so logs survive admin deletion
    action      text not null,              -- short slug, e.g. 'subscription.approve'
    target_type text,
    target_id   text,
    details     jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
    on public.audit_logs (created_at desc);
create index if not exists audit_logs_admin_created_idx
    on public.audit_logs (admin_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "Super admin reads audit logs" on public.audit_logs;
create policy "Super admin reads audit logs"
    on public.audit_logs for select
    to authenticated
    using ( public.is_super_admin() );
-- deliberately NO insert/update/delete policies: append-only via triggers.

-- ── 2) logging helper ───────────────────────────────────────────────────────
-- Inserts a log row ONLY when the current JWT belongs to an admin; silently
-- no-ops otherwise. SECURITY DEFINER so the insert bypasses the (absent)
-- client policies. Execute is revoked from API roles so PostgREST does not
-- expose it as an RPC an admin could use to forge entries — it is reachable
-- only from the SECURITY DEFINER trigger functions below.
create or replace function public.log_admin_action(
    p_action      text,
    p_target_type text,
    p_target_id   text,
    p_details     jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_admin_id    uuid;
    v_admin_email text;
begin
    select a.id, a.email
      into v_admin_id, v_admin_email
      from public.admins a
     where a.id = auth.uid()
        or lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
     limit 1;

    if v_admin_id is null then
        return;   -- not an admin request (mobile user, cron, service job)
    end if;

    insert into public.audit_logs (admin_id, admin_email, action, target_type, target_id, details)
    values (v_admin_id, v_admin_email, p_action, p_target_type, p_target_id, p_details);
end
$fn$;

revoke all on function public.log_admin_action(text, text, text, jsonb) from public, anon, authenticated;

-- ── 3) trigger functions ────────────────────────────────────────────────────
-- All SECURITY DEFINER (owned by postgres) so they may call the revoked
-- helper regardless of who performed the DML.

-- subscriptions: approve / reject / other admin edits ------------------------
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
            'old_status',    old.status,
            'new_status',    new.status
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_subscriptions on public.subscriptions;
create trigger trg_audit_subscriptions
    after update on public.subscriptions
    for each row execute function public.audit_subscriptions_update();

-- listings: admin status flips + deletes --------------------------------------
create or replace function public.audit_listings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if tg_op = 'DELETE' then
        perform public.log_admin_action(
            'listing.delete', 'listing', old.id::text,
            jsonb_build_object('title', old.title, 'seller_id', old.seller_id, 'status', old.status)
        );
        return null;
    end if;

    perform public.log_admin_action(
        case when new.status = 'active' then 'listing.enable' else 'listing.disable' end,
        'listing', new.id::text,
        jsonb_build_object(
            'title', new.title, 'seller_id', new.seller_id,
            'old_status', old.status, 'new_status', new.status
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_listings_status on public.listings;
create trigger trg_audit_listings_status
    after update on public.listings
    for each row
    when (old.status is distinct from new.status)
    execute function public.audit_listings_change();

drop trigger if exists trg_audit_listings_delete on public.listings;
create trigger trg_audit_listings_delete
    after delete on public.listings
    for each row execute function public.audit_listings_change();

-- announcements: admin-authored broadcast posts only ---------------------------
-- The mobile repo's notification pipeline inserts per-user announcements
-- (recipient_id set) via SECURITY DEFINER triggers attributed to an admin id
-- but fired by USER actions — those must never be logged. Filter: only rows
-- with no recipient_id, and only when the JWT itself is an admin (the helper
-- enforces the latter).
create or replace function public.audit_announcements_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_action text;
begin
    if tg_op = 'DELETE' then
        if old.recipient_id is not null then return null; end if;
        perform public.log_admin_action(
            'announcement.delete', 'announcement', old.id::text,
            jsonb_build_object('title', old.title, 'status', old.status, 'audience', old.audience)
        );
        return null;
    end if;

    if new.recipient_id is not null then return null; end if;

    if tg_op = 'INSERT' then
        v_action := 'announcement.create';
    elsif new.deleted_at is not null and old.deleted_at is null then
        v_action := 'announcement.delete';   -- soft delete from the admin UI
    else
        v_action := 'announcement.update';
    end if;

    perform public.log_admin_action(
        v_action, 'announcement', new.id::text,
        jsonb_build_object('title', new.title, 'status', new.status, 'audience', new.audience)
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_announcements on public.announcements;
create trigger trg_audit_announcements
    after insert or update or delete on public.announcements
    for each row execute function public.audit_announcements_change();

-- prices: plan pricing edits ---------------------------------------------------
create or replace function public.audit_prices_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    perform public.log_admin_action(
        'pricing.update', 'price', new.id::text,
        jsonb_build_object(
            'plan',          new.plan,
            'old_price',     old.price,
            'new_price',     new.price,
            'old_discount',  old.discount_percent,
            'new_discount',  new.discount_percent,
            'promo_label',   new.promo_label,
            'promo_active',  new.promo_active
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_prices on public.prices;
create trigger trg_audit_prices
    after update on public.prices
    for each row execute function public.audit_prices_update();

-- reports: triage decisions ----------------------------------------------------
create or replace function public.audit_reports_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    perform public.log_admin_action(
        case new.status
            when 'reviewed'  then 'report.review'
            when 'dismissed' then 'report.dismiss'
            else 'report.update'
        end,
        'report', new.id::text,
        jsonb_build_object(
            'report_target', new.target_type,
            'reason',        new.reason,
            'listing_id',    new.listing_id,
            'seller_id',     new.seller_id,
            'old_status',    old.status,
            'new_status',    new.status
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_reports on public.reports;
create trigger trg_audit_reports
    after update on public.reports
    for each row
    when (old.status is distinct from new.status)
    execute function public.audit_reports_update();

-- app_settings: how GCash payment-detail changes are audited --------------------
create or replace function public.audit_app_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
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

drop trigger if exists trg_audit_app_settings on public.app_settings;
create trigger trg_audit_app_settings
    after insert or update or delete on public.app_settings
    for each row execute function public.audit_app_settings_change();

-- users: verification decisions --------------------------------------------------
create or replace function public.audit_users_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    perform public.log_admin_action(
        case when new.is_verified then 'user.approve' else 'user.unverify' end,
        'user', new.id::text,
        jsonb_build_object(
            'name',       new.name,
            'email',      new.email,
            'old_status', old.status,
            'new_status', new.status
        )
    );
    return null;
end
$fn$;

drop trigger if exists trg_audit_users_verification on public.users;
create trigger trg_audit_users_verification
    after update on public.users
    for each row
    when (old.is_verified is distinct from new.is_verified)
    execute function public.audit_users_verification();

-- ── 4) retention: purge logs older than 1 year (pg_cron) ────────────────────
-- cron.schedule(name, ...) upserts, so re-running this migration is safe.
do $do$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'purge-old-audit-logs',
            '15 3 * * *',   -- daily 03:15 UTC (11:15 Asia/Manila)
            $job$ delete from public.audit_logs where created_at < now() - interval '1 year' $job$
        );
    end if;
end
$do$;
