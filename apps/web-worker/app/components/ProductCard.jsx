// بطاقة منتج: الصورة (أو «لا توجد صورة»)، الاسم، العلامة والفئة،
// السعر، البائع والتوفر، وحالة الصدق. البطاقة كلها رابط واحد.
import { Link } from "react-router";
import { Price } from "./Price.jsx";
import { StockState } from "./StockState.jsx";
import { DealNote } from "./DealNote.jsx";

export function ProductCard({ product, deal }) {
  return (
    <Link
      to={`/products/${product.id}`}
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 hover:border-primary"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-white">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt=""
            loading="lazy"
            width="400"
            height="300"
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-sm text-muted">لا توجد صورة</span>
        )}
      </div>
      <h2 className="mt-3 line-clamp-2 min-w-0 break-words font-bold leading-snug text-balance">{product.name}</h2>
      <p className="mt-1 truncate text-sm text-muted">
        {[product.brand, product.category].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-3">
        <Price priceMinor={product.current_price_minor} originalMinor={product.current_original_price_minor} />
      </div>
      <p className="mt-2 text-sm text-muted">
        البائع: {product.current_seller || "—"} · <StockState inStock={product.in_stock} />
      </p>
      <div className="mt-2">
        <DealNote deal={deal} />
      </div>
    </Link>
  );
}
