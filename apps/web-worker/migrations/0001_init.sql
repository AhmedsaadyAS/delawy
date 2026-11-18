-- 0001_init.sql — initial schema for the read path only.
--
-- Tables: store_products, price_points, poll_runs, poll_failures.
-- Deliberately NOT included here: accounts (users, user_identities),
-- alerts (tracked_products, alerts_log), coupons. Those come later.
--
-- Money is stored as INTEGER minor units (piastres), never REAL:
--   price_minor = price in EGP * 100, currency is always 'EGP' for now.
-- Product identity inside a store is UNIQUE(store, external_id); the
-- internal id is an INTEGER primary key used by the API and URLs.
--
-- Freshness simplification (documented, user-approved 2026-11-18):
-- store_products.last_successful_check_at is updated on every successful
-- read of that product. This is simpler and correct for the small version;
-- the fuller poll_runs-based freshness inference from DECISIONS.md §2 is
-- deferred until the product count grows. price_updated_at is a different
-- thing: the time of the last PRICE change, never shown as "last checked".

CREATE TABLE IF NOT EXISTS store_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  external_id TEXT NOT NULL,
  slug TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  url TEXT,
  offer_code TEXT,
  current_price_minor INTEGER,
  current_original_price_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'EGP',
  current_seller TEXT,
  in_stock INTEGER,
  price_updated_at TEXT,
  first_seen_at TEXT,
  last_successful_check_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (store, external_id)
);
CREATE INDEX IF NOT EXISTS idx_store_products_active ON store_products(active);

CREATE TABLE IF NOT EXISTS price_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES store_products(id),
  ts TEXT NOT NULL,
  price_minor INTEGER NOT NULL,
  original_price_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'EGP',
  seller TEXT,
  in_stock INTEGER,
  run_id INTEGER REFERENCES poll_runs(id),
  source TEXT NOT NULL DEFAULT 'spike_run',
  UNIQUE (product_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_price_points_product_ts ON price_points(product_id, ts);

CREATE TABLE IF NOT EXISTS poll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  slice TEXT NOT NULL,
  source TEXT NOT NULL,
  run_ref TEXT UNIQUE,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  products_checked INTEGER NOT NULL DEFAULT 0,
  products_ok INTEGER NOT NULL DEFAULT 0,
  products_failed INTEGER NOT NULL DEFAULT 0,
  akamai_count INTEGER NOT NULL DEFAULT 0,
  http_429_count INTEGER NOT NULL DEFAULT 0,
  http_403_count INTEGER NOT NULL DEFAULT 0,
  median_latency_ms INTEGER,
  p95_latency_ms INTEGER
);

CREATE TABLE IF NOT EXISTS poll_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES poll_runs(id),
  sku TEXT NOT NULL,
  reason TEXT NOT NULL,
  ts TEXT NOT NULL,
  UNIQUE (run_id, sku, reason)
);
CREATE INDEX IF NOT EXISTS idx_poll_failures_run ON poll_failures(run_id);
