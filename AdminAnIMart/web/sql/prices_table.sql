-- ============================================================================
-- AniMart — premium plan pricing
-- Backs the "Available Premium Plans & Features" cards in web/pages/premium.html.
-- Lets admins edit the base price and apply a discount and/or a promo badge.
-- Run in the Supabase SQL Editor.
-- ============================================================================

create table if not exists public.prices (
    id               uuid primary key default gen_random_uuid(),
    plan             text    not null unique,        -- 'basic' | 'pro' | 'elite'
    name             text    not null,               -- display name
    tagline          text,                            -- short subtitle
    price            numeric not null default 0,      -- base monthly price (PHP)
    discount_percent numeric not null default 0,      -- 0-100 (0 = no discount)
    promo_label      text,                            -- e.g. 'HOLIDAY SALE'
    promo_active     boolean not null default false,  -- show the promo badge?
    is_popular       boolean not null default false,  -- show the POPULAR ribbon?
    billing_period   text    not null default 'month',
    sort_order       int     not null default 0,
    updated_at       timestamptz not null default now()
);

-- Seed the three current plans (no-op if they already exist).
insert into public.prices (plan, name, tagline, price, is_popular, sort_order)
values
    ('basic', 'Basic', 'For new sellers starting out',  299,  false, 1),
    ('pro',   'Pro',   'For serious livestock traders', 699,  true,  2),
    ('elite', 'Elite', 'Maximum visibility & control',  1299, false, 3)
on conflict (plan) do nothing;

-- ── RLS ──
-- Pricing is public info (the mobile app shows it), so anyone may read it.
-- Only admins (see is_admin() in announcements_rls.sql) may edit it.
alter table public.prices enable row level security;

drop policy if exists "Anyone can read prices" on public.prices;
create policy "Anyone can read prices" on public.prices
    for select to anon, authenticated
    using ( true );

drop policy if exists "Admins update prices" on public.prices;
create policy "Admins update prices" on public.prices
    for update to authenticated
    using      ( public.is_admin() )
    with check ( public.is_admin() );
