-- ============================================================================
-- AniMart — align the `prices` table with the 3-tier model: Free, Premium,
-- Super Premium. The canonical plan value IS the label string (no key layer).
--
--   • Free          = default tier for sellers with no active subscription
--                     (derived, no pricing row).
--   • Premium       = ₱699/month  (POPULAR)   — was prices.plan 'pro' (and 'basic').
--   • Super Premium = ₱1299/month             — was prices.plan 'elite'.
--
-- This mirrors the subscriptions.plan migration already applied
-- ('free'->'Free', 'basic'/'pro'->'Premium', 'elite'->'Super Premium').
-- The old paid "Basic" plan is retired (folded into Premium).
--
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
-- ============================================================================

-- Retire the old Basic pricing row (Basic is folded into Premium; Free has no row).
delete from public.prices where plan in ('basic', 'free');

-- Convert the paid plan keys to their canonical label strings.
update public.prices set plan = 'Premium',       name = 'Premium',       updated_at = now() where plan = 'pro';
update public.prices set plan = 'Super Premium', name = 'Super Premium', updated_at = now() where plan = 'elite';

-- Backfill: ensure both paid rows exist with the correct names (no-op if present).
insert into public.prices (plan, name, tagline, price, is_popular, sort_order)
values
    ('Premium',       'Premium',       'For serious livestock traders', 699,  true,  2),
    ('Super Premium', 'Super Premium', 'Maximum visibility & control',  1299, false, 3)
on conflict (plan) do nothing;

-- Verify
select plan, name, price, is_popular from public.prices order by sort_order;
