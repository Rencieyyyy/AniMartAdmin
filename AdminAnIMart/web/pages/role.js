// ============================================================================
// AniMart — admin role helper (admin | super_admin).
// Included on every admin page AFTER config.js (needs supabaseClient).
//
// public.admins.role was added by supabase/migrations/20260709000000. This
// script:
//   1. exposes window.getAdminRole() → Promise<'admin'|'super_admin'|null>;
//   2. injects the "Super Admin" sidebar section (Payment Settings,
//      Manage Admins, Audit Logs) — ONLY when the signed-in admin is a super
//      admin, so regular admins never even see the links. sidebar.js then
//      folds it into a collapsible dropdown like Main / Admin;
//   3. fills any [data-admin-role] element with the pretty role name
//      (used by the My Profile page's role pill);
//   4. exposes window.requireSuperAdmin() — route guard for the two
//      super-admin-only pages; bounces non-super-admins to the dashboard.
//
// The nav links are hidden-by-default UX only. The real enforcement is in the
// database: RESTRICTIVE RLS policies + triggers (20260709001000) block GCash
// app_settings writes, and audit_logs has a super-admin-only SELECT policy
// (20260709002000) — a regular admin gets an error / zero rows regardless of
// what the UI shows.
// ============================================================================
(function () {

    // Same matching rule as config.js / public.is_super_admin(): the session's
    // email maps to a row in public.admins (RLS lets an admin read own row).
    const adminPromise = (async () => {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return null;

            const { data, error } = await supabaseClient
                .from("admins")
                .select("id, email, role, status")
                .eq("email", user.email)
                .maybeSingle();

            if (error) { console.error("ROLE LOOKUP ERROR:", error); return null; }
            return data || null;
        } catch (e) {
            console.error("ROLE LOOKUP ERROR:", e);
            return null;
        }
    })();

    // Effective role: super admin only while ACTIVE (mirrors is_super_admin()).
    const rolePromise = adminPromise.then(a => {
        if (!a) return null;
        if (a.role === "super_admin" && (a.status || "active") !== "active") return "admin";
        return a.role || "admin";
    });

    window.getAdminRole = () => rolePromise;
    window.getAdminRecord = () => adminPromise;

    // Route guard for payment-settings.html / audit-logs.html. config.js
    // already bounces non-admins; this additionally bounces regular admins.
    window.requireSuperAdmin = async function () {
        const role = await rolePromise;
        if (role !== "super_admin") {
            window.location.replace("dashboard.html");
            return false;
        }
        return true;
    };

    // localStorage key holding the last verified role (written here, at
    // login by config.js, cleared at logout by logout-modal.js).
    const ROLE_CACHE_KEY = "animart_admin_role";

    function prettyRole(role) {
        return role === "super_admin" ? "Super Admin" : "Admin";
    }

    function markActive(link) {
        const here = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
        const href = (link.getAttribute("href") || "").split("/").pop().toLowerCase();
        link.classList.toggle("active", href === here);
    }

    async function apply() {
        const [role, record] = await Promise.all([rolePromise, adminPromise]);

        // Role pill (My Profile). Filled for every admin, not just supers.
        if (role) {
            document.querySelectorAll("[data-admin-role]").forEach(el => {
                el.textContent = prettyRole(role) +
                    (record && record.status === "restricted" ? " · Restricted" : "");
            });
        }

        // Read-only banner for restricted admins: the database rejects all
        // their writes (migration 20260709003000), this just says so upfront.
        if (record && record.status === "restricted" && !document.getElementById("restrictedBanner")) {
            const main = document.querySelector(".main");
            if (main) {
                const bar = document.createElement("div");
                bar.id = "restrictedBanner";
                bar.style.cssText =
                    "background:rgba(251,184,36,0.1);border:1px solid rgba(251,184,36,0.3);" +
                    "color:#FBB824;border-radius:12px;padding:11px 16px;margin-bottom:20px;" +
                    "font-size:0.8rem;font-weight:600;";
                bar.textContent =
                    "Your account is read-only: you can view everything, but changes are disabled. Contact a super admin.";
                main.prepend(bar);
            }
        }

        // Remember the verified role so the next page can draw the Super
        // Admin section immediately (see the top of this file's tail below).
        try {
            if (role) localStorage.setItem(ROLE_CACHE_KEY, role);
            else localStorage.removeItem(ROLE_CACHE_KEY);
        } catch (e) { /* storage blocked — just no fast path */ }

        if (role === "super_admin") injectSuperAdmin();
        else removeSuperAdmin();
    }

    // Super Admin section (Payment Settings / Manage Admins / Audit Logs),
    // inserted just above .nav-bottom. Idempotent.
    function injectSuperAdmin() {
        const nav = document.querySelector(".sidebar .nav");
        if (!nav || nav.querySelector('a[href$="payment-settings.html"]')) return;

        const label = document.createElement("div");
        label.className = "nav-label";
        label.textContent = "Super Admin";

        const pay = document.createElement("a");
        pay.href = "payment-settings.html";
        pay.className = "nav-link";
        pay.innerHTML = '<i data-lucide="wallet"></i><span>Payment Settings</span>';

        const admins = document.createElement("a");
        admins.href = "manage-admins.html";
        admins.className = "nav-link";
        admins.innerHTML = '<i data-lucide="users"></i><span>Manage Admins</span>';

        const logs = document.createElement("a");
        logs.href = "audit-logs.html";
        logs.className = "nav-link";
        logs.innerHTML = '<i data-lucide="scroll-text"></i><span>Audit Logs</span>';

        const bottom = nav.querySelector(".nav-bottom");
        if (bottom) {
            nav.insertBefore(label, bottom);
            nav.insertBefore(pay, bottom);
            nav.insertBefore(admins, bottom);
            nav.insertBefore(logs, bottom);
        } else {
            nav.append(label, pay, admins, logs);
        }

        markActive(pay);
        markActive(admins);
        markActive(logs);

        // sidebar.js turns the new label + links into the collapsible
        // "Super Admin" dropdown (it renders the icons too).
        if (window.AdminSidebar) window.AdminSidebar.refresh();
        else if (window.lucide) lucide.createIcons();
    }

    // Undo a cached (optimistic) injection when the live lookup says this
    // session is not a super admin (role changed, or a different account).
    function removeSuperAdmin() {
        const group = document.querySelector('.sidebar .nav-group[data-group="super-admin"]');
        if (group) { group.remove(); return; }
        const link = document.querySelector('.sidebar a[href$="payment-settings.html"]');
        if (!link) return;
        let el = link.previousElementSibling;
        if (el && el.classList.contains("nav-label")) el.remove();
        document.querySelectorAll('.sidebar a[href$="payment-settings.html"], .sidebar a[href$="manage-admins.html"], .sidebar a[href$="audit-logs.html"]')
            .forEach(a => a.remove());
    }

    // Fast path: the role from the previous page (or login) draws the Super
    // Admin section right away, so it doesn't vanish and pop back in on every
    // navigation while the lookup runs. apply() then confirms or removes it.
    // UI only — the database enforces super-admin access regardless.
    try {
        if (localStorage.getItem(ROLE_CACHE_KEY) === "super_admin") injectSuperAdmin();
    } catch (e) { /* storage blocked */ }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply);
    } else {
        apply();
    }
})();
