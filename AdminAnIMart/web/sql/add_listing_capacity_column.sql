-- ============================================================================
-- AniMart — Free tier listing capacity
-- Adds prices.listing_capacity and seeds a 'Free' row so admins can edit how
-- many active listings Free-tier sellers get (premium.html "Edit capacity").
-- Run in the Supabase SQL Editor (after prices_table.sql).
-- ============================================================================

alter table public.prices
    add column if not exists listing_capacity int not null default 10;

-- The Free tier previously had no pricing row; it needs one now to hold its
-- listing capacity. price stays 0 and the existing RLS policies apply as-is
-- (public read, admin update).
insert into public.prices (plan, name, tagline, price, billing_period, sort_order)
values ('Free', 'Free', 'For new sellers starting out', 0, 'forever', 1)
on conflict (plan) do nothing;
