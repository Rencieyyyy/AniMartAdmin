// ── SHARED SELLER PLAN STATS ──
// Single source of truth for the AniMart subscription plans and "how many
// sellers are on each plan", used by the Dashboard, Sellers & Buyers and
// Premium Requests pages so they always agree.
//
// The four plans (same labels the mobile app writes VERBATIM to
// subscriptions.plan — see the app's subscription_service.dart):
//   • Animart Basic     — ₱0   / month  (1-month free trial for new sellers)
//   • Animart Essential — ₱99  / week   (starter plan for growing sellers)
//   • Animart Pro       — ₱299 / month  (for serious livestock traders)
//   • Animart Elite     — ₱2999 / month (maximum visibility & premium benefits)
// Live prices come from public.prices (editable on the Premium page); the
// numbers above are only the fallbacks shown before that table loads.
//
// Every plan — even the free Basic trial — is a subscriptions row that an
// admin approves. A seller's plan = the plan of their approved subscription;
// sellers with none are counted under NO_PLAN. Only sellers
// (users.is_seller = true) are counted, by DISTINCT seller, so the plan
// counts + NO_PLAN === total sellers.

// The four plans, cheapest → most premium (also the display order).
const PLAN_TIERS = ['Animart Basic', 'Animart Essential', 'Animart Pro', 'Animart Elite'];

// Bucket for sellers without an approved subscription.
const NO_PLAN = 'No Plan';

// Normalize ANY stored/legacy plan value to a canonical plan label. Older rows
// may still hold the retired 3-tier names ('Free' / 'Premium' /
// 'Super Premium') or lowercase keys, depending on whether the plan migration
// has run — map them forward exactly like the mobile app does
// (Free/Basic → Basic, Premium/Pro → Pro, Super Premium/Elite → Elite).
const _PLAN_ALIASES = {
    animartbasic:     'Animart Basic',
    basic:            'Animart Basic',
    free:             'Animart Basic',
    animartessential: 'Animart Essential',
    essential:        'Animart Essential',
    animartpro:       'Animart Pro',
    pro:              'Animart Pro',
    premium:          'Animart Pro',
    animartelite:     'Animart Elite',
    elite:            'Animart Elite',
    superpremium:     'Animart Elite'
};
function normalizePlan(plan) {
    const key = String(plan || '').toLowerCase().replace(/[^a-z]/g, '');
    return _PLAN_ALIASES[key] || (plan ? String(plan) : NO_PLAN);
}

// Rank used when a seller somehow holds two approved plans: keep the higher one.
function planRank(plan) {
    return PLAN_TIERS.indexOf(plan);   // -1 for unknown / NO_PLAN
}

// Normalize subscriptions.billing_cycle to 'weekly' | 'monthly' | 'yearly'.
// Rows written before the billing_cycle migration have no value, so
// missing/null (or anything unrecognized) is treated as 'monthly'.
function normalizeBillingCycle(cycle) {
    const c = String(cycle || '').toLowerCase().trim();
    return c === 'weekly' || c === 'yearly' ? c : 'monthly';
}

function billingCycleLabel(cycle) {
    return { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[normalizeBillingCycle(cycle)];
}

// Converts one billing period's price to a per-month rate (for MRR):
// weekly × 52/12, yearly ÷ 12, monthly as-is.
function monthlyEquivalent(amount, cycle) {
    const a = Number(amount) || 0;
    switch (normalizeBillingCycle(cycle)) {
        case 'weekly': return a * 52 / 12;
        case 'yearly': return a / 12;
        default:       return a;
    }
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

// Display metadata for the plans + the no-plan bucket (shared so every page
// looks consistent). `key` is the canonical plan label; `id` is the DOM-safe
// element suffix; `short` is the compact label for legends/chips.
const TIER_META = [
    { key: 'Animart Basic',     id: 'basic',     label: 'Animart Basic',     short: 'Basic',     icon: 'sprout', color: '#38BDF8', rgb: '56,189,248'  },
    { key: 'Animart Essential', id: 'essential', label: 'Animart Essential', short: 'Essential', icon: 'zap',    color: '#34D399', rgb: '52,211,153'  },
    { key: 'Animart Pro',       id: 'pro',       label: 'Animart Pro',       short: 'Pro',       icon: 'crown',  color: '#FFD166', rgb: '255,209,102' },
    { key: 'Animart Elite',     id: 'elite',     label: 'Animart Elite',     short: 'Elite',     icon: 'gem',    color: '#C084FC', rgb: '192,132,252' },
    { key: NO_PLAN,             id: 'none',      label: 'No Plan',           short: 'No Plan',   icon: 'user',   color: '#7D8590', rgb: '125,133,144' }
];

// Lookup by canonical plan label (falls back to the no-plan styling).
function tierMeta(plan) {
    return TIER_META.find(t => t.key === plan) || TIER_META[TIER_META.length - 1];
}

// Total revenue from mobile-app subscription payments: sum of subscriptions.price
// over approved (active) + expired rows — pending/rejected were never paid.
// A row's price is the FULL amount for its billing cycle (a yearly row's price
// covers the whole year), so `total`/`active` are money actually collected.
// `mrr` normalizes active plans to a per-month rate (weekly × 52/12,
// yearly ÷ 12) for monthly-recurring-revenue style display.
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
                mrr += monthlyEquivalent(amt, r.billing_cycle);
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

// Returns { 'Animart Basic', 'Animart Essential', 'Animart Pro',
// 'Animart Elite', 'No Plan', totalSellers }.
// On any error, returns all-zero counts and logs (callers render zeros rather
// than breaking the page).
function emptyTierCounts() {
    const z = { totalSellers: 0 };
    TIER_META.forEach(t => { z[t.key] = 0; });
    return z;
}

async function computeSellerTierCounts(client) {
    try {
        // Total sellers (head:true → count only, no rows transferred).
        const { count: totalSellers, error: uErr } = await client
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('is_seller', true);
        if (uErr) throw uErr;

        // Active subscriptions → map each seller to ONE plan (distinct sellers;
        // the highest plan wins if a seller somehow holds two).
        const { data: subs, error: sErr } = await client
            .from('subscriptions')
            .select('user_id, plan')
            .eq('status', 'approved');
        if (sErr) throw sErr;

        const tierByUser = {};
        (subs || []).forEach(s => {
            const tier = normalizePlan(s.plan);
            if (!PLAN_TIERS.includes(tier) || s.user_id == null) return;
            const prev = tierByUser[s.user_id];
            if (!prev || planRank(tier) > planRank(prev)) tierByUser[s.user_id] = tier;
        });

        const counts = emptyTierCounts();
        let subscribers = 0;
        Object.values(tierByUser).forEach(plan => { counts[plan]++; subscribers++; });

        const total = totalSellers || 0;
        counts[NO_PLAN] = Math.max(0, total - subscribers);
        counts.totalSellers = total;
        return counts;
    } catch (e) {
        console.error('TIER STATS ERROR:', e);
        return emptyTierCounts();
    }
}
