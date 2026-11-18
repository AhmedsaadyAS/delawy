// Seed transform — pure logic, no I/O, no D1. Tested in tests/seed-lib.test.js.
//
// Inputs:
//   records      — parsed spike/data/results.jsonl rows (unified Spike record)
//   skus         — current spike/skus.csv rows (active = 1)
//   removedSkus  — seed/removed-skus.csv rows: SKUs that left skus.csv (active = 0)
//   images       — seed/sku-images.json map sku -> image_url (backfill fallback;
//                  a record's own image_url wins over the mapping)
//
// Rules (from the task brief):
//   - Strategy A only; parse_ok=true and HTTP 200 only; warp=true only
//     (control data is excluded from the production price source).
//   - Never let an older price overwrite a newer one: records are applied in
//     ts order and the current state always comes from the latest record.
//   - Historical products (left skus.csv) are kept, but inactive.
//   - A first price point is added for every product, even if its price never
//     changed; later points only on price / original-price / seller / stock
//     change. Nothing is invented: a product with no readings gets its first
//     point from its skus.csv listing price at selected_at (source='sku_list').
//   - poll_runs rows are RECONSTRUCTED by clustering record timestamps
//     (gap > 30 min starts a new batch). results.jsonl carries no GitHub run
//     ids, so run_ref is a deterministic 'seed:batch-<started_at>' string.
//   - Absence of a poll_failures row is NOT proof a product was checked:
//     freshness is per-product last_successful_check_at = max ts of its own
//     accepted readings. A product absent from a run keeps its old timestamp.

import { toMinor } from '../src/lib/money.js';

export const RUN_GAP_MS = 30 * 60 * 1000;

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      // skip, \n follows
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function p95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function reasonFor(record) {
  if (record.strategy !== 'A') return 'strategy_b';
  if (record.warp !== true) return 'control_data';
  if (record.http_status !== 200) return `http_${record.http_status}`;
  if (record.parse_ok !== true) return 'parse_failed';
  if (record.price === null || record.price === undefined) return 'missing_price';
  return null;
}

function failureReason(record) {
  if (record.http_status === 403) return 'http_403';
  if (record.http_status === 429) return 'http_429';
  if (record.akamai_challenge) return 'akamai_challenge';
  if (record.parse_ok !== true) return 'parse_fail';
  if (record.price === null || record.price === undefined) return 'parse_fail';
  return 'timeout';
}

