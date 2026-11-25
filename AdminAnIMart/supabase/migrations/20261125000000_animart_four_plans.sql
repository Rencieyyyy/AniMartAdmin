-- ============================================================================
-- AniMart — four subscription plans for the admin Premium page.
--
--   Animart Basic      ₱0   / month   1-month free trial for new sellers   (up to 3 listings)
--   Animart Essential  ₱99  / week    Starter plan for growing sellers     (up to 10 listings)
--   Animart Pro        ₱99  / month   For serious livestock traders        (unlimited)
--   Animart Elite      ₱299 / month   Maximum visibility & premium benefits (unlimited)
--
-- Replaces the retired 3-tier model (Free / Premium / Super Premium):
--   Free → Animart Basic, Premium → Animart Pro, Super Premium → Animart Elite,
-- and adds the new Animart Essential row.
--
-- The mobile app repo's migration 20260728000000_subscription_plan_restructure
-- already rewrote subscriptions.plan to these labels and allows 'weekly'
-- billing; step 1 below repeats the billing_cycle part so this file also works
-- on its own. Everything here is idempotent — safe to re-run.
-- ============================================================================

begin;

-- 1) subscriptions.billing_cycle accepts 'weekly' (Animart Essential).
alter table public.subscriptions
    add column if not exists billing_cycle text not null default 'monthly';

alter table public.subscriptions
    drop constraint if exists subscriptions_billing_cycle_check;

update public.subscriptions
   set billing_cycle = 'monthly'
 where billing_cycle is null
    or billing_cycle not in ('weekly', 'monthly', 'yearly');

alter table public.subscriptions
    add constraint subscriptions_billing_cycle_check
    check (billing_cycle in ('weekly', 'monthly', 'yearly'));

-- 2) prices.listing_capacity: NULL now means "unlimited" (Pro / Elite). The
--    app reads it as `listing_capacity ?? plan default`, so NULL falls back to
--    the plan's own limit (unlimited for Pro / Elite).
alter table public.prices
    add column if not exists listing_capacity int;
alter table public.prices
    alter column listing_capacity drop not null;

-- 3) Carry the legacy rows over to the new names (keeps any discount / promo /
--    POPULAR flag the admin had set). One row per plan (the canonical old name
--    wins); skipped when the new row already exists.
update public.prices set plan = 'Animart Basic'
 where plan = (select plan from public.prices
                where plan in ('Free', 'free', 'basic')
                order by plan <> 'Free', plan limit 1)
   and not exists (select 1 from public.prices where plan = 'Animart Basic');

update public.prices set plan = 'Animart Pro'
 where plan = (select plan from public.prices
                where plan in ('Premium', 'premium', 'pro')
                order by plan <> 'Premium', plan limit 1)
   and not exists (select 1 from public.prices where plan = 'Animart Pro');

update public.prices set plan = 'Animart Elite'
 where plan = (select plan from public.prices
                where plan in ('Super Premium', 'superpremium', 'elite')
                order by plan <> 'Super Premium', plan limit 1)
   and not exists (select 1 from public.prices where plan = 'Animart Elite');

-- Any legacy rows still left are duplicates of an existing new row.
delete from public.prices
 where plan in ('Free', 'free', 'basic', 'Premium', 'premium', 'pro',
                'Super Premium', 'superpremium', 'elite');

-- 4) Seed / correct the four plans. Prices, periods, taglines and listing
--    caps are set to the new plan definitions; discounts, promos and the
--    POPULAR flag stay as the admin left them.
insert into public.prices (plan, name, tagline, price, billing_period, listing_capacity, is_popular, sort_order)
values
    ('Animart Basic',     'Animart Basic',     '1-month free trial for new sellers',      0,   'month', 3,    false, 1),
    ('Animart Essential', 'Animart Essential', 'Starter plan for growing sellers',        99,  'week',  10,   false, 2),
    ('Animart Pro',       'Animart Pro',       'For serious livestock traders',           99,  'month', null, true,  3),
    ('Animart Elite',     'Animart Elite',     'Maximum visibility and premium benefits', 299, 'month', null, false, 4)
on conflict (plan) do update
    set name             = excluded.name,
        tagline          = excluded.tagline,
        price            = excluded.price,
        billing_period   = excluded.billing_period,
        listing_capacity = excluded.listing_capacity,
        sort_order       = excluded.sort_order,
        updated_at       = now();

-- The free trial never carries a discount or promo.
update public.prices
   set discount_percent = 0, promo_label = null, promo_active = false, promo_deadline = null
 where plan = 'Animart Basic';

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select plan, price, billing_period, listing_capacity, discount_percent, is_popular
--     from public.prices order by sort_order;
