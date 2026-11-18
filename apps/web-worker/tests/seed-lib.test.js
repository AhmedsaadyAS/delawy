import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, buildSeed, toSql } from '../scripts/seed-lib.mjs';

const SKUS_CSV = `sku,name,url,offer_code,listing_price,original_price,seller,category,selected_at
AAA111,"Phone, With Comma",https://example.com/a,aaa-1,1000.0,1200.0,noon,electronics-and-mobiles/mobiles,2026-11-16T10:00:00Z
BBB222,Laptop X,https://example.com/b,bbb-1,50000.0,60000.0,StoreB,electronics-and-mobiles/laptops,2026-11-16T10:00:00Z
CCC333,New Phone,https://example.com/c,ccc-1,7000.0,8000.0,StoreC,electronics-and-mobiles/mobiles,2026-11-18T10:00:00Z`;

const REMOVED_CSV = `sku,name,url,offer_code,listing_price,original_price,seller,category,selected_at
DDD444,Old Watch Band,https://example.com/d,ddd-1,110.0,180.0,StoreD,electronics-and-mobiles/wearable-technology,2026-11-16T10:00:00Z`;

function rec(overrides) {
  return {
    ts: '2026-11-16T14:00:00Z',
    sku: 'AAA111',
    strategy: 'A',
    http_status: 200,
    attempts: 1,
    impersonate: 'chrome',
    akamai_challenge: false,
    parse_ok: true,
    parser_used: 'json_ld',
    price: 1000.0,
    original_price: 1200.0,
    seller: 'noon',
    in_stock: true,
    offer_code: 'aaa-1',
    elapsed_ms: 1000,
    error: null,
    warp: true,
    ...overrides,
  };
}

test('parseCsv handles quoted commas', () => {
  const rows = parseCsv(SKUS_CSV);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Phone, With Comma');
  assert.equal(rows[0].listing_price, '1000.0');
});

test('seed rejects strategy B, control data, failures — and counts them', () => {
  const records = [
    rec({}),
    rec({ strategy: 'B', price: 999 }),
    rec({ strategy: 'B', price: 999, ts: '2026-11-16T15:00:00Z' }),
    rec({ warp: false, ts: '2026-11-16T16:00:00Z' }),
    rec({ parse_ok: false, price: null, ts: '2026-11-16T17:00:00Z' }),
    rec({ http_status: 403, parse_ok: false, price: null, ts: '2026-11-16T18:00:00Z' }),
    rec({ sku: 'BBB222', price: 50000, original_price: 60000, seller: 'StoreB' }),
  ];
  const seed = buildSeed({
    records,
    skus: parseCsv(SKUS_CSV),
    removedSkus: parseCsv(REMOVED_CSV),
  });
  assert.equal(seed.summary.rejected.strategy_b, 2);
  assert.equal(seed.summary.rejected.control_data, 1);
  assert.equal(seed.summary.rejected.parse_failed, 1);
  assert.equal(seed.summary.rejected.http_403, 1);
  assert.equal(seed.summary.accepted_records, 2);
  // Genuine A-path failures become poll_failures rows.
  assert.equal(seed.failureRows.length, 2);
  assert.deepEqual(
    seed.failureRows.map((f) => f.reason).sort(),
    ['http_403', 'parse_fail'],
  );
});

test('points: first point always, then only on change; latest price wins', () => {
  const records = [
    rec({ ts: '2026-11-16T14:00:00Z', price: 1000 }),
    rec({ ts: '2026-11-16T20:00:00Z', price: 1000 }), // same -> no point
    rec({ ts: '2026-11-17T02:00:00Z', price: 900 }), // change -> point
    rec({ ts: '2026-11-17T08:00:00Z', price: 1100 }), // older ts AFTER newer? no: sorted
    rec({ ts: '2026-11-17T01:00:00Z', price: 950 }), // out of order input, sorted in
  ];
  const seed = buildSeed({
    records,
    skus: parseCsv(SKUS_CSV),
    removedSkus: parseCsv(REMOVED_CSV),
  });
  const pts = seed.points.filter((p) => p.sku === 'AAA111');
  // sorted: 1000 @14:00, 950 @01:00(+1d), 900 @02:00, 1100 @08:00 -> 4 changes
  // (the 20:00 same-price record adds nothing)
  assert.equal(pts.length, 4);
  assert.equal(pts[0].price_minor, 100000);
  assert.equal(pts[pts.length - 1].price_minor, 110000);
  const product = seed.products.find((p) => p.external_id === 'AAA111');
  assert.equal(product.current_price_minor, 110000);
  assert.equal(product.price_updated_at, '2026-11-17T08:00:00Z');
  assert.equal(product.last_successful_check_at, '2026-11-17T08:00:00Z');
});