export function buildSeed({ records, skus, removedSkus, images = {} }) {
  const rejected = {};
  const reject = (reason) => {
    rejected[reason] = (rejected[reason] || 0) + 1;
  };

  // ---- metadata ----
  const meta = new Map();
  for (const r of skus) {
    meta.set(r.sku, {
      sku: r.sku,
      name: r.name,
      url: r.url,
      offer_code: r.offer_code || null,
      listing_price: r.listing_price === '' ? null : Number(r.listing_price),
      original_price: r.original_price === '' ? null : Number(r.original_price),
      seller: r.seller || null,
      category: r.category || null,
      selected_at: r.selected_at || null,
      active: 1,
    });
  }
  for (const r of removedSkus) {
    if (!meta.has(r.sku)) {
      meta.set(r.sku, {
        sku: r.sku,
        name: r.name,
        url: r.url,
        offer_code: r.offer_code || null,
        listing_price: r.listing_price === '' ? null : Number(r.listing_price),
        original_price: r.original_price === '' ? null : Number(r.original_price),
        seller: r.seller || null,
        category: r.category || null,
        selected_at: r.selected_at || null,
        active: 0,
      });
    }
  }

  // ---- filter records ----
  const accepted = [];
  const failures = [];
  for (const rec of records) {
    const reason = reasonFor(rec);
    if (reason) {
      reject(reason);
      // Genuine A-path failures (not strategy B / control) go to poll_failures.
      if (rec.strategy === 'A' && rec.warp === true) {
        failures.push({ sku: rec.sku, ts: rec.ts, reason: failureReason(rec) });
      }
      continue;
    }
    accepted.push(rec);
  }
  accepted.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // ---- reconstruct poll_runs by timestamp clustering ----
  const batches = [];
  for (const rec of accepted) {
    const ts = Date.parse(rec.ts);
    const last = batches[batches.length - 1];
    if (!last || ts - Date.parse(last.lastTs) > RUN_GAP_MS) {
      batches.push({
        run_ref: `seed:batch-${rec.ts.replace(/[^0-9]/g, '').slice(0, 14)}`,
        started_at: rec.ts,
        finished_at: rec.ts,
        lastTs: rec.ts,
        records: [rec],
      });
    } else {
      last.finished_at = rec.ts;
      last.lastTs = rec.ts;
      last.records.push(rec);
    }
  }
  const runs = batches.map((b) => {
    const latencies = b.records
      .map((r) => r.elapsed_ms)
      .filter((v) => typeof v === 'number');
    return {
      store: 'noon',
      slice: 'warp-50',
      source: 'spike',
      run_ref: b.run_ref,
      started_at: b.started_at,
      finished_at: b.finished_at,
      products_checked: new Set(b.records.map((r) => r.sku)).size,
      products_ok: b.records.length,
      products_failed: 0,
      akamai_count: b.records.filter((r) => r.akamai_challenge).length,
      http_429_count: b.records.filter((r) => r.http_status === 429).length,
      http_403_count: b.records.filter((r) => r.http_status === 403).length,
      median_latency_ms: median(latencies),
      p95_latency_ms: p95(latencies),
      _startedMs: Date.parse(b.started_at),
      _finishedMs: Date.parse(b.finished_at),
    };
  });

  // Attach failures to the batch whose window contains their ts.
  const failureRows = failures.map((f) => {
    const ts = Date.parse(f.ts);
    let run = runs.find((r) => ts >= r._startedMs && ts <= r._finishedMs);
    if (!run) {
      const before = runs.filter((r) => r._finishedMs <= ts);
      run = before.length ? before[before.length - 1] : runs[0];
    }
    if (run) run.products_failed += 1;
    return { run_ref: run ? run.run_ref : null, sku: f.sku, reason: f.reason, ts: f.ts };
  });

  const batchOf = (ts) => {
    const t = Date.parse(ts);
    const run = runs.find((r) => t >= r._startedMs && t <= r._finishedMs);
    return run ? run.run_ref : runs.length ? runs[runs.length - 1].run_ref : null;
  };

  // ---- group accepted records per SKU ----
  const bySku = new Map();
  for (const rec of accepted) {
    if (!bySku.has(rec.sku)) bySku.set(rec.sku, []);
    bySku.get(rec.sku).push(rec);
  }

  const products = [];
  const points = [];
  let pointsFromRecords = 0;
  let pointsFromSkuList = 0;

  for (const [sku, m] of meta) {
    const recs = bySku.get(sku) || [];
    // Image: latest non-null image_url from accepted records, else the
    // one-off backfill mapping, else null (UI shows a placeholder).
    const recordImage =
      recs.reduce((acc, r) => r.image_url || acc, null) || images[sku] || null;
    if (recs.length === 0) {
      // Product never read: first point from the sku-list listing price.
      // If there is no listing price either, there is nothing honest to import.
      const priceMinor = toMinor(m.listing_price);
      if (priceMinor === null) {
        reject('no_data');
        continue;
      }
      const point = {
        sku,
        ts: m.selected_at,
        price_minor: priceMinor,
        original_price_minor: toMinor(m.original_price),
        seller: m.seller,
        in_stock: null,
        run_ref: null,
        source: 'sku_list',
      };
      points.push(point);
      pointsFromSkuList += 1;
      products.push({
        store: 'noon',
        external_id: sku,
        slug: null,
        name: m.name,
        brand: null,
        category: m.category,
        url: m.url,
        offer_code: m.offer_code,
        image_url: recordImage,
        current_price_minor: priceMinor,
        current_original_price_minor: toMinor(m.original_price),
        currency: 'EGP',
        current_seller: m.seller,
        in_stock: null,
        price_updated_at: m.selected_at,
        first_seen_at: m.selected_at,
        last_successful_check_at: null,
        active: m.active,
      });
      continue;
    }

    // Walk records in ts order; emit a point on first record and on change.
    let prevKey = null;
    let lastPointTs = null;
    for (const rec of recs) {
      const priceMinor = toMinor(rec.price);
      const originalMinor = toMinor(rec.original_price);
      const key = [priceMinor, originalMinor, rec.seller ?? '', rec.in_stock ? 1 : 0].join('|');
      if (prevKey === null || key !== prevKey) {
        points.push({
          sku,
          ts: rec.ts,
          price_minor: priceMinor,
          original_price_minor: originalMinor,
          seller: rec.seller ?? null,
          in_stock: rec.in_stock ? 1 : 0,
          run_ref: batchOf(rec.ts),
          source: 'spike_run',
        });
        pointsFromRecords += 1;
        lastPointTs = rec.ts;
        prevKey = key;
      }
    }
    const latest = recs[recs.length - 1];
    const firstTs = recs[0].ts;
    products.push({
      store: 'noon',
      external_id: sku,
      slug: null,
      name: m.name,
      brand: null,
      category: m.category,
      url: m.url,
      offer_code: m.offer_code,
      image_url: recordImage,
      current_price_minor: toMinor(latest.price),
      current_original_price_minor: toMinor(latest.original_price),
      currency: 'EGP',
      current_seller: latest.seller ?? null,
      in_stock: latest.in_stock ? 1 : 0,
      price_updated_at: lastPointTs,
      first_seen_at: m.selected_at && m.selected_at < firstTs ? m.selected_at : firstTs,
      last_successful_check_at: latest.ts,
      active: m.active,
    });
  }

  // Records for SKUs with no metadata at all (should not happen).
  for (const sku of bySku.keys()) {
    if (!meta.has(sku)) reject('missing_metadata');
  }

  const summary = {
    input: {
      records: records.length,
      skus: skus.length,
      removed_skus: removedSkus.length,
    },
    rejected,
    accepted_records: accepted.length,
    products: {
      total: products.length,
      active: products.filter((p) => p.active === 1).length,
      inactive: products.filter((p) => p.active === 0).length,
      with_readings: products.filter((p) => p.last_successful_check_at !== null).length,
      from_sku_list_only: products.filter((p) => p.last_successful_check_at === null).length,
      with_image: products.filter((p) => p.image_url).length,
    },
    points: {
      total: points.length,
      from_records: pointsFromRecords,
      from_sku_list: pointsFromSkuList,
    },
    runs: runs.length,
    failure_rows: failureRows.length,
  };

  return { products, points, runs, failureRows, summary };
}

