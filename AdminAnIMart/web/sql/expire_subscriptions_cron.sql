-- ============================================================================
-- AniMart — auto-expire premium subscriptions
-- Flips approved subscriptions to 'expired' once their expires_at has passed.
-- Run in the Supabase SQL Editor.
--
-- This is server-side and automatic: pg_cron runs the UPDATE on a schedule,
-- regardless of whether the admin panel is open. premium.html also runs the
-- same UPDATE on load as a safety net (see expirePastDue() there).
--
-- NOTE: the subscriptions.status CHECK constraint must allow 'expired'. Verify:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'subscriptions_status_check';
-- ============================================================================

-- pg_cron lives in the `cron` schema; enable it once.
create extension if not exists pg_cron;

-- One-time catch-up: expire anything already past due right now.
update public.subscriptions
   set status = 'expired'
 where status = 'approved'
   and expires_at < now();

-- (Re)create the scheduled job. Drop any previous copy first so this file is
-- safe to re-run.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'expire-subscriptions') then
        perform cron.unschedule('expire-subscriptions');
    end if;
end $$;

-- Runs hourly at :05. Change to '5 0 * * *' for once-a-day at 00:05.
select cron.schedule(
    'expire-subscriptions',
    '5 * * * *',
    $$update public.subscriptions
         set status = 'expired'
       where status = 'approved'
         and expires_at < now()$$
);

-- To inspect / remove later:
--   select jobid, jobname, schedule, command from cron.job;
--   select cron.unschedule('expire-subscriptions');
