// ── SHARED SELLER TIER STATS ──
// Single source of truth for "how many sellers are on each plan tier", used by
// the Dashboard and Premium Requests pages so both always agree.
//
// Tiers are derived from real data (there is no stored 'free' plan):
//   • A seller's tier = the plan of their active (approved) subscription.
//   • Sellers with no active subscription fall back to the Free tier.
//   • Only sellers (users.is_seller = true) are counted — buyers are excluded.
//
// DB subscription plan -> UI tier key:  basic->basic, premium->pro, superpremium->elite
// (matches PLAN_MAP in premium.html). Counts are by DISTINCT seller, so
// free + basic + pro + elite === total sellers.

const TIER_PLAN_KEY = { basic: 'basic', premium: 'pro', superpremium: 'elite' };

// Display metadata for the four tiers (shared so both pages look consistent).
const TIER_META = [
    { key: 'free',  label: 'Free',  color: '#7D8590', rgb: '125,133,144' },
    { key: 'basic', label: 'Basic', color: '#38BDF8', rgb: '56,189,248'  },
    { key: 'pro',   label: 'Pro',   color: '#FFD166', rgb: '255,209,102' },
    { key: 'elite', label: 'Elite', color: '#C084FC', rgb: '192,132,252' }
];

// Returns { free, basic, pro, elite, totalSellers }.
// On any error, returns all-zero counts and logs (callers render zeros rather
// than breaking the page).
async function computeSellerTierCounts(client) {
    const zero = { free: 0, basic: 0, pro: 0, elite: 0, totalSellers: 0 };
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
            const key = TIER_PLAN_KEY[s.plan];
            if (key && s.user_id != null) tierByUser[s.user_id] = key;
        });

        const counts = { basic: 0, pro: 0, elite: 0 };
        let subscribers = 0;
        Object.values(tierByUser).forEach(key => { counts[key]++; subscribers++; });

        const total = totalSellers || 0;
        return {
            free:  Math.max(0, total - subscribers),
            basic: counts.basic,
            pro:   counts.pro,
            elite: counts.elite,
            totalSellers: total
        };
    } catch (e) {
        console.error('TIER STATS ERROR:', e);
        return zero;
    }
}
