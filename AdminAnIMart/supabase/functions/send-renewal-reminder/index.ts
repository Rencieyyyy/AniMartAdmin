// AniMart — renewal-reminder email sender.
//
// Called by web/pages/premium.html (the Remind button). Verifies the caller is
// a signed-in admin (has a row in public.admins), then emails the user via
// Resend (https://resend.com).
//
// Deploy (either way):
//   • Dashboard: Edge Functions → Deploy a new function → name it exactly
//     `send-renewal-reminder` → paste this file → Deploy.
//   • CLI:       supabase functions deploy send-renewal-reminder
//
// Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   RESEND_API_KEY       required — your Resend API key.
//   REMINDER_FROM_EMAIL  optional — a verified sender like
//                        "AniMart <no-reply@yourdomain.com>". Defaults to
//                        Resend's onboarding sender (fine for testing; it can
//                        only deliver to the Resend account owner's inbox).
//
// Until this function is deployed, the admin site still works: the in-app
// reminder is sent and the email falls back to a pre-filled mail draft.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Only signed-in admins may send reminders. The client's JWT rides in on
    // the Authorization header; admins are rows in public.admins.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: admin } = await supabase
      .from("admins")
      .select("id")
      .eq("email", user.email)
      .maybeSingle();
    if (!admin) return json({ error: "Not an admin" }, 403);

    const { email, name, plan, billingCycle, price, expiresAt, expired } =
      await req.json();
    if (!email || !plan) return json({ error: "email and plan are required" }, 400);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY secret is not set" }, 500);
    const from = Deno.env.get("REMINDER_FROM_EMAIL") ??
      "AniMart <onboarding@resend.dev>";

    const expires = expiresAt ? new Date(expiresAt) : null;
    const dateTxt = expires && !isNaN(expires.getTime())
      ? expires.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
      : "soon";
    const cycleTxt = billingCycle ? ` (billed ${billingCycle})` : "";
    const priceTxt = typeof price === "number" && price > 0
      ? ` at ₱${price.toLocaleString("en-PH")}${billingCycle === "yearly" ? "/year" : "/month"}`
      : "";

    const subject = expired
      ? `Your AniMart ${plan} plan has expired`
      : `Your AniMart ${plan} plan expires on ${dateTxt}`;

    const lead = expired
      ? `Your <strong>${plan}</strong> plan${cycleTxt} expired on <strong>${dateTxt}</strong>, so your ${plan} benefits are currently paused.`
      : `Your <strong>${plan}</strong> plan${cycleTxt} will expire on <strong>${dateTxt}</strong>.`;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937;">
        <h2 style="color:#0d9668;margin:0 0 16px;">AniMart</h2>
        <p>Hi ${name || "there"},</p>
        <p>${lead}</p>
        <p>Would you like to renew${priceTxt}? Open the <strong>Premium</strong> section in the AniMart app to resubscribe and keep your benefits — priority placement, verified badge, and more.</p>
        <p>If you have any questions, just reply through the in-app Customer Service chat.</p>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">— The AniMart Team</p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });
    if (!resp.ok) return json({ error: `Resend: ${await resp.text()}` }, 502);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
