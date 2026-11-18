// عرض السعر: الحالي بارز بالأخضر الغامق وأرقام جدولية، والمشطوب
// ونسبة الخصم (بيانات المتجر نفسه) أصغر تحته.
import { formatEGP, discountPct } from "../../src/lib/money.js";

export function Price({ priceMinor, originalMinor, size = "md" }) {
  const pct = discountPct(priceMinor, originalMinor);
  const current = size === "lg" ? "text-3xl font-bold" : "text-xl font-bold";
  return (
    <div className="min-w-0">
      <div className={`${current} tabular-nums text-primary`}>{formatEGP(priceMinor)}</div>
      {originalMinor && pct !== null ? (
        <div className="text-sm text-muted">
          <span className="line-through">{formatEGP(originalMinor)}</span>{" "}
          <span className="font-bold text-primary">-{pct}%</span>
        </div>
      ) : null}
    </div>
  );
}
