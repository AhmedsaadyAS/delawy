// مسار مورد — نفس عقد /api/products/:id/history في المدخل القديم،
// بما فيه 400 عند days غير 7/30/90.
import { getProduct, getHistory, countHistory } from "../../src/lib/db.js";
import { parseDays, parsePagination, pageMeta } from "../../src/lib/pagination.js";
import { fromMinor } from "../../src/lib/money.js";
import { env } from "cloudflare:workers";

export async function loader({ request, params }) {
  const db = env.DB;
  const id = Number(params.id);
  const product = await getProduct(db, id);
  if (!product) return Response.json({ error: "product_not_found" }, { status: 404 });
  const searchParams = new URL(request.url).searchParams;
  const daysRaw = searchParams.get("days");
  if (daysRaw !== null && ![7, 30, 90].includes(Number(daysRaw))) {
    return Response.json({ error: "days must be 7, 30 or 90" }, { status: 400 });
  }
  const days = parseDays(searchParams, 30);
  const { page, limit, offset } = parsePagination(searchParams, {
    defaultLimit: 200,
    maxLimit: 1000,
  });
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const total = await countHistory(db, id, { sinceIso });
  const points = await getHistory(db, id, { sinceIso, limit, offset });
  return Response.json({
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
