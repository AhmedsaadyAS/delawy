// الفرق الصادق بين الحالتين — بلا شارة Hot Deals في هذه الشريحة:
// - غير متحقق: سعر قائمة أولي، بلا EMA ولا ادعاء جودة.
// - متحقق لكن التاريخ < 7 أيام: السعر مرصود، لكنه غير كافٍ لتقييم العرض.
export function UnverifiedBadge() {
  return (
    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
      سعر أولي — لم يُتحقق منه
    </span>
  );
}

export function DealNote({ deal }) {
  if (!deal.verified) return <UnverifiedBadge />;
  if (deal.state === "unproven") {
    return <span className="text-xs text-muted">السعر مرصود لكن التاريخ غير كافٍ لتقييم العرض</span>;
  }
  return null;
}
