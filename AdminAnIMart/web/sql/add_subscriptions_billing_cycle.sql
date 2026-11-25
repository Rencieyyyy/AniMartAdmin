-- Adds subscriptions.billing_cycle ('monthly' | 'yearly') — the admin pages
-- (premium.html, sellers.html, tier-stats.js, dashboard.html) select this
-- column, so it must exist before they can load.
--
-- Mirrors the mobile-app repo migration 20260703000000_subscriptions_billing_cycle.sql.
-- If the app repo has already applied it, running this again is a no-op.
--
-- How the app writes requests:
--   • monthly → billing_cycle = 'monthly', price = plan's monthly price
--     (Premium ₱699, Super Premium ₱1,299)
--   • yearly  → billing_cycle = 'yearly', price = 10× monthly (2 months free:
--     Premium ₱6,990, Super Premium ₱12,990)
-- Rows older than the column default to 'monthly'.

alter table public.subscriptions
    add column if not exists billing_cycle text not null default 'monthly';

alter table public.subscriptions
    drop constraint if exists subscriptions_billing_cycle_check;

alter table public.subscriptions
    add constraint subscriptions_billing_cycle_check
    check (billing_cycle in ('monthly', 'yearly'));

-- Backfill: the only way earlier app versions could signal a yearly request
-- was the 10× price, so flag those rows as yearly.
update public.subscriptions
   set billing_cycle = 'yearly'
 where billing_cycle = 'monthly'
   and price in (6990, 12990);
