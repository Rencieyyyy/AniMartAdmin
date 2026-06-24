// ── SHARED LOGOUT MODAL ──
// Drop-in styled "Sign Out" confirmation used by every admin page so the logout
// prompt looks identical everywhere (matches profile.html). Self-contained:
// injects its own CSS + markup and exposes confirmLogout()/closeLogoutModal()/
// doLogout() globally. Classes are namespaced (lgt-*) to avoid clashing with the
// per-page .modal styles already defined on some pages.
(function () {
    "use strict";

    // Guard against double-inclusion on a page.
    if (window.__logoutModalReady) return;
    window.__logoutModalReady = true;

    var CSS = [
        ".lgt-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);",
        "backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;",
        "opacity:0;visibility:hidden;transition:opacity .25s ease,visibility .25s ease;",
        "z-index:4000;padding:20px;}",
        ".lgt-overlay.show{opacity:1;visibility:visible;}",
        ".lgt-modal{background:var(--surface,#161B22);border:1px solid var(--border,rgba(255,255,255,0.07));",
        "border-radius:var(--radius,16px);padding:28px 26px 24px;width:100%;max-width:380px;",
        "box-shadow:0 24px 60px rgba(0,0,0,0.5);transform:translateY(14px) scale(0.97);",
        "transition:transform .25s ease;text-align:center;}",
        ".lgt-overlay.show .lgt-modal{transform:translateY(0) scale(1);}",
        ".lgt-icon{width:52px;height:52px;border-radius:50%;background:rgba(255,107,107,0.12);",
        "display:flex;align-items:center;justify-content:center;margin:0 auto 16px;}",
        ".lgt-icon svg{width:24px;height:24px;color:var(--danger,#FF6B6B);}",
        ".lgt-title{font-size:1.1rem;font-weight:800;color:var(--text,#E6EDF3);",
        "letter-spacing:-0.02em;margin-bottom:8px;}",
        ".lgt-text{font-size:0.85rem;color:var(--muted,#7D8590);line-height:1.5;margin-bottom:22px;}",
        ".lgt-actions{display:flex;gap:10px;}",
        ".lgt-btn{flex:1;padding:11px 14px;border-radius:10px;font-size:0.85rem;font-weight:700;",
        "cursor:pointer;border:1px solid transparent;transition:background .15s ease,transform .15s ease;}",
        ".lgt-btn-ghost{background:transparent;border-color:var(--border,rgba(255,255,255,0.07));color:var(--muted,#7D8590);}",
        ".lgt-btn-ghost:hover{color:var(--text,#E6EDF3);border-color:var(--border,rgba(255,255,255,0.2));}",
        ".lgt-btn-danger{background:var(--danger,#FF6B6B);color:#fff;}",
        ".lgt-btn-danger:hover{background:#ff5252;transform:translateY(-1px);}"
    ].join("");

    var MARKUP =
        '<div class="lgt-overlay" id="logoutModal">' +
        '<div class="lgt-modal" role="dialog" aria-modal="true" aria-labelledby="logoutModalTitle">' +
        '<div class="lgt-icon"><i data-lucide="log-out"></i></div>' +
        '<div class="lgt-title" id="logoutModalTitle">Sign Out</div>' +
        '<div class="lgt-text">Are you sure you want to sign out of your admin account?</div>' +
        '<div class="lgt-actions">' +
        '<button class="lgt-btn lgt-btn-ghost" type="button" onclick="closeLogoutModal()">Cancel</button>' +
        '<button class="lgt-btn lgt-btn-danger" type="button" onclick="doLogout()">Sign Out</button>' +
        '</div></div></div>';

    function inject() {
        var style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        var wrap = document.createElement("div");
        wrap.innerHTML = MARKUP;
        document.body.appendChild(wrap.firstChild);

        // Close when the dimmed backdrop (not the card) is clicked.
        var overlay = document.getElementById("logoutModal");
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closeLogoutModal();
        });

        if (window.lucide && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", inject);
    } else {
        inject();
    }

    window.confirmLogout = function () {
        var modal = document.getElementById("logoutModal");
        if (!modal) return;
        modal.classList.add("show");
        if (window.lucide && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    };

    window.closeLogoutModal = function () {
        var modal = document.getElementById("logoutModal");
        if (modal) modal.classList.remove("show");
    };

    window.doLogout = async function () {
        // End the Supabase session before leaving, when available.
        try {
            if (typeof supabaseClient !== "undefined") {
                await supabaseClient.auth.signOut();
            }
        } catch (e) {
            console.error("SIGN OUT ERROR:", e);
        }
        window.location.href = "../index.html";
    };

    // Esc dismisses the modal.
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") window.closeLogoutModal();
    });
})();
