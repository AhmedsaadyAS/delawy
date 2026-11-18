// ترقيم الرئيسية — روابط تحافظ على الفلاتر الحالية في الرابط.
import { Link } from "react-router";
import { filtersToParams } from "../lib/filters.js";

export function Pagination({ meta, filters }) {
  const href = (page) => {
    const params = filtersToParams(filters, { page });
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };
  return (
    <nav aria-label="ترقيم" className="mt-6 flex items-center justify-center gap-3">
      {meta.page > 1 ? (
        <Link to={href(meta.page - 1)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-bold hover:border-primary">
          السابق
        </Link>
      ) : null}
      <span className="text-sm text-muted">
        صفحة {meta.page} من {meta.total_pages}
      </span>
      {meta.page < meta.total_pages ? (
        <Link to={href(meta.page + 1)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-bold hover:border-primary">
          التالي
        </Link>
      ) : null}
    </nav>
  );
}
