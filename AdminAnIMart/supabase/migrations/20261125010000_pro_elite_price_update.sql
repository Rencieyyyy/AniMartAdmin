-- ============================================================================
-- AniMart — new prices for the paid top tiers.
--
--   Animart Pro    ₱99  → ₱299
--   Animart Elite  ₱299 → ₱2999
--
-- Matches the defaults in the mobile app's subscription_service.dart.
-- Only the base price changes; discounts, promos, periods and the POPULAR
-- flag stay as the admin left them.
-- ============================================================================

begin;

update public.prices set price = 299,  updated_at = now() where plan = 'Animart Pro';
update public.prices set price = 2999, updated_at = now() where plan = 'Animart Elite';

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select plan, price, billing_period from public.prices order by sort_order;
