// حالة التوفر: 1 متوفر، 0 غير متوفر، null غير معروف (لا نختلق حالة).
export function stockLabel(inStock) {
  if (inStock === 1) return "متوفر";
  if (inStock === 0) return "غير متوفر";
  return "غير معروف";
}

export function StockState({ inStock }) {
  return <span className={inStock === 1 ? "font-medium text-primary" : "text-muted"}>{stockLabel(inStock)}</span>;
}
