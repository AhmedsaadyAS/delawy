import test from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, fromMinor, formatEGP, discountPct } from '../src/lib/money.js';

test('toMinor converts EGP to integer piastres exactly', () => {
  assert.equal(toMinor(1799), 179900);
  assert.equal(toMinor(1799.0), 179900);
  assert.equal(toMinor(5728.05), 572805);
  assert.equal(toMinor(57129.95), 5712995);
  assert.equal(toMinor(67164.4), 6716440);
  assert.equal(toMinor('747.60'), 74760);
  assert.equal(toMinor(0), 0);
});

test('toMinor returns null for missing values', () => {
  assert.equal(toMinor(null), null);
  assert.equal(toMinor(undefined), null);
  assert.equal(toMinor(''), null);
});

test('fromMinor and formatEGP round-trip', () => {
  assert.equal(fromMinor(179900), 1799);
  assert.equal(fromMinor(null), null);
  assert.equal(formatEGP(179900), '1,799.00 ج.م');
  assert.equal(formatEGP(74760), '747.60 ج.م');
  assert.equal(formatEGP(null), '—');
});

test('discountPct', () => {
  assert.equal(discountPct(314000, 1000000), 68.6);
  assert.equal(discountPct(179900, 220000), 18.2);
  assert.equal(discountPct(100, 100), null);
  assert.equal(discountPct(100, null), null);
  assert.equal(discountPct(200, 100), null);
});
