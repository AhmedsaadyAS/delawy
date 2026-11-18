// فلاتر الرئيسية: بحث + فئة + توفر، في نموذج GET واحد —
// الفلاتر تعيش في الرابط (قابلة للمشاركة والرجوع)، وتُطبَّق قبل الترقيم.
// القوائم تُرسل تلقائياً عند تغييرها (مع JS)؛ زر «بحث» يعمل بلا JS.
import { Form, Link, useSubmit } from "react-router";

export function Filters({ filters, categories }) {
  const submit = useSubmit();
  const hasFilters = Boolean(filters.q || filters.category || filters.inStock !== null);
  const formKey = JSON.stringify([filters.q, filters.category, filters.inStock]);
  return (
    <Form
      method="get"
      role="search"
      key={formKey}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="mb-1 block text-sm font-bold">
            بحث
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q || ""}
            placeholder="ابحث باسم المنتج أو العلامة…"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-white px-3 py-2"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="category" className="mb-1 block text-sm font-bold">
            الفئة
          </label>
          <select
            id="category"
            name="category"
            defaultValue={filters.category || ""}
            onChange={(e) => submit(e.currentTarget.form)}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 md:w-48"
          >
            <option value="">كل الفئات</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="stock" className="mb-1 block text-sm font-bold">
            التوفر
          </label>
          <select
            id="stock"
            name="stock"
            defaultValue={filters.inStock === null ? "" : String(filters.inStock)}
            onChange={(e) => submit(e.currentTarget.form)}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 md:w-40"
          >
            <option value="">الكل</option>
            <option value="1">متوفر</option>
            <option value="0">غير متوفر</option>
          </select>
        </div>
        <button
          type="submit"
          className="touch-manipulation rounded-lg bg-primary px-4 py-2 font-bold text-white hover:bg-primary-dark"
        >
          بحث
        </button>
        {hasFilters ? (
          <Link to="/" className="rounded-lg px-3 py-2 text-center text-sm font-bold text-primary hover:underline">
            مسح الفلاتر
          </Link>
        ) : null}
      </div>
    </Form>
  );
}
