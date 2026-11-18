// D1 queries for the read path. All prices come back as INTEGER minor units.

export async function countProducts(db, { active = 1 } = {}) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM store_products WHERE active = ?')
    .bind(active)
    .first();
  return row ? row.n : 0;
}

export async function listProducts(db, { active = 1, limit, offset }) {
  const { results } = await db
    .prepare(
      `SELECT id, store, external_id, slug, name, brand, category, url,
              current_price_minor, current_original_price_minor, currency,
              current_seller, in_stock, price_updated_at,
              first_seen_at, last_successful_check_at, active
         FROM store_products
        WHERE active = ?
        ORDER BY id ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(active, limit, offset)
    .all();
  return results || [];
}

export async function getProduct(db, id) {
  return await db
    .prepare(
      `SELECT id, store, external_id, slug, name, brand, category, url,
              current_price_minor, current_original_price_minor, currency,
              current_seller, in_stock, price_updated_at,
              first_seen_at, last_successful_check_at, active
         FROM store_products
        WHERE id = ?`,
    )
    .bind(id)
    .first();
}

/** Price points for a product, oldest first. sinceIso is optional. */
export async function getHistory(db, productId, { sinceIso = null, limit = 200, offset = 0 } = {}) {
  const { results } = await db
    .prepare(
      `SELECT id, ts, price_minor, original_price_minor, currency,
              seller, in_stock, source
         FROM price_points
        WHERE product_id = ? AND (? IS NULL OR ts >= ?)
        ORDER BY ts ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(productId, sinceIso, sinceIso, limit, offset)
    .all();
  return results || [];
}

export async function countHistory(db, productId, { sinceIso = null } = {}) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM price_points
        WHERE product_id = ? AND (? IS NULL OR ts >= ?)`,
    )
    .bind(productId, sinceIso, sinceIso)
    .first();
  return row ? row.n : 0;
}

/** All price points for a set of product ids, oldest first (one query). */
export async function getPointsForProducts(db, ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT product_id, ts, price_minor
         FROM price_points
        WHERE product_id IN (${placeholders})
        ORDER BY product_id ASC, ts ASC`,
    )
    .bind(...ids)
    .all();
  return results || [];
}

export async function getCounts(db) {
  const products = await db
    .prepare('SELECT COUNT(*) AS n FROM store_products WHERE active = 1')
    .first();
  const points = await db
    .prepare('SELECT COUNT(*) AS n FROM price_points')
    .first();
  const lastCheck = await db
    .prepare(
      'SELECT MAX(last_successful_check_at) AS v FROM store_products WHERE active = 1',
    )
    .first();
  return {
    products: products ? products.n : 0,
    points: points ? points.n : 0,
    last_successful_check_at: lastCheck ? lastCheck.v : null,
  };
}
