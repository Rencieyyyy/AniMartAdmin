# Prompt for the MOBILE APP repo (paste into Claude Code there)

*Written 2026-07-07 from the admin-website repo. The admin/DB side is already
live on Supabase project `kzhlhrhhfupgvpzjllce`: multiple GCash accounts, a
private receipt bucket, `subscriptions.receipt_url`, and the admin UI that
reviews receipts. This prompt implements the mobile side of the pay-first
premium flow.*

---

Implement the new **pay-first premium request flow**. The database contracts
below already exist (admin repo migrations `20260709003000` and
`20260709004000`) — do not recreate or modify them.

## 1. Multiple GCash accounts on the "Pay with GCash" sheet

- New table `public.payment_methods`:
  `id uuid, provider text ('gcash'), account_name text, account_number text,
  qr_url text (public URL, may be ''), sort_order int, is_active bool`.
- Replace the single-account `app_settings` reads with:
  `select id, account_name, account_number, qr_url from payment_methods
   where is_active order by sort_order` — render EVERY row on the payment
  sheet (number + copy button, account name, QR image when non-empty).
  The first row is the primary account.
- RLS: any authenticated user can read active rows; writes are
  super-admin-only — never write this table from the app.
- Keep reading `app_settings.premium_payment_instructions` (unchanged,
  global instructions shown once under all accounts).
- The legacy keys `gcash_number` / `gcash_account_name` / `gcash_qr_url`
  are still auto-synced to the primary account (a DB trigger does it) so
  old app builds keep working — new code should NOT read them.

## 2. Pay-first flow (the important change)

Current flow: user taps "Choose plan" → request row is inserted → admin
approves. New flow:

1. User taps **Choose plan** → show the payment sheet (all GCash accounts,
   amount for the selected plan/billing cycle, instructions).
2. User pays outside the app, then MUST attach their **receipt screenshot**
   before the app submits anything. No receipt → no request.
3. Upload the image to the **private** Storage bucket `payment-receipts` at
   the path `"<auth.uid()>/<millisecondsSinceEpoch>.<ext>"`.
   - RLS only allows inserting into your own `<uid>/…` folder.
   - jpeg / png / webp, max 5 MB (bucket enforces both).
   - The bucket is NOT public — do not build public URLs from it.
4. THEN insert the `subscriptions` request row exactly as today, plus the
   new column: `receipt_url = <the object PATH from step 3>` (the path
   string, NOT a URL — the admin panel opens it with a signed URL).
5. If the receipt upload succeeds but the insert fails, surface the error
   and let the user retry the submit without re-uploading.

## 3. After approval — no change needed (verify only)

The admin approves the request (`subscriptions.status = 'approved'`,
`started_at`/`expires_at` stamped). The app already derives the user's plan
and benefits from the live approved subscription — verify benefits kick in
on the next app refresh after approval, and that rejection
(`status = 'rejected'`) shows the reject reason as before.

## 4. Don't break

- Do not write to `payment_methods` or the `gcash_*` / instructions keys
  from the app.
- Users can read their OWN receipts back (`payment-receipts` select policy)
  — show a thumbnail of the uploaded receipt on the pending-request screen.
- Old pending requests have `receipt_url = null`; render "no receipt"
  gracefully in any user-facing history.
- `users` table: a security fix removed the policy that let any signed-in
  user update ANY user's row. Users can still update their OWN row. If any
  app feature was writing another user's row directly, it will now fail —
  flag it and route it through a proper mechanism instead of loosening RLS.
