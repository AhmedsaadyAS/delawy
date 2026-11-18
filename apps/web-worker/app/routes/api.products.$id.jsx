// مسار مورد — نفس عقد /api/products/:id في المدخل القديم، بلا تغيير.
import { getProduct, getHistory } from "../../src/lib/db.js";
import { resolveDeal } from "../../src/lib/ema.js";
import { productJson } from "../../src/lib/product-json.js";
import { env } from "cloudflare:workers";

export async function loader({ params }) {
  const db = env.DB;
  const product = await getProduct(db, Number(params.id));
  if (!product) return Response.json({ error: "product_not_found" }, { status: 404 });
  const points = await getHistory(db, product.id, { limit: 1000 });
  const deal = resolveDeal(product, points);
  return Response.json(productJson(product, deal, points.length));
}
