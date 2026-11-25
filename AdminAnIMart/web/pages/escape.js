// escape.js — shared HTML-escaping helpers for the AniMart admin panel.
//
// Loaded globally from a <script> tag on every admin page (after config.js,
// before the page's own inline scripts run their render functions). Provides a
// single, consistent escaper so user-controlled data (names, emails, shop
// titles, message bodies, report reasons — all originally typed by mobile-app
// users) can never break out of the markup it is interpolated into.
//
// Why this matters: the admin pages build rows/cards with template strings and
// assign them via innerHTML. Without escaping, a user who registers a name like
//   <img src=x onerror="…">
// would run script in an admin's authenticated browser (stored XSS). Route every
// interpolated value that originates from the database through escapeHtml().
//
// escapeHtml() is safe for both element text and quoted attribute values because
// it encodes &, <, >, ", and '. Prefer it everywhere; it is intentionally the
// only helper so there is nothing to pick wrong.

(function (global) {
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Attribute-context alias. Same encoding, named for intent at call sites
    // that inject into onclick="…('${x}')" or style="…${x}…".
    global.escapeHtml = escapeHtml;
    global.escapeAttr = escapeHtml;
})(window);
