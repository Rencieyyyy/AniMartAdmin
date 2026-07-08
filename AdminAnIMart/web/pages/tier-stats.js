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

// Normalize subscriptions.billing_cycle to 'monthly' | 'yearly'. Rows written
// before the 20260703 migration have no explicit value, so missing/null (or
// anything unrecognized) is treated as 'monthly'.
function normalizeBillingCycle(cycle) {
    return String(cycle || '').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
}

function billingCycleLabel(cycle) {
    return normalizeBillingCycle(cycle) === 'yearly' ? 'Yearly' : 'Monthly';
}

// Selects from subscriptions including billing_cycle, retrying without it when
// the column doesn't exist yet (add_subscriptions_billing_cycle.sql not applied
// — Postgres error 42703). Fallback rows carry no billing_cycle, which
// normalizeBillingCycle treats as 'monthly' — the pre-migration reality.
// `applyFilters` receives the query builder so callers keep their own filters.
async function selectSubscriptions(client, withCycle, withoutCycle, applyFilters) {
    let res = await applyFilters(client.from('subscriptions').select(withCycle));
    if (res.error && res.error.code === '42703') {
        console.warn('subscriptions.billing_cycle missing — run web/sql/add_subscriptions_billing_cycle.sql. Treating all subscriptions as monthly until then.');
        res = await applyFilters(client.from('subscriptions').select(withoutCycle));
    }
    return res;
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
// A row's price is the FULL amount for its billing cycle (a yearly row's price
// covers the whole year), so `total`/`active` are money actually collected.
// `mrr` normalizes active plans to a per-month rate (yearly ÷ 12) for
// monthly-recurring-revenue style display.
// Returns { total, active, mrr }; zeros on error (callers render zeros, page survives).
async function computeSubscriptionRevenue(client) {
    try {
        const { data, error } = await selectSubscriptions(
            client,
            'price, status, billing_cycle',
            'price, status',
            q => q.in('status', ['approved', 'expired'])
        );
        if (error) throw error;
        let total = 0, active = 0, mrr = 0;
        (data || []).forEach(r => {
            const amt = Number(r.price) || 0;
            total += amt;
            if (r.status === 'approved') {
                active += amt;
                mrr += normalizeBillingCycle(r.billing_cycle) === 'yearly' ? amt / 12 : amt;
            }
        });
        return { total, active, mrr: Math.round(mrr) };
    } catch (e) {
        console.error('SUBSCRIPTION REVENUE ERROR:', e);
        return { total: 0, active: 0, mrr: 0 };
    }
}

// Head-count of users split into sellers vs buyers (is_seller flag). Buyers =
// everyone who isn't a seller. Two head-only count queries (no rows moved).
// Returns { sellers, buyers, total }; zeros on error.
async function computeUserCounts(client) {
    try {
        const totalRes = await client
            .from('users')
            .select('id', { count: 'exact', head: true });
        if (totalRes.error) throw totalRes.error;

        const sellerRes = await client
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('is_seller', true);
        if (sellerRes.error) throw sellerRes.error;

        const total   = totalRes.count || 0;
        const sellers = sellerRes.count || 0;
        return { sellers, buyers: Math.max(0, total - sellers), total };
    } catch (e) {
        console.error('USER COUNTS ERROR:', e);
        return { sellers: 0, buyers: 0, total: 0 };
    }
}

// Monthly subscription revenue for the last `months` calendar months (default
// 6), ending with the current month. Revenue is booked to the month a plan was
// paid for — approved rows use started_at (when it went active), expired rows
// use started_at too (that's when the money came in). pending/rejected never
// paid, so they're excluded. A yearly plan books its whole price to its start
// month (matches how computeSubscriptionRevenue totals money collected).
// Returns { labels:[…], data:[…], total } — labels like 'Feb', data in pesos.
async function computeMonthlyRevenue(client, months = 6) {
    const now = new Date();
    // Build the ordered list of month buckets we care about.
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({
            key:   d.getFullYear() + '-' + d.getMonth(),
            label: d.toLocaleDateString('en-PH', { month: 'short' }),
            total: 0
        });
    }
    const byKey = {};
    buckets.forEach(b => { byKey[b.key] = b; });

    try {
        const { data, error } = await selectSubscriptions(
            client,
            'price, status, started_at, billing_cycle',
            'price, status, started_at',
            q => q.in('status', ['approved', 'expired'])
        );
        if (error) throw error;

        (data || []).forEach(r => {
            if (!r.started_at) return;
            const d = new Date(r.started_at);
            const key = d.getFullYear() + '-' + d.getMonth();
            if (byKey[key]) byKey[key].total += Number(r.price) || 0;
        });
    } catch (e) {
        console.error('MONTHLY REVENUE ERROR:', e);
        // fall through with zeroed buckets so the chart still renders
    }

    return {
        labels: buckets.map(b => b.label),
        data:   buckets.map(b => b.total),
        total:  buckets.reduce((s, b) => s + b.total, 0)
    };
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
