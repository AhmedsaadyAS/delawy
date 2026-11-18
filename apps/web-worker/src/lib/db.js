// D1 queries for the read path. All prices come back as INTEGER minor units.

/** Escape LIKE wildcards in a user search term. */
export function escapeLike(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Shared WHERE builder for the product list filters. Filters are applied
 * in SQL, before LIMIT/OFFSET, so pagination counts the filtered set.
 * q: substring search over name/brand; category: exact match;
 * inStock: 1 = in stock only, 0 = out of stock only (NULL = unknown,
 * matches neither).
 */
function productWhere({ active = 1, q = null, category = null, inStock = null } = {}) {
  const where = ['active = ?'];
  const binds = [active];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(name LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')`);
    binds.push(like, like);
  }
  if (category) {
    where.push('category = ?');
    binds.push(category);
  }
  if (inStock === 1) where.push('in_stock = 1');
  if (inStock === 0) where.push('in_stock = 0');
  return { where: where.join(' AND '), binds };
}

export async function countProducts(db, opts = {}) {
  const { where, binds } = productWhere(opts);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM store_products WHERE ${where}`)
    .bind(...binds)
    .first();
  return row ? row.n : 0;
}

export async function listProducts(db, { limit, offset, ...opts } = {}) {
  const { where, binds } = productWhere(opts);
  const { results } = await db
    .prepare(
      `SELECT id, store, external_id, slug, name, brand, category, url,
              image_url, current_price_minor, current_original_price_minor, currency,
              current_seller, in_stock, price_updated_at,
              first_seen_at, last_successful_check_at, active
         FROM store_products
        WHERE ${where}
        ORDER BY id ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all();
  return results || [];
}

/** Distinct non-empty categories of active products, for the filter list. */
export async function listCategories(db, { active = 1 } = {}) {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT category FROM store_products
        WHERE active = ? AND category IS NOT NULL AND category != ''
        ORDER BY category ASC`,
    )
    .bind(active)
    .all();
  return (results || []).map((r) => r.category);
}

export async function getProduct(db, id) {
  return await db
    .prepare(
      `SELECT id, store, external_id, slug, name, brand, category, url,
              image_url, current_price_minor, current_original_price_minor, currency,
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
