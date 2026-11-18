// Deal quality: time-weighted 30-day EMA + 5 states (SCHEMA.md rev 2).
// The EMA is computed at READ time from price_points — nothing about it is
// stored, so it can never go stale. A product with less than 7 days of
// history is 'unproven': there is no trustworthy EMA yet.
//
// Threshold follows AzTracker: 15% for a ~100 EGP product, 3% for a
// ~100,000 EGP laptop, log-interpolated between them.

const TAU_DAYS = 30;
const HISTORY_MIN_DAYS = 7;

/** Time-weighted EMA (in minor units) over points sorted by ts ascending. */
export function timeWeightedEma(points) {
  if (!points || points.length === 0) return null;
  let ema = points[0].price_minor;
  let prevTs = Date.parse(points[0].ts);
  for (let i = 1; i < points.length; i++) {
    const ts = Date.parse(points[i].ts);
    const dtDays = Math.max(0, (ts - prevTs) / 86_400_000);
    const alpha = 1 - Math.exp(-dtDays / TAU_DAYS);
    ema = alpha * points[i].price_minor + (1 - alpha) * ema;
    prevTs = ts;
  }
  return ema;
}

export function historySpanDays(points) {
  if (!points || points.length < 2) return 0;
  return (
    (Date.parse(points[points.length - 1].ts) - Date.parse(points[0].ts)) /
    86_400_000
  );
}

/** Drop threshold (fraction) for a price in minor units. */
export function dropThreshold(priceMinor) {
  const egp = Math.max(1, priceMinor / 100);
  const t = (Math.log10(egp) - 2) / (5 - 2); // 100 EGP -> 0, 100k EGP -> 1
  const clamped = Math.min(1, Math.max(0, t));
  return 0.15 - (0.15 - 0.03) * clamped;
}

/**
 * Deal state for a product given its current price (minor) and its
 * price_points (sorted by ts ascending).
 * Returns { state, ema_minor, drop_pct } — drop_pct is null when unproven.
 */
export function dealState(currentPriceMinor, points) {
  if (currentPriceMinor === null || currentPriceMinor === undefined) {
    return { state: 'unproven', ema_minor: null, drop_pct: null };
  }
  if (!points || points.length === 0 || historySpanDays(points) < HISTORY_MIN_DAYS) {
    const ema = timeWeightedEma(points);
    return {
      state: 'unproven',
      ema_minor: ema === null ? null : Math.round(ema),
      drop_pct: null,
    };
  }
  const ema = timeWeightedEma(points);
  const drop = (ema - currentPriceMinor) / ema;
  const threshold = dropThreshold(currentPriceMinor);
  let state = 'bad';
  if (drop >= threshold) state = 'hot';
  else if (drop >= threshold / 2) state = 'good';
  else if (drop > 0) state = 'normal';
  return {
    state,
    ema_minor: Math.round(ema),
    drop_pct: Math.round(drop * 1000) / 10,
  };
}

export const DEAL_LABELS = {
  unproven: 'غير مثبَت',
  hot: 'عرض ساخن',
  good: 'عرض جيد',
  normal: 'عادي',
  bad: 'فوق المتوسط',
};

/**
 * Resolve the deal display for a product.
 *
 * A product is verified only if it has at least one successful reading
 * (last_successful_check_at !== null). An unverified product's price comes
 * from the sku list only: it gets NO EMA and NO quality claim — state
 * 'unproven', ema_minor null, price_source 'sku_list'. Its single point (if
 * any) is a listing observation, not a price check.
 */
export function resolveDeal(product, points) {
  const verified =
    product.last_successful_check_at !== null &&
    product.last_successful_check_at !== undefined;
  if (!verified) {
    return {
      state: 'unproven',
      ema_minor: null,
      drop_pct: null,
      verified: false,
      price_source: 'sku_list',
    };
  }
  const deal = dealState(product.current_price_minor, points);
  return { ...deal, verified: true, price_source: 'spike_run' };
}
