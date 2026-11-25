// ============================================================================
// image-lightbox.js — shared full-screen image popup for the admin panel.
//
// One <img> lightbox used across pages (user approvals, sellers & buyers,
// premium requests) so submitted IDs and payment receipts open in-page instead
// of navigating to a raw storage URL in a new tab.
//
// Usage:  openImageLightbox({ url, title, subtitle })
//   url      — image URL to display (already-resolved; e.g. a Cloudinary URL or
//              a Supabase signed URL). Set as <img src> directly — never built
//              into markup, so it can't inject HTML.
//   title    — heading shown in the popup header (optional).
//   subtitle — small caption under the title (optional).
//
// Requires the host page to define the CSS vars --surface/--border/--text/
// --muted/--danger (all admin pages do); sensible fallbacks are used otherwise.
// ============================================================================
(function () {
    if (window.openImageLightbox) return;   // guard against double-include

    const style = document.createElement('style');
    style.textContent = `
        .il-overlay {
            display: none; position: fixed; inset: 0; z-index: 4000;
            background: rgba(0,0,0,0.78); backdrop-filter: blur(6px);
            align-items: center; justify-content: center; padding: 20px;
        }
        .il-overlay.open { display: flex; }
        .il-modal {
            background: var(--surface, #161B22);
            border: 1px solid var(--border, rgba(255,255,255,0.07));
            border-radius: 18px; width: 100%; max-width: 720px;
            max-height: 92vh; display: flex; flex-direction: column;
            box-shadow: 0 24px 60px rgba(0,0,0,0.5);
            animation: ilPop 0.22s ease both;
        }
        @keyframes ilPop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        .il-header {
            padding: 18px 20px 14px; display: flex; align-items: flex-start;
            justify-content: space-between; gap: 12px;
            border-bottom: 1px solid var(--border, rgba(255,255,255,0.07)); flex-shrink: 0;
        }
        .il-title { font-size: 0.98rem; font-weight: 800; letter-spacing: -0.02em; color: var(--text, #E6EDF3); }
        .il-sub   { font-size: 0.74rem; color: var(--muted, #7D8590); margin-top: 2px; }
        .il-close {
            width: 28px; height: 28px; border-radius: 7px; flex-shrink: 0;
            border: 1px solid var(--border, rgba(255,255,255,0.07)); background: transparent;
            color: var(--muted, #7D8590); font-size: 1.1rem; line-height: 1; cursor: pointer;
            display: flex; align-items: center; justify-content: center; transition: all 0.15s;
        }
        .il-close:hover { color: var(--text, #E6EDF3); background: rgba(255,255,255,0.06); }
        .il-stage {
            position: relative; margin: 16px 18px; background: #000;
            border: 1px solid var(--border, rgba(255,255,255,0.07)); border-radius: 12px;
            overflow: hidden; min-height: 220px; max-height: 66vh;
            display: flex; align-items: center; justify-content: center;
        }
        .il-stage img { max-width: 100%; max-height: 66vh; object-fit: contain; display: block; }
        .il-loading, .il-error {
            display: none; text-align: center; padding: 40px 28px; max-width: 340px;
            color: var(--muted, #7D8590); font-size: 0.82rem; line-height: 1.55;
        }
        .il-stage.loading .il-loading { display: block; }
        .il-stage.loading img { display: none; }
        .il-stage.error img { display: none; }
        .il-stage.error .il-error { display: block; color: var(--danger, #FF6B6B); }
        .il-footer {
            padding: 12px 20px 16px; display: flex; align-items: center;
            justify-content: flex-end; gap: 9px; flex-shrink: 0;
        }
        .il-btn {
            display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
            padding: 8px 16px; border-radius: 9px; font-size: 0.8rem; font-weight: 600;
            font-family: inherit; cursor: pointer; transition: all 0.15s;
            border: 1px solid var(--border, rgba(255,255,255,0.07));
            background: transparent; color: var(--muted, #7D8590);
        }
        .il-btn:hover { color: var(--text, #E6EDF3); border-color: rgba(255,255,255,0.18); }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'il-overlay';
    overlay.innerHTML = `
        <div class="il-modal" role="dialog" aria-modal="true">
            <div class="il-header">
                <div>
                    <div class="il-title" id="ilTitle">Image</div>
                    <div class="il-sub" id="ilSub"></div>
                </div>
                <button class="il-close" id="ilClose" aria-label="Close">&times;</button>
            </div>
            <div class="il-stage" id="ilStage">
                <img id="ilImg" alt="" />
                <div class="il-loading" id="ilLoading">Loading image…</div>
                <div class="il-error" id="ilError">Could not load this image. It may have been removed or the link has expired.</div>
            </div>
            <div class="il-footer">
                <button class="il-btn" id="ilCloseBtn">Close</button>
                <a class="il-btn" id="ilOpen" target="_blank" rel="noopener">Open in new tab ↗</a>
            </div>
        </div>`;

    function mount() {
        document.head.appendChild(style);
        document.body.appendChild(overlay);

        const img = overlay.querySelector('#ilImg');
        const stage = overlay.querySelector('#ilStage');
        img.addEventListener('load',  () => stage.classList.remove('loading', 'error'));
        img.addEventListener('error', () => { stage.classList.remove('loading'); stage.classList.add('error'); });

        overlay.querySelector('#ilClose').addEventListener('click', close);
        overlay.querySelector('#ilCloseBtn').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && overlay.classList.contains('open')) close();
        });
    }

    function close() {
        overlay.classList.remove('open');
        // Drop the src so a re-open of a broken URL re-triggers load/error.
        overlay.querySelector('#ilImg').removeAttribute('src');
    }

    window.openImageLightbox = function (opts) {
        opts = opts || {};
        if (!opts.url) return;
        const stage = overlay.querySelector('#ilStage');
        const img   = overlay.querySelector('#ilImg');
        const link  = overlay.querySelector('#ilOpen');

        overlay.querySelector('#ilTitle').textContent = opts.title || 'Image';
        overlay.querySelector('#ilSub').textContent   = opts.subtitle || '';
        img.alt = opts.title || 'Image';

        stage.classList.remove('error');
        stage.classList.add('loading');
        img.src   = opts.url;      // resolved URL — set directly, not via markup
        link.href = opts.url;

        overlay.classList.add('open');
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
