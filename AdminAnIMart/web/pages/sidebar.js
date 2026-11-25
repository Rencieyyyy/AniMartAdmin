// ============================================================================
// AniMart — shared admin sidebar behaviour. Included on every admin page
// (after the sidebar markup, BEFORE role.js). Styles live in admin-shell.css.
//
// 1. Collapsible sections. The static markup is a flat list:
//        <div class="nav-label">Main</div> <a class="nav-link">…</a> …
//    build() turns every label + the links that follow it into a dropdown
//    group (Main / Admin / Super Admin). Clicking the group button shows or
//    hides its links. The group holding the current page always opens; every
//    group remembers whether it was last open or closed (localStorage, per
//    browser), and the list keeps its scroll position between pages.
//    role.js injects the Super Admin label + links later (after the role
//    lookup) and then calls AdminSidebar.refresh() to group them too.
//
// 2. Responsive drawer. At ≤1024px the sidebar leaves the layout: a top bar
//    with a menu button appears and the sidebar slides in over the page
//    (scrim, Esc, or picking a link closes it).
// ============================================================================
(function () {
    "use strict";

    if (window.AdminSidebar) return;   // guard against double inclusion

    var STORE_KEY = "animart_nav_groups";
    var GROUP_ICONS = { "main": "layout-grid", "admin": "shield", "super-admin": "shield-check" };
    var drawerMq = window.matchMedia("(max-width: 1024px)");

    var here = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
        catch (e) { return {}; }
    }
    function saveState(state) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    }
    var state = loadState();

    function slug(text) {
        return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }

    function isCurrent(link) {
        var href = (link.getAttribute("href") || "").split("/").pop().toLowerCase();
        return !!href && href === here;
    }

    function renderIcons() {
        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
    }

    // ── Groups ──────────────────────────────────────────────────────────────

    function setGroupOpen(group, open) {
        group.classList.toggle("open", open);
        var btn = group.querySelector(".nav-group-toggle");
        var body = group.querySelector(".nav-group-body");
        if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
        // Collapsed links must not be reachable with Tab / screen readers.
        if (body) body.inert = !open;
    }

    function makeGroup(label) {
        var name = label.textContent.trim();
        var key = slug(name);
        var bodyId = "nav-group-" + key;

        var group = document.createElement("div");
        group.className = "nav-group";
        group.setAttribute("data-group", key);
        group.innerHTML =
            '<button type="button" class="nav-group-toggle" aria-expanded="false" aria-controls="' + bodyId + '">' +
                '<i data-lucide="' + (GROUP_ICONS[key] || "folder") + '" class="ng-icon"></i>' +
                '<span class="ng-text"></span>' +
                '<span class="ng-dot" aria-hidden="true"></span>' +
                '<i data-lucide="chevron-down" class="ng-chevron"></i>' +
            "</button>" +
            '<div class="nav-group-body" id="' + bodyId + '" role="group">' +
                '<div class="nav-group-items"></div>' +
            "</div>";
        group.querySelector(".ng-text").textContent = name;
        group.querySelector(".nav-group-body").setAttribute("aria-label", name);

        // Move the links that follow the label into the group.
        var items = group.querySelector(".nav-group-items");
        var next = label.nextElementSibling;
        label.replaceWith(group);
        while (next && next.classList.contains("nav-link")) {
            var link = next;
            next = next.nextElementSibling;
            link.classList.toggle("active", isCurrent(link));
            items.appendChild(link);
        }

        var hasCurrent = !!items.querySelector(".nav-link.active");
        group.classList.toggle("has-current", hasCurrent);
        // The group holding the current page opens — and is remembered as
        // open, so the sidebar looks the same on the next page instead of
        // collapsing it again (which would also shift the scroll position).
        if (hasCurrent && state[key] !== true) { state[key] = true; saveState(state); }
        setGroupOpen(group, hasCurrent || state[key] === true);

        group.querySelector(".nav-group-toggle").addEventListener("click", function () {
            var open = !group.classList.contains("open");
            setGroupOpen(group, open);
            state[key] = open;
            saveState(state);
        });
    }

    function build() {
        var nav = document.querySelector(".sidebar .nav");
        if (!nav) return;
        Array.prototype.slice.call(nav.children)
            .filter(function (el) { return el.classList.contains("nav-label"); })
            .forEach(makeGroup);
        renderIcons();
        restoreScroll();   // the list may have grown (Super Admin added later)
    }

    // ── Keep the section list's scroll position across page loads ──────────
    // Every link is a full page load, which would reset the scrolled list to
    // the top. Save where it was (per tab) and put it back on the next page;
    // with nothing saved, just make sure the current page's link is visible.

    var SCROLL_KEY = "animart_nav_scroll";

    function saveScroll() {
        var nav = document.querySelector(".sidebar .nav");
        if (!nav) return;
        try { sessionStorage.setItem(SCROLL_KEY, String(nav.scrollTop)); } catch (e) { /* storage blocked */ }
    }

    function restoreScroll() {
        var nav = document.querySelector(".sidebar .nav");
        if (!nav) return;
        var saved = null;
        try { saved = sessionStorage.getItem(SCROLL_KEY); } catch (e) { /* storage blocked */ }
        if (saved !== null) nav.scrollTop = Number(saved) || 0;

        // Bring the current page's link into view if it's hidden, without
        // moving the list when it's already visible.
        var active = nav.querySelector(".nav-group.open .nav-link.active");
        if (!active) return;
        var bottomBar = nav.querySelector(".nav-bottom");
        var navBox = nav.getBoundingClientRect();
        var box = active.getBoundingClientRect();
        var visibleBottom = navBox.bottom - (bottomBar ? bottomBar.offsetHeight : 0);
        if (box.top < navBox.top) nav.scrollTop -= navBox.top - box.top + 8;
        else if (box.bottom > visibleBottom) nav.scrollTop += box.bottom - visibleBottom + 8;
    }

    function watchScroll() {
        var nav = document.querySelector(".sidebar .nav");
        if (!nav) return;
        nav.addEventListener("scroll", saveScroll, { passive: true });
        window.addEventListener("pagehide", saveScroll);
    }

    // ── Drawer (tablet / phone) ─────────────────────────────────────────────

    var sidebar, menuBtn, scrim;

    function drawerOpen() { return document.body.classList.contains("nav-open"); }

    function syncInert() {
        // Off-canvas and closed → keep it out of the tab order.
        if (sidebar) sidebar.inert = drawerMq.matches && !drawerOpen();
    }

    function openDrawer() {
        if (!drawerMq.matches) return;
        document.body.classList.add("nav-open");
        menuBtn.setAttribute("aria-expanded", "true");
        syncInert();
        var target = sidebar.querySelector(".nav-link.active") || sidebar.querySelector(".sidebar-close");
        if (target) target.focus({ preventScroll: true });
    }

    function closeDrawer(restoreFocus) {
        if (!drawerOpen()) return;
        var focusWasInside = sidebar.contains(document.activeElement);
        document.body.classList.remove("nav-open");
        menuBtn.setAttribute("aria-expanded", "false");
        syncInert();
        if (restoreFocus !== false && focusWasInside) menuBtn.focus({ preventScroll: true });
    }

    function buildDrawer() {
        sidebar = document.querySelector(".sidebar");
        if (!sidebar) return;
        if (!sidebar.id) sidebar.id = "adminSidebar";

        // Top bar: menu button + brand mark + current page name.
        var current = sidebar.querySelector(".nav-link.active span");
        var bar = document.createElement("header");
        bar.className = "mobile-topbar";
        bar.innerHTML =
            '<button type="button" class="mt-menu" aria-label="Open menu" aria-controls="' + sidebar.id + '" aria-expanded="false">' +
                '<i data-lucide="menu"></i>' +
            "</button>" +
            '<div class="mt-brand"></div>' +
            '<div class="mt-title"></div>';
        var brand = sidebar.querySelector(".sidebar-brand");
        if (brand) {
            Array.prototype.forEach.call(brand.children, function (child) {
                if (child.classList.contains("sidebar-close")) return;
                var copy = child.cloneNode(true);
                copy.removeAttribute("id");
                bar.querySelector(".mt-brand").appendChild(copy);
            });
        }
        bar.querySelector(".mt-title").textContent = current ? current.textContent.trim() : "";
        // Top bar + scrim go next to the sidebar (inside .wrapper) so all three
        // share one stacking context — .wrapper sets z-index:1 on every page.
        var shell = sidebar.parentElement || document.body;
        shell.insertBefore(bar, sidebar);
        menuBtn = bar.querySelector(".mt-menu");

        // Close button inside the drawer (hidden on desktop by CSS).
        if (brand) {
            var close = document.createElement("button");
            close.type = "button";
            close.className = "sidebar-close";
            close.setAttribute("aria-label", "Close menu");
            close.innerHTML = '<i data-lucide="x"></i>';
            close.addEventListener("click", function () { closeDrawer(); });
            brand.appendChild(close);
        }

        scrim = document.createElement("div");
        scrim.className = "nav-scrim";
        scrim.addEventListener("click", function () { closeDrawer(); });
        shell.insertBefore(scrim, sidebar.nextSibling);

        menuBtn.addEventListener("click", function () {
            if (drawerOpen()) closeDrawer(); else openDrawer();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && drawerOpen()) closeDrawer();
        });
        // Picking a page closes the drawer (the browser is navigating away).
        sidebar.addEventListener("click", function (e) {
            if (e.target.closest("a.nav-link")) closeDrawer(false);
        });
        var onChange = function () { if (!drawerMq.matches) closeDrawer(false); syncInert(); };
        if (drawerMq.addEventListener) drawerMq.addEventListener("change", onChange);
        else drawerMq.addListener(onChange);
        syncInert();

        // Wide tables scroll sideways inside their card instead of stretching
        // the page on small screens.
        document.querySelectorAll(".main table").forEach(function (table) {
            var p = table.parentElement;
            var ox = p ? getComputedStyle(p).overflowX : "";
            if (ox === "auto" || ox === "scroll") return;
            var wrap = document.createElement("div");
            wrap.className = "rsp-table-scroll";
            p.insertBefore(wrap, table);
            wrap.appendChild(table);
        });
    }

    function init() {
        build();
        buildDrawer();
        renderIcons();
        restoreScroll();
        watchScroll();
    }

    window.AdminSidebar = {
        refresh: build,
        open: openDrawer,
        close: closeDrawer
    };

    // The script tag sits after the sidebar markup, so build right away (no
    // flash of the flat list); fall back to DOMContentLoaded if it doesn't.
    if (document.querySelector(".sidebar .nav") && document.querySelector(".main")) init();
    else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
