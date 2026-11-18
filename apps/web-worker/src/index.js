// Delawy web worker — read-only experimental app.
// Routes:
//   GET /                          HTML product list (active products)
//   GET /products/:id              HTML product page + price history
//   GET /api/health                JSON health + counts
//   GET /api/products              JSON list, ?page=&limit= (limit max 100)
//   GET /api/products/:id          JSON detail (+ EMA, deal state)
//   GET /api/products/:id/history  JSON points, ?days=7|30|90 (default 30)
// No writes, no auth, no KV. D1 binding is named DB.

import {
  countProducts,
  listProducts,
  getProduct,
  getHistory,
  countHistory,
  getPointsForProducts,
  getCounts,
} from './lib/db.js';
import { parsePagination, pageMeta, parseDays } from './lib/pagination.js';
import { dealState } from './lib/ema.js';
import { fromMinor } from './lib/money.js';
import { listPage, detailPage, notFoundPage } from './lib/html.js';

const VERSION = '0.1.0';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function productJson(p, deal, pointsCount) {
  return {
    id: p.id,
    store: p.store,
    external_id: p.external_id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    url: p.url,
    offer_code: p.offer_code,
    current_price_minor: p.current_price_minor,
    current_price: fromMinor(p.current_price_minor),
    current_original_price_minor: p.current_original_price_minor,
    current_original_price: fromMinor(p.current_original_price_minor),
    currency: p.currency,
    current_seller: p.current_seller,
    in_stock: p.in_stock,
    price_updated_at: p.price_updated_at,
    first_seen_at: p.first_seen_at,
    last_successful_check_at: p.last_successful_check_at,
    active: p.active,
    ema_minor: deal.ema_minor,
    ema: fromMinor(deal.ema_minor),
    deal_state: deal.state,
    drop_pct: deal.drop_pct,
    points_count: pointsCount,
  };
}

export default {
  async fetch(request, env) {
    const db = env.DB;
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- JSON API ----
      if (path === '/api/health') {
        const counts = await getCounts(db);
        return json({ ok: true, version: VERSION, store: 'noon', ...counts });
      }

      if (path === '/api/products') {
        const { page, limit, offset } = parsePagination(url.searchParams);
        const total = await countProducts(db, { active: 1 });
        const rows = await listProducts(db, { active: 1, limit, offset });
        const pointsByProduct = new Map();
        for (const pt of await getPointsForProducts(db, rows.map((r) => r.id))) {
          if (!pointsByProduct.has(pt.product_id)) pointsByProduct.set(pt.product_id, []);
          pointsByProduct.get(pt.product_id).push(pt);
        }
        const data = rows.map((p) => {
          const deal = dealState(p.current_price_minor, pointsByProduct.get(p.id) || []);
          return productJson(p, deal, (pointsByProduct.get(p.id) || []).length);
        });
        return json({ ...pageMeta(total, { page, limit }), data });
      }

      const productMatch = path.match(/^\/api\/products\/(\d+)(\/history)?$/);
      if (productMatch) {
        const id = Number(productMatch[1]);
        const product = await getProduct(db, id);
        if (!product) return json({ error: 'product_not_found' }, 404);

        if (productMatch[2] === '/history') {
          const daysRaw = url.searchParams.get('days');
          if (daysRaw !== null && ![7, 30, 90].includes(Number(daysRaw))) {
            return json({ error: 'days must be 7, 30 or 90' }, 400);
          }
          const days = parseDays(url.searchParams, 30);
          const { page, limit, offset } = parsePagination(url.searchParams, {
            defaultLimit: 200,
            maxLimit: 1000,
          });
          const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
          const total = await countHistory(db, id, { sinceIso });
          const points = await getHistory(db, id, { sinceIso, limit, offset });
          return json({
            product_id: id,
            days,
            ...pageMeta(total, { page, limit }),
            data: points.map((pt) => ({
              ts: pt.ts,
              price_minor: pt.price_minor,
              price: fromMinor(pt.price_minor),
              original_price_minor: pt.original_price_minor,
              original_price: fromMinor(pt.original_price_minor),
              currency: pt.currency,
              seller: pt.seller,
              in_stock: pt.in_stock,
              source: pt.source,
            })),
          });
        }

        const points = await getHistory(db, id, { limit: 1000 });
        const deal = dealState(product.current_price_minor, points);
        return json(productJson(product, deal, points.length));
      }

      if (path.startsWith('/api/')) {
        return json({ error: 'not_found' }, 404);
      }

      // ---- HTML pages ----
      if (path === '/') {
        const { page, limit, offset } = parsePagination(url.searchParams);
        const total = await countProducts(db, { active: 1 });
        const rows = await listProducts(db, { active: 1, limit, offset });
        const pointsByProduct = new Map();
        for (const pt of await getPointsForProducts(db, rows.map((r) => r.id))) {
          if (!pointsByProduct.has(pt.product_id)) pointsByProduct.set(pt.product_id, []);
          pointsByProduct.get(pt.product_id).push(pt);
        }
        const deals = rows.map((p) =>
          dealState(p.current_price_minor, pointsByProduct.get(p.id) || []),
        );
        return html(listPage(rows, deals, pageMeta(total, { page, limit })));
      }

      const htmlMatch = path.match(/^\/products\/(\d+)$/);
      if (htmlMatch) {
        const id = Number(htmlMatch[1]);
        const product = await getProduct(db, id);
        if (!product) return html(notFoundPage('المنتج غير موجود.'), 404);
        const days = parseDays(url.searchParams, 30);
        const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
        const points = await getHistory(db, id, { sinceIso, limit: 1000 });
        const allPoints = await getHistory(db, id, { limit: 1000 });
        const deal = dealState(product.current_price_minor, allPoints);
        return html(detailPage(product, deal, points, days));
      }

      return html(notFoundPage('الصفحة غير موجودة.'), 404);
    } catch (err) {
      console.error(err);
      if (path.startsWith('/api/')) {
        return json({ error: 'internal_error' }, 500);
      }
      return html(notFoundPage('حدث خطأ غير متوقع.'), 500);
    }
  },
};
