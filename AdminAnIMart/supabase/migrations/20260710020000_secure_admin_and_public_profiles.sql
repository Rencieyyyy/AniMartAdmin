-- ============================================================================
-- AniMart — reduce PII / admin-roster exposure (security review M1 + H3 part 1)
--
-- Context: the admin panel is a static anon-key client, so RLS is the real
-- boundary. Two over-broad SELECT grants let ANY authenticated user (including
-- every mobile-app user) read data they shouldn't:
--
--   M1  public.admins policy "Authenticated can read admin profiles" = USING
--       (true) — any signed-in user could enumerate all admin emails/roles.
--
--   H3  public.users SELECT is USING (true) and the table holds email, phone,
--       address, and valid_id_url (government-ID links). Any signed-in user can
--       `select *` and harvest everyone's PII.
--
-- This migration does the two things that are SAFE to apply immediately:
--   • M1: scope the admins read policy to admins only (is_admin()). Mobile
--     users lose it; regular + super admins keep it, so the panel (including
--     the User Approvals admin-account filter) still works.
--   • H3 part 1: add a `public_profiles` view exposing ONLY non-sensitive,
--     marketplace-facing columns — the sanctioned path for showing OTHER
--     users' names/avatars on listings, offers, reviews, chat, etc.
--
-- H3 part 2 (locking public.users SELECT down to own-row + admin) is NOT done
-- here: the mobile app reads other users' rows from `users` directly (listings/
-- offers/reviews only store FKs, no denormalized names), so tightening it now
-- would break the live marketplace. That step is staged in
-- web/sql/PENDING_lock_down_users_pii.sql and must wait until the mobile app
-- reads cross-user profiles from public_profiles instead.
-- ============================================================================

-- ── M1: only admins may read the admins roster ───────────────────────────────
-- Own-row read ("admins_select_own" / "Admins read own row") and the super-admin
-- read ("Super admin reads all admins") already exist; this replaces the
-- blanket authenticated read with an admin-scoped one so regular admins still
-- see the roster (needed by the approvals filter) but mobile users do not.
drop policy if exists "Authenticated can read admin profiles" on public.admins;

drop policy if exists "Admins read admin roster" on public.admins;
create policy "Admins read admin roster"
    on public.admins for select
    to authenticated
    using ( public.is_admin() );

-- ── H3 part 1: public-safe profile projection ────────────────────────────────
-- SECURITY DEFINER semantics (security_invoker = false, the default) so the view
-- keeps returning every user's SAFE columns even after public.users SELECT is
-- later locked to own-row. Deliberately excludes email, phone, address,
-- house_number, valid_id_type/valid_id_url/id_type, payment/contact numbers,
-- precise lat/long, approval status, and other private fields.
create or replace view public.public_profiles
with (security_invoker = false) as
    select
        id,
        name,
        avatar_url,
        is_seller,
        is_verified,
        trust_score,
        sales_count,
        business_name,
        shop_category,
        shop_description,
        location_name,
        member_since,
        created_at
    from public.users;

comment on view public.public_profiles is
    'Public-safe projection of public.users (no PII). Read OTHER users here; read your own full row from public.users. See security review H3.';

-- Lock the view to SELECT-only. It is a simple (auto-updatable) view running
-- with owner privileges (security_invoker = false), so leaving the default
-- Supabase INSERT/UPDATE/DELETE grants in place would let a client write
-- through it to public.users bypassing RLS. Revoke everything, then grant only
-- SELECT to authenticated (public.users has no anon read today — don't widen).
revoke all on public.public_profiles from anon, authenticated, public;
grant select on public.public_profiles to authenticated;
