// ============================================================================
// AniMart — open-reports count badge on the "Reports" sidebar link.
// Included on every admin page AFTER config.js (needs supabaseClient).
// Counts public.reports rows with status = 'open' (head-only count query, so
// no row data is transferred) and fills every [data-reports-badge] element.
// reports.html re-calls window.refreshReportsBadge() after triage actions.
// ============================================================================
(function () {

    // Badge styling is injected here so the 8 page files don't each need it.
    const style = document.createElement('style');
    style.textContent = `
        .nav-link .reports-badge {
            margin-left: auto; min-width: 20px; height: 18px; padding: 0 6px;
            border-radius: 20px; background: rgba(255,107,107,0.15); color: #FF6B6B;
            border: 1px solid rgba(255,107,107,0.25);
            font-size: 0.62rem; font-weight: 700; font-family: 'DM Mono', monospace;
            display: inline-flex; align-items: center; justify-content: center;
            line-height: 1;
        }
        /* On mint (hover/active) backgrounds the red pill is unreadable —
           switch to a dark-on-mint treatment that inherits the link color. */
        .nav-link:hover .reports-badge,
        .nav-link.active .reports-badge {
            background: rgba(13,17,23,0.15); color: inherit;
            border-color: rgba(13,17,23,0.2);
        }
    `;
    document.head.appendChild(style);

    async function refreshReportsBadge() {
        try {
            const { count, error } = await supabaseClient
                .from('reports')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'open');

            if (error) { console.error('REPORTS BADGE ERROR:', error); return; }

            document.querySelectorAll('[data-reports-badge]').forEach(el => {
                el.textContent = count > 99 ? '99+' : String(count || 0);
                el.hidden = !count;   // badge only shows when something is pending
            });
        } catch (e) {
            console.error('REPORTS BADGE ERROR:', e);
        }
    }

    window.refreshReportsBadge = refreshReportsBadge;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshReportsBadge);
    } else {
        refreshReportsBadge();
    }
})();
