// مسار مورد — نفس عقد /api/products في المدخل القديم، بلا تغيير.
import { countProducts, listProducts, getPointsForProducts } from "../../src/lib/db.js";
import { parsePagination, pageMeta } from "../../src/lib/pagination.js";
import { resolveDeal } from "../../src/lib/ema.js";
import { productJson } from "../../src/lib/product-json.js";
import { env } from "cloudflare:workers";

export async function loader({ request }) {
  const db = env.DB;
  const { page, limit, offset } = parsePagination(new URL(request.url).searchParams);
  const total = await countProducts(db, { active: 1 });
  const rows = await listProducts(db, { active: 1, limit, offset });
  const pointsByProduct = new Map();
  for (const pt of await getPointsForProducts(db, rows.map((r) => r.id))) {
    if (!pointsByProduct.has(pt.product_id)) pointsByProduct.set(pt.product_id, []);
    pointsByProduct.get(pt.product_id).push(pt);
  }
  const data = rows.map((p) => {
    const deal = resolveDeal(p, pointsByProduct.get(p.id) || []);
    return productJson(p, deal, (pointsByProduct.get(p.id) || []).length);
  });
  return Response.json({ ...pageMeta(total, { page, limit }), data });
}
