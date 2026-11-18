// صفحة المنتج: الصورة، السعر، البائع، التوفر، رابط نون الصحيح،
// وآخر فحص ناجح منفصل عن آخر تغيّر سعر، وتاريخ 7/30/90 يوماً
// ضمن البيانات المتاحة. بلا متوسط مختلق ولا قرار Hot Deals.
import { useLoaderData, Link } from "react-router";
import { getProduct, getHistory } from "../../src/lib/db.js";
import { resolveDeal } from "../../src/lib/ema.js";
import { parseDays } from "../../src/lib/pagination.js";
import { formatEGP } from "../../src/lib/money.js";
import { Price } from "../components/Price.jsx";
import { StockState } from "../components/StockState.jsx";
import { UnverifiedBadge } from "../components/DealNote.jsx";
import { CheckTimes } from "../components/CheckTimes.jsx";
import { PriceChart } from "../components/PriceChart.jsx";
import { formatDateTime } from "../lib/dates.js";
import { env } from "cloudflare:workers";

export function meta({ data }) {
  return [{ title: `${data?.product?.name || "منتج"} — ديلاوي` }];
}

export async function loader({ request, params, context }) {
  const db = env.DB;
  const id = Number(params.id);
  const product = await getProduct(db, id);
  if (!product) throw new Response("المنتج غير موجود.", { status: 404 });
  const days = parseDays(new URL(request.url).searchParams, 30);
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const points = await getHistory(db, id, { sinceIso, limit: 1000 });
  const allPoints = await getHistory(db, id, { limit: 1000 });
  const deal = resolveDeal(product, allPoints);
  return { product, deal, points, days };
}

export default function ProductDetail() {
  const { product, deal, points, days } = useLoaderData();
  const minPoint = points.length
    ? points.reduce((a, b) => (b.price_minor < a.price_minor ? b : a), points[0])
    : null;
  const maxPoint = points.length
    ? points.reduce((a, b) => (b.price_minor > a.price_minor ? b : a), points[0])
    : null;
  const minMax = deal.verified && minPoint ? formatEGP(minPoint.price_minor) : "—";
  const maxMax = deal.verified && maxPoint ? formatEGP(maxPoint.price_minor) : "—";
  const emaNote = !deal.verified
    ? "لا يوجد متوسط — المنتج لم يُفحص بعد"
    : deal.drop_pct !== null
      ? `أقل من المتوسط بنسبة ${deal.drop_pct}%`
      : "تاريخ أقل من 7 أيام — غير مثبَت";
  const rows = [...points].reverse();
  return (
    <>
      <Link to="/" className="text-sm font-bold text-primary hover:underline">
        ← كل المنتجات
      </Link>
      <h1 className="mt-2 break-words text-2xl font-bold leading-snug text-balance">{product.name}</h1>
      <p className="mt-1 text-muted">
        {[product.brand, product.category].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex aspect-square w-44 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt=""
              loading="lazy"
              width="400"
              height="400"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-sm text-muted">لا توجد صورة</span>
          )}
        </div>
        <div className="min-w-0">
          <Price
            priceMinor={product.current_price_minor}
            originalMinor={product.current_original_price_minor}
            size="lg"
          />
          <div className="mt-2">{deal.verified ? null : <UnverifiedBadge />}</div>
        </div>
        <div className="text-sm text-muted">
          <div>
            البائع: {product.current_seller || "—"}
          </div>
          <div>
            <StockState inStock={product.in_stock} />
          </div>
          <CheckTimes product={product} verified={deal.verified} />
        </div>
        {product.url ? (
          <a
            href={product.url}
            target="_blank"
            rel="noopener"
            className="touch-manipulation ms-auto rounded-lg bg-primary px-4 py-2 font-bold text-white hover:bg-primary-dark"
          >
            اشترِ من نون
          </a>
        ) : null}
      </div>

      {!deal.verified ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          سعر أولي من القائمة — لم يُتحقق منه بعد. هذا السعر من قائمة المنتجات وقت الإعداد، ولم يُفحص بعد من
          صفحة المنتج على نون.
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 text-center md:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs text-muted">أقل سعر ({days} يوم)</div>
          <div className="text-lg font-bold tabular-nums">{minMax}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs text-muted">أعلى سعر ({days} يوم)</div>
          <div className="text-lg font-bold tabular-nums">{maxMax}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-xs text-muted">متوسط 30 يوم (EMA)</div>
          <div className="text-lg font-bold tabular-nums">
            {deal.ema_minor !== null ? formatEGP(deal.ema_minor) : "—"}
          </div>
          <div className="text-sm text-muted">{emaNote}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            to={`/products/${product.id}?days=${d}`}
            aria-current={d === days ? "true" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
              d === days ? "bg-primary text-white" : "border border-border bg-surface hover:border-primary"
            }`}
          >
            {d} يوم
          </Link>
        ))}
        <span className="text-sm text-muted">{points.length} نقطة</span>
      </div>
      <div className="mt-2">
        <PriceChart points={points} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-muted">
              <th scope="col" className="px-2 py-2">الوقت</th>
              <th scope="col" className="px-2 py-2">السعر</th>
              <th scope="col" className="px-2 py-2">قبل الخصم</th>
              <th scope="col" className="px-2 py-2">البائع</th>
              <th scope="col" className="px-2 py-2">التوفر</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-muted" colSpan="5">
                  لا يوجد تاريخ سعر بعد.
                </td>
              </tr>
            ) : (
              rows.map((pt) => (
                <tr key={pt.id} className="border-t border-border">
                  <td className="px-2 py-2">{formatDateTime(pt.ts)}</td>
                  <td className="px-2 py-2 font-bold tabular-nums">{formatEGP(pt.price_minor)}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {pt.original_price_minor ? formatEGP(pt.original_price_minor) : "—"}
                  </td>
                  <td className="px-2 py-2">{pt.seller || "—"}</td>
                  <td className="px-2 py-2">
                    <StockState inStock={pt.in_stock} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">
        الأسعار من متابعة نون الفعلية (Spike) — ليست عرضاً حياً من المتجر. SKU: {product.external_id}
      </p>
    </>
  );
}
