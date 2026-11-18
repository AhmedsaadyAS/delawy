// Smoke test — assumes `npm run dev` is serving on http://localhost:8787.
//   node scripts/smoke.mjs [baseUrl]
// Exits non-zero on the first failed check; prints one line per check.

const base = process.argv[2] || 'http://localhost:8787';

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  assert(res.ok, `${path} -> HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  assert(ct.includes('application/json'), `${path} content-type ${ct}`);
  return res.json();
}

async function getHtml(path) {
  const res = await fetch(`${base}${path}`);
  assert(res.ok, `${path} -> HTTP ${res.status}`);
  return res.text();
}

const health = await getJson('/api/health').catch(() => null);
await check('health returns ok:true', async () => {
  assert(health && health.ok === true, 'health.ok is not true');
  assert(health.products > 0, `expected products > 0, got ${health.products}`);
  assert(health.points > 0, `expected points > 0, got ${health.points}`);
});

let firstId = null;
await check('products list paginates', async () => {
  const page = await getJson('/api/products?page=1&limit=5');
  assert(Array.isArray(page.data), 'data is not an array');
  assert(page.data.length === 5, `expected 5 items, got ${page.data.length}`);
  assert(page.total >= 50, `expected total >= 50, got ${page.total}`);
  assert(page.total_pages >= 1, 'total_pages missing');
  assert(typeof page.data[0].current_price_minor === 'number', 'price is not integer minor');
  assert(page.data[0].currency === 'EGP', 'currency is not EGP');
  firstId = page.data[0].id;
});

await check('products list rejects bad pagination', async () => {
  const page = await getJson('/api/products?page=0&limit=9999');
  assert(page.page === 1, 'page should clamp to 1');
  assert(page.limit === 100, 'limit should clamp to 100');
});

await check('product detail has EMA + deal state', async () => {
  const p = await getJson(`/api/products/${firstId}`);
  assert(p.id === firstId, 'wrong product');
  assert(typeof p.deal_state === 'string', 'deal_state missing');
  assert('ema_minor' in p, 'ema_minor missing');
  assert(typeof p.points_count === 'number', 'points_count missing');
});

await check('history endpoint validates days', async () => {
  const h = await getJson(`/api/products/${firstId}/history?days=7`);
  assert(Array.isArray(h.data), 'history data is not an array');
  assert(h.days === 7, 'days echo wrong');
  const bad = await fetch(`${base}/api/products/${firstId}/history?days=5`);
  assert(bad.status === 400, `days=5 should be 400, got ${bad.status}`);
});

await check('unknown product is 404', async () => {
  const res = await fetch(`${base}/api/products/999999`);
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

await check('HTML list page renders', async () => {
  const html = await getHtml('/');
  assert(html.includes('ديلاوي'), 'missing brand');
  assert(html.includes('/products/'), 'missing product links');
});

await check('HTML detail page renders chart', async () => {
  const html = await getHtml(`/products/${firstId}`);
  assert(html.includes('<svg'), 'missing SVG chart');
  assert(html.includes('تاريخ السعر') || html.includes('أقل سعر'), 'missing history section');
});

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
