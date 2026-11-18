// فلترة الرئيسية من رابط الصفحة (URL هو مصدر الحقيقة — الفلاتر
// والترقيم يظهران في الرابط ويُشاركان).
// q: بحث نصي (اسم/علامة)؛ category: فئة؛ stock: "1" متوفر، "0" غير متوفر.
import { parsePagination } from "../../src/lib/pagination.js";

export function parseFilters(searchParams) {
  const qRaw = (searchParams.get("q") || "").trim();
  const q = qRaw ? qRaw.slice(0, 100) : null;
  const categoryRaw = (searchParams.get("category") || "").trim();
  const category = categoryRaw ? categoryRaw : null;
  const stockRaw = searchParams.get("stock");
  const inStock = stockRaw === "1" ? 1 : stockRaw === "0" ? 0 : null;
  const { page, limit, offset } = parsePagination(searchParams);
  return { q, category, inStock, page, limit, offset };
}

/** إعادة بناء معاملات الرابط من الفلاتر (لروابط الترقيم). */
export function filtersToParams(filters, overrides = {}) {
  const params = new URLSearchParams();
  const merged = { ...filters, ...overrides };
  if (merged.q) params.set("q", merged.q);
  if (merged.category) params.set("category", merged.category);
  if (merged.inStock === 1) params.set("stock", "1");
  if (merged.inStock === 0) params.set("stock", "0");
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  if (merged.limit && merged.limit !== 20) params.set("limit", String(merged.limit));
  return params;
}
