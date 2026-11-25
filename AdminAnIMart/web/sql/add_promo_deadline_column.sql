-- ============================================================================
-- AniMart — premium promo deadlines (auto-restore to base price)
-- Adds a `promo_deadline` to public.prices. When the deadline passes, the
-- plan's discount/promo is cleared and it falls back to its base price.
-- Run in the Supabase SQL Editor.
--
-- This is server-side and automatic: pg_cron runs the UPDATE on a schedule,
-- regardless of whether the admin panel is open. premium.html also runs the
-- same reset on load as a safety net (see restoreExpiredPromos() there).
-- ============================================================================

-- 1) New column. Null = the promo never expires on its own.
alter table public.prices
    add column if not exists promo_deadline timestamptz;

-- 2) One-time catch-up: restore anything already past due right now.
update public.prices
   set discount_percent = 0,
       promo_label      = null,
       promo_active     = false,
       promo_deadline   = null,
       updated_at       = now()
 where promo_deadline is not null
   and promo_deadline <= now();

-- 3) Scheduled job. pg_cron lives in the `cron` schema; enable it once.
create extension if not exists pg_cron;

-- (Re)create the job. Drop any previous copy first so this file is safe to re-run.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'restore-expired-promos') then
        perform cron.unschedule('restore-expired-promos');
    end if;
end $$;

-- Runs every 15 minutes so a promo restores close to its deadline.
select cron.schedule(
    'restore-expired-promos',
    '*/15 * * * *',
    $$update public.prices
         set discount_percent = 0,
             promo_label      = null,
             promo_active     = false,
             promo_deadline   = null,
             updated_at       = now()
       where promo_deadline is not null
         and promo_deadline <= now()$$
);

-- To inspect / remove later:
--   select jobid, jobname, schedule, command from cron.job;
--   select cron.unschedule('restore-expired-promos');
