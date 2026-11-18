import test from 'node:test';
import assert from 'node:assert/strict';
import { productCard, detailPage } from '../src/lib/html.js';

const base = {
  id: 1,
  external_id: 'AAA111',
  name: 'Test Product',
  brand: null,
  category: null,
  url: 'https://www.noon.com/egypt-en/test/AAA111/p/',
  current_price_minor: 100000,
  current_original_price_minor: 120000,
  current_seller: 'noon',
  in_stock: 1,
  last_successful_check_at: '2026-11-18T08:39:19Z',
  price_updated_at: '2026-11-18T08:39:19Z',
};
const verifiedDeal = {
  verified: true,
  state: 'normal',
  ema_minor: 100000,
  drop_pct: null,
};

test('productCard renders the image when present', () => {
  const html = productCard(
    { ...base, image_url: 'https://f.nooncdn.com/p/a.jpg' },
    verifiedDeal,
  );
  assert.match(html, /<img src="https:\/\/f\.nooncdn\.com\/p\/a\.jpg"/);
  assert.match(html, /loading="lazy"/);
});

test('productCard shows a placeholder without an image', () => {
  const html = productCard({ ...base, image_url: null }, verifiedDeal);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /لا توجد صورة/);
});

test('detailPage renders the image', () => {
  const html = detailPage(
    { ...base, image_url: 'https://f.nooncdn.com/p/a.jpg' },
    verifiedDeal,
    [],
    30,
  );
  assert.match(html, /<img src="https:\/\/f\.nooncdn\.com\/p\/a\.jpg"/);
});
