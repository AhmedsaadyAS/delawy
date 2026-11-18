// آخر فحص ناجح منفصل عن آخر تغيّر سعر — بلا اختلاق وقت.
// المنتج غير المتحقق سعره من القائمة، فيُسمّى «سعر القائمة بتاريخ».
import { formatDateTime } from "../lib/dates.js";

export function CheckTimes({ product, verified }) {
  return (
    <div className="text-sm text-muted">
      <div>آخر فحص ناجح: {formatDateTime(product.last_successful_check_at)}</div>
      <div>
        {verified ? "آخر تغيّر سعر" : "سعر القائمة بتاريخ"}: {formatDateTime(product.price_updated_at)}
      </div>
    </div>
  );
}
