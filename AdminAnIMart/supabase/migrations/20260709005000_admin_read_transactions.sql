-- ============================================================================
-- AniMart — let admins read marketplace transactions
-- ----------------------------------------------------------------------------
-- The only SELECT policy on public.transactions is transactions_select_involved
-- (buyer_id/seller_id = auth.uid()), so the admin panel could not see any
-- transactions at all. The dashboard's Recent Transactions widget needs a
-- read-only view across all rows.
--
-- Read-only on purpose: admins get no INSERT/UPDATE/DELETE here — transactions
-- are created and settled by the mobile app flow.
-- ============================================================================

drop policy if exists "Admins read transactions" on public.transactions;
create policy "Admins read transactions"
    on public.transactions
    for select
    to authenticated
    using ( public.is_admin() );
