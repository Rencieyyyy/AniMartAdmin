// AniMart — admin account lifecycle (create / delete).
//
// Called by web/pages/manage-admins.html. Creating or deleting an ADMIN means
// creating/deleting a Supabase AUTH user, which requires the service-role
// key — so it must happen here, never in the browser.
//
// Guards (server-side, cannot be bypassed by the client):
//   • caller must be a signed-in ACTIVE super admin (public.admins.role =
//     'super_admin', status = 'active');
//   • callers cannot delete themselves;
//   • the last active super admin can never be deleted (also enforced by the
//     trg_protect_admins_row DB trigger as defense in depth).
//
// Role/status changes (block / restrict / promote) do NOT go through this
// function — the panel updates public.admins directly under RLS, and the
// trg_protect_admins_row trigger guards the sensitive columns.
//
// Audit: operations here run as service role (no admin JWT), so the admins
// audit trigger skips them; this function writes the audit_logs rows itself,
// attributed to the verified caller.
//
// Deploy:  supabase functions deploy admin-users
// Secrets: none beyond the platform-provided SUPABASE_URL /
//          SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.

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
    // ── 1) identify the caller from their JWT ──────────────────────────────
    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user: caller } } = await authed.auth.getUser();
    if (!caller) return json({ error: "Not signed in" }, 401);

    // ── 2) service-role client for privileged work ──────────────────────────
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Caller must be an ACTIVE super admin. Match by id OR email (one legacy
    // admins row has an id that differs from its auth user id).
    const { data: actor } = await service
      .from("admins")
      .select("id, email, role, status")
      .or(`id.eq.${caller.id},email.ilike.${(caller.email ?? "").trim()}`)
      .maybeSingle();

    if (!actor || actor.role !== "super_admin" || actor.status !== "active") {
      return json({ error: "Only an active super admin can manage admin accounts" }, 403);
    }

    const audit = (action: string, targetId: string, details: unknown) =>
      service.from("audit_logs").insert({
        admin_id: actor.id,
        admin_email: actor.email,
        action,
        target_type: "admin",
        target_id: targetId,
        details,
      });

    const body = await req.json();

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const firstName = String(body.first_name ?? "").trim();
      const lastName = String(body.last_name ?? "").trim();
      const role = body.role === "super_admin" ? "super_admin" : "admin";

      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "A valid email is required" }, 400);
      }
      if (password.length < 8) {
        return json({ error: "Password must be at least 8 characters" }, 400);
      }
      if (!lastName) return json({ error: "Last name is required" }, 400);

      const { data: existing } = await service
        .from("admins").select("id").ilike("email", email).maybeSingle();
      if (existing) return json({ error: "An admin with that email already exists" }, 409);

      const { data: created, error: authErr } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authErr) return json({ error: "Auth user: " + authErr.message }, 400);

      const { error: rowErr } = await service.from("admins").insert({
        id: created.user.id, // id-matched, unlike the legacy row
        email,
        first_name: firstName || null,
        last_name: lastName,
        role,
        status: "active",
      });
      if (rowErr) {
        // Roll back the auth user so a failed insert doesn't strand an
        // account that can log in but has no admin row.
        await service.auth.admin.deleteUser(created.user.id);
        return json({ error: "Admins row: " + rowErr.message }, 400);
      }

      await audit("admin.create", created.user.id, { email, role, status: "active" });
      return json({ ok: true, id: created.user.id });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (body.action === "delete") {
      const targetId = String(body.admin_id ?? "");
      if (!targetId) return json({ error: "admin_id is required" }, 400);
      if (targetId === actor.id) {
        return json({ error: "You cannot delete your own account" }, 400);
      }

      const { data: target } = await service
        .from("admins")
        .select("id, email, role, status")
        .eq("id", targetId)
        .maybeSingle();
      if (!target) return json({ error: "Admin not found" }, 404);

      if (target.role === "super_admin" && target.status === "active") {
        const { count } = await service
          .from("admins")
          .select("id", { count: "exact", head: true })
          .eq("role", "super_admin").eq("status", "active").neq("id", target.id);
        if (!count) return json({ error: "Cannot delete the last active super admin" }, 400);
      }

      // Delete the admins row first (the DB trigger re-checks the last-super
      // invariant), then the auth user.
      const { error: rowErr } = await service.from("admins").delete().eq("id", target.id);
      if (rowErr) return json({ error: rowErr.message }, 400);

      // admins.id normally equals the auth user id; the one legacy row does
      // not, so fall back to finding the auth user by email.
      const { error: delErr } = await service.auth.admin.deleteUser(target.id);
      if (delErr) {
        const { data: page } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const match = page?.users?.find(
          (u) => (u.email ?? "").toLowerCase() === target.email.toLowerCase(),
        );
        if (match) await service.auth.admin.deleteUser(match.id);
      }

      await audit("admin.delete", target.id, {
        email: target.email, role: target.role, status: target.status,
      });
      return json({ ok: true });
    }

    return json({ error: "Unknown action (use 'create' or 'delete')" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
