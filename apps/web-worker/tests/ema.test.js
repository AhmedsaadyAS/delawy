import test from 'node:test';
import assert from 'node:assert/strict';
import { timeWeightedEma, dealState, dropThreshold } from '../src/lib/ema.js';

const P = (ts, priceMinor) => ({ ts, price_minor: priceMinor });

test('EMA of a single point is the point itself', () => {
  assert.equal(timeWeightedEma([P('2026-11-16T00:00:00Z', 179900)]), 179900);
  assert.equal(timeWeightedEma([]), null);
});

test('EMA moves toward a new price, more with more time', () => {
  const ema1d = timeWeightedEma([
    P('2026-11-01T00:00:00Z', 200000),
    P('2026-11-02T00:00:00Z', 100000),
  ]);
  const ema20d = timeWeightedEma([
    P('2026-11-01T00:00:00Z', 200000),
    P('2026-11-21T00:00:00Z', 100000),
  ]);
  assert.ok(ema1d > 100000 && ema1d < 200000);
  assert.ok(ema20d < ema1d, 'longer gap should pull EMA closer to the new price');
});

test('deal state is unproven under 7 days of history', () => {
  const points = [
    P('2026-11-16T00:00:00Z', 200000),
    P('2026-11-17T00:00:00Z', 100000),
  ];
  const d = dealState(100000, points);
  assert.equal(d.state, 'unproven');
  assert.equal(d.drop_pct, null);
});

test('deal state hot when the drop beats the threshold', () => {
  // 30 days of history at 2000.00, then a drop to 1000.00 (50% below EMA).
  const points = [
    P('2026-10-01T00:00:00Z', 200000),
    P('2026-10-15T00:00:00Z', 200000),
    P('2026-10-31T00:00:00Z', 100000),
  ];
  const d = dealState(100000, points);
  assert.equal(d.state, 'hot');
  assert.ok(d.drop_pct > 30);
});

test('drop threshold interpolates 15% at 100 EGP to 3% at 100k EGP', () => {
  assert.equal(dropThreshold(100 * 100), 0.15);
  assert.equal(dropThreshold(100000 * 100), 0.03);
  const mid = dropThreshold(10000 * 100);
  assert.ok(mid > 0.03 && mid < 0.15);
});
