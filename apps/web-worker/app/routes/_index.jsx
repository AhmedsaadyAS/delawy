// الرئيسية: عنوان + بحث وفلاتر (في الرابط) + الكتالوج + ترقيم.
// الفلاتر تُطبَّق في SQL قبل الترقيم، والـ loader يقرأ من D1 مباشرةً
// (نفس مسار القراءة — بلا استدعاء HTTP للـ API العامة).
import { useLoaderData } from "react-router";
import { countProducts, listProducts, getPointsForProducts, listCategories } from "../../src/lib/db.js";
import { resolveDeal } from "../../src/lib/ema.js";
import { pageMeta } from "../../src/lib/pagination.js";
import { parseFilters } from "../lib/filters.js";
import { env } from "cloudflare:workers";
import { ProductCard } from "../components/ProductCard.jsx";
import { Filters } from "../components/Filters.jsx";
import { Pagination } from "../components/Pagination.jsx";

export function meta() {
  return [{ title: "أسعار نون مصر — ديلاوي" }];
}

export async function loader({ request, context }) {
  const db = env.DB;
  const filters = parseFilters(new URL(request.url).searchParams);
  const total = await countProducts(db, filters);
  const rows = await listProducts(db, filters);
  const pointsByProduct = new Map();
  for (const pt of await getPointsForProducts(db, rows.map((r) => r.id))) {
    if (!pointsByProduct.has(pt.product_id)) pointsByProduct.set(pt.product_id, []);
    pointsByProduct.get(pt.product_id).push(pt);
  }
  const products = rows.map((p) => ({
    product: p,
    deal: resolveDeal(p, pointsByProduct.get(p.id) || []),
  }));
  const categories = await listCategories(db);
  return { products, categories, meta: pageMeta(total, filters), filters };
}

export default function Home() {
  const { products, categories, meta, filters } = useLoaderData();
  const hasFilters = Boolean(filters.q || filters.category || filters.inStock !== null);
  return (
    <>
      <h1 className="text-2xl font-bold text-balance">أسعار نون مصر</h1>
      <p className="mt-1 text-muted">
        {meta.total} منتج نشط — الأسعار بالجنيه المصري، وتاريخ كل منتج من المتابعة الفعلية.
      </p>
      <div className="mt-4">
        <Filters filters={filters} categories={categories} />
      </div>
      {products.length === 0 ? (
        <p className="mt-8 text-center text-muted">
          {hasFilters ? "لا توجد منتجات مطابقة لبحثك." : "لا توجد منتجات بعد."}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map(({ product, deal }) => (
            <ProductCard key={product.id} product={product} deal={deal} />
          ))}
        </div>
      )}
      <Pagination meta={meta} filters={filters} />
    </>
  );
}
