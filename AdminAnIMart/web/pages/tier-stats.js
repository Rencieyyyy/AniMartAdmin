// ── SHARED SELLER TIER STATS ──
// Single source of truth for "how many sellers are on each plan tier", used by
// the Dashboard and Premium Requests pages so both always agree.
//
// Tiers are derived from real data:
//   • A seller's tier = the plan of their active (approved) subscription.
//   • Sellers with no active (paid) subscription are on the Free tier.
//   • Only sellers (users.is_seller = true) are counted — buyers are excluded.
//
// There are three tiers, stored VERBATIM in subscriptions.plan: 'Free',
// 'Premium', 'Super Premium'. There is no key-mapping layer — the stored
// string IS the label. Counts are by DISTINCT seller, so
// Free + Premium + Super Premium === total sellers.

// The two PAID tiers (Free is everyone else).
const PAID_TIERS = ['Premium', 'Super Premium'];

// Normalize ANY stored/legacy plan value to a canonical tier label. The DB has
// historically stored lowercase keys ('premium', 'superpremium', 'basic') and
// may also store the spaced labels ('Super Premium') depending on whether the
// migration ran — so we accept all of them. 'basic'/'pro' fold into Premium;
// 'elite'/'superpremium' into Super Premium.
const _PLAN_ALIASES = {
    free:         'Free',
    basic:        'Premium',
    pro:          'Premium',
    premium:      'Premium',
    elite:        'Super Premium',
    superpremium: 'Super Premium'
};
function normalizePlan(plan) {
    const key = String(plan || '').toLowerCase().replace(/[^a-z]/g, '');
    return _PLAN_ALIASES[key] || plan || 'Free';
}

// Display metadata for the three tiers (shared so both pages look consistent).
// `key` is the canonical plan label; `id` is the DOM-safe element suffix.
const TIER_META = [
    { key: 'Free',          id: 'free',    label: 'Free',          color: '#7D8590', rgb: '125,133,144' },
    { key: 'Premium',       id: 'premium', label: 'Premium',       color: '#FFD166', rgb: '255,209,102' },
    { key: 'Super Premium', id: 'super',   label: 'Super Premium', color: '#C084FC', rgb: '192,132,252' }
];

// Total revenue from mobile-app subscription payments: sum of subscriptions.price
// over approved (active) + expired rows — pending/rejected were never paid.
// Returns { total, active }; zeros on error (callers render zeros, page survives).
async function computeSubscriptionRevenue(client) {
    try {
        const { data, error } = await client
            .from('subscriptions')
            .select('price, status')
            .in('status', ['approved', 'expired']);
        if (error) throw error;
        let total = 0, active = 0;
        (data || []).forEach(r => {
            const amt = Number(r.price) || 0;
            total += amt;
            if (r.status === 'approved') active += amt;
        });
        return { total, active };
    } catch (e) {
        console.error('SUBSCRIPTION REVENUE ERROR:', e);
        return { total: 0, active: 0 };
    }
}

// Returns { 'Free', 'Premium', 'Super Premium', totalSellers }.
// On any error, returns all-zero counts and logs (callers render zeros rather
// than breaking the page).
async function computeSellerTierCounts(client) {
    const zero = { 'Free': 0, 'Premium': 0, 'Super Premium': 0, totalSellers: 0 };
    try {
        // Total sellers (head:true → count only, no rows transferred).
        const { count: totalSellers, error: uErr } = await client
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('is_seller', true);
        if (uErr) throw uErr;

        // Active subscriptions → map each seller to a tier (distinct sellers).
        const { data: subs, error: sErr } = await client
            .from('subscriptions')
            .select('user_id, plan')
            .eq('status', 'approved');
        if (sErr) throw sErr;

        const tierByUser = {};
        (subs || []).forEach(s => {
            const tier = normalizePlan(s.plan);
            if (PAID_TIERS.includes(tier) && s.user_id != null) tierByUser[s.user_id] = tier;
        });

        const counts = { 'Premium': 0, 'Super Premium': 0 };
        let subscribers = 0;
        Object.values(tierByUser).forEach(plan => { counts[plan]++; subscribers++; });

        const total = totalSellers || 0;
        return {
            'Free':          Math.max(0, total - subscribers),
            'Premium':       counts['Premium'],
            'Super Premium': counts['Super Premium'],
            totalSellers: total
        };
    } catch (e) {
        console.error('TIER STATS ERROR:', e);
        return zero;
    }
}