// ---- SQL generation (idempotent) ----

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlInt(v) {
  return v === null || v === undefined ? 'NULL' : String(v);
}

export function toSql({ products, points, runs, failureRows }) {
  // NOTE: no BEGIN/COMMIT wrapper — Miniflare's local D1 rejects explicit
  // transaction statements via `wrangler d1 execute`. Statements run in file
  // order; idempotency comes from the ON CONFLICT / OR IGNORE guards.
  const out = [];
  for (const r of runs) {
    out.push(
      `INSERT INTO poll_runs (store, slice, source, run_ref, started_at, finished_at, products_checked, products_ok, products_failed, akamai_count, http_429_count, http_403_count, median_latency_ms, p95_latency_ms) VALUES (${sqlStr(r.store)}, ${sqlStr(r.slice)}, ${sqlStr(r.source)}, ${sqlStr(r.run_ref)}, ${sqlStr(r.started_at)}, ${sqlStr(r.finished_at)}, ${r.products_checked}, ${r.products_ok}, ${r.products_failed}, ${r.akamai_count}, ${r.http_429_count}, ${r.http_403_count}, ${sqlInt(r.median_latency_ms)}, ${sqlInt(r.p95_latency_ms)}) ON CONFLICT(run_ref) DO NOTHING;`,
    );
  }
  for (const p of products) {
    out.push(
      `INSERT INTO store_products (store, external_id, slug, name, brand, category, url, offer_code, image_url, current_price_minor, current_original_price_minor, currency, current_seller, in_stock, price_updated_at, first_seen_at, last_successful_check_at, active) VALUES (${sqlStr(p.store)}, ${sqlStr(p.external_id)}, ${sqlStr(p.slug)}, ${sqlStr(p.name)}, ${sqlStr(p.brand)}, ${sqlStr(p.category)}, ${sqlStr(p.url)}, ${sqlStr(p.offer_code)}, ${sqlStr(p.image_url)}, ${sqlInt(p.current_price_minor)}, ${sqlInt(p.current_original_price_minor)}, ${sqlStr(p.currency)}, ${sqlStr(p.current_seller)}, ${sqlInt(p.in_stock)}, ${sqlStr(p.price_updated_at)}, ${sqlStr(p.first_seen_at)}, ${sqlStr(p.last_successful_check_at)}, ${p.active}) ON CONFLICT(store, external_id) DO UPDATE SET name=excluded.name, url=excluded.url, offer_code=excluded.offer_code, image_url=excluded.image_url, current_price_minor=excluded.current_price_minor, current_original_price_minor=excluded.current_original_price_minor, current_seller=excluded.current_seller, in_stock=excluded.in_stock, price_updated_at=excluded.price_updated_at, last_successful_check_at=excluded.last_successful_check_at, active=excluded.active WHERE excluded.last_successful_check_at IS NOT NULL AND (store_products.last_successful_check_at IS NULL OR excluded.last_successful_check_at >= store_products.last_successful_check_at);`,
    );
  }
  // Fill a missing image without touching the no-regression guard above:
  // sku_list-only products never pass that guard (no successful check), so
  // their first image arrives through this pass. Never overwrites an image.
  for (const p of products) {
    if (p.image_url) {
      out.push(
        `UPDATE store_products SET image_url=${sqlStr(p.image_url)} WHERE store='noon' AND external_id=${sqlStr(p.external_id)} AND image_url IS NULL;`,
      );
    }
  }
  for (const pt of points) {
    const productSub = `(SELECT id FROM store_products WHERE store='noon' AND external_id=${sqlStr(pt.sku)})`;
    const runSub = pt.run_ref
      ? `(SELECT id FROM poll_runs WHERE run_ref=${sqlStr(pt.run_ref)})`
      : 'NULL';
    out.push(
      `INSERT OR IGNORE INTO price_points (product_id, ts, price_minor, original_price_minor, currency, seller, in_stock, run_id, source) VALUES (${productSub}, ${sqlStr(pt.ts)}, ${sqlInt(pt.price_minor)}, ${sqlInt(pt.original_price_minor)}, 'EGP', ${sqlStr(pt.seller)}, ${sqlInt(pt.in_stock)}, ${runSub}, ${sqlStr(pt.source)});`,
    );
  }
  for (const f of failureRows) {
    if (!f.run_ref) continue;
    const runSub = `(SELECT id FROM poll_runs WHERE run_ref=${sqlStr(f.run_ref)})`;
    out.push(
      `INSERT OR IGNORE INTO poll_failures (run_id, sku, reason, ts) VALUES (${runSub}, ${sqlStr(f.sku)}, ${sqlStr(f.reason)}, ${sqlStr(f.ts)});`,
    );
  }
  return out.join('\n') + '\n';
}