test('removed SKUs stay in the DB but inactive; new SKUs get a sku_list point', () => {
  const records = [
    rec({ sku: 'DDD444', price: 110, original_price: 180, seller: 'StoreD' }),
    rec({ sku: 'AAA111' }),
  ];
  const seed = buildSeed({
    records,
    skus: parseCsv(SKUS_CSV),
    removedSkus: parseCsv(REMOVED_CSV),
  });
  const removed = seed.products.find((p) => p.external_id === 'DDD444');
  assert.equal(removed.active, 0);
  assert.equal(removed.current_price_minor, 11000);
  const fresh = seed.products.find((p) => p.external_id === 'CCC333');
  assert.equal(fresh.active, 1);
  assert.equal(fresh.current_price_minor, 700000);
  assert.equal(fresh.last_successful_check_at, null);
  // BBB222 and CCC333 both have no readings, so both get a sku_list point.
  const skuListPoints = seed.points.filter((p) => p.source === 'sku_list');
  assert.equal(skuListPoints.length, 2);
  const cccPoint = skuListPoints.find((p) => p.sku === 'CCC333');
  assert.equal(cccPoint.ts, '2026-11-18T10:00:00Z');
  assert.equal(seed.summary.products.total, 4);
  assert.equal(seed.summary.products.inactive, 1);
});

test('runs are reconstructed by timestamp clustering', () => {
  const records = [
    rec({ ts: '2026-11-16T14:00:00Z' }),
    rec({ ts: '2026-11-16T14:10:00Z', sku: 'BBB222', price: 50000, original_price: 60000 }),
    rec({ ts: '2026-11-16T20:00:00Z' }), // >30 min gap -> new batch
  ];
  const seed = buildSeed({
    records,
    skus: parseCsv(SKUS_CSV),
    removedSkus: parseCsv(REMOVED_CSV),
  });
  assert.equal(seed.runs.length, 2);
  assert.equal(seed.runs[0].products_checked, 2);
  assert.equal(seed.runs[1].products_checked, 1);
  assert.ok(seed.runs[0].run_ref.startsWith('seed:batch-'));
});

test('generated SQL is idempotent in shape', () => {
  const records = [rec({})];
  const seed = buildSeed({
    records,
    skus: parseCsv(SKUS_CSV),
    removedSkus: parseCsv(REMOVED_CSV),
  });
  const sql = toSql(seed);
  assert.match(sql, /ON CONFLICT\(run_ref\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT\(store, external_id\) DO UPDATE/);
  assert.match(sql, /INSERT OR IGNORE INTO price_points/);
  assert.match(sql, /excluded\.last_successful_check_at >= store_products\.last_successful_check_at/);
  // Same input -> same SQL (deterministic).
  assert.equal(sql, toSql(seed));
});

test('images: record image_url wins, mapping is the fallback, null when neither', () => {
  const records = [
    rec({ image_url: 'https://f.nooncdn.com/p/a.jpg' }),
    rec({ sku: 'BBB222', price: 50000, original_price: 60000, seller: 'StoreB', image_url: null }),
  ];
  const seed = buildSeed({
    records,
    skus: parseCsv(SKUS_CSV),
    removedSkus: parseCsv(REMOVED_CSV),
    images: {
      AAA111: 'https://f.nooncdn.com/p/mapping.jpg',
      BBB222: 'https://f.nooncdn.com/p/b.jpg',
      CCC333: 'https://f.nooncdn.com/p/c.jpg',
    },
  });
  const a = seed.products.find((p) => p.external_id === 'AAA111');
  assert.equal(a.image_url, 'https://f.nooncdn.com/p/a.jpg'); // record wins
  const b = seed.products.find((p) => p.external_id === 'BBB222');
  assert.equal(b.image_url, 'https://f.nooncdn.com/p/b.jpg'); // mapping fallback
  const c = seed.products.find((p) => p.external_id === 'CCC333');
  assert.equal(c.image_url, 'https://f.nooncdn.com/p/c.jpg'); // sku_list product via mapping
  const d = seed.products.find((p) => p.external_id === 'DDD444');
  assert.equal(d.image_url, null); // neither source -> null
  assert.equal(seed.summary.products.with_image, 3);
  const sql = toSql(seed);
  assert.match(sql, /image_url/);
  assert.match(sql, /UPDATE store_products SET image_url=/);
  assert.equal(sql, toSql(seed)); // deterministic
});
