// Money handling — everything is INTEGER minor units (piastres), never REAL.
// 1 EGP = 100 piastres. Conversion uses string parsing so 57129.95 EGP
// becomes exactly 5712995, never 5712994.999999999.

/** EGP (number|string) -> integer piastres, or null for null/undefined/''. */
export function toMinor(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (s === '') return null;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intPart = '0', fracPart = ''] = body.split('.');
  const frac = (fracPart + '00').slice(0, 2);
  const minor = Math.abs(parseInt(intPart, 10) || 0) * 100 + parseInt(frac, 10);
  return neg ? -minor : minor;
}

/** Integer piastres -> EGP as a float (for JSON output only). */
export function fromMinor(minor) {
  if (minor === null || minor === undefined) return null;
  return minor / 100;
}

/** Integer piastres -> "1,799.00 ج.م" (Western digits, like the Delawy posts). */
export function formatEGP(minor) {
  if (minor === null || minor === undefined) return '—';
  const major = minor / 100;
  return (
    major.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' ج.م'
  );
}

/** Discount percent from (price_minor, original_minor), or null. */
export function discountPct(priceMinor, originalMinor) {
  if (
    priceMinor === null ||
    originalMinor === null ||
    originalMinor === undefined ||
    originalMinor <= 0 ||
    priceMinor >= originalMinor
  ) {
    return null;
  }
  return Math.round(((originalMinor - priceMinor) / originalMinor) * 1000) / 10;
}
