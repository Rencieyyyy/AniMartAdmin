-- ============================================================================
-- AniMart — listing & review moderation (admin panel features)
--
-- Before this migration admins could READ every listing (listings_select_all)
-- but had no write path: reports about a bad listing could only be marked
-- "reviewed" — there was no way to actually take the listing down. Likewise
-- app_reviews (the mobile "Rate us" feedback) had no admin delete, so abusive
-- reviews could not be removed.
--
-- This migration adds:
--   1. "Admins update listings"  — lets active admins moderate any listing
--      (the panel uses it to set status = 'removed' / back to 'active').
--      Restricted (read-only) admins are blocked by the restrictive
--      limited-admin policy, same pattern as public.users.
--   2. trg_protect_removed_listing — a non-admin (i.e. the seller) cannot
--      flip a listing out of 'removed': an admin takedown sticks until an
--      admin restores it. Sellers keep full control of their own listings
--      in every other status.
--   3. "Admins delete app reviews" — moderation for the Reviews page.
--
-- Audit: trg_audit_listings_status / trg_audit_listings_delete already log
-- admin status changes and deletions to audit_logs — no new triggers needed.
-- ============================================================================

-- ── 1) admins may update any listing ─────────────────────────────────────────
drop policy if exists "Admins update listings" on public.listings;
create policy "Admins update listings"
    on public.listings for update
    to authenticated
    using ( public.is_admin() )
    with check ( public.is_admin() );

-- Read-only (restricted/blocked) admins: writes rejected, sellers unaffected
-- (is_limited_admin() is false for every non-admin).
drop policy if exists "listings_block_limited_update" on public.listings;
create policy "listings_block_limited_update"
    on public.listings as restrictive for update
    to authenticated
    using ( not public.is_limited_admin() )
    with check ( not public.is_limited_admin() );

-- ── 2) sellers cannot undo an admin takedown ─────────────────────────────────
create or replace function public.protect_removed_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if old.status = 'removed'
       and new.status is distinct from old.status
       and not public.is_admin() then
        raise exception 'This listing was removed by an admin and can only be restored by an admin.';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_protect_removed_listing on public.listings;
create trigger trg_protect_removed_listing
    before update on public.listings
    for each row execute function public.protect_removed_listing();

-- ── 3) admins may delete app reviews ─────────────────────────────────────────
drop policy if exists "Admins delete app reviews" on public.app_reviews;
create policy "Admins delete app reviews"
    on public.app_reviews for delete
    to authenticated
    using ( public.is_admin() );

drop policy if exists "app_reviews_block_limited_delete" on public.app_reviews;
create policy "app_reviews_block_limited_delete"
    on public.app_reviews as restrictive for delete
    to authenticated
    using ( not public.is_limited_admin() );
